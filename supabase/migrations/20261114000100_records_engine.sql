-- =============================================================================
-- Records engine: every field module (Safety Events, DFRs, Timesheets, Plant
-- Pre-Starts, Risk Assessments, Audits) stores its records as form submissions
-- against an immutable template version. Adds reference numbers, a per-module
-- status pipeline, derived summary fields for rules, approvals, an activity
-- log/comments, and branding settings.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
create or replace function public.pipeline_has_status(p_module public.workflow_module, p_status text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workflow_pipelines w, jsonb_array_elements(w.statuses) s
     where w.module = p_module and s->>'key' = p_status)
$$;

create or replace function public.pipeline_first_open_status(p_module public.workflow_module)
returns text language sql stable security definer set search_path = public as $$
  select s.x->>'key'
    from public.workflow_pipelines w, jsonb_array_elements(w.statuses) with ordinality s(x, ord)
   where w.module = p_module and s.x->>'key' <> 'draft'
   order by s.ord limit 1
$$;

-- Next forward status after p_current (skips draft / rejected / returned).
create or replace function public.pipeline_next_status(p_module public.workflow_module, p_current text)
returns text language sql stable security definer set search_path = public as $$
  with s as (
    select x->>'key' as k, ord
      from public.workflow_pipelines w, jsonb_array_elements(w.statuses) with ordinality t(x, ord)
     where w.module = p_module)
  select k from s
   where ord > coalesce((select ord from s where k = p_current), 0)
     and k not in ('draft', 'rejected', 'returned')
   order by ord limit 1
$$;

-- Dropdowns tied to a lookup list feed a named field rules can test (e.g. severity_levels -> severity).
create or replace function public.lookup_field_name(p_list_key text)
returns text language sql immutable set search_path = public as $$
  select case p_list_key
    when 'event_types' then 'event_type'
    when 'severity_levels' then 'severity'
    when 'plant_categories' then 'plant_category'
    when 'hazard_categories' then 'hazard_category'
    when 'cost_codes' then 'cost_code'
    when 'ticket_types' then 'ticket_type'
    else p_list_key
  end
$$;

create or replace function public.module_prefix(p_module public.workflow_module)
returns text language sql immutable set search_path = public as $$
  select case p_module
    when 'safety_event' then 'SE'
    when 'daily_field_report' then 'DFR'
    when 'plant_prestart' then 'PS'
    when 'audit' then 'AUD'
    when 'risk_assessment' then 'RA'
    when 'timesheet' then 'TS'
    when 'training' then 'TR'
  end
$$;

-- -----------------------------------------------------------------------------
-- Records = form_submissions
-- -----------------------------------------------------------------------------
alter table public.form_submissions
  add column if not exists module public.workflow_module,
  add column if not exists reference text,
  add column if not exists title text,
  add column if not exists summary jsonb not null default '{}'::jsonb,
  add column if not exists last_status_change_at timestamptz not null default now();
update public.form_submissions s
   set module = v.category::text::public.workflow_module
  from public.form_template_versions v
 where v.id = s.template_version_id and s.module is null;
alter table public.form_submissions alter column module set not null;
create unique index if not exists form_submissions_reference on public.form_submissions (reference);
create index if not exists form_submissions_module_idx on public.form_submissions (module, status, created_at desc);
create index if not exists form_submissions_project_idx on public.form_submissions (project_id);

create table public.record_counters (
  module     public.workflow_module primary key,
  last_value int not null default 0
);
alter table public.record_counters enable row level security; -- written only by the trigger

create table public.record_approvals (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.form_submissions(id) on delete cascade,
  rule_id       uuid references public.workflow_rules(id) on delete set null,
  step          int not null,
  approver_role public.app_role not null,
  job_role_id   uuid references public.job_roles(id) on delete set null,
  status        text not null default 'waiting' check (status in ('waiting','pending','approved','rejected','cancelled')),
  due_at        timestamptz,
  decided_by    uuid references public.profiles(id) on delete set null,
  decided_at    timestamptz,
  comment       text,
  created_at    timestamptz not null default now()
);
create index record_approvals_submission_idx on public.record_approvals (submission_id);
create index record_approvals_pending_idx on public.record_approvals (approver_role) where status = 'pending';

