-- =============================================================================
-- Actions v2
--   * anyone raising an action can assign it to anyone on the record's project
--     (plus Admin/HSET), not only people they can otherwise see
--   * investigations: findings + root cause, then actions, then submit for review;
--     an independent reviewer confirms the actions address the gaps found and closes
--     it, or sends it back
--   * emails: queued emails are sent straight away by the send-emails function
--     (database trigger via pg_net) and retried every 5 minutes (pg_cron)
--   * Field Leadership form gets a short Yes/No checklist (new version)
-- Nothing is dropped.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Who an action can be assigned to
-- ---------------------------------------------------------------------------
create or replace function public.can_assign_action(p_assignee uuid, p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = p_assignee and is_active)
     and (public.is_leader()
          or public.can_see_person(p_assignee)
          or exists (select 1 from public.profiles where id = p_assignee and role in ('admin', 'hset'))
          or (p_project is not null and exists (
                select 1 from public.project_members m
                 where m.profile_id = p_assignee and m.project_id = p_project
                   and m.start_date <= public.perth_today() and (m.end_date is null or m.end_date >= public.perth_today()))))
$$;
revoke execute on function public.can_assign_action(uuid, uuid) from public, anon;
grant execute on function public.can_assign_action(uuid, uuid) to authenticated;

create or replace function public.action_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  sub  public.form_submissions%rowtype;
  inv  public.investigations%rowtype;
  me   uuid := auth.uid();
  manager boolean;
  service boolean := public.is_service_context();
begin
  if tg_op = 'INSERT' then
    if not service then new.raised_by := me; end if;
    if new.submission_id is not null then
      select * into sub from public.form_submissions where id = new.submission_id;
      if sub.id is null then raise exception 'Record not found'; end if;
      new.investigation_id := null;
      new.source_module := sub.module::text;
      new.source_reference := sub.reference;
      new.project_id := sub.project_id;
      new.organization_id := sub.organization_id;
    else
      select * into inv from public.investigations where id = new.investigation_id;
      if inv.id is null then raise exception 'Investigation not found'; end if;
      if inv.status = 'closed' then raise exception 'This investigation is closed'; end if;
      new.source_module := 'investigation';
      new.source_reference := inv.reference;
      new.project_id := inv.project_id;
      new.organization_id := inv.organization_id;
    end if;
    if not exists (select 1 from public.profiles where id = new.assignee_id and is_active) then
      raise exception 'Assign the action to an active person';
    end if;
    if not service and not public.can_assign_action(new.assignee_id, new.project_id) then
      raise exception 'You can only assign actions to people on this project, Admin or HSET';
    end if;
    new.reference := 'ACT-' || lpad(nextval('public.action_seq')::text, 5, '0');
    new.status := 'open';
    new.close_comment := null;
    new.close_evidence := '{}';
    new.closed_by := null;
    new.closed_at := null;
    new.status_note := null;
    return new;
  end if;

  new.reference := old.reference;
  new.submission_id := old.submission_id;
  new.investigation_id := old.investigation_id;
  new.source_module := old.source_module;
  new.source_reference := old.source_reference;
  new.project_id := old.project_id;
  new.organization_id := old.organization_id;
  new.raised_by := old.raised_by;
  new.created_at := old.created_at;
  if service then return new; end if;

  manager := public.is_leader() or old.raised_by = me
             or (public.is_project_lead() and old.project_id in (select public.my_project_ids()));

  if new.status is distinct from old.status then
    if old.status = 'open' and new.status = 'closed' then
      if me is distinct from old.assignee_id then
        raise exception 'Only the person the action is assigned to can close it out';
      end if;
      if coalesce(trim(new.close_comment), '') = '' then
        raise exception 'Add a close-out comment';
      end if;
      if coalesce(array_length(new.close_evidence, 1), 0) = 0 then
        raise exception 'Attach evidence (a photo or file) to close the action';
      end if;
      new.closed_by := me;
      new.closed_at := now();
    elsif old.status = 'closed' and new.status = 'open' then
      if not manager then raise exception 'Only the person who raised it, Admin/HSET or a project lead can reopen an action'; end if;
      if coalesce(trim(new.status_note), '') = '' or new.status_note is not distinct from old.status_note then
        raise exception 'Say why the action is being reopened';
      end if;
      new.close_comment := null;
      new.close_evidence := '{}';
      new.closed_by := null;
      new.closed_at := null;
    elsif old.status = 'open' and new.status = 'cancelled' then
      if not manager then raise exception 'Only the person who raised it, Admin/HSET or a project lead can cancel an action'; end if;
      if coalesce(trim(new.status_note), '') = '' or new.status_note is not distinct from old.status_note then
        raise exception 'Say why the action is being cancelled';
      end if;
    else
      raise exception 'An action can''t go from % to %', old.status, new.status;
    end if;
  else
    new.close_comment := old.close_comment;
    new.close_evidence := old.close_evidence;
    new.closed_by := old.closed_by;
    new.closed_at := old.closed_at;
    new.status_note := old.status_note;
  end if;

  if (new.title, new.description, new.priority, new.assignee_id, new.due_date)
     is distinct from (old.title, old.description, old.priority, old.assignee_id, old.due_date) then
    if not manager then
      raise exception 'Only the person who raised it, Admin/HSET or a project lead can change an action';
    end if;
    if old.status <> 'open' and new.status <> 'open' then
      raise exception 'Reopen the action before changing it';
    end if;
    if new.assignee_id is distinct from old.assignee_id and not public.can_assign_action(new.assignee_id, old.project_id) then
      raise exception 'You can only assign actions to people on this project, Admin or HSET';
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Investigation review
-- ---------------------------------------------------------------------------
alter table public.investigations
  add column if not exists no_actions_reason text,
  add column if not exists submitted_for_review_at timestamptz,
  add column if not exists submitted_for_review_by uuid references public.profiles(id) on delete set null,
  add column if not exists review_comment text,
  add column if not exists actions_confirmed boolean not null default false,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_at timestamptz;

