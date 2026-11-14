-- =============================================================================
-- Stage 3: scaffold register and inspections
--   * scaffold register (SCF-<project code>-0001), status only changes through
--     an inspection, or by tagging Unsafe / Dismantled
--   * checklist template with versions (Admins edit; old inspections keep theirs)
--   * inspections: only a competent inspector with a current scaffolding licence;
--     can't be Safe with a failed item; Restricted needs the restriction written;
--     signature, time and GPS recorded; next due date worked out per project
--   * each failed item becomes a defect with an owner and due date, closed with a photo
-- Nothing existing is dropped or changed except new columns.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Settings
-- -----------------------------------------------------------------------------
alter table public.projects
  add column if not exists scaffold_inspection_days int not null default 30
    check (scaffold_inspection_days between 1 and 365);

alter table public.app_settings
  add column if not exists scaffold_min_licence text not null default 'Basic'
    check (scaffold_min_licence in ('Basic', 'Intermediate', 'Advanced'));

create or replace function public.licence_rank(p_class text)
returns int language sql immutable set search_path = public as $$
  select case lower(coalesce(p_class, '')) when 'advanced' then 3 when 'intermediate' then 2 when 'basic' then 1 else 0 end
$$;

-- Best current (not expired, not archived) scaffolding licence class for a person.
create or replace function public.scaffold_licence_class(p_profile_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select t.licence_class from public.worker_tickets t
   where t.profile_id = p_profile_id and t.archived_at is null
     and t.ticket_type ilike '%scaffold%'
     and public.licence_rank(t.licence_class) > 0
     and (t.expires_on is null or t.expires_on >= public.perth_today())
   order by public.licence_rank(t.licence_class) desc
   limit 1
$$;

-- Competent inspector flag + current licence at or above the minimum class (app setting).
create or replace function public.can_inspect_scaffolds(p_profile_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = p_profile_id and is_active and is_scaffold_inspector)
     and public.licence_rank(public.scaffold_licence_class(p_profile_id))
         >= public.licence_rank(coalesce((select scaffold_min_licence from public.app_settings where id = 1), 'Basic'))
$$;

-- -----------------------------------------------------------------------------
-- Checklist template (versioned: a new row per published version)
-- -----------------------------------------------------------------------------
create table public.scaffold_checklists (
  id          uuid primary key default gen_random_uuid(),
  version     int not null unique,
  sections    jsonb not null,
  change_note text,
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);

create or replace function public.scaffold_checklist_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.version := coalesce((select max(version) from public.scaffold_checklists), 0) + 1;
  if jsonb_typeof(new.sections) <> 'array' or jsonb_array_length(new.sections) = 0 then
    raise exception 'The checklist needs at least one section';
  end if;
  if exists (select 1 from jsonb_array_elements(new.sections) s
              where jsonb_typeof(s->'items') <> 'array' or jsonb_array_length(s->'items') = 0) then
    raise exception 'Every checklist section needs at least one item';
  end if;
  return new;
end $$;
create trigger scaffold_checklists_before_insert before insert on public.scaffold_checklists
  for each row execute function public.scaffold_checklist_before_insert();

insert into public.scaffold_checklists (version, sections, change_note) values (1, '[
  {"id":"foundations","title":"Foundations, base plates and sole boards","items":[
    {"id":"fnd-ground","label":"Ground is firm, level and able to take the load"},
    {"id":"fnd-plates","label":"Base plates fitted to every standard"},
    {"id":"fnd-soles","label":"Sole boards in place and the right size"},
    {"id":"fnd-jacks","label":"Adjustable bases within extension limits"}]},
  {"id":"frame","title":"Standards, ledgers and transoms","items":[
    {"id":"frm-plumb","label":"Standards plumb, joints staggered"},
    {"id":"frm-ledgers","label":"Ledgers level and secured at every lift"},
    {"id":"frm-transoms","label":"Transoms at correct spacing for the duty class"},
    {"id":"frm-fittings","label":"Couplers and fittings tight, no damaged components"}]},
  {"id":"bracing","title":"Bracing","items":[
    {"id":"brc-face","label":"Face (longitudinal) bracing in place"},
    {"id":"brc-plan","label":"Plan and ledger bracing in place where required"}]},
  {"id":"ties","title":"Ties and anchors","items":[
    {"id":"tie-spacing","label":"Ties at the designed spacing"},
    {"id":"tie-secure","label":"Ties and anchors secure and undamaged"}]},
  {"id":"platforms","title":"Platforms and decking","items":[
    {"id":"plt-full","label":"Platforms fully decked, no gaps"},
    {"id":"plt-secure","label":"Planks / decks secured against uplift and movement"},
    {"id":"plt-width","label":"Platform width suitable for the work"}]},
  {"id":"edges","title":"Guardrails, midrails and toeboards","items":[
    {"id":"edg-guard","label":"Guardrails at the correct height on all open sides"},
    {"id":"edg-mid","label":"Midrails fitted"},
    {"id":"edg-toe","label":"Toeboards fitted"}]},
  {"id":"access","title":"Access (ladders and stairs)","items":[
    {"id":"acc-safe","label":"Safe access to every working platform"},
    {"id":"acc-ladders","label":"Ladders secured and extend 900 mm above the landing"},
    {"id":"acc-gates","label":"Access gates / trapdoors self-closing"}]},
  {"id":"containment","title":"Containment and mesh","items":[
    {"id":"cnt-mesh","label":"Mesh / containment fitted where required"},
    {"id":"cnt-drop","label":"Drop zone / exclusion zone in place"}]},
  {"id":"clearance","title":"Clearance from powerlines and plant","items":[
    {"id":"clr-power","label":"Safe clearance from powerlines"},
    {"id":"clr-plant","label":"Protected from mobile plant and traffic"}]},
  {"id":"signage","title":"Load signage","items":[
    {"id":"sig-load","label":"Duty class and maximum load per bay signage displayed"},
    {"id":"sig-tag","label":"Scaff tag holder in place at each access point"}]}
]', 'Initial checklist');

-- -----------------------------------------------------------------------------
-- Scaffold register
-- -----------------------------------------------------------------------------
create table public.scaffold_counters (
  project_id uuid primary key references public.projects(id) on delete cascade,
  last_value int not null default 0
);

create table public.scaffolds (
  id                  uuid primary key default gen_random_uuid(),
  scaffold_number     text unique,
  project_id          uuid not null references public.projects(id),
  location            text not null,
  latitude            numeric(9,6),
  longitude           numeric(9,6),
  scaffold_type       text not null check (scaffold_type in ('independent', 'mobile', 'hung', 'cantilever', 'birdcage', 'other')),
  scaffold_type_other text,
  duty_class          text not null check (duty_class in ('light', 'medium', 'heavy', 'special')),
  max_load_kg         numeric check (max_load_kg >= 0),
  height_m            numeric check (height_m >= 0),
  lifts               int check (lifts >= 0),
  bays                int check (bays >= 0),
  erected_by_id       uuid references public.profiles(id) on delete set null,
  erected_by_name     text,
  erected_on          date,
  photos              text[] not null default '{}',
  status              text not null default 'unsafe' check (status in ('safe', 'restricted', 'unsafe', 'dismantled')),
  restriction         text,
  status_reason       text,
  last_inspection_id  uuid,
  last_inspected_at   timestamptz,
  next_inspection_due date,
  dismantled_on       date,
  -- permanent, hard-to-guess token for the QR code page (Stage 4)
  qr_token            text not null unique default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  notes               text,
  archived_at         timestamptz,
  created_by          uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index scaffolds_project_idx on public.scaffolds (project_id) where archived_at is null;
create index scaffolds_due_idx on public.scaffolds (next_inspection_due) where archived_at is null and status <> 'dismantled';
create trigger scaffolds_updated before update on public.scaffolds
  for each row execute function public.set_updated_at();

create or replace function public.scaffold_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  n int;
  code text;
  bypass boolean := coalesce(current_setting('app.scaffold_status_bypass', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    insert into public.scaffold_counters (project_id, last_value) values (new.project_id, 1)
      on conflict (project_id) do update set last_value = public.scaffold_counters.last_value + 1
      returning last_value into n;
    select coalesce(nullif(upper(regexp_replace(p.code, '[^A-Za-z0-9]', '', 'g')), ''), 'GEN') into code
      from public.projects p where p.id = new.project_id;
    new.scaffold_number := 'SCF-' || coalesce(code, 'GEN') || '-' || lpad(n::text, 4, '0');
    -- A new scaffold is not safe until its handover inspection.
    new.status := 'unsafe';
    new.status_reason := 'Awaiting handover inspection';
    new.restriction := null;
    new.last_inspection_id := null;
    new.last_inspected_at := null;
    new.next_inspection_due := null;
    new.dismantled_on := null;
    new.qr_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    return new;
  end if;

  new.scaffold_number := old.scaffold_number;
  new.qr_token := old.qr_token;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  if new.project_id is distinct from old.project_id and not public.is_leader() then
    raise exception 'Only Admin or HSET can move a scaffold to another project';
  end if;

  if not bypass then
    -- Inspection results can't be edited by hand.
    new.last_inspection_id := old.last_inspection_id;
    new.last_inspected_at := old.last_inspected_at;
    new.next_inspection_due := old.next_inspection_due;
    if new.status is distinct from old.status then
      if new.status = 'unsafe' then
        if coalesce(trim(new.status_reason), '') = '' or new.status_reason is not distinct from old.status_reason then
          raise exception 'Give a reason when tagging a scaffold Unsafe';
        end if;
        new.restriction := null;
      elsif new.status = 'dismantled' then
        new.dismantled_on := coalesce(new.dismantled_on, public.perth_today());
        new.restriction := null;
      else
        raise exception 'A scaffold can only be made Safe or Restricted by an inspection';
      end if;
    else
      new.restriction := old.restriction;
      if new.status <> 'unsafe' then new.status_reason := old.status_reason; end if;
      if new.status <> 'dismantled' then new.dismantled_on := old.dismantled_on; end if;
    end if;
  end if;
  return new;
end $$;
create trigger scaffolds_before_write before insert or update on public.scaffolds
  for each row execute function public.scaffold_before_write();

-- -----------------------------------------------------------------------------
-- Inspections (submitted once, signed; never edited)
-- -----------------------------------------------------------------------------
create sequence public.scaffold_inspection_seq;
create table public.scaffold_inspections (
  id                      uuid primary key default gen_random_uuid(),
  reference               text unique,
  scaffold_id             uuid not null references public.scaffolds(id),
  project_id              uuid references public.projects(id),
  inspection_type         text not null check (inspection_type in ('handover', 'periodic', 'alteration', 'incident_weather', 'pre_dismantle')),
  checklist_id            uuid not null references public.scaffold_checklists(id),
  -- { itemId: { result: pass|fail|na, comment, photos[], defect_owner_id, defect_due } }
  items                   jsonb not null default '{}',
  photos                  text[] not null default '{}',
  outcome                 text not null check (outcome in ('safe', 'restricted', 'unsafe')),
  restriction             text,
  notes                   text,
  inspector_id            uuid not null references public.profiles(id) default auth.uid(),
  inspector_name          text,
  inspector_licence_class text,
  signature               text not null,
  signed_at               timestamptz not null,
  latitude                numeric(9,6),
  longitude               numeric(9,6),
  gps_accuracy_m          numeric,
  failed_count            int not null default 0,
  next_due                date,
  archived_at             timestamptz,
  created_at              timestamptz not null default now()
);
create index scaffold_inspections_scaffold_idx on public.scaffold_inspections (scaffold_id, signed_at desc);
alter table public.scaffolds
  add constraint scaffolds_last_inspection_fk foreign key (last_inspection_id)
  references public.scaffold_inspections(id) on delete set null;

create sequence public.scaffold_defect_seq;
create table public.scaffold_defects (
  id            uuid primary key default gen_random_uuid(),
  reference     text unique,
  scaffold_id   uuid not null references public.scaffolds(id),
  inspection_id uuid not null references public.scaffold_inspections(id),
  project_id    uuid references public.projects(id),
  item_id       text not null,
  item_label    text,
  section_title text,
  description   text,
  photos        text[] not null default '{}',
  owner_id      uuid references public.profiles(id) on delete set null,
  due_date      date,
  status        text not null default 'open' check (status in ('open', 'closed')),
  close_photos  text[] not null default '{}',
  close_comment text,
  closed_by     uuid references public.profiles(id) on delete set null,
  closed_at     timestamptz,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (inspection_id, item_id)
);
create index scaffold_defects_open_idx on public.scaffold_defects (scaffold_id) where status = 'open';
create trigger scaffold_defects_updated before update on public.scaffold_defects
  for each row execute function public.set_updated_at();

create or replace function public.scaffold_inspection_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  s     public.scaffolds%rowtype;
  cl    public.scaffold_checklists%rowtype;
  item  jsonb;
  res   text;
  fails int := 0;
  days  int;
begin
  if tg_op = 'UPDATE' then
    -- Signed inspections are a permanent record: only archiving is allowed (Admins, via RLS).
    if (to_jsonb(new) - 'archived_at') is distinct from (to_jsonb(old) - 'archived_at') then
      raise exception 'A signed inspection can''t be changed';
    end if;
    return new;
  end if;

  if not public.is_service_context() then
    new.inspector_id := auth.uid();
  end if;
  if not public.can_inspect_scaffolds(new.inspector_id) then
    raise exception 'Only a competent scaffold inspector with a current scaffolding licence can sign off an inspection';
  end if;

  select * into s from public.scaffolds where id = new.scaffold_id;
  if s.id is null or s.archived_at is not null then
    raise exception 'Scaffold not found';
  end if;
  select * into cl from public.scaffold_checklists where id = new.checklist_id;
  if cl.id is null then
    raise exception 'Checklist not found';
  end if;

  new.items := coalesce(new.items, '{}'::jsonb);
  for item in select i from jsonb_array_elements(cl.sections) sec, jsonb_array_elements(sec->'items') i loop
    res := new.items->(item->>'id')->>'result';
    if res is null or res not in ('pass', 'fail', 'na') then
      raise exception 'Every checklist item needs Pass, Fail or N/A (missing: %)', item->>'label';
    end if;
    if res = 'fail' then fails := fails + 1; end if;
  end loop;

  if new.outcome = 'safe' and fails > 0 then
    raise exception 'A scaffold can''t be Safe for Use while any checklist item has failed';
  end if;
  if new.outcome = 'restricted' and coalesce(trim(new.restriction), '') = '' then
    raise exception 'Write the restriction, for example "Light duty only, max 2 persons"';
  end if;
  if new.outcome <> 'restricted' then
    new.restriction := null;
  end if;
  if coalesce(new.signature, '') = '' then
    raise exception 'The inspector must sign the inspection';
  end if;
  if new.signed_at > now() + interval '10 minutes' then
    raise exception 'The signed time is in the future';
  end if;

  new.reference := 'SI-' || lpad(nextval('public.scaffold_inspection_seq')::text, 5, '0');
  new.project_id := s.project_id;
  new.failed_count := fails;
  select full_name into new.inspector_name from public.profiles where id = new.inspector_id;
  new.inspector_licence_class := public.scaffold_licence_class(new.inspector_id);
  select scaffold_inspection_days into days from public.projects where id = s.project_id;
  new.next_due := case when new.outcome in ('safe', 'restricted')
                       then (new.signed_at at time zone 'Australia/Perth')::date + coalesce(days, 30) end;
  new.created_at := now();
  return new;
end $$;
create trigger scaffold_inspections_before_write before insert or update on public.scaffold_inspections
  for each row execute function public.scaffold_inspection_before_write();

-- After an inspection: update the scaffold (if it's the latest) and raise a defect per failed item.
create or replace function public.scaffold_inspection_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  s    public.scaffolds%rowtype;
  cl   public.scaffold_checklists%rowtype;
  sec  jsonb;
  item jsonb;
  a    jsonb;
begin
  select * into s from public.scaffolds where id = new.scaffold_id;
  -- Inspections done offline can sync out of order: only the newest one sets the status.
  if s.last_inspected_at is null or new.signed_at >= s.last_inspected_at then
    perform set_config('app.scaffold_status_bypass', 'on', true);
    update public.scaffolds
       set status = new.outcome, restriction = new.restriction,
           status_reason = case when new.outcome = 'unsafe' then 'Failed inspection ' || new.reference end,
           last_inspection_id = new.id, last_inspected_at = new.signed_at, next_inspection_due = new.next_due,
           dismantled_on = null
     where id = new.scaffold_id;
    perform set_config('app.scaffold_status_bypass', 'off', true);
  end if;

  select * into cl from public.scaffold_checklists where id = new.checklist_id;
  for sec in select x from jsonb_array_elements(cl.sections) x loop
    for item in select i from jsonb_array_elements(sec->'items') i loop
      a := new.items->(item->>'id');
      if a->>'result' = 'fail' then
        insert into public.scaffold_defects (reference, scaffold_id, inspection_id, project_id, item_id, item_label,
                                             section_title, description, photos, owner_id, due_date)
        values ('SD-' || lpad(nextval('public.scaffold_defect_seq')::text, 5, '0'), new.scaffold_id, new.id, new.project_id,
                item->>'id', item->>'label', sec->>'title', nullif(trim(a->>'comment'), ''),
                coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(a->'photos') = 'array' then a->'photos' else '[]'::jsonb end)), '{}'),
                coalesce(nullif(a->>'defect_owner_id', '')::uuid, new.inspector_id),
                coalesce(nullif(a->>'defect_due', '')::date, (new.signed_at at time zone 'Australia/Perth')::date + 7))
        on conflict (inspection_id, item_id) do nothing;
      end if;
    end loop;
  end loop;
  return null;
end $$;
create trigger scaffold_inspections_after_insert after insert on public.scaffold_inspections
  for each row execute function public.scaffold_inspection_after_insert();

create or replace function public.scaffold_defect_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.reference := old.reference;
  new.scaffold_id := old.scaffold_id;
  new.inspection_id := old.inspection_id;
  new.project_id := old.project_id;
  new.item_id := old.item_id;
  new.item_label := old.item_label;
  new.section_title := old.section_title;
  new.photos := old.photos;
  new.created_at := old.created_at;
  if new.status = 'closed' and old.status <> 'closed' then
    if coalesce(array_length(new.close_photos, 1), 0) = 0 then
      raise exception 'Add a photo of the fix to close the defect';
    end if;
    new.closed_by := auth.uid();
    new.closed_at := now();
  elsif new.status = 'open' then
    new.closed_by := null;
    new.closed_at := null;
  else
    new.closed_by := old.closed_by;
    new.closed_at := old.closed_at;
  end if;
  return new;
end $$;
create trigger scaffold_defects_before_update before update on public.scaffold_defects
  for each row execute function public.scaffold_defect_before_update();

-- -----------------------------------------------------------------------------
-- Row-level security
-- -----------------------------------------------------------------------------
alter table public.scaffold_checklists enable row level security;
alter table public.scaffold_counters enable row level security;
alter table public.scaffolds enable row level security;
alter table public.scaffold_inspections enable row level security;
alter table public.scaffold_defects enable row level security;

-- Checklist: everyone reads (needed to inspect offline); Admins publish new versions.
create policy scaffold_checklists_select on public.scaffold_checklists for select to authenticated using (true);
create policy scaffold_checklists_insert on public.scaffold_checklists for insert to authenticated with check (public.is_admin());

-- Scaffolds: everyone on the project sees them (status is a safety matter, so
-- subcontractors see every scaffold on their projects). Admin/HSET and PMs/Supervisors
-- on the project register and update them.
create policy scaffolds_select on public.scaffolds for select to authenticated
  using (public.is_leader() or project_id in (select public.my_project_ids()));
create policy scaffolds_insert on public.scaffolds for insert to authenticated
  with check (public.is_leader() or (public.is_project_lead() and project_id in (select public.my_project_ids())));
create policy scaffolds_update on public.scaffolds for update to authenticated
  using (public.is_leader() or (public.is_project_lead() and project_id in (select public.my_project_ids())))
  with check (public.is_leader() or (public.is_project_lead() and project_id in (select public.my_project_ids())));

-- Inspections: visible with the scaffold; signed off only by a competent inspector who can see it.
create policy scaffold_inspections_select on public.scaffold_inspections for select to authenticated
  using (exists (select 1 from public.scaffolds s where s.id = scaffold_id));
create policy scaffold_inspections_insert on public.scaffold_inspections for insert to authenticated
  with check (public.can_inspect_scaffolds()
              and exists (select 1 from public.scaffolds s where s.id = scaffold_id and s.archived_at is null));
create policy scaffold_inspections_archive on public.scaffold_inspections for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Defects: visible with the scaffold; created by inspections; the owner, Admin/HSET or a
-- PM/Supervisor on the project updates and closes them.
create policy scaffold_defects_select on public.scaffold_defects for select to authenticated
  using (exists (select 1 from public.scaffolds s where s.id = scaffold_id));
create policy scaffold_defects_update on public.scaffold_defects for update to authenticated
  using (public.is_leader() or owner_id = auth.uid()
         or (public.is_project_lead() and project_id in (select public.my_project_ids())))
  with check (public.is_leader() or owner_id = auth.uid()
         or (public.is_project_lead() and project_id in (select public.my_project_ids())));

grant select, insert on public.scaffold_checklists to authenticated;
grant select, insert, update on public.scaffolds, public.scaffold_inspections to authenticated;
grant select, update on public.scaffold_defects to authenticated;
revoke all on public.scaffold_checklists, public.scaffold_counters, public.scaffolds,
  public.scaffold_inspections, public.scaffold_defects from anon;
revoke all on public.scaffold_counters from authenticated;

-- Photos: inspection, scaffold and defect photos live in form-uploads under {org}/{id}/…
create or replace function public.can_see_upload(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((storage.foldername(p_name))[2] ~ '^[0-9a-f-]{36}$', false)
     and (public.can_see_submission(((storage.foldername(p_name))[2])::uuid)
          or exists (select 1 from public.scaffolds s
                      where s.id = ((storage.foldername(p_name))[2])::uuid and public.can_access_project(s.project_id))
          or exists (select 1 from public.scaffold_inspections i join public.scaffolds s on s.id = i.scaffold_id
                      where i.id = ((storage.foldername(p_name))[2])::uuid and public.can_access_project(s.project_id))
          or exists (select 1 from public.scaffold_defects d
                      where d.id = ((storage.foldername(p_name))[2])::uuid and public.can_access_project(d.project_id)))
$$;

-- History
create trigger scaffolds_audit after insert or update or delete on public.scaffolds
  for each row execute function public.audit_row();
create trigger scaffold_inspections_audit after insert or update or delete on public.scaffold_inspections
  for each row execute function public.audit_row();
create trigger scaffold_defects_audit after insert or update or delete on public.scaffold_defects
  for each row execute function public.audit_row();
create trigger scaffold_checklists_audit after insert or update or delete on public.scaffold_checklists
  for each row execute function public.audit_row();

alter policy audit_log_select on public.audit_log
  using (public.is_leader()
         or (table_name = 'profiles' and record_id = auth.uid()::text)
         or (table_name = 'form_submissions' and public.can_see_submission(record_id::uuid))
         or (table_name = 'vehicles' and exists (select 1 from public.vehicles v where v.id::text = audit_log.record_id))
         or (table_name = 'investigations' and exists (select 1 from public.investigations i where i.id::text = audit_log.record_id))
         or (table_name = 'scaffolds' and exists (select 1 from public.scaffolds s where s.id::text = audit_log.record_id))
         or (table_name = 'scaffold_defects' and exists (select 1 from public.scaffold_defects d where d.id::text = audit_log.record_id)));

revoke execute on function public.scaffold_before_write() from public, anon, authenticated;
revoke execute on function public.scaffold_inspection_before_write() from public, anon, authenticated;
revoke execute on function public.scaffold_inspection_after_insert() from public, anon, authenticated;
revoke execute on function public.scaffold_defect_before_update() from public, anon, authenticated;
revoke execute on function public.scaffold_checklist_before_insert() from public, anon, authenticated;
revoke execute on function public.scaffold_licence_class(uuid) from public, anon;
revoke execute on function public.can_inspect_scaffolds(uuid) from public, anon;
grant execute on function public.scaffold_licence_class(uuid), public.can_inspect_scaffolds(uuid), public.licence_rank(text) to authenticated;

-- Live updates
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    for t in select unnest(array['scaffolds', 'scaffold_inspections', 'scaffold_defects']) loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