create table public.record_events (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.form_submissions(id) on delete cascade,
  kind          text not null check (kind in ('created','status','approval_requested','approval','comment')),
  from_status   text,
  to_status     text,
  body          text,
  actor         uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now()
);
create index record_events_submission_idx on public.record_events (submission_id, created_at);

-- Who can see a record: leaders; the submitter; the submitter's own contractor
-- company; anyone whose role has a pending approval on it.
create or replace function public.can_see_submission(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.form_submissions s
     where s.id = p_id and (
           public.is_leader()
        or s.submitted_by = auth.uid()
        or (public.is_contractor() and s.organization_id = public.current_org_id())
        or exists (select 1 from public.record_approvals a
                    where a.submission_id = s.id and a.status = 'pending'
                      and a.approver_role = public.current_role_name())))
$$;

-- -----------------------------------------------------------------------------
-- Before write: module, reference, organisation, summary, status resolution
-- -----------------------------------------------------------------------------
create or replace function public.submission_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v         public.form_template_versions%rowtype;
  crit      int;
  fields    jsonb;
  hours     numeric;
  n         int;
  requested text := new.status;
  target    text;
  privileged boolean := public.is_service_context() or public.is_leader()
                        or coalesce(current_setting('app.status_guard_bypass', true), '') = 'on';
begin
  if tg_op = 'UPDATE' then
    -- identity columns never change
    new.module := old.module;
    new.reference := old.reference;
    new.template_version_id := old.template_version_id;
    new.submitted_by := old.submitted_by;
    new.organization_id := old.organization_id;
    new.created_at := old.created_at;
  end if;

  select * into v from public.form_template_versions where id = new.template_version_id;
  if v.id is null then
    raise exception 'Template version not found';
  end if;

  if tg_op = 'INSERT' then
    new.module := v.category::text::public.workflow_module;
    new.submitted_by := coalesce(new.submitted_by, auth.uid());
    if new.organization_id is null then
      select organization_id into new.organization_id from public.profiles where id = new.submitted_by;
    end if;
    insert into public.record_counters (module, last_value) values (new.module, 1)
      on conflict (module) do update set last_value = public.record_counters.last_value + 1
      returning last_value into n;
    new.reference := public.module_prefix(new.module) || '-' || lpad(n::text, 5, '0');
  end if;

  new.title := coalesce(nullif(new.title, ''), v.name);
  new.answers := coalesce(new.answers, '{}'::jsonb);

  -- Derived fields for rules and lists.
  select count(*) into crit
    from jsonb_array_elements(v.schema->'sections') s, jsonb_array_elements(s->'questions') q
   where coalesce((q->>'critical')::boolean, false)
     and new.answers->>(q->>'id') in ('fail', 'no');

  select coalesce(jsonb_object_agg(k, val), '{}'::jsonb) into fields from (
    select coalesce(nullif(q->>'fieldKey', ''), public.lookup_field_name(q->>'lookupKey')) as k,
           new.answers->(q->>'id') as val
      from jsonb_array_elements(v.schema->'sections') s, jsonb_array_elements(s->'questions') q
     where (nullif(q->>'fieldKey', '') is not null or nullif(q->>'lookupKey', '') is not null)
       and jsonb_typeof(new.answers->(q->>'id')) in ('string', 'number', 'boolean')
  ) x where k is not null;

  -- Total hours across any table question with an 'hours' column (crew, plant, timesheet rows).
  select sum((r->>'hours')::numeric) into hours
    from jsonb_array_elements(v.schema->'sections') s, jsonb_array_elements(s->'questions') q,
         jsonb_array_elements(case when jsonb_typeof(new.answers->(q->>'id')) = 'array' then new.answers->(q->>'id') else '[]'::jsonb end) r
   where q->>'type' = 'table' and (r->>'hours') ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$';

  new.summary := fields || jsonb_build_object('critical_failures', crit)
                 || case when hours is not null and not fields ? 'total_hours' then jsonb_build_object('total_hours', hours) else '{}'::jsonb end;

  -- Status: non-privileged users may only save drafts or submit.
  if (tg_op = 'INSERT' or new.status is distinct from old.status) and not privileged
     and requested not in ('draft', 'submitted') then
    raise exception 'Only leaders can move a record to "%"', requested;
  end if;

  if requested = 'submitted' and (tg_op = 'INSERT' or old.status is distinct from 'submitted') then
    target := null;
    if crit > 0 then
      target := coalesce(nullif(v.schema->'settings'->>'criticalFailStatus', ''), 'defect_reported');
      if not public.pipeline_has_status(new.module, target) then
        target := null;
      end if;
    end if;
    if target is null then
      target := case when public.pipeline_has_status(new.module, 'submitted') then 'submitted'
                     else public.pipeline_first_open_status(new.module) end;
    end if;
    new.status := coalesce(target, 'submitted');
    if tg_op = 'INSERT' or old.submitted_at is null then
      new.submitted_at := now();
    end if;
  end if;

  if new.status <> 'draft' and not public.pipeline_has_status(new.module, new.status) then
    raise exception 'Status "%" is not in the % pipeline', new.status, new.module;
  end if;

  if tg_op = 'INSERT' or new.status is distinct from old.status then
    new.last_status_change_at := now();
  end if;
  return new;