create or replace function public.investigation_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  inc public.form_submissions%rowtype;
  me  uuid := auth.uid();
  service boolean := public.is_service_context();
  live_actions int;
begin
  select * into inc from public.form_submissions where id = new.incident_id;
  if inc.id is null or inc.module <> 'safety_event' then
    raise exception 'Investigations must be linked to a safety event';
  end if;
  if tg_op = 'INSERT' then
    new.reference := 'INV-' || lpad(nextval('public.investigation_seq')::text, 5, '0');
    new.project_id := inc.project_id;
    new.organization_id := inc.organization_id;
    new.due_date := coalesce(new.due_date, coalesce(inc.record_date, public.perth_today()) + 14);
    if new.status not in ('open', 'in_progress') and not service then new.status := 'open'; end if;
    new.actions_confirmed := false;
    new.reviewed_by := null; new.reviewed_at := null;
    new.submitted_for_review_at := null; new.submitted_for_review_by := null;
    return new;
  end if;

  new.incident_id := old.incident_id;
  new.reference := old.reference;
  new.project_id := old.project_id;
  new.organization_id := old.organization_id;
  new.opened_at := old.opened_at;
  new.created_by := old.created_by;
  if service then return new; end if;

  if new.status is distinct from old.status then
    if new.status = 'review' then
      -- Submit for review: findings, root cause, and the actions (or why none are needed).
      if old.status not in ('open', 'in_progress') then
        raise exception 'Only an open investigation can be submitted for review';
      end if;
      if coalesce(trim(new.findings), '') = '' or coalesce(trim(new.root_cause), '') = '' then
        raise exception 'Record the findings and root cause before submitting for review';
      end if;
      select count(*) into live_actions from public.actions where investigation_id = new.id and status <> 'cancelled';
      if live_actions = 0 and coalesce(trim(new.no_actions_reason), '') = '' then
        raise exception 'Raise the actions that address the gaps found (or say why no actions are needed)';
      end if;
      new.submitted_for_review_at := now();
      new.submitted_for_review_by := me;
      new.actions_confirmed := false;
      new.reviewed_by := null; new.reviewed_at := null;
    elsif new.status = 'closed' then
      -- Close-out = review: someone other than the lead confirms the actions address the gaps.
      if old.status <> 'review' then
        raise exception 'Submit the investigation for review before closing it';
      end if;
      if not (public.is_leader() or (public.is_project_lead() and public.can_see_submission(old.incident_id))) then
        raise exception 'Only Admin, HSET or a project lead can review and close an investigation';
      end if;
      if me is not distinct from old.lead_id then
        raise exception 'The review must be done by someone other than the investigation lead';
      end if;
      if not new.actions_confirmed then
        raise exception 'Confirm the actions address the gaps and root causes found';
      end if;
      if coalesce(trim(new.review_comment), '') = '' then
        raise exception 'Add a review comment';
      end if;
      new.reviewed_by := me;
      new.reviewed_at := now();
    elsif old.status = 'review' and new.status in ('open', 'in_progress') then
      -- Sent back by the reviewer, with the reason.
      if not (public.is_leader() or (public.is_project_lead() and public.can_see_submission(old.incident_id))) then
        raise exception 'Only Admin, HSET or a project lead can send an investigation back';
      end if;
      if coalesce(trim(new.review_comment), '') = '' or new.review_comment is not distinct from old.review_comment then
        raise exception 'Say what needs more work';
      end if;
      new.actions_confirmed := false;
    elsif old.status = 'closed' then
      if not public.is_leader() then raise exception 'Only Admin or HSET can reopen a closed investigation'; end if;
      new.actions_confirmed := false;
      new.reviewed_by := null; new.reviewed_at := null;
    end if;
  end if;

  if new.status = 'closed' and (old.status <> 'closed') then
    new.closed_at := now();
    new.closed_by := me;
  elsif new.status <> 'closed' then
    new.closed_at := null;
    new.closed_by := null;
  end if;
  return new;
