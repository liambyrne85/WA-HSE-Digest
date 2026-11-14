-- =============================================================================
-- Stage 1: people profiles, app roles, positions, project assignments, access
-- rules, audit history and archive-instead-of-delete.
--
-- App roles (what a person can see and do):
--   admin            everything + people/company/role administration + settings
--   hset             sees everything; manages safety config (templates, workflow, lists)
--   project_manager  their currently assigned projects
--   supervisor       their currently assigned projects
--   worker           their own submissions + their primary project
-- PMs/Supervisors at a subcontractor only see their own company's people and
-- records on their projects. PMs/Supervisors at the internal company see
-- everyone on their projects.
--
-- Nothing is dropped. Old role values (leader/employee/contractor) are converted
-- (leader -> admin, employee -> worker, contractor -> worker) and then blocked.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- New columns
-- -----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists start_date date,
  add column if not exists is_scaffold_inspector boolean not null default false;

alter table public.user_invitations
  add column if not exists phone text,
  add column if not exists employee_number text,
  add column if not exists start_date date,
  add column if not exists primary_project_id uuid references public.projects(id) on delete set null,
  add column if not exists is_scaffold_inspector boolean not null default false;

alter table public.worker_tickets
  add column if not exists licence_class text,
  add column if not exists archived_at timestamptz;

alter table public.form_submissions
  add column if not exists archived_at timestamptz;

alter table public.workflow_rules
  add column if not exists archived_at timestamptz;

-- -----------------------------------------------------------------------------
-- Project assignments (with history: end_date set instead of deleting)
-- -----------------------------------------------------------------------------
create table public.project_members (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete restrict,
  profile_id  uuid not null references public.profiles(id) on delete restrict,
  is_primary  boolean not null default false,
  start_date  date not null default ((now() at time zone 'Australia/Perth')::date),
  end_date    date,
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint project_members_dates check (end_date is null or end_date >= start_date)
);
create index project_members_profile_idx on public.project_members (profile_id) where end_date is null;
create index project_members_project_idx on public.project_members (project_id) where end_date is null;
-- One open assignment per person per project, and one open primary project per person.
create unique index project_members_one_open on public.project_members (project_id, profile_id) where end_date is null;
-- Checked at commit, so switching primary (clear old, set new) works in one transaction.
alter table public.project_members add constraint project_members_one_primary
  exclude using btree (profile_id with =) where (is_primary and end_date is null) deferrable initially deferred;
create trigger project_members_updated before update on public.project_members
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Helpers (Perth time; role and company checks)
-- -----------------------------------------------------------------------------
create or replace function public.perth_today()
returns date language sql stable set search_path = public as $$
  select (now() at time zone 'Australia/Perth')::date
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active and role = 'admin')
$$;

-- "Leader" = sees everything (Admin and HSET). Kept under this name because
-- existing policies and functions use it.
create or replace function public.is_leader()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active and role in ('admin', 'hset'))
$$;

-- Internal vs subcontractor is now decided by the person's company, not their role.
create or replace function public.is_internal_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p join public.organizations o on o.id = p.organization_id
                  where p.id = auth.uid() and p.is_active and o.type = 'internal')
$$;

create or replace function public.is_contractor()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p join public.organizations o on o.id = p.organization_id
                  where p.id = auth.uid() and p.is_active and o.type = 'contractor')
$$;

create or replace function public.is_project_lead()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active and role in ('project_manager', 'supervisor'))
$$;

-- Projects the current user can see: PM/Supervisor = all current assignments;
-- Worker = current primary project only.
create or replace function public.my_project_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select m.project_id
    from public.project_members m
    join public.profiles p on p.id = m.profile_id and p.is_active
   where m.profile_id = auth.uid()
     and m.start_date <= public.perth_today()
     and (m.end_date is null or m.end_date >= public.perth_today())
     and (p.role in ('project_manager', 'supervisor') or (p.role = 'worker' and m.is_primary))
$$;

create or replace function public.can_access_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_leader() or p_project_id in (select public.my_project_ids())
$$;