end $$;

create trigger form_submissions_before_write before insert or update on public.form_submissions
  for each row execute function public.submission_before_write();

-- -----------------------------------------------------------------------------
-- Rules engine (replaces Phase 1 version): also opens approval chains on records
-- -----------------------------------------------------------------------------
create or replace function public.run_workflow_rules(
  p_module public.workflow_module, p_event public.workflow_trigger,
  p_record jsonb, p_old jsonb default null
) returns uuid[]
language plpgsql security definer set search_path = public as $$
declare
  r          public.workflow_rules%rowtype;
  act        jsonb;
  stp        jsonb;
  recip      text;
  matched    uuid[] := '{}';
  msg        text;
  record_org uuid := nullif(p_record->>'organization_id', '')::uuid;
  rec_id     uuid := nullif(p_record->>'id', '')::uuid;
  first_step int;
begin
  for r in
    select * from public.workflow_rules
     where module = p_module and trigger_event = p_event and is_enabled
     order by priority, created_at
  loop
    continue when not public.workflow_rule_matches(r, p_event, p_record, p_old);
    matched := matched || r.id;

    -- Approval chain on a real record (one open chain per rule per record).
    if rec_id is not null and jsonb_array_length(r.approval_chain) > 0
       and exists (select 1 from public.form_submissions where id = rec_id)
       and not exists (select 1 from public.record_approvals
                        where submission_id = rec_id and rule_id = r.id and status in ('waiting', 'pending')) then
      select min((x->>'step')::int) into first_step from jsonb_array_elements(r.approval_chain) x;
      for stp in select * from jsonb_array_elements(r.approval_chain) loop
        insert into public.record_approvals (submission_id, rule_id, step, approver_role, job_role_id, status, due_at)
        values (rec_id, r.id, (stp->>'step')::int, (stp->>'role')::public.app_role,
                nullif(stp->>'job_role_id', '')::uuid,
                case when (stp->>'step')::int = first_step then 'pending' else 'waiting' end,
                case when (stp->>'step')::int = first_step and nullif(stp->>'sla_hours', '') is not null
                     then now() + make_interval(hours => (stp->>'sla_hours')::int) end);
      end loop;
      insert into public.record_events (submission_id, kind, body, actor)
      values (rec_id, 'approval_requested', r.name, null);
    end if;

    for act in select * from jsonb_array_elements(r.actions) loop
      msg := coalesce(nullif(act->>'message', ''), r.name);
      if p_record ? 'reference' then
        msg := (p_record->>'reference') || ': ' || msg;
      end if;
      for recip in select jsonb_array_elements_text(coalesce(act->'recipients', '[]'::jsonb)) loop
        if act->>'type' = 'in_app' then
          insert into public.notifications (user_id, title, body, rule_id, link)
          select p.id, r.name, msg, r.id, p_record->>'link'
            from public.profiles p
           where p.is_active and (
                 (recip like 'role:%' and p.role::text = substring(recip from 6)
                  and (p.role <> 'contractor' or p.organization_id = record_org))
              or (recip = 'submitter' and p.id = nullif(p_record->>'submitted_by', '')::uuid)
              or (recip like 'user:%' and p.id::text = substring(recip from 6)));
        elsif act->>'type' in ('email', 'sms') then
          insert into public.notification_outbox (channel, recipient, subject, body, rule_id, payload)
          select act->>'type', x.addr, r.name, msg, r.id, p_record - 'answers'
            from (
              select case when act->>'type' = 'email' then p.email else p.phone end as addr
                from public.profiles p
               where p.is_active and (
                     (recip like 'role:%' and p.role::text = substring(recip from 6)
                      and (p.role <> 'contractor' or p.organization_id = record_org))
                  or (recip = 'submitter' and p.id = nullif(p_record->>'submitted_by', '')::uuid))
              union all
              select substring(recip from 7) where recip like 'email:%' and act->>'type' = 'email'
            ) x
           where x.addr is not null and x.addr <> '';
        end if;
      end loop;
    end loop;
  end loop;
  return matched;
