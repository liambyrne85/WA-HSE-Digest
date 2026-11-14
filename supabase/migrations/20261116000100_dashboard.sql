-- =============================================================================
-- Stage 2: dashboard data
--   * vehicle register (+ out-of-service tagging from failed pre-starts)
--   * record_date (the day a record is about — incident date, pre-start day …)
--     and vehicle_id on records; failed-item count and incident category in summary
--   * investigations linked to incidents
--   * field leadership module + per-leader targets
-- Nothing is dropped; existing templates get new versions (old versions stay).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Vehicle register
-- -----------------------------------------------------------------------------
create table public.vehicles (
  id                      uuid primary key default gen_random_uuid(),
  fleet_number            text not null,
  rego                    text,
  vehicle_type            text,
  project_id              uuid references public.projects(id) on delete set null,
  operator_id             uuid references public.profiles(id) on delete set null,
  is_active               boolean not null default true,
  daily_prestart_required boolean not null default true,
  status                  text not null default 'in_service' check (status in ('in_service', 'out_of_service')),
  out_of_service_reason   text,
  out_of_service_at       timestamptz,
  out_of_service_record_id uuid,
  notes                   text,
  archived_at             timestamptz,
  created_by              uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create unique index vehicles_fleet_number on public.vehicles (lower(fleet_number)) where archived_at is null;
create index vehicles_project_idx on public.vehicles (project_id) where is_active;
create trigger vehicles_updated before update on public.vehicles
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Records: record date + vehicle
-- -----------------------------------------------------------------------------
alter table public.form_submissions
  add column if not exists record_date date,
  add column if not exists vehicle_id uuid references public.vehicles(id) on delete set null;
alter table public.vehicles
  add constraint vehicles_out_of_service_record_fk foreign key (out_of_service_record_id)
  references public.form_submissions(id) on delete set null;
create index if not exists form_submissions_record_date_idx on public.form_submissions (module, record_date);
create index if not exists form_submissions_vehicle_idx on public.form_submissions (vehicle_id, record_date);
update public.form_submissions
   set record_date = (coalesce(submitted_at, created_at) at time zone 'Australia/Perth')::date
 where record_date is null;

-- Incident categories for the dashboard (injury, near miss, property damage,
-- vehicle/plant, environmental); stored on each event type, editable by leaders.
insert into public.lookup_values (list_key, label, code, sort_order) values
  ('event_types', 'Vehicle / Plant Incident', 'VPI', 6)
on conflict (list_key, label) do nothing;
update public.lookup_values set metadata = metadata || jsonb_build_object('category', c.cat)
  from (values ('Near Miss', 'near_miss'), ('First Aid Injury', 'injury'), ('Medical Treatment Injury', 'injury'),
               ('Lost Time Injury', 'injury'), ('Property / Plant Damage', 'property_damage'),
               ('Vehicle / Plant Incident', 'vehicle_plant'), ('Environmental Incident', 'environmental'),
               ('Hazard Report', 'hazard'), ('Positive Observation', 'observation')) as c(label, cat)
 where lookup_values.list_key = 'event_types' and lookup_values.label = c.label
   and not (lookup_values.metadata ? 'category');

insert into public.lookup_lists (key, name, description, visible_to_contractors, is_system) values
  ('vehicle_types', 'Vehicle Types', 'Types used in the vehicle register', true, true),
  ('leadership_activities', 'Field Leadership Activities', 'Activity types for field leadership records', true, true)
on conflict (key) do nothing;
insert into public.lookup_values (list_key, label, sort_order)
select v.list_key, v.label, v.sort_order from (values
  ('vehicle_types', 'Ute', 1), ('vehicle_types', 'Light Vehicle', 2), ('vehicle_types', 'Truck', 3),
  ('vehicle_types', 'HIAB Truck', 4), ('vehicle_types', 'Trailer', 5), ('vehicle_types', 'Bus', 6),
  ('vehicle_types', 'Forklift', 7), ('vehicle_types', 'EWP', 8),
  ('leadership_activities', 'Site safety walk', 1), ('leadership_activities', 'Safety interaction / conversation', 2),
  ('leadership_activities', 'Toolbox talk', 3), ('leadership_activities', 'Pre-start meeting', 4),
  ('leadership_activities', 'Scaffold inspection observation', 5), ('leadership_activities', 'Critical risk control verification', 6),
  ('leadership_activities', 'Audit', 7)
) as v(list_key, label, sort_order)
on conflict (list_key, label) do nothing;

-- -----------------------------------------------------------------------------
-- Records trigger: adds record_date, failed_items, incident_category; keeps
-- vehicle_id fixed after creation.
-- -----------------------------------------------------------------------------
create or replace function public.submission_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v         public.form_template_versions%rowtype;
  crit      int;
  failed    int;
  fields    jsonb;
  hours     numeric;
  n         int;
  dt        text;
  cat       text;
  requested text := new.status;
  target    text;
  privileged boolean := public.is_service_context() or public.is_leader()
                        or coalesce(current_setting('app.status_guard_bypass', true), '') = 'on';
begin
  if tg_op = 'UPDATE' then
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

  if new.vehicle_id is not null and (tg_op = 'INSERT' or new.vehicle_id is distinct from old.vehicle_id) and not exists (
       select 1 from public.vehicles where id = new.vehicle_id and is_active and archived_at is null) then
    raise exception 'That vehicle is not in the active vehicle register';
  end if;

  new.title := coalesce(nullif(new.title, ''), v.name);
  new.answers := coalesce(new.answers, '{}'::jsonb);

  select count(*) into crit
    from jsonb_array_elements(v.schema->'sections') s, jsonb_array_elements(s->'questions') q
   where coalesce((q->>'critical')::boolean, false)
     and new.answers->>(q->>'id') in ('fail', 'no');

  select count(*) into failed
    from jsonb_array_elements(v.schema->'sections') s, jsonb_array_elements(s->'questions') q
   where (q->>'type' = 'pass_fail_na' and new.answers->>(q->>'id') = 'fail')
      or (q->>'type' = 'yes_no' and coalesce((q->>'critical')::boolean, false) and new.answers->>(q->>'id') = 'no');

  select coalesce(jsonb_object_agg(k, val), '{}'::jsonb) into fields from (
    select coalesce(nullif(q->>'fieldKey', ''), public.lookup_field_name(q->>'lookupKey')) as k,
           new.answers->(q->>'id') as val
      from jsonb_array_elements(v.schema->'sections') s, jsonb_array_elements(s->'questions') q
     where (nullif(q->>'fieldKey', '') is not null or nullif(q->>'lookupKey', '') is not null)
       and jsonb_typeof(new.answers->(q->>'id')) in ('string', 'number', 'boolean')
  ) x where k is not null;

  select sum((r->>'hours')::numeric) into hours
    from jsonb_array_elements(v.schema->'sections') s, jsonb_array_elements(s->'questions') q,
         jsonb_array_elements(case when jsonb_typeof(new.answers->(q->>'id')) = 'array' then new.answers->(q->>'id') else '[]'::jsonb end) r
   where q->>'type' = 'table' and (r->>'hours') ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$';

  -- Incident category from the event type's lookup metadata.
  if fields ? 'event_type' then
    select metadata->>'category' into cat from public.lookup_values
     where list_key = 'event_types' and lower(label) = lower(fields->>'event_type') limit 1;
  end if;

  new.summary := fields || jsonb_build_object('critical_failures', crit, 'failed_items', failed)
                 || case when hours is not null and not fields ? 'total_hours' then jsonb_build_object('total_hours', hours) else '{}'::jsonb end
                 || case when cat is not null then jsonb_build_object('incident_category', cat) else '{}'::jsonb end;

  -- Record date: a question with field name record_date (date or date-time), else the Perth day it was submitted/created.
  dt := fields->>'record_date';
  if dt ~ '^\d{4}-\d{2}-\d{2}' then
    new.record_date := left(dt, 10)::date;
  else
    new.record_date := (coalesce(new.submitted_at, case when requested = 'submitted' then now() end, new.created_at, now())
                        at time zone 'Australia/Perth')::date;
  end if;

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

-- A submitted pre-start with a failed critical item tags its vehicle out of service.
create or replace function public.prestart_tag_vehicle()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.module = 'plant_prestart' and new.vehicle_id is not null and new.status <> 'draft'
     and coalesce((new.summary->>'critical_failures')::int, 0) > 0
     and (tg_op = 'INSERT' or old.status = 'draft' or old.status is distinct from new.status) then
    update public.vehicles
       set status = 'out_of_service',
           out_of_service_reason = 'Critical item failed on pre-start ' || new.reference,
           out_of_service_at = now(),
           out_of_service_record_id = new.id
     where id = new.vehicle_id and status <> 'out_of_service';
  end if;
  return null;
end $$;
create trigger form_submissions_prestart_tag after insert or update on public.form_submissions
  for each row execute function public.prestart_tag_vehicle();

-- -----------------------------------------------------------------------------
-- Investigations
-- -----------------------------------------------------------------------------
create sequence public.investigation_seq;

create table public.investigations (
  id                 uuid primary key default gen_random_uuid(),
  reference          text unique,
  incident_id        uuid not null references public.form_submissions(id) on delete restrict,
  project_id         uuid references public.projects(id) on delete set null,
  organization_id    uuid references public.organizations(id) on delete set null,
  lead_id            uuid references public.profiles(id) on delete set null,
  status             text not null default 'open' check (status in ('open', 'in_progress', 'review', 'closed')),
  due_date           date,
  findings           text,
  root_cause         text,
  corrective_actions text,
  opened_at          timestamptz not null default now(),
  closed_at          timestamptz,
  closed_by          uuid references public.profiles(id) on delete set null,
  archived_at        timestamptz,
  created_by         uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index investigations_one_per_incident on public.investigations (incident_id) where archived_at is null;
create index investigations_open_idx on public.investigations (status) where status <> 'closed';
create trigger investigations_updated before update on public.investigations
  for each row execute function public.set_updated_at();

create or replace function public.investigation_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  inc public.form_submissions%rowtype;
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
  else
    new.incident_id := old.incident_id;
    new.reference := old.reference;
    new.project_id := old.project_id;
    new.organization_id := old.organization_id;
    new.opened_at := old.opened_at;
    new.created_by := old.created_by;
  end if;
  if new.status = 'closed' and (tg_op = 'INSERT' or old.status <> 'closed') then
    new.closed_at := now();
    new.closed_by := auth.uid();
  elsif new.status <> 'closed' then
    new.closed_at := null;
    new.closed_by := null;
  end if;
  return new;
end $$;
create trigger investigations_before_write before insert or update on public.investigations
  for each row execute function public.investigation_before_write();

-- Opening an investigation moves the incident to "Under Investigation" when that status exists.
create or replace function public.investigation_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.pipeline_has_status('safety_event', 'under_investigation') then
    perform set_config('app.status_guard_bypass', 'on', true);
    update public.form_submissions set status = 'under_investigation'
     where id = new.incident_id and status in ('submitted', 'draft');
    perform set_config('app.status_guard_bypass', 'off', true);
  end if;
  insert into public.record_events (submission_id, kind, body, actor)
  values (new.incident_id, 'comment', 'Investigation ' || new.reference || ' opened', auth.uid());
  return null;
end $$;
create trigger investigations_after_insert after insert on public.investigations
  for each row execute function public.investigation_after_insert();

-- -----------------------------------------------------------------------------
-- Field leadership targets (per leader, per week or per month; set by Admins)
-- -----------------------------------------------------------------------------
create table public.leadership_targets (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  period     text not null default 'week' check (period in ('week', 'month')),
  target     int not null check (target >= 0),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);
create trigger leadership_targets_updated before update on public.leadership_targets
  for each row execute function public.set_updated_at();

-- Field leadership pipeline: a record is complete when submitted.
insert into public.workflow_pipelines (module, statuses) values
  ('field_leadership', '[{"key":"submitted","label":"Completed","color":"green","is_terminal":true}]')
on conflict (module) do nothing;

-- -----------------------------------------------------------------------------
-- Templates: new versions (old versions are kept for existing records)
-- -----------------------------------------------------------------------------
create or replace function public.publish_seed_version(p_template_id uuid, p_schema jsonb, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare
  t public.form_templates%rowtype;
  v_id uuid;
begin
  select * into t from public.form_templates where id = p_template_id;
  insert into public.form_template_versions (template_id, version, name, category, schema, change_note)
  values (t.id, t.current_version + 1, t.name, t.category, p_schema, p_note)
  returning id into v_id;
  update public.form_templates
     set draft_schema = p_schema, current_version = t.current_version + 1, current_version_id = v_id, status = 'published'
   where id = t.id;
  update public.form_templates set has_unpublished_changes = false where id = t.id;
end $$;
revoke execute on function public.publish_seed_version(uuid, jsonb, text) from public, anon, authenticated;

do $$
declare
  t_id uuid;
  v_id uuid;
  s jsonb;
begin
  -- Safety Event Report: add the incident date & time (feeds the record date).
  select id, draft_schema into t_id, s from public.form_templates
   where category = 'safety_event' and name = 'Safety Event Report' limit 1;
  if t_id is not null and not (s::text like '%"record_date"%') then
    s := jsonb_set(s, '{sections,0,questions}',
           jsonb_build_array(jsonb_build_object('id', 'q-when', 'label', 'Date and time of the incident', 'type', 'datetime',
                                                'required', true, 'fieldKey', 'record_date'))
           || (s->'sections'->0->'questions'));
    perform public.publish_seed_version(t_id, s, 'Added incident date and time');
  end if;

  -- Vehicle Pre-Start (linked to the vehicle register).
  if not exists (select 1 from public.form_templates where name = 'Vehicle Pre-Start') then
    s := '{"settings":{"requireProject":true,"requireVehicle":true,"requireSignOff":false},"sections":[
      {"id":"s-v-details","title":"Vehicle","questions":[
        {"id":"q-v-odo","label":"Odometer / hour meter","type":"number","required":true,"unit":"km"}]},
      {"id":"s-v-walk","title":"Walk-around","questions":[
        {"id":"q-v-tyres","label":"Tyres and wheel nuts OK","type":"pass_fail_na","required":true,"critical":true,"photoOnFail":true},
        {"id":"q-v-lights","label":"Lights, indicators and beacon working","type":"pass_fail_na","required":true,"photoOnFail":true},
        {"id":"q-v-fluids","label":"Oil, coolant and fluids OK, no leaks","type":"pass_fail_na","required":true,"photoOnFail":true},
        {"id":"q-v-body","label":"Body, mirrors and windscreen undamaged","type":"pass_fail_na","required":true,"photoOnFail":true},
        {"id":"q-v-load","label":"Load restraint (straps, chains, gates) OK","type":"pass_fail_na","required":true,"critical":true,"photoOnFail":true}]},
      {"id":"s-v-cab","title":"In the cab","questions":[
        {"id":"q-v-brakes","label":"Service and park brakes work","type":"pass_fail_na","required":true,"critical":true},
        {"id":"q-v-belts","label":"Seatbelts work","type":"pass_fail_na","required":true,"critical":true},
        {"id":"q-v-horn","label":"Horn and reversing alarm work","type":"pass_fail_na","required":true},
        {"id":"q-v-kit","label":"First aid kit and fire extinguisher present","type":"pass_fail_na","required":true},
        {"id":"q-v-hiab","label":"HIAB / crane checks done (if fitted)","type":"pass_fail_na","required":true}]},
      {"id":"s-v-sign","title":"Driver","questions":[
        {"id":"q-v-fit","label":"I am fit to drive and the vehicle is safe to use","type":"yes_no","required":true,"critical":true},
        {"id":"q-v-sig","label":"Driver signature","type":"signature","required":true}]}]}';
    insert into public.form_templates (name, description, category, draft_schema, status, has_unpublished_changes)
    values ('Vehicle Pre-Start', 'Daily pre-start for utes, trucks and HIABs on the vehicle register.', 'plant_prestart', s, 'published', false)
    returning id into t_id;
    insert into public.form_template_versions (template_id, version, name, category, schema, change_note)
    values (t_id, 1, 'Vehicle Pre-Start', 'plant_prestart', s, 'Initial starter template') returning id into v_id;
    update public.form_templates set current_version = 1, current_version_id = v_id where id = t_id;
    update public.form_templates set has_unpublished_changes = false where id = t_id;
  end if;

  -- Field Leadership.
  if not exists (select 1 from public.form_templates where category = 'field_leadership') then
    s := '{"settings":{"requireProject":true,"requireSignOff":false},"sections":[
      {"id":"s-fl","title":"Field leadership","questions":[
        {"id":"q-fl-date","label":"Date","type":"date","required":true,"fieldKey":"record_date"},
        {"id":"q-fl-type","label":"Activity type","type":"dropdown","required":true,"lookupKey":"leadership_activities","fieldKey":"activity_type"},
        {"id":"q-fl-obs","label":"Observations","type":"text","required":true,"multiline":true},
        {"id":"q-fl-photos","label":"Photos","type":"photo","required":false}]}]}';
    insert into public.form_templates (name, description, category, draft_schema, status, has_unpublished_changes)
    values ('Field Leadership', 'Leader in the field: site walks, safety conversations, toolbox talks.', 'field_leadership', s, 'published', false)
    returning id into t_id;
    insert into public.form_template_versions (template_id, version, name, category, schema, change_note)
    values (t_id, 1, 'Field Leadership', 'field_leadership', s, 'Initial starter template') returning id into v_id;
    update public.form_templates set current_version = 1, current_version_id = v_id where id = t_id;
    update public.form_templates set has_unpublished_changes = false where id = t_id;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Row-level security