-- Can the current user see this person's profile?
create or replace function public.can_see_person(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_profile_id = auth.uid()
      or public.is_leader()
      or (public.is_project_lead() and exists (
            select 1
              from public.project_members m
              join public.profiles them on them.id = m.profile_id
             where m.profile_id = p_profile_id
               and m.project_id in (select public.my_project_ids())
               and (m.end_date is null or m.end_date >= public.perth_today())
               and (public.is_internal_user() or them.organization_id = public.current_org_id())))
$$;

-- Does a given person (not necessarily the caller) see records on a project for a company?
-- Used to target workflow alerts at people who can actually open the record.
create or replace function public.person_sees_project_record(p_profile_id uuid, p_project_id uuid, p_org_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p join public.organizations o on o.id = p.organization_id
     where p.id = p_profile_id and p.is_active and (
           p.role in ('admin', 'hset')
        or (p.role in ('project_manager', 'supervisor')
            and p_project_id is not null
            and exists (select 1 from public.project_members m
                         where m.profile_id = p.id and m.project_id = p_project_id
                           and m.start_date <= public.perth_today()
                           and (m.end_date is null or m.end_date >= public.perth_today()))
            and (o.type = 'internal' or p.organization_id = p_org_id))))
$$;

-- Records: Admin/HSET all; submitter own; PM/Supervisor records on their projects
-- (subcontractor leads: own company's records only).
create or replace function public.can_see_submission(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.form_submissions s
     where s.id = p_id and (
           public.is_leader()
        or s.submitted_by = auth.uid()
        or (public.is_project_lead()
            and s.project_id in (select public.my_project_ids())
            and (public.is_internal_user() or s.organization_id = public.current_org_id()))))
$$;

-- -----------------------------------------------------------------------------
-- Role / company rules, profile guard, sign-up
-- -----------------------------------------------------------------------------
-- Admin and HSET belong to the internal company; other roles can be at any company.
create or replace function public.enforce_role_org_match()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t public.org_type;
begin
  select type into t from public.organizations where id = new.organization_id;
  if t is null then
    raise exception 'Company % does not exist', new.organization_id;
  end if;
  if new.role in ('leader', 'employee', 'contractor') then
    raise exception 'Role "%" is no longer used. Use Admin, HSET, Project Manager, Supervisor or Worker', new.role;
  end if;
  if new.role in ('admin', 'hset') and t <> 'internal' then
    raise exception 'Admin and HSET users must belong to your own company';
  end if;
  return new;
end $$;

create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_service_context() and not public.is_admin() then
    if new.role is distinct from old.role
       or new.organization_id is distinct from old.organization_id
       or new.job_role_id is distinct from old.job_role_id
       or new.employee_number is distinct from old.employee_number
       or new.start_date is distinct from old.start_date
       or new.is_scaffold_inspector is distinct from old.is_scaffold_inspector
       or new.is_active is distinct from old.is_active
       or new.email is distinct from old.email then
      raise exception 'Only admins can change role, company, position, employee ID, start date, inspector status or account status';
    end if;
  end if;

  if old.role = 'admin' and old.is_active
     and (new.role <> 'admin' or not new.is_active)
     and (select count(*) from public.profiles where role = 'admin' and is_active and id <> old.id) = 0 then
    raise exception 'Cannot remove the last active admin';
  end if;
  return new;
end $$;

-- New login -> profile. Invited people inherit everything on their invitation
-- (role, company, position, mobile, employee ID, start date, primary project,
-- inspector flag). The very first user becomes Admin. Anyone else who signs up
-- uninvited is an inactive Worker until an Admin activates them.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  inv          public.user_invitations%rowtype;
  internal_org uuid;
  display_name text;
begin
  display_name := coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1));

  select * into inv from public.user_invitations
   where lower(email) = lower(new.email) and status = 'pending' and expires_at > now()
   order by created_at desc limit 1;

  select id into internal_org from public.organizations where type = 'internal' limit 1;
  if internal_org is null then
    insert into public.organizations (name, type) values ('Our company', 'internal')
    returning id into internal_org;
  end if;

  if inv.id is not null then
    insert into public.profiles (id, email, full_name, role, organization_id, job_role_id, phone,
                                 employee_number, start_date, is_scaffold_inspector, is_active)
    values (new.id, new.email, coalesce(nullif(inv.full_name, ''), display_name), inv.role, inv.organization_id,
            inv.job_role_id, inv.phone, inv.employee_number, inv.start_date, inv.is_scaffold_inspector, true);
    if inv.primary_project_id is not null then
      insert into public.project_members (project_id, profile_id, is_primary, start_date, created_by)
      values (inv.primary_project_id, new.id, true, coalesce(inv.start_date, public.perth_today()), inv.invited_by);
    end if;
    update public.user_invitations
       set status = 'accepted', accepted_at = now(), user_id = new.id
     where id = inv.id;
  elsif not exists (select 1 from public.profiles) then
    insert into public.profiles (id, email, full_name, role, organization_id, is_active)
    values (new.id, new.email, display_name, 'admin', internal_org, true);
  else
    insert into public.profiles (id, email, full_name, role, organization_id, is_active)
    values (new.id, new.email, display_name, 'worker', internal_org, false);
  end if;
  return new;