end $$;
revoke execute on function public.run_workflow_rules(public.workflow_module, public.workflow_trigger, jsonb, jsonb) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- After write: activity log + fire rules
-- -----------------------------------------------------------------------------
create or replace function public.submission_after_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  rec     jsonb;
  old_rec jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.record_events (submission_id, kind, to_status, actor)
    values (new.id, 'created', new.status, new.submitted_by);
  elsif new.status is distinct from old.status then
    insert into public.record_events (submission_id, kind, from_status, to_status, actor)
    values (new.id, 'status', old.status, new.status, auth.uid());
  end if;

  if new.status = 'draft' then
    return null;
  end if;

  rec := (to_jsonb(new) - 'answers')
         || coalesce((select jsonb_object_agg(key, value) from jsonb_each(new.answers)
                       where jsonb_typeof(value) in ('string', 'number', 'boolean')), '{}'::jsonb)
         || new.summary
         || jsonb_build_object('link', '/records/' || new.id);
  if tg_op = 'UPDATE' then
    old_rec := to_jsonb(old) - 'answers';
  end if;

  -- "Created" = first time it leaves draft.
  if tg_op = 'INSERT' or old.status = 'draft' then
    perform public.run_workflow_rules(new.module, 'record_created', rec, null);
    perform public.run_workflow_rules(new.module, 'field_condition', rec, null);
  end if;
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    perform public.run_workflow_rules(new.module, 'status_changed', rec, old_rec);
  end if;
  return null;
end $$;

create trigger form_submissions_after_write after insert or update on public.form_submissions
  for each row execute function public.submission_after_write();

