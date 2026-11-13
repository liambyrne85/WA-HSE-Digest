-- =============================================================================
-- Phase 1 foundation: organisations, profiles & roles, projects/sites,
-- dynamic form templates (versioned), workflow & notification rules engine,
-- configurable lookup lists, worker tickets, storage buckets and RLS.
--
-- Roles
--   leader      full access, approvals, template/workflow admin (internal org only)
--   employee    internal field worker: own records, no commercial data
--   contractor  scoped to their own organization_id, nothing internal
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.app_role as enum ('leader', 'employee', 'contractor');
create type public.org_type as enum ('internal', 'contractor');
create type public.project_status as enum ('planning', 'active', 'on_hold', 'completed', 'closed');
create type public.template_category as enum ('audit', 'plant_prestart', 'risk_assessment', 'safety_event');
create type public.template_status as enum ('draft', 'published', 'archived');
create type public.invitation_status as enum ('pending', 'accepted', 'revoked', 'expired');
create type public.workflow_module as enum (
  'safety_event', 'daily_field_report', 'plant_prestart', 'audit',
  'risk_assessment', 'timesheet', 'training'
);
create type public.workflow_trigger as enum (
  'record_created', 'status_changed', 'field_condition', 'record_overdue', 'ticket_expiring'
);

-- -----------------------------------------------------------------------------
-- Shared helpers
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- True when running as the service role / migrations (no end-user JWT).
create or replace function public.is_service_context()
returns boolean language sql stable as $$
  select coalesce(auth.role(), '') = 'service_role' or auth.uid() is null
$$;

-- -----------------------------------------------------------------------------
-- Organisations
-- -----------------------------------------------------------------------------
create table public.organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  type          public.org_type not null,
  abn           text,
  contact_name  text,
  contact_email text,
  contact_phone text,
  is_active     boolean not null default true,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- Exactly one primary internal company.
create unique index organizations_single_internal on public.organizations ((type)) where type = 'internal';
create trigger organizations_updated before update on public.organizations
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Job roles / classifications (visible to everyone) + commercial rates (leaders only)
-- -----------------------------------------------------------------------------
create table public.job_roles (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique,
  classification text,
  description    text,
  applies_to     public.org_type[] not null default array['internal','contractor']::public.org_type[],
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger job_roles_updated before update on public.job_roles
  for each row execute function public.set_updated_at();

create table public.job_role_rates (
  job_role_id  uuid primary key references public.job_roles(id) on delete cascade,
  cost_rate    numeric(10,2),
  charge_rate  numeric(10,2),
  currency     text not null default 'AUD',
  updated_at   timestamptz not null default now()
);
create trigger job_role_rates_updated before update on public.job_role_rates
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),
  role            public.app_role not null default 'employee',
  email           text not null,
  full_name       text not null default '',
  phone           text,
  job_role_id     uuid references public.job_roles(id) on delete set null,
  employee_number text,
  emergency_contact_name  text,
  emergency_contact_phone text,
  avatar_path     text,
  is_active       boolean not null default true,
  last_seen_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index profiles_org_idx on public.profiles (organization_id);
create index profiles_role_idx on public.profiles (role);
create trigger profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- RLS helper functions. SECURITY DEFINER so they can read profiles without
-- recursing through profiles' own policies.
create or replace function public.current_role_name()
returns public.app_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.current_org_id()
returns uuid language sql stable security definer set search_path = public as $$
  select organization_id from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_leader()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active and role = 'leader')
$$;

create or replace function public.is_internal_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active and role in ('leader','employee'))
$$;

create or replace function public.is_contractor()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active and role = 'contractor')
$$;

-- Role <-> organisation type must agree (contractor role ⇔ contractor org).
create or replace function public.enforce_role_org_match()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t public.org_type;
begin
  select type into t from public.organizations where id = new.organization_id;
  if t is null then
    raise exception 'Organisation % does not exist', new.organization_id;
  end if;
  if new.role = 'contractor' and t <> 'contractor' then
    raise exception 'Contractor users must belong to a contractor company';
  end if;
  if new.role in ('leader','employee') and t <> 'internal' then
    raise exception 'Leaders and employees must belong to the internal company';
  end if;
  return new;