end $$;

-- Assignments: who/which project never changes on an existing row (history).
create or replace function public.project_members_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.project_id := old.project_id;
    new.profile_id := old.profile_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;
create trigger project_members_before_write before insert or update on public.project_members
  for each row execute function public.project_members_before_write();

-- Making an assignment primary clears the person's previous primary — only once
-- the new row has actually been saved.
create or replace function public.project_members_after_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_primary and new.end_date is null then
    update public.project_members
       set is_primary = false
     where profile_id = new.profile_id and is_primary and end_date is null and id <> new.id;
  end if;
  return null;
end $$;
create trigger project_members_after_write after insert or update of is_primary, end_date on public.project_members
  for each row execute function public.project_members_after_write();

-- -----------------------------------------------------------------------------
-- Workflow alerts only go to people who can open the record
-- -----------------------------------------------------------------------------
create or replace function public.run_workflow_rules(
  p_module public.workflow_module, p_event public.workflow_trigger,
  p_record jsonb, p_old jsonb default null
) returns uuid[]
language plpgsql security definer set search_path = public as $$
declare
  r           public.workflow_rules%rowtype;
  act         jsonb;
  stp         jsonb;
  recip       text;
  matched     uuid[] := '{}';
  msg         text;
  record_org  uuid := nullif(p_record->>'organization_id', '')::uuid;
  record_proj uuid := nullif(p_record->>'project_id', '')::uuid;
  rec_id      uuid := nullif(p_record->>'id', '')::uuid;
  first_step  int;
begin
  for r in
    select * from public.workflow_rules
     where module = p_module and trigger_event = p_event and is_enabled and archived_at is null
     order by priority, created_at
  loop
    continue when not public.workflow_rule_matches(r, p_event, p_record, p_old);
    matched := matched || r.id;

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
                  and public.person_sees_project_record(p.id, record_proj, record_org))
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
                      and public.person_sees_project_record(p.id, record_proj, record_org))
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

-- Approvers must also be able to see the record.
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
              and public.can_see_submission(a.submission_id)
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
    target := case when public.pipeline_has_status(s.module, 'rejected') then 'rejected'
                   when public.pipeline_has_status(s.module, 'returned') then 'returned'
                   else 'draft' end;
    update public.form_submissions set status = target where id = s.id;
  end if;
  perform set_config('app.status_guard_bypass', 'off', true);
  return a;
end $$;

-- -----------------------------------------------------------------------------
-- Convert existing data to the new roles (no rows are deleted)
-- -----------------------------------------------------------------------------
update public.profiles
   set role = case role::text when 'leader' then 'admin' when 'employee' then 'worker' when 'contractor' then 'worker' end::public.app_role
 where role::text in ('leader', 'employee', 'contractor');
update public.user_invitations
   set role = case role::text when 'leader' then 'admin' when 'employee' then 'worker' when 'contractor' then 'worker' end::public.app_role
 where role::text in ('leader', 'employee', 'contractor');
update public.record_approvals
   set approver_role = case approver_role::text when 'leader' then 'admin' when 'employee' then 'worker' when 'contractor' then 'worker' end::public.app_role
 where approver_role::text in ('leader', 'employee', 'contractor');

-- Workflow rules: approval steps leader -> admin; alerts to "leaders" go to Admin and HSET.
update public.workflow_rules r
   set approval_chain = (
         select coalesce(jsonb_agg(case when s->>'role' = 'leader' then jsonb_set(s, '{role}', '"admin"')
                                        when s->>'role' in ('employee', 'contractor') then jsonb_set(s, '{role}', '"worker"')
                                        else s end order by ord), '[]'::jsonb)
           from jsonb_array_elements(r.approval_chain) with ordinality t(s, ord)),
       actions = (
         select coalesce(jsonb_agg(
                  case when a ? 'recipients' then jsonb_set(a, '{recipients}', (
                    select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from (
                      select case rc when 'role:leader' then 'role:admin'
                                     when 'role:employee' then 'role:worker'
                                     when 'role:contractor' then 'role:worker'
                                     else rc end as x
                        from jsonb_array_elements_text(a->'recipients') rc
                      union all
                      select 'role:hset' where a->'recipients' ? 'role:leader') q))
                  else a end order by ord), '[]'::jsonb)
           from jsonb_array_elements(r.actions) with ordinality t(a, ord))
 where r.approval_chain::text ~ '"(leader|employee|contractor)"' or r.actions::text ~ 'role:(leader|employee|contractor)';

