-- =============================================================================
-- Actions: raised on incidents, audits, field leadership (any record) and
-- investigations; assigned to a person with a due date; the person assigned
-- closes it out with a comment and evidence. Nothing existing is changed.
-- =============================================================================
create sequence public.action_seq;

create table public.actions (
  id               uuid primary key default gen_random_uuid(),
  reference        text unique,
  submission_id    uuid references public.form_submissions(id),
  investigation_id uuid references public.investigations(id),
  source_module    text,
  source_reference text,
  project_id       uuid references public.projects(id),
  organization_id  uuid references public.organizations(id),
  title            text not null check (length(trim(title)) > 0),
  description      text,
  priority         text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  assignee_id      uuid not null references public.profiles(id),
  due_date         date not null,
  status           text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  close_comment    text,
  close_evidence   text[] not null default '{}',
  closed_by        uuid references public.profiles(id) on delete set null,
  closed_at        timestamptz,
  -- reason given when an action is reopened or cancelled
  status_note      text,
  raised_by        uuid not null references public.profiles(id) default auth.uid(),
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (submission_id is not null or investigation_id is not null)
);
create index actions_assignee_idx on public.actions (assignee_id) where status = 'open';
create index actions_submission_idx on public.actions (submission_id);
create index actions_investigation_idx on public.actions (investigation_id);
create trigger actions_updated before update on public.actions
  for each row execute function public.set_updated_at();

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
      new.source_module := 'investigation';
      new.source_reference := inv.reference;
      new.project_id := inv.project_id;
      new.organization_id := inv.organization_id;
    end if;
    if not exists (select 1 from public.profiles where id = new.assignee_id and is_active) then
      raise exception 'Assign the action to an active person';
    end if;
    if not service and not public.is_leader() and not public.can_see_person(new.assignee_id) then
      raise exception 'You can only assign actions to people you can see';
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

  -- Fixed once raised
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

  -- The raiser, Admin/HSET, or a PM/Supervisor on the project manages the action.
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
    -- No status change: close-out fields stay as they are.
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
    if new.assignee_id is distinct from old.assignee_id then
      if not exists (select 1 from public.profiles where id = new.assignee_id and is_active) then
        raise exception 'Assign the action to an active person';
      end if;
      if not public.is_leader() and not public.can_see_person(new.assignee_id) then
        raise exception 'You can only assign actions to people you can see';
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger actions_before_write before insert or update on public.actions
  for each row execute function public.action_before_write();

-- Tell people: in the app and by email (queued; sent by the email service).
create or replace function public.action_notify(p_user uuid, p_title text, p_body text, p_link text)
returns void language plpgsql security definer set search_path = public as $$
declare
  em text;
begin
  if p_user is null or p_user is not distinct from auth.uid() then return; end if;
  insert into public.notifications (user_id, title, body, link) values (p_user, p_title, p_body, p_link);
  select email into em from public.profiles where id = p_user and is_active;
  if em is not null then
    insert into public.notification_outbox (channel, recipient, subject, body, payload)
    values ('email', em, p_title, p_body, jsonb_build_object('link', p_link, 'kind', 'action'));
  end if;
end $$;

create or replace function public.action_after_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  link text := '/actions/' || new.id;
  due  text := to_char(new.due_date, 'DD/MM/YYYY');
begin
  if tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id then
    perform public.action_notify(new.assignee_id, 'Action assigned to you: ' || new.title,
      new.reference || ' (from ' || coalesce(new.source_reference, 'a record') || ') is due ' || due || '.', link);
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'closed' then
      perform public.action_notify(new.raised_by, 'Action closed: ' || new.title,
        new.reference || ' was closed out: ' || left(coalesce(new.close_comment, ''), 200), link);
    elsif new.status = 'open' then
      perform public.action_notify(new.assignee_id, 'Action reopened: ' || new.title,
        new.reference || ' was reopened: ' || left(coalesce(new.status_note, ''), 200) || ' Due ' || due || '.', link);
    elsif new.status = 'cancelled' then
      perform public.action_notify(new.assignee_id, 'Action cancelled: ' || new.title,
        new.reference || ' was cancelled: ' || left(coalesce(new.status_note, ''), 200), link);
    end if;
  elsif tg_op = 'UPDATE' and new.due_date is distinct from old.due_date and new.status = 'open' then
    perform public.action_notify(new.assignee_id, 'Action due date changed: ' || new.title,
      new.reference || ' is now due ' || due || '.', link);
  end if;
  return null;