end $$;
create trigger profiles_role_org_match before insert or update of role, organization_id on public.profiles
  for each row execute function public.enforce_role_org_match();

-- Stop privilege escalation: only leaders (or the service role) may change
-- role, organisation, job role, employee number or active flag; and the last
-- active leader can never be demoted or deactivated.
create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_service_context() and not public.is_leader() then
    if new.role is distinct from old.role
       or new.organization_id is distinct from old.organization_id
       or new.job_role_id is distinct from old.job_role_id
       or new.employee_number is distinct from old.employee_number
       or new.is_active is distinct from old.is_active
       or new.email is distinct from old.email then
      raise exception 'Only leaders can change role, company, job role or account status';
    end if;
  end if;

  if old.role = 'leader' and old.is_active
     and (new.role <> 'leader' or not new.is_active)
     and (select count(*) from public.profiles where role = 'leader' and is_active and id <> old.id) = 0 then
    raise exception 'Cannot remove the last active leader';
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- -----------------------------------------------------------------------------
-- Invitations
-- -----------------------------------------------------------------------------
create table public.user_invitations (
  id              uuid primary key default gen_random_uuid(),
  email           text not null,
  full_name       text,
  role            public.app_role not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_role_id     uuid references public.job_roles(id) on delete set null,
  status          public.invitation_status not null default 'pending',
  invited_by      uuid references public.profiles(id) on delete set null,
  user_id         uuid references auth.users(id) on delete set null,
  accepted_at     timestamptz,
  expires_at      timestamptz not null default now() + interval '14 days',
  created_at      timestamptz not null default now()
);
create unique index user_invitations_pending_email on public.user_invitations (lower(email)) where status = 'pending';
create trigger user_invitations_role_org_match before insert or update of role, organization_id on public.user_invitations
  for each row execute function public.enforce_role_org_match();

-- New auth user → profile. Invited users inherit the invitation; the very first
-- user bootstraps as leader of the internal company; anyone else who self-signs
-- up is created INACTIVE (no data access) until a leader activates them.
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
    insert into public.organizations (name, type) values ('Internal Company', 'internal')
    returning id into internal_org;
  end if;

  if inv.id is not null then
    insert into public.profiles (id, email, full_name, role, organization_id, job_role_id, is_active)
    values (new.id, new.email, coalesce(nullif(inv.full_name, ''), display_name),
            inv.role, inv.organization_id, inv.job_role_id, true);
    update public.user_invitations
       set status = 'accepted', accepted_at = now(), user_id = new.id
     where id = inv.id;
  elsif not exists (select 1 from public.profiles) then
    insert into public.profiles (id, email, full_name, role, organization_id, is_active)
    values (new.id, new.email, display_name, 'leader', internal_org, true);
  else
    insert into public.profiles (id, email, full_name, role, organization_id, is_active)
    values (new.id, new.email, display_name, 'employee', internal_org, false);
  end if;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Directory view: names/roles that a user is allowed to see, without private
-- fields (phone, emergency contacts, employee number).
create or replace view public.profile_directory
with (security_invoker = false) as
  select p.id, p.full_name, p.role, p.organization_id, p.job_role_id, p.is_active
    from public.profiles p
   where public.is_leader()
      or (p.is_active and public.is_internal_user() and p.role in ('leader','employee'))
      or (p.is_active and public.is_contractor() and p.organization_id = public.current_org_id());
grant select on public.profile_directory to authenticated;