-- -----------------------------------------------------------------------------
-- Approve / reject a pending step
-- -----------------------------------------------------------------------------
create or replace function public.decide_approval(p_approval_id uuid, p_decision text, p_comment text default null)
returns public.record_approvals
language plpgsql security definer set search_path = public as $$
declare
  a      public.record_approvals%rowtype;
  s      public.form_submissions%rowtype;
  nxt    record;
  target text;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected';
  end if;
  select * into a from public.record_approvals where id = p_approval_id for update;
  if a.id is null then
    raise exception 'Approval not found';
  end if;
  if a.status <> 'pending' then
    raise exception 'This approval step is no longer waiting for a decision';
  end if;
  if not (public.is_leader()
          or (public.current_role_name() = a.approver_role
              and (a.job_role_id is null
                   or exists (select 1 from public.profiles where id = auth.uid() and job_role_id = a.job_role_id)))) then
    raise exception 'You are not an approver for this step';
  end if;
  if p_decision = 'rejected' and nullif(trim(coalesce(p_comment, '')), '') is null then
    raise exception 'Add a comment explaining what needs to change';
  end if;

  update public.record_approvals
     set status = p_decision, decided_by = auth.uid(), decided_at = now(), comment = nullif(trim(p_comment), '')
   where id = a.id
  returning * into a;

  select * into s from public.form_submissions where id = a.submission_id for update;
  insert into public.record_events (submission_id, kind, body, actor)
  values (s.id, 'approval', initcap(p_decision) || coalesce(': ' || nullif(trim(p_comment), ''), ''), auth.uid());

  perform set_config('app.status_guard_bypass', 'on', true);
  if p_decision = 'approved' then
    select * into nxt from public.record_approvals
     where submission_id = s.id and rule_id is not distinct from a.rule_id and status = 'waiting'
     order by step limit 1;
    if nxt.id is not null then
      update public.record_approvals
         set status = 'pending',
             due_at = now() + coalesce((select make_interval(hours => (x->>'sla_hours')::int)
                                          from public.workflow_rules wr, jsonb_array_elements(wr.approval_chain) x
                                         where wr.id = a.rule_id and (x->>'step')::int = nxt.step
                                           and nullif(x->>'sla_hours', '') is not null limit 1), interval '0')
       where id = nxt.id;
    elsif not exists (select 1 from public.record_approvals
                       where submission_id = s.id and status in ('waiting', 'pending')) then
      target := public.pipeline_next_status(s.module, s.status);
      if target is not null then
        update public.form_submissions set status = target where id = s.id;
      end if;
    end if;
  else
    update public.record_approvals set status = 'cancelled'
     where submission_id = s.id and status in ('waiting', 'pending');
    -- Back to the submitter: the pipeline's Rejected/Returned status, or draft if it has neither.
    target := case when public.pipeline_has_status(s.module, 'rejected') then 'rejected'
                   when public.pipeline_has_status(s.module, 'returned') then 'returned'
                   else 'draft' end;
    update public.form_submissions set status = target where id = s.id;
  end if;
  perform set_config('app.status_guard_bypass', 'off', true);
  return a;
end $$;

-- -----------------------------------------------------------------------------
-- Branding (one row; readable before sign-in so the login page is branded)
-- -----------------------------------------------------------------------------
create table public.app_settings (
  id            int primary key default 1 check (id = 1),
  company_name  text not null default 'Access & Site Services',
  primary_color text not null default '#2047c6' check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  accent_color  text not null default '#f5b81a' check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  dark_color    text not null default '#13213f' check (dark_color ~ '^#[0-9a-fA-F]{6}$'),
  logo_url      text,
  updated_by    uuid references public.profiles(id) on delete set null,
  updated_at    timestamptz not null default now()
);
insert into public.app_settings (id) values (1) on conflict (id) do nothing;
create trigger app_settings_updated before update on public.app_settings
  for each row execute function public.set_updated_at();

insert into storage.buckets (id, name, public) values ('branding', 'branding', true)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.record_approvals enable row level security;
alter table public.record_events    enable row level security;
alter table public.app_settings     enable row level security;

-- Policies are altered in place (no drops) so the change applies without a destructive step.
alter policy submissions_select on public.form_submissions
  using (public.can_see_submission(id));