end $$;
create trigger actions_after_write after insert or update on public.actions
  for each row execute function public.action_after_write();

-- -----------------------------------------------------------------------------
-- Row-level security
-- -----------------------------------------------------------------------------
alter table public.actions enable row level security;

-- Seen by the person assigned, whoever raised it, Admin/HSET, and anyone who can
-- see the record or investigation it came from.
create policy actions_select on public.actions for select to authenticated
  using (public.is_leader() or assignee_id = auth.uid() or raised_by = auth.uid()
         or (submission_id is not null and public.can_see_submission(submission_id))
         or (investigation_id is not null and exists (select 1 from public.investigations i where i.id = investigation_id)));
-- Raised by anyone who can see the record (the person who submitted it, project leads, Admin/HSET).
create policy actions_insert on public.actions for insert to authenticated
  with check (public.is_leader()
              or (submission_id is not null and public.can_see_submission(submission_id))
              or (investigation_id is not null and exists (select 1 from public.investigations i where i.id = investigation_id)));
create policy actions_update on public.actions for update to authenticated
  using (public.is_leader() or assignee_id = auth.uid() or raised_by = auth.uid()
         or (public.is_project_lead() and project_id in (select public.my_project_ids())))
  with check (true);

grant select, insert, update on public.actions to authenticated;
revoke all on public.actions from anon;

-- Evidence files live in form-uploads under {org}/{action id}/…
create or replace function public.can_see_action(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.actions a where a.id = p_id and (
           public.is_leader() or a.assignee_id = auth.uid() or a.raised_by = auth.uid()
        or (a.submission_id is not null and public.can_see_submission(a.submission_id))
        or (a.investigation_id is not null and exists (
              select 1 from public.investigations i
               where i.id = a.investigation_id and (i.lead_id = auth.uid() or public.can_see_submission(i.incident_id))))))
$$;

create or replace function public.can_see_upload(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((storage.foldername(p_name))[2] ~ '^[0-9a-f-]{36}$', false)
     and (public.can_see_submission(((storage.foldername(p_name))[2])::uuid)
          or public.can_see_action(((storage.foldername(p_name))[2])::uuid)
          or exists (select 1 from public.scaffolds s
                      where s.id = ((storage.foldername(p_name))[2])::uuid and public.can_access_project(s.project_id))
          or exists (select 1 from public.scaffold_inspections i join public.scaffolds s on s.id = i.scaffold_id
                      where i.id = ((storage.foldername(p_name))[2])::uuid and public.can_access_project(s.project_id))
          or exists (select 1 from public.scaffold_defects d
                      where d.id = ((storage.foldername(p_name))[2])::uuid and public.can_access_project(d.project_id)))
$$;

-- History
create trigger actions_audit after insert or update or delete on public.actions
  for each row execute function public.audit_row();
alter policy audit_log_select on public.audit_log
  using (public.is_leader()
         or (table_name = 'profiles' and record_id = auth.uid()::text)
         or (table_name = 'form_submissions' and public.can_see_submission(record_id::uuid))
         or (table_name = 'vehicles' and exists (select 1 from public.vehicles v where v.id::text = audit_log.record_id))
         or (table_name = 'investigations' and exists (select 1 from public.investigations i where i.id::text = audit_log.record_id))
         or (table_name = 'scaffolds' and exists (select 1 from public.scaffolds s where s.id::text = audit_log.record_id))
         or (table_name = 'scaffold_defects' and exists (select 1 from public.scaffold_defects d where d.id::text = audit_log.record_id))
         or (table_name = 'actions' and exists (select 1 from public.actions a where a.id::text = audit_log.record_id)));

revoke execute on function public.action_before_write() from public, anon, authenticated;
revoke execute on function public.action_after_write() from public, anon, authenticated;
revoke execute on function public.action_notify(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.can_see_action(uuid) from public, anon;
grant execute on function public.can_see_action(uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'actions') then
    alter publication supabase_realtime add table public.actions;
  end if;
end $$;