-- -----------------------------------------------------------------------------
-- Projects / sites master register
-- -----------------------------------------------------------------------------
create table public.projects (
  id            uuid primary key default gen_random_uuid(),
  code          text unique,
  name          text not null,
  client_name   text,
  site_location text,
  latitude      numeric(9,6),
  longitude     numeric(9,6),
  status        public.project_status not null default 'active',
  is_active     boolean not null default true,
  start_date    date,
  end_date      date,
  description   text,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger projects_updated before update on public.projects
  for each row execute function public.set_updated_at();

-- Which contractor companies are engaged on which project.
create table public.project_organizations (
  project_id      uuid not null references public.projects(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (project_id, organization_id)
);

create or replace function public.can_access_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_internal_user()
      or exists (
        select 1 from public.project_organizations po
         where po.project_id = p_project_id and po.organization_id = public.current_org_id()
      )
$$;

-- -----------------------------------------------------------------------------
-- Lookup lists (Event Types, Plant Categories, Cost Codes, …)
-- -----------------------------------------------------------------------------
create table public.lookup_lists (
  key                    text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  name                   text not null,
  description            text,
  visible_to_contractors boolean not null default true,
  is_system              boolean not null default false,
  created_at             timestamptz not null default now()
);

create table public.lookup_values (
  id         uuid primary key default gen_random_uuid(),
  list_key   text not null references public.lookup_lists(key) on delete cascade on update cascade,
  label      text not null,
  code       text,
  sort_order int not null default 0,
  is_active  boolean not null default true,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (list_key, label)
);
create trigger lookup_values_updated before update on public.lookup_values
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Form & checklist templates (JSONB) with immutable published versions
-- -----------------------------------------------------------------------------
create table public.form_templates (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  description            text,
  category               public.template_category not null,
  status                 public.template_status not null default 'draft',
  draft_schema           jsonb not null default '{"sections": []}'::jsonb,
  has_unpublished_changes boolean not null default true,
  current_version        int not null default 0,
  current_version_id     uuid,
  available_to_contractors boolean not null default true,
  created_by             uuid references public.profiles(id) on delete set null,
  updated_by             uuid references public.profiles(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint draft_schema_has_sections check (jsonb_typeof(draft_schema->'sections') = 'array')
);
create trigger form_templates_updated before update on public.form_templates
  for each row execute function public.set_updated_at();

create table public.form_template_versions (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null references public.form_templates(id) on delete restrict,
  version      int not null,
  name         text not null,
  category     public.template_category not null,
  schema       jsonb not null,
  change_note  text,
  published_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz not null default now(),
  unique (template_id, version)
);
alter table public.form_templates
  add constraint form_templates_current_version_fk
  foreign key (current_version_id) references public.form_template_versions(id) on delete set null;

-- Published versions are immutable so historical submissions always render
-- against the exact questions that were answered.
create or replace function public.prevent_version_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Published template versions are immutable';
end $$;
create trigger form_template_versions_immutable before update or delete on public.form_template_versions
  for each row execute function public.prevent_version_mutation();

-- Mark draft dirty whenever its schema is edited.
create or replace function public.mark_template_dirty()
returns trigger language plpgsql as $$
begin
  if new.draft_schema is distinct from old.draft_schema
     or new.name is distinct from old.name then
    new.has_unpublished_changes := true;
  end if;
  return new;
end $$;
create trigger form_templates_dirty before update on public.form_templates
  for each row execute function public.mark_template_dirty();

create or replace function public.publish_form_template(p_template_id uuid, p_change_note text default null)
returns public.form_template_versions
language plpgsql security definer set search_path = public as $$
declare
  t public.form_templates%rowtype;
  v public.form_template_versions%rowtype;
begin
  if not public.is_leader() then
    raise exception 'Only leaders can publish templates';
  end if;
  select * into t from public.form_templates where id = p_template_id for update;
  if t.id is null then
    raise exception 'Template not found';
  end if;
  if jsonb_array_length(t.draft_schema->'sections') = 0 then
    raise exception 'Add at least one section before publishing';
  end if;

  insert into public.form_template_versions (template_id, version, name, category, schema, change_note, published_by)
  values (t.id, t.current_version + 1, t.name, t.category, t.draft_schema, p_change_note, auth.uid())
  returning * into v;

  update public.form_templates
     set current_version = v.version,
         current_version_id = v.id,
         status = 'published',
         updated_by = auth.uid()
   where id = t.id;
  -- mark_template_dirty only sets true; clear it explicitly afterwards.
  update public.form_templates set has_unpublished_changes = false where id = t.id;
  return v;
end $$;

-- Records captured against a template (consumed by Phase 2 modules).
create table public.form_submissions (
  id                  uuid primary key default gen_random_uuid(),
  template_version_id uuid not null references public.form_template_versions(id) on delete restrict,
  project_id          uuid references public.projects(id) on delete set null,
  organization_id     uuid not null references public.organizations(id),
  submitted_by        uuid not null references public.profiles(id) default auth.uid(),
  status              text not null default 'draft',
  answers             jsonb not null default '{}'::jsonb,
  submitted_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index form_submissions_org_idx on public.form_submissions (organization_id);
create trigger form_submissions_updated before update on public.form_submissions
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Workflow: status pipelines per module + rules engine
-- -----------------------------------------------------------------------------
create table public.workflow_pipelines (
  module     public.workflow_module primary key,
  statuses   jsonb not null,  -- [{key,label,color,is_terminal}]
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint statuses_is_array check (jsonb_typeof(statuses) = 'array')
);
create trigger workflow_pipelines_updated before update on public.workflow_pipelines
  for each row execute function public.set_updated_at();

create table public.workflow_rules (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  description    text,
  module         public.workflow_module not null,
  trigger_event  public.workflow_trigger not null,
  -- status_changed:  {"to_status": "submitted", "from_status": null}
  -- field_condition: {"field": "severity", "operator": "eq", "value": "High"}
  -- record_overdue:  {"after_hours": 24, "status": "submitted"}
  trigger_config jsonb not null default '{}'::jsonb,
  -- [{"step":1,"role":"leader","job_role_id":null,"sla_hours":24}]
  approval_chain jsonb not null default '[]'::jsonb,
  -- [{"type":"in_app"|"email"|"sms","recipients":["role:leader","submitter","email:x@y"],"message":"…"}]
  actions        jsonb not null default '[]'::jsonb,
  is_enabled     boolean not null default true,
  priority       int not null default 100,
  created_by     uuid references public.profiles(id) on delete set null,
  updated_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint approval_chain_is_array check (jsonb_typeof(approval_chain) = 'array'),
  constraint actions_is_array check (jsonb_typeof(actions) = 'array')
);
create index workflow_rules_lookup on public.workflow_rules (module, trigger_event) where is_enabled;
create trigger workflow_rules_updated before update on public.workflow_rules
  for each row execute function public.set_updated_at();

-- In-app notifications and an outbound queue (email/SMS) drained by an Edge Function.
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  title      text not null,
  body       text,
  link       text,
  rule_id    uuid references public.workflow_rules(id) on delete set null,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.notification_outbox (
  id          uuid primary key default gen_random_uuid(),
  channel     text not null check (channel in ('email','sms')),
  recipient   text not null,
  subject     text,
  body        text,
  rule_id     uuid references public.workflow_rules(id) on delete set null,
  payload     jsonb not null default '{}'::jsonb,
  status      text not null default 'queued' check (status in ('queued','sent','failed')),
  attempts    int not null default 0,
  sent_at     timestamptz,
  created_at  timestamptz not null default now()
);

-- Does a single rule match an event? Pure function so the admin UI can dry-run it.
create or replace function public.workflow_rule_matches(
  r public.workflow_rules, p_event public.workflow_trigger, p_record jsonb, p_old jsonb default null
) returns boolean language plpgsql immutable as $$
declare
  cfg jsonb := coalesce(r.trigger_config, '{}'::jsonb);
  fld text; op text; val text; actual text;
begin
  if r.trigger_event <> p_event then
    return false;
  end if;

  if p_event = 'status_changed' then
    if cfg ? 'to_status' and coalesce(cfg->>'to_status','') <> ''
       and coalesce(p_record->>'status','') <> cfg->>'to_status' then
      return false;
    end if;
    if cfg ? 'from_status' and coalesce(cfg->>'from_status','') <> ''
       and coalesce(p_old->>'status','') <> cfg->>'from_status' then
      return false;
    end if;
    return true;
  end if;

  if p_event = 'field_condition' then
    fld := cfg->>'field'; op := coalesce(cfg->>'operator','eq'); val := cfg->>'value';
    actual := p_record->>fld;
    if fld is null or actual is null then
      return false;
    end if;
    return case op
      when 'eq'       then lower(actual) = lower(val)
      when 'neq'      then lower(actual) <> lower(val)
      when 'in'       then lower(actual) = any (select lower(trim(x)) from unnest(string_to_array(val, ',')) x)
      when 'contains' then position(lower(val) in lower(actual)) > 0
      when 'gt'       then actual ~ '^-?[0-9.]+$' and val ~ '^-?[0-9.]+$' and actual::numeric >  val::numeric
      when 'gte'      then actual ~ '^-?[0-9.]+$' and val ~ '^-?[0-9.]+$' and actual::numeric >= val::numeric
      when 'lt'       then actual ~ '^-?[0-9.]+$' and val ~ '^-?[0-9.]+$' and actual::numeric <  val::numeric
      when 'lte'      then actual ~ '^-?[0-9.]+$' and val ~ '^-?[0-9.]+$' and actual::numeric <= val::numeric
      else false
    end;
  end if;

  return true;  -- record_created / record_overdue / ticket_expiring: module+event is enough
end $$;

-- Evaluate enabled rules for an event and fan out notifications.
-- Phase 2 modules call this from their own triggers, e.g.
--   perform public.run_workflow_rules('safety_event', 'status_changed', to_jsonb(new), to_jsonb(old));
-- Returns the matched rule ids.
create or replace function public.run_workflow_rules(
  p_module public.workflow_module, p_event public.workflow_trigger,
  p_record jsonb, p_old jsonb default null
) returns uuid[]
language plpgsql security definer set search_path = public as $$
declare
  r         public.workflow_rules%rowtype;
  act       jsonb;
  recip     text;
  matched   uuid[] := '{}';
  msg       text;
  record_org uuid := nullif(p_record->>'organization_id','')::uuid;
begin
  for r in
    select * from public.workflow_rules
     where module = p_module and trigger_event = p_event and is_enabled
     order by priority, created_at
  loop
    continue when not public.workflow_rule_matches(r, p_event, p_record, p_old);
    matched := matched || r.id;

    for act in select * from jsonb_array_elements(r.actions) loop
      msg := coalesce(act->>'message', r.name);
      for recip in select jsonb_array_elements_text(coalesce(act->'recipients', '[]'::jsonb)) loop
        if act->>'type' = 'in_app' then
          insert into public.notifications (user_id, title, body, rule_id, link)
          select p.id, r.name, msg, r.id, p_record->>'link'
            from public.profiles p
           where p.is_active and (
                 (recip like 'role:%' and p.role::text = substring(recip from 6)
                  -- contractor recipients only ever hear about their own company's records
                  and (p.role <> 'contractor' or p.organization_id = record_org))
              or (recip = 'submitter' and p.id = nullif(p_record->>'submitted_by','')::uuid)
              or (recip like 'user:%' and p.id::text = substring(recip from 6)));
        elsif act->>'type' in ('email','sms') then
          insert into public.notification_outbox (channel, recipient, subject, body, rule_id, payload)
          select act->>'type', x.addr, r.name, msg, r.id, p_record
            from (
              select case when act->>'type' = 'email' then p.email else p.phone end as addr
                from public.profiles p
               where p.is_active and (
                     (recip like 'role:%' and p.role::text = substring(recip from 6)
                      and (p.role <> 'contractor' or p.organization_id = record_org))
                  or (recip = 'submitter' and p.id = nullif(p_record->>'submitted_by','')::uuid))
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

-- Admin dry run: which enabled rules would fire for a sample record? No side effects.
create or replace function public.test_workflow_rules(
  p_module public.workflow_module, p_event public.workflow_trigger,
  p_record jsonb, p_old jsonb default null
) returns setof public.workflow_rules
language sql stable security invoker as $$
  select r.* from public.workflow_rules r
   where r.module = p_module and r.is_enabled
     and public.workflow_rule_matches(r, p_event, p_record, p_old)
   order by r.priority, r.created_at
$$;

-- -----------------------------------------------------------------------------
-- Worker tickets / licences / training (own records + contractor crew)
-- -----------------------------------------------------------------------------
create table public.worker_tickets (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),
  ticket_type     text not null,
  ticket_number   text,
  issuer          text,
  issued_on       date,
  expires_on      date,
  file_path       text,
  verified_by     uuid references public.profiles(id) on delete set null,
  verified_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index worker_tickets_profile_idx on public.worker_tickets (profile_id);
create trigger worker_tickets_updated before update on public.worker_tickets
  for each row execute function public.set_updated_at();

-- organization_id is always derived from the worker, never trusted from the client.
create or replace function public.worker_ticket_set_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select organization_id into new.organization_id from public.profiles where id = new.profile_id;
  if not public.is_service_context() and not public.is_leader() then
    new.verified_by := case when tg_op = 'UPDATE' then old.verified_by else null end;
    new.verified_at := case when tg_op = 'UPDATE' then old.verified_at else null end;
  end if;
  return new;
end $$;
create trigger worker_tickets_org before insert or update on public.worker_tickets
  for each row execute function public.worker_ticket_set_org();

-- =============================================================================
-- Row-Level Security
-- =============================================================================
alter table public.organizations          enable row level security;
alter table public.job_roles              enable row level security;
alter table public.job_role_rates         enable row level security;
alter table public.profiles               enable row level security;
alter table public.user_invitations       enable row level security;
alter table public.projects               enable row level security;
alter table public.project_organizations  enable row level security;
alter table public.lookup_lists           enable row level security;
alter table public.lookup_values          enable row level security;
alter table public.form_templates         enable row level security;
alter table public.form_template_versions enable row level security;
alter table public.form_submissions       enable row level security;
alter table public.workflow_pipelines     enable row level security;
alter table public.workflow_rules         enable row level security;
alter table public.notifications          enable row level security;
alter table public.notification_outbox    enable row level security;
alter table public.worker_tickets         enable row level security;

-- Organisations: internal users see all; contractors see only their own company.
create policy org_select on public.organizations for select to authenticated
  using (public.is_internal_user() or id = public.current_org_id());
create policy org_leader_write on public.organizations for all to authenticated
  using (public.is_leader()) with check (public.is_leader());

-- Job roles: readable by any active user (names/classifications only).
create policy job_roles_select on public.job_roles for select to authenticated
  using (public.current_role_name() is not null);
create policy job_roles_leader_write on public.job_roles for all to authenticated
  using (public.is_leader()) with check (public.is_leader());

-- Commercial rates: leaders only.
create policy job_role_rates_leader on public.job_role_rates for all to authenticated
  using (public.is_leader()) with check (public.is_leader());

-- Profiles: self always; leaders all; contractors their own crew.
-- Employees see only their own full profile (others via profile_directory).
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or public.is_leader()
    or (public.is_contractor() and organization_id = public.current_org_id())
  );
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_leader_update on public.profiles for update to authenticated
  using (public.is_leader()) with check (public.is_leader());

-- Invitations: leaders only.
create policy invitations_leader on public.user_invitations for all to authenticated
  using (public.is_leader()) with check (public.is_leader());

-- Projects: internal see all; contractors only projects they're engaged on.
create policy projects_select on public.projects for select to authenticated
  using (public.can_access_project(id));
create policy projects_leader_write on public.projects for all to authenticated
  using (public.is_leader()) with check (public.is_leader());

create policy project_orgs_select on public.project_organizations for select to authenticated
  using (public.is_internal_user() or organization_id = public.current_org_id());
create policy project_orgs_leader_write on public.project_organizations for all to authenticated
  using (public.is_leader()) with check (public.is_leader());

-- Lookups: readable by active users (contractors only lists flagged visible).
create policy lookup_lists_select on public.lookup_lists for select to authenticated
  using (public.is_internal_user() or (public.is_contractor() and visible_to_contractors));
create policy lookup_lists_leader_write on public.lookup_lists for all to authenticated
  using (public.is_leader()) with check (public.is_leader());
create policy lookup_values_select on public.lookup_values for select to authenticated
  using (exists (select 1 from public.lookup_lists l where l.key = list_key
                  and (public.is_internal_user() or (public.is_contractor() and l.visible_to_contractors))));
create policy lookup_values_leader_write on public.lookup_values for all to authenticated
  using (public.is_leader()) with check (public.is_leader());

-- Templates: leaders manage; others read published templates they may use.
create policy templates_select on public.form_templates for select to authenticated
  using (
    public.is_leader()
    or (status = 'published' and public.is_internal_user())
    or (status = 'published' and available_to_contractors and public.is_contractor())
  );
create policy templates_leader_write on public.form_templates for all to authenticated
  using (public.is_leader()) with check (public.is_leader());

create policy template_versions_select on public.form_template_versions for select to authenticated
  using (
    public.is_leader()
    or public.is_internal_user()
    or (public.is_contractor() and exists (
          select 1 from public.form_templates t
           where t.id = template_id and t.available_to_contractors))
  );
-- Inserts happen only through publish_form_template(); no update/delete policies.

-- Submissions: leaders see everything; employees their own; contractors
-- everything from their own company (their crew's records).
create policy submissions_select on public.form_submissions for select to authenticated
  using (
    public.is_leader()
    or submitted_by = auth.uid()
    or (public.is_contractor() and organization_id = public.current_org_id())
  );
create policy submissions_insert on public.form_submissions for insert to authenticated
  with check (
    submitted_by = auth.uid()
    and organization_id = public.current_org_id()
    and (project_id is null or public.can_access_project(project_id))
  );
create policy submissions_update_own_draft on public.form_submissions for update to authenticated
  using ((submitted_by = auth.uid() and status = 'draft') or public.is_leader())
  with check (organization_id = public.current_org_id() or public.is_leader());

-- Workflow config: pipelines readable by all active users; rules leaders only.
create policy pipelines_select on public.workflow_pipelines for select to authenticated
  using (public.current_role_name() is not null);
create policy pipelines_leader_write on public.workflow_pipelines for all to authenticated
  using (public.is_leader()) with check (public.is_leader());
create policy rules_leader on public.workflow_rules for all to authenticated
  using (public.is_leader()) with check (public.is_leader());

-- Notifications: own only.
create policy notifications_own_select on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_own_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Outbox: service role only (no policies for authenticated).

-- Tickets: own; contractors their crew; leaders all. Employees can't see others'.
create policy tickets_select on public.worker_tickets for select to authenticated
  using (
    profile_id = auth.uid()
    or public.is_leader()
    or (public.is_contractor() and organization_id = public.current_org_id())
  );
create policy tickets_write on public.worker_tickets for all to authenticated
  using (
    profile_id = auth.uid()
    or public.is_leader()
    or (public.is_contractor() and organization_id = public.current_org_id())
  )
  with check (
    (profile_id = auth.uid() and public.current_role_name() is not null)
    or public.is_leader()
    or (public.is_contractor() and exists (
          select 1 from public.profiles p
           where p.id = profile_id and p.organization_id = public.current_org_id()))
  );

-- Table privileges (RLS still applies).
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on public.notification_outbox from authenticated;
grant execute on function public.publish_form_template(uuid, text) to authenticated;
grant execute on function public.test_workflow_rules(public.workflow_module, public.workflow_trigger, jsonb, jsonb) to authenticated;

-- =============================================================================
-- Storage: private buckets, objects foldered by organisation id
--   form-uploads/{organization_id}/...   photos & signatures from forms
--   worker-tickets/{organization_id}/... licence/ticket scans
-- =============================================================================
insert into storage.buckets (id, name, public)
values ('form-uploads', 'form-uploads', false), ('worker-tickets', 'worker-tickets', false)
on conflict (id) do nothing;

create policy storage_org_read on storage.objects for select to authenticated
  using (
    bucket_id in ('form-uploads','worker-tickets')
    and (public.is_leader() or (storage.foldername(name))[1] = public.current_org_id()::text)
  );
create policy storage_org_insert on storage.objects for insert to authenticated
  with check (
    bucket_id in ('form-uploads','worker-tickets')
    and (storage.foldername(name))[1] = public.current_org_id()::text
  );
create policy storage_org_delete on storage.objects for delete to authenticated
  using (
    bucket_id in ('form-uploads','worker-tickets')
    and (public.is_leader() or owner = auth.uid())
  );