end $$;

-- Tell people when an investigation goes to review, is sent back, or is closed.
create or replace function public.investigation_after_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  link text := '/investigations/' || new.id;
  r record;
begin
  if new.status is not distinct from old.status then return null; end if;
  if new.status = 'review' then
    for r in select p.id from public.profiles p
              where p.is_active and p.id is distinct from new.lead_id
                and (p.role in ('admin', 'hset')
                     or (p.role = 'project_manager' and exists (select 1 from public.project_members m where m.profile_id = p.id
                          and m.project_id = new.project_id and (m.end_date is null or m.end_date >= public.perth_today()))))
    loop
      perform public.action_notify(r.id, 'Investigation ready for review: ' || new.reference,
        new.reference || ' has findings and actions ready for review.', link);
    end loop;
  elsif old.status = 'review' and new.status in ('open', 'in_progress') then
    perform public.action_notify(new.lead_id, 'Investigation sent back: ' || new.reference, left(coalesce(new.review_comment, ''), 300), link);
  elsif new.status = 'closed' then
    perform public.action_notify(new.lead_id, 'Investigation closed: ' || new.reference, left(coalesce(new.review_comment, ''), 300), link);
  end if;
  return null;
end $$;
create trigger investigations_after_update after update on public.investigations
  for each row execute function public.investigation_after_update();
revoke execute on function public.investigation_after_update() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Email sending (send-emails function). App address and sender live in settings.
-- ---------------------------------------------------------------------------
alter table public.app_settings
  add column if not exists email_from text,
  add column if not exists app_url text;

-- Called by the send-emails function (service role only): claim a batch to send.
create or replace function public.claim_queued_emails(p_limit int default 25)
returns setof public.notification_outbox language sql security definer set search_path = public as $$
  update public.notification_outbox o
     set attempts = o.attempts + 1, payload = o.payload || jsonb_build_object('claimed_at', now())
   where o.id in (
     select id from public.notification_outbox
      where status = 'queued' and attempts < 5
        and (payload->>'claimed_at' is null or (payload->>'claimed_at')::timestamptz < now() - interval '10 minutes')
      order by created_at
      limit p_limit
      for update skip locked)
  returning o.*
$$;
create or replace function public.mark_email(p_id uuid, p_ok boolean, p_error text default null)
returns void language sql security definer set search_path = public as $$
  update public.notification_outbox
     set status = case when p_ok then 'sent' when attempts >= 5 then 'failed' else 'queued' end,
         sent_at = case when p_ok then now() end,
         payload = payload || jsonb_build_object('last_error', p_error)
   where id = p_id