-- -----------------------------------------------------------------------------
alter table public.vehicles enable row level security;
alter table public.investigations enable row level security;
alter table public.leadership_targets enable row level security;

-- Vehicles: everyone on the project sees the fleet there; subcontractors only see vehicles
-- their own people operate (they can't see our pre-starts, so our fleet is not theirs to track).
create policy vehicles_select on public.vehicles for select to authenticated
  using (public.is_leader() or operator_id = auth.uid()
         or (project_id is not null and public.can_access_project(project_id)
             and (public.is_internal_user() or (operator_id is not null and public.can_see_person(operator_id)))));
create policy vehicles_insert on public.vehicles for insert to authenticated
  with check (public.is_leader());
create policy vehicles_update on public.vehicles for update to authenticated
  using (public.is_leader() or (public.is_project_lead() and project_id in (select public.my_project_ids())
         and (public.is_internal_user() or (operator_id is not null and public.can_see_person(operator_id)))))
  with check (public.is_leader() or (public.is_project_lead() and project_id in (select public.my_project_ids())
         and (public.is_internal_user() or (operator_id is not null and public.can_see_person(operator_id)))));

-- Investigations: visible with the incident; Admin/HSET or a lead on the
-- project opens them; the investigation lead can update.
create policy investigations_select on public.investigations for select to authenticated
  using (public.is_leader() or lead_id = auth.uid() or public.can_see_submission(incident_id));
create policy investigations_insert on public.investigations for insert to authenticated
  with check (public.is_leader() or (public.is_project_lead() and public.can_see_submission(incident_id)));
create policy investigations_update on public.investigations for update to authenticated
  using (public.is_leader() or lead_id = auth.uid() or (public.is_project_lead() and public.can_see_submission(incident_id)))
  with check (public.is_leader() or lead_id = auth.uid() or (public.is_project_lead() and public.can_see_submission(incident_id)));

-- Targets: read by anyone who can see the leader; set by Admins.
create policy targets_select on public.leadership_targets for select to authenticated
  using (public.can_see_person(profile_id));
create policy targets_admin_insert on public.leadership_targets for insert to authenticated
  with check (public.is_admin());
create policy targets_admin_update on public.leadership_targets for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update on public.vehicles, public.investigations, public.leadership_targets to authenticated;
revoke all on public.vehicles, public.investigations, public.leadership_targets from anon;

-- Audit history on the new tables (audit_row now also keys rows by profile_id).
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  r jsonb := coalesce(to_jsonb(new), to_jsonb(old));
  changed_old jsonb;
  changed_new jsonb;
begin
  if tg_op = 'UPDATE' then
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
          coalesce(r->>'id', r->>'job_role_id', r->>'profile_id', r->>'module', r->>'project_id', '?'),
          lower(tg_op), o, n);
  return coalesce(new, old);