alter policy submissions_update_own_draft on public.form_submissions rename to submissions_update;
alter policy submissions_update on public.form_submissions
  using ((submitted_by = auth.uid() and status in ('draft', 'rejected', 'returned')) or public.is_leader())
  with check (public.is_leader() or (submitted_by = auth.uid() and organization_id = public.current_org_id()));

alter policy submissions_insert on public.form_submissions
  with check (
    public.current_role_name() is not null
    and coalesce(submitted_by, auth.uid()) = auth.uid()
    and (organization_id is null or organization_id = public.current_org_id())
    and (project_id is null or public.can_access_project(project_id))
  );

create policy submissions_delete on public.form_submissions for delete to authenticated
  using ((submitted_by = auth.uid() and status = 'draft') or public.is_leader());

create policy approvals_select on public.record_approvals for select to authenticated
  using (public.can_see_submission(submission_id));

create policy events_select on public.record_events for select to authenticated
  using (public.can_see_submission(submission_id));
create policy events_comment on public.record_events for insert to authenticated
  with check (kind = 'comment' and actor = auth.uid() and public.can_see_submission(submission_id));

create policy app_settings_read on public.app_settings for select to anon, authenticated using (true);
create policy app_settings_leader_write on public.app_settings for update to authenticated
  using (public.is_leader()) with check (public.is_leader());

grant select on public.app_settings to anon;
grant select, insert, update, delete on public.record_approvals, public.record_events, public.app_settings to authenticated;
revoke insert, update, delete on public.record_approvals from authenticated;
revoke all on public.record_counters from anon, authenticated;
revoke all on public.record_approvals, public.record_events from anon;