-- From now on only the new roles can be used.
alter table public.profiles
  add constraint profiles_role_current check (role in ('admin', 'hset', 'project_manager', 'supervisor', 'worker'));
alter table public.user_invitations
  add constraint user_invitations_role_current check (role in ('admin', 'hset', 'project_manager', 'supervisor', 'worker'));
alter table public.record_approvals
  add constraint record_approvals_role_current check (approver_role in ('admin', 'hset', 'project_manager', 'supervisor', 'worker'));

-- -----------------------------------------------------------------------------
-- Positions (job_roles) and licence types for a scaffolding/access business
-- -----------------------------------------------------------------------------
update public.job_roles set name = 'Supervisor' where name = 'Site Supervisor'
  and not exists (select 1 from public.job_roles where name = 'Supervisor');
update public.job_roles set name = 'HSET Advisor', classification = 'HSET' where name = 'HSEQ Advisor'
  and not exists (select 1 from public.job_roles where name = 'HSET Advisor');
insert into public.job_roles (name, classification, applies_to) values
  ('Scaffolder', 'Trade', array['internal','contractor']::public.org_type[]),
  ('Labourer', 'Level 1', array['internal','contractor']::public.org_type[]),
  ('Leading Hand', 'Level 4', array['internal','contractor']::public.org_type[]),
  ('Supervisor', 'Supervision', array['internal','contractor']::public.org_type[]),
  ('Plant Operator', 'Level 3', array['internal','contractor']::public.org_type[]),
  ('Project Manager', 'Management', array['internal','contractor']::public.org_type[]),
  ('HSET Advisor', 'HSET', array['internal']::public.org_type[])
on conflict (name) do nothing;

insert into public.lookup_values (list_key, label, code, sort_order, metadata) values
  ('ticket_types', 'HRW – Scaffolding', 'SC', 0, '{"classes":["Basic","Intermediate","Advanced"],"scaffolding":true}'),
  ('ticket_types', 'HRW – Rigging', 'RG', 9, '{"classes":["Basic","Intermediate","Advanced"]}'),
  ('ticket_types', 'Driver Licence', 'DL', 10, '{"classes":["C","LR","MR","HR","HC","MC"]}')
on conflict (list_key, label) do update set metadata = excluded.metadata;

-- -----------------------------------------------------------------------------
-- Audit history: who created / changed what, and when
-- -----------------------------------------------------------------------------
create table public.audit_log (
  id         bigint generated always as identity primary key,
  table_name text not null,
  record_id  text not null,
  action     text not null check (action in ('insert', 'update', 'delete')),
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default now(),
  old_data   jsonb,
  new_data   jsonb
);
create index audit_log_record_idx on public.audit_log (table_name, record_id, changed_at desc);

create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  changed_old jsonb;
  changed_new jsonb;
begin
  if tg_op = 'UPDATE' then
    -- store only the fields that changed (ignoring updated_at)
    select jsonb_object_agg(key, o->key), jsonb_object_agg(key, value)
      into changed_old, changed_new
      from jsonb_each(n) where key <> 'updated_at' and n->key is distinct from o->key;
    if changed_new is null then
      return new;
    end if;
    o := changed_old; n := changed_new;
  end if;
  insert into public.audit_log (table_name, record_id, action, old_data, new_data)
  values (tg_table_name,
          coalesce((coalesce(to_jsonb(new), to_jsonb(old)))->>'id',
                   (coalesce(to_jsonb(new), to_jsonb(old)))->>'job_role_id',
                   (coalesce(to_jsonb(new), to_jsonb(old)))->>'module',
                   (coalesce(to_jsonb(new), to_jsonb(old)))->>'project_id', '?'),
          lower(tg_op), o, n);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles', 'project_members', 'worker_tickets', 'projects', 'organizations', 'job_roles',
                            'job_role_rates', 'user_invitations', 'form_submissions', 'workflow_rules', 'form_templates',
                            'lookup_values', 'lookup_lists', 'workflow_pipelines', 'app_settings', 'project_organizations']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()',
                   t || '_audit', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Name directory (names only, no contact details): everyone you can see, plus