$$;
-- The send-emails function checks callers against this secret (kept in Vault).
create or replace function public.email_sender_secret_ok(p_secret text)
returns boolean language plpgsql security definer set search_path = public as $$
declare s text;
begin
  if to_regnamespace('vault') is null then return false; end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = ''email_sender_secret''' into s;
  return s is not null and p_secret = s;
end $$;
revoke execute on function public.claim_queued_emails(int) from public, anon, authenticated;
revoke execute on function public.mark_email(uuid, boolean, text) from public, anon, authenticated;
revoke execute on function public.email_sender_secret_ok(text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.claim_queued_emails(int), public.mark_email(uuid, boolean, text),
      public.email_sender_secret_ok(text) to service_role;
  end if;
end $$;

-- Wake the sender (no-op until pg_net and the Vault entries exist).
create or replace function public.kick_email_sender()
returns void language plpgsql security definer set search_path = public as $$
declare
  url text;
  secret text;
begin
  if to_regnamespace('net') is null or to_regnamespace('vault') is null then return; end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = ''email_sender_url''' into url;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = ''email_sender_secret''' into secret;
  if url is null or secret is null then return; end if;
  execute 'select net.http_post(url := $1, body := ''{}''::jsonb, headers := $2)'
    using url, jsonb_build_object('Content-Type', 'application/json', 'x-outbox-secret', secret);
exception when others then
  -- never block the insert that queued the email
  raise warning 'kick_email_sender: %', sqlerrm;
end $$;
create or replace function public.notification_outbox_kick()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.kick_email_sender();
  return null;
end $$;
create trigger notification_outbox_kick after insert on public.notification_outbox
  for each statement execute function public.notification_outbox_kick();
revoke execute on function public.kick_email_sender() from public, anon, authenticated;
revoke execute on function public.notification_outbox_kick() from public, anon, authenticated;

-- Retry anything still queued every 5 minutes (Supabase only).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    if not exists (select 1 from cron.job where jobname = 'send-queued-emails') then
      perform cron.schedule('send-queued-emails', '*/5 * * * *', 'select public.kick_email_sender()');
    end if;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Field Leadership: a short Yes/No checklist (a "No" can raise an action)
-- ---------------------------------------------------------------------------
do $$
declare
  t_id uuid;
  s jsonb;
begin
  select id, draft_schema into t_id, s from public.form_templates where category = 'field_leadership' and name = 'Field Leadership' limit 1;
  if t_id is not null and not (s::text like '%q-fl-ppe%') then
    s := jsonb_set(s, '{sections}', (s->'sections') || jsonb_build_array(jsonb_build_object(
      'id', 's-fl-checks', 'title', 'What did you see?',
      'questions', jsonb_build_array(
        jsonb_build_object('id', 'q-fl-ppe', 'label', 'Everyone in the area wearing the right PPE?', 'type', 'yes_no', 'required', false),
        jsonb_build_object('id', 'q-fl-zones', 'label', 'Exclusion zones and barricades in place?', 'type', 'yes_no', 'required', false),
        jsonb_build_object('id', 'q-fl-tags', 'label', 'Scaff tags current and displayed at access points?', 'type', 'yes_no', 'required', false),
        jsonb_build_object('id', 'q-fl-height', 'label', 'Tools and materials secured at height (tethers, toeboards)?', 'type', 'yes_no', 'required', false),
        jsonb_build_object('id', 'q-fl-house', 'label', 'Housekeeping OK and access ways clear?', 'type', 'yes_no', 'required', false),
        jsonb_build_object('id', 'q-fl-permits', 'label', 'Permits, JHAs and Take 5s done and on site?', 'type', 'yes_no', 'required', false)))));
    perform public.publish_seed_version(t_id, s, 'Added a Yes/No checklist; a No can raise an action');
  end if;
end $$;

-- People an action on this project can be assigned to (for the picker).
create or replace function public.assignable_people(p_project uuid)
returns table (id uuid, full_name text, role public.app_role, organization_id uuid)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.role, p.organization_id
    from public.profiles p
   where p.is_active and auth.uid() is not null and public.can_assign_action(p.id, p_project)
   order by p.full_name
$$;
revoke execute on function public.assignable_people(uuid) from public, anon;
grant execute on function public.assignable_people(uuid) to authenticated;