-- Storage: the record's own folder ({org}/{record id}/...) is readable by anyone who can see the record.
create or replace function public.can_see_upload(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((storage.foldername(p_name))[2] ~ '^[0-9a-f-]{36}$', false)
     and public.can_see_submission(((storage.foldername(p_name))[2])::uuid)
$$;

alter policy storage_org_read on storage.objects
  using (
    bucket_id in ('form-uploads','worker-tickets')
    and (public.is_leader()
         or (storage.foldername(name))[1] = public.current_org_id()::text
         or (bucket_id = 'form-uploads' and public.can_see_upload(name)))
  );
create policy storage_branding_write on storage.objects for insert to authenticated
  with check (bucket_id = 'branding' and public.is_leader());
create policy storage_branding_update on storage.objects for update to authenticated
  using (bucket_id = 'branding' and public.is_leader());
create policy storage_branding_delete on storage.objects for delete to authenticated
  using (bucket_id = 'branding' and public.is_leader());

-- Function privileges
revoke execute on function public.submission_before_write() from public, anon, authenticated;
revoke execute on function public.submission_after_write() from public, anon, authenticated;
revoke execute on function public.can_see_submission(uuid) from public, anon;
revoke execute on function public.can_see_upload(text) from public, anon;
revoke execute on function public.decide_approval(uuid, text, text) from public, anon;
revoke execute on function public.pipeline_has_status(public.workflow_module, text) from public, anon;
revoke execute on function public.pipeline_first_open_status(public.workflow_module) from public, anon;
revoke execute on function public.pipeline_next_status(public.workflow_module, text) from public, anon;
grant execute on function public.can_see_submission(uuid), public.can_see_upload(text),
  public.decide_approval(uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Starter templates for the new modules + a timesheet approval rule
-- -----------------------------------------------------------------------------
do $$
declare
  t_id uuid;
  v_id uuid;
  rec record;
begin
  for rec in select * from (values
    ('Daily Field Report', 'Shift report: crew, hours, plant, progress and issues.', 'daily_field_report'::public.template_category,
     '{"settings":{"requireProject":true,"requireSignOff":true},"sections":[
       {"id":"s-shift","title":"Shift","questions":[
         {"id":"q-shift","label":"Shift","type":"dropdown","required":true,"options":["Day","Night"]},
         {"id":"q-weather","label":"Weather","type":"dropdown","required":true,"options":["Fine","Hot (over 35°C)","Wet","Windy","Storm / lightning"]}]},
       {"id":"s-crew","title":"Crew & Hours","questions":[
         {"id":"q-crew","label":"Crew on site","type":"table","required":true,"columns":[{"id":"name","label":"Name","type":"text"},{"id":"role","label":"Role","type":"text"},{"id":"hours","label":"Hours","type":"number"}]}]},
       {"id":"s-plant","title":"Plant & Equipment","questions":[
         {"id":"q-plant","label":"Plant used","type":"table","required":false,"columns":[{"id":"plant","label":"Plant / fleet no.","type":"text"},{"id":"plant_hours","label":"Hours","type":"number"}]}]},
       {"id":"s-progress","title":"Progress","questions":[
         {"id":"q-work","label":"Work completed","type":"text","required":true,"multiline":true},
         {"id":"q-delays","label":"Delays or issues","type":"text","required":false,"multiline":true},
         {"id":"q-photos","label":"Progress photos","type":"photo","required":false}]},
       {"id":"s-sign","title":"Safety & Sign-off","questions":[
         {"id":"q-incidents","label":"Were there any incidents or near misses this shift?","type":"yes_no","required":true,"helpText":"If yes, also log a Safety Event."},
         {"id":"q-sig","label":"Supervisor signature","type":"signature","required":true}]}]}'::jsonb),
    ('Weekly Timesheet', 'Hours worked by each person for the week.', 'timesheet'::public.template_category,
     '{"settings":{"requireProject":true,"requireSignOff":true},"sections":[
       {"id":"s-week","title":"Week","questions":[
         {"id":"q-week","label":"Week ending","type":"text","required":true,"helpText":"e.g. Sunday 15 November"}]},
       {"id":"s-hours","title":"Hours","questions":[
         {"id":"q-hours","label":"Hours worked","type":"table","required":true,"columns":[{"id":"name","label":"Worker","type":"text"},{"id":"day","label":"Day","type":"text"},{"id":"hours","label":"Hours","type":"number"}]}]},
       {"id":"s-sign","title":"Sign-off","questions":[
         {"id":"q-sig","label":"Supervisor signature","type":"signature","required":true}]}]}'::jsonb)
  ) as x(name, description, category, schema)
  loop
    continue when exists (select 1 from public.form_templates where category = rec.category);
    insert into public.form_templates (name, description, category, draft_schema, status, has_unpublished_changes)
    values (rec.name, rec.description, rec.category, rec.schema, 'published', false)
    returning id into t_id;
    insert into public.form_template_versions (template_id, version, name, category, schema, change_note)
    values (t_id, 1, rec.name, rec.category, rec.schema, 'Initial starter template')
    returning id into v_id;
    update public.form_templates set current_version = 1, current_version_id = v_id where id = t_id;
    update public.form_templates set has_unpublished_changes = false where id = t_id;
  end loop;
end $$;

insert into public.workflow_rules (name, description, module, trigger_event, trigger_config, approval_chain, actions, priority)
select 'Timesheet submitted for approval', 'Leaders approve submitted timesheets before payroll.',
       'timesheet', 'status_changed', '{"to_status":"submitted"}'::jsonb,
       '[{"step":1,"role":"leader","sla_hours":48}]'::jsonb,
       '[{"type":"in_app","recipients":["role:leader"],"message":"A timesheet is awaiting approval"}]'::jsonb, 50
where not exists (select 1 from public.workflow_rules where module = 'timesheet');

-- Plant pre-starts with a critical fail go straight to "Defect Reported".
update public.workflow_rules
   set trigger_config = '{"to_status":"defect_reported"}'::jsonb
 where module = 'plant_prestart' and name = 'Plant defect reported';