end $$;
-- Audit history on the new tables.
create trigger vehicles_audit after insert or update or delete on public.vehicles
  for each row execute function public.audit_row();
create trigger investigations_audit after insert or update or delete on public.investigations
  for each row execute function public.audit_row();
create trigger leadership_targets_audit after insert or update or delete on public.leadership_targets
  for each row execute function public.audit_row();

revoke execute on function public.prestart_tag_vehicle() from public, anon, authenticated;
revoke execute on function public.investigation_before_write() from public, anon, authenticated;
revoke execute on function public.investigation_after_insert() from public, anon, authenticated;

-- Live dashboard: stream changes on these tables to signed-in clients (RLS applies).
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    for t in select unnest(array['form_submissions', 'vehicles', 'investigations', 'leadership_targets']) loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- History: anyone who can see a vehicle or investigation can read its change history
-- (the sub-selects run under the caller's row-level security).
alter policy audit_log_select on public.audit_log
  using (public.is_leader()
         or (table_name = 'profiles' and record_id = auth.uid()::text)
         or (table_name = 'form_submissions' and public.can_see_submission(record_id::uuid))
         or (table_name = 'vehicles' and exists (select 1 from public.vehicles v where v.id::text = audit_log.record_id))
         or (table_name = 'investigations' and exists (select 1 from public.investigations i where i.id::text = audit_log.record_id)));