-- people who share a current project with you (same company if you're a subcontractor).
-- -----------------------------------------------------------------------------
create or replace view public.profile_directory
with (security_invoker = false) as
  select p.id, p.full_name, p.role, p.organization_id, p.job_role_id, p.is_active
    from public.profiles p
   where public.is_leader()
      or public.can_see_person(p.id)
      or (p.is_active and exists (
            select 1 from public.project_members m
             where m.profile_id = p.id
               and (m.end_date is null or m.end_date >= public.perth_today())
               and m.project_id in (select pm.project_id from public.project_members pm
                                     where pm.profile_id = auth.uid()
                                       and (pm.end_date is null or pm.end_date >= public.perth_today())))
          and (public.is_internal_user() or p.organization_id = public.current_org_id()));

-- -----------------------------------------------------------------------------
-- Row-level security
-- -----------------------------------------------------------------------------
alter table public.project_members enable row level security;
alter table public.audit_log enable row level security;

alter policy profiles_select on public.profiles using (public.can_see_person(id));
alter policy profiles_leader_update on public.profiles using (public.is_admin()) with check (public.is_admin());
alter policy invitations_leader on public.user_invitations using (public.is_admin()) with check (public.is_admin());
alter policy job_role_rates_leader on public.job_role_rates using (public.is_admin()) with check (public.is_admin());
alter policy job_roles_leader_write on public.job_roles using (public.is_admin()) with check (public.is_admin());
alter policy org_leader_write on public.organizations using (public.is_admin()) with check (public.is_admin());
alter policy app_settings_leader_write on public.app_settings using (public.is_admin()) with check (public.is_admin());

-- Records are archived, never deleted.
alter policy submissions_delete on public.form_submissions using (false);

-- Licences & tickets: own, plus anyone who can see the person; only the person
-- themselves, Admin or HSET can add or change them.
alter policy tickets_select on public.worker_tickets
  using (public.can_see_person(profile_id));
alter policy tickets_write on public.worker_tickets
  using (profile_id = auth.uid() or public.is_leader())
  with check ((profile_id = auth.uid() and public.current_role_name() is not null) or public.is_leader());

create policy project_members_select on public.project_members for select to authenticated
  using (profile_id = auth.uid() or public.can_see_person(profile_id));
create policy project_members_admin_insert on public.project_members for insert to authenticated
  with check (public.is_admin());
create policy project_members_admin_update on public.project_members for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy audit_log_select on public.audit_log for select to authenticated
  using (public.is_leader()
         or (table_name = 'profiles' and record_id = auth.uid()::text)
         or (table_name = 'form_submissions' and public.can_see_submission(record_id::uuid)));

-- People's photos and licence scans: {org}/{profile}/... in the worker-tickets bucket.
alter policy storage_org_read on storage.objects
  using (
    (bucket_id = 'worker-tickets'
      and (public.is_leader()
           or (coalesce((storage.foldername(name))[2] ~ '^[0-9a-f-]{36}$', false)
               and public.can_see_person(((storage.foldername(name))[2])::uuid))))
    or (bucket_id = 'form-uploads'
      and (public.is_leader()
           or (storage.foldername(name))[1] = public.current_org_id()::text
           or public.can_see_upload(name)))
  );
alter policy storage_org_insert on storage.objects
  with check (
    (bucket_id = 'form-uploads' and (storage.foldername(name))[1] = public.current_org_id()::text)
    or (bucket_id = 'worker-tickets'
        and coalesce((storage.foldername(name))[2] ~ '^[0-9a-f-]{36}$', false)
        and (public.is_leader() or (storage.foldername(name))[2] = auth.uid()::text))
  );

-- Archive instead of delete: signed-in users can't delete rows anywhere in the
-- app schema (except link rows between projects and contractor companies).
revoke delete on all tables in schema public from authenticated;
grant delete on public.project_organizations to authenticated;

grant select, insert, update on public.project_members to authenticated;
grant select on public.audit_log to authenticated;
revoke all on public.project_members, public.audit_log from anon;

-- Function privileges
revoke execute on function public.audit_row() from public, anon, authenticated;
revoke execute on function public.project_members_before_write() from public, anon, authenticated;
revoke execute on function public.project_members_after_write() from public, anon, authenticated;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.is_project_lead() from public, anon;
revoke execute on function public.my_project_ids() from public, anon;
revoke execute on function public.can_see_person(uuid) from public, anon;
revoke execute on function public.person_sees_project_record(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.is_admin(), public.is_project_lead(), public.my_project_ids(),
  public.can_see_person(uuid), public.perth_today() to authenticated;
