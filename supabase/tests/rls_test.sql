-- RLS & business-rule tests. Run via scripts/test-db.sh.
\set ON_ERROR_STOP 1


create schema if not exists tests;
grant usage on schema tests to authenticated;

create or replace function tests.assert_count(q text, expected bigint, msg text)
returns void language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from (%s) x', q) into n;
  if n <> expected then
    raise exception 'FAIL: % (expected %, got %)', msg, expected, n;
  end if;
  raise notice 'ok  %', msg;
end $$;

create or replace function tests.assert_fails(q text, msg text)
returns void language plpgsql as $$
begin
  begin
    execute q;
  exception when others then
    raise notice 'ok  % (%)', msg, sqlerrm;
    return;
  end;
  raise exception 'FAIL: % (statement succeeded)', msg;
end $$;

create or replace function tests.login(uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, false);
end $$;
grant execute on all functions in schema tests to authenticated;

-- ---------------------------------------------------------------------------
-- Fixtures (as superuser / service context)
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name, type) values
  ('00000000-0000-0000-0000-00000000000a', 'Acme Earthworks', 'contractor'),
  ('00000000-0000-0000-0000-00000000000b', 'Bravo Civil',     'contractor');

-- First user bootstraps as leader.
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'lead@internal.test');

insert into public.user_invitations (email, full_name, role, organization_id)
select 'emp@internal.test', 'Eddie Employee', 'employee', id from public.organizations where type = 'internal';
insert into public.user_invitations (email, full_name, role, organization_id) values
  ('a1@acme.test', 'Alice Acme', 'contractor', '00000000-0000-0000-0000-00000000000a'),
  ('a2@acme.test', 'Andy Acme', 'contractor', '00000000-0000-0000-0000-00000000000a'),
  ('b1@bravo.test', 'Bob Bravo', 'contractor', '00000000-0000-0000-0000-00000000000b');

insert into auth.users (id, email) values
  ('22222222-2222-2222-2222-222222222222', 'emp@internal.test'),
  ('33333333-3333-3333-3333-333333333333', 'a1@acme.test'),
  ('34444444-4444-4444-4444-444444444444', 'a2@acme.test'),
  ('44444444-4444-4444-4444-444444444444', 'b1@bravo.test'),
  ('55555555-5555-5555-5555-555555555555', 'random@nowhere.test');

select tests.assert_count($$select 1 from public.profiles where id = '11111111-1111-1111-1111-111111111111' and role = 'leader' and is_active$$, 1, 'first user is an active leader');
select tests.assert_count($$select 1 from public.profiles where id = '33333333-3333-3333-3333-333333333333' and role = 'contractor' and organization_id = '00000000-0000-0000-0000-00000000000a'$$, 1, 'invited contractor linked to company');
select tests.assert_count($$select 1 from public.profiles where id = '55555555-5555-5555-5555-555555555555' and not is_active$$, 1, 'uninvited sign-up is inactive');
select tests.assert_count($$select 1 from public.user_invitations where status = 'accepted'$$, 4, 'invitations marked accepted');

select tests.assert_fails($$insert into public.user_invitations (email, role, organization_id) values ('x@acme.test', 'employee', '00000000-0000-0000-0000-00000000000a')$$,
  'employee cannot be attached to a contractor company');

insert into public.projects (id, code, name, client_name, status) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'P-001', 'Great Northern Hwy Upgrade', 'Main Roads WA', 'active'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'P-002', 'Pilbara Haul Road', 'MineCo', 'active');
insert into public.project_organizations values
  ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', now());

insert into public.job_role_rates (job_role_id, cost_rate, charge_rate)
select id, 55, 95 from public.job_roles;

insert into public.worker_tickets (profile_id, organization_id, ticket_type, expires_on) values
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-00000000000b', 'White Card', null), -- org will be corrected by trigger
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-00000000000a', 'White Card', null),
  ('34444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-00000000000a', 'Forklift', current_date + 10),
  ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-00000000000b', 'White Card', null);
select tests.assert_count($$select 1 from public.worker_tickets w join public.profiles p on p.id = w.profile_id where w.organization_id <> p.organization_id$$, 0, 'ticket organisation derived from worker');

-- ---------------------------------------------------------------------------
-- LEADER
-- ---------------------------------------------------------------------------
set role authenticated;
select tests.login('11111111-1111-1111-1111-111111111111');
select tests.assert_count('select * from public.profiles', 6, 'leader sees all profiles');
select tests.assert_count('select * from public.organizations', 3, 'leader sees all organisations');
select tests.assert_count('select * from public.job_role_rates', 7, 'leader sees commercial rates');
select tests.assert_count('select * from public.workflow_rules', 4, 'leader sees workflow rules');
select tests.assert_count('select * from public.user_invitations', 4, 'leader sees invitations');
select tests.assert_count($$select * from public.lookup_values where list_key = 'cost_codes'$$, 6, 'leader sees cost codes');

-- Publish a new template version: history is kept and immutable.
do $$
declare t uuid;
begin
  select id into t from public.form_templates where category = 'plant_prestart' limit 1;
  update public.form_templates set draft_schema = jsonb_set(draft_schema, '{sections,0,title}', '"Plant Details (rev)"') where id = t;
  if not (select has_unpublished_changes from public.form_templates where id = t) then
    raise exception 'FAIL: edit should mark template dirty';
  end if;
  perform public.publish_form_template(t, 'Renamed section');
  if (select current_version from public.form_templates where id = t) <> 2 then
    raise exception 'FAIL: expected version 2';
  end if;
  if (select has_unpublished_changes from public.form_templates where id = t) then
    raise exception 'FAIL: publish should clear dirty flag';
  end if;
  if (select schema->'sections'->0->>'title' from public.form_template_versions where template_id = t and version = 1) <> 'Plant Details' then
    raise exception 'FAIL: v1 schema changed';
  end if;
  raise notice 'ok  publishing creates v2 and keeps v1 intact';
end $$;
update public.form_template_versions set schema = '{}'::jsonb;  -- no UPDATE policy: silently affects 0 rows
select tests.assert_count($$select 1 from public.form_template_versions where schema = '{}'::jsonb$$, 0, 'clients cannot modify published versions');

-- Rules engine dry-run.
select tests.assert_count($$select * from public.test_workflow_rules('safety_event', 'field_condition', '{"severity":"high"}')$$, 1, 'High severity rule matches');
select tests.assert_count($$select * from public.test_workflow_rules('safety_event', 'field_condition', '{"severity":"Low"}')$$, 0, 'Low severity does not match');
select tests.assert_count($$select * from public.test_workflow_rules('daily_field_report', 'status_changed', '{"status":"submitted"}')$$, 1, 'DFR submitted matches');
select tests.assert_count($$select * from public.test_workflow_rules('daily_field_report', 'status_changed', '{"status":"approved"}')$$, 0, 'DFR approved does not match');
select tests.assert_fails($$select public.run_workflow_rules('safety_event', 'field_condition', '{"severity":"High"}')$$, 'clients cannot execute run_workflow_rules directly');

-- Leader can change roles but cannot remove the last leader.
update public.profiles set job_role_id = (select id from public.job_roles where name = 'Labourer') where id = '22222222-2222-2222-2222-222222222222';
select tests.assert_fails($$update public.profiles set role = 'employee' where id = '11111111-1111-1111-1111-111111111111'$$, 'last leader cannot be demoted');
update public.profiles set is_active = true where id = '55555555-5555-5555-5555-555555555555';
update public.profiles set is_active = false where id = '55555555-5555-5555-5555-555555555555';
reset role;

select tests.assert_fails($$update public.form_template_versions set schema = '{}'::jsonb$$, 'published versions immutable even for superuser');

-- ---------------------------------------------------------------------------
-- EMPLOYEE
-- ---------------------------------------------------------------------------
set role authenticated;
select tests.login('22222222-2222-2222-2222-222222222222');
select tests.assert_count('select * from public.profiles', 1, 'employee sees only own profile');
select tests.assert_count('select * from public.profile_directory', 2, 'employee directory = internal staff names only');
select tests.assert_count('select * from public.job_role_rates', 0, 'employee cannot see commercial rates');
select tests.assert_count('select * from public.workflow_rules', 0, 'employee cannot see workflow rules');
select tests.assert_count('select * from public.user_invitations', 0, 'employee cannot see invitations');
select tests.assert_count('select * from public.projects', 2, 'employee sees all projects');
select tests.assert_count('select * from public.worker_tickets', 1, 'employee sees own tickets only');
select tests.assert_count($$select * from public.form_templates where status = 'published'$$, 4, 'employee sees published templates');
select tests.assert_fails($$update public.profiles set role = 'leader' where id = '22222222-2222-2222-2222-222222222222'$$, 'employee cannot self-promote');
update public.profiles set phone = '0400 000 000' where id = '22222222-2222-2222-2222-222222222222';
select tests.assert_count($$select 1 from public.profiles where phone = '0400 000 000'$$, 1, 'employee can update own contact details');
select tests.assert_fails($$insert into public.projects (name) values ('Rogue')$$, 'employee cannot create projects');
select tests.assert_fails($$select public.publish_form_template((select id from public.form_templates limit 1))$$, 'employee cannot publish templates');
insert into public.worker_tickets (profile_id, organization_id, ticket_type) values ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-00000000000a', 'First Aid');
select tests.assert_count('select * from public.worker_tickets', 2, 'employee can add own ticket');
select tests.assert_fails($$insert into public.worker_tickets (profile_id, organization_id, ticket_type) values ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-00000000000a', 'Fake')$$, 'employee cannot add tickets for others');
reset role;

-- ---------------------------------------------------------------------------
-- CONTRACTOR (Acme)
-- ---------------------------------------------------------------------------
set role authenticated;
select tests.login('33333333-3333-3333-3333-333333333333');
select tests.assert_count('select * from public.profiles', 2, 'contractor sees own crew only');
select tests.assert_count('select * from public.profile_directory', 2, 'contractor directory limited to own company');
select tests.assert_count('select * from public.organizations', 1, 'contractor sees only own company');
select tests.assert_count('select * from public.projects', 1, 'contractor sees only engaged projects');
select tests.assert_count('select * from public.job_role_rates', 0, 'contractor cannot see rates');
select tests.assert_count($$select * from public.lookup_values where list_key = 'cost_codes'$$, 0, 'contractor cannot see cost codes');
select tests.assert_count($$select * from public.lookup_values where list_key = 'event_types'$$, 8, 'contractor sees event types');
select tests.assert_count('select * from public.worker_tickets', 2, 'contractor sees crew tickets only');
select tests.assert_count('select * from public.workflow_rules', 0, 'contractor cannot see workflow rules');
insert into public.worker_tickets (profile_id, organization_id, ticket_type) values ('34444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-00000000000a', 'Working at Heights');
select tests.assert_count('select * from public.worker_tickets', 3, 'contractor can add crew ticket');
select tests.assert_fails($$insert into public.worker_tickets (profile_id, organization_id, ticket_type) values ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-00000000000a', 'Fake')$$, 'contractor cannot add tickets for another company');
select tests.assert_fails($$update public.profiles set organization_id = '00000000-0000-0000-0000-00000000000b' where id = '33333333-3333-3333-3333-333333333333'$$, 'contractor cannot move company');

-- Submissions scoped to company + engaged projects.
insert into public.form_submissions (template_version_id, project_id, organization_id, status, answers)
select v.id, 'aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'submitted', '{}'
  from public.form_template_versions v limit 1;
select tests.assert_fails($$insert into public.form_submissions (template_version_id, project_id, organization_id) select v.id, 'aaaaaaaa-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a' from public.form_template_versions v limit 1$$,
  'contractor cannot submit against a project they are not engaged on');
select tests.assert_fails($$insert into public.form_submissions (template_version_id, organization_id) select v.id, '00000000-0000-0000-0000-00000000000b' from public.form_template_versions v limit 1$$,
  'contractor cannot submit as another company');
select tests.assert_count($$select * from storage.objects$$, 0, 'storage visible (empty)');
insert into storage.objects (bucket_id, name) values ('form-uploads', '00000000-0000-0000-0000-00000000000a/photo.jpg');
select tests.assert_fails($$insert into storage.objects (bucket_id, name) values ('form-uploads', '00000000-0000-0000-0000-00000000000b/photo.jpg')$$, 'contractor cannot upload into another company folder');
reset role;

-- ---------------------------------------------------------------------------
-- CONTRACTOR (Bravo) – zero visibility into Acme
-- ---------------------------------------------------------------------------
set role authenticated;
select tests.login('44444444-4444-4444-4444-444444444444');
select tests.assert_count('select * from public.profiles', 1, 'Bravo sees only itself');
select tests.assert_count('select * from public.projects', 0, 'Bravo has no projects');
select tests.assert_count('select * from public.form_submissions', 0, 'Bravo cannot see Acme submissions');
select tests.assert_count('select * from storage.objects', 0, 'Bravo cannot see Acme files');
select tests.assert_count('select * from public.worker_tickets', 1, 'Bravo sees own ticket only');
reset role;

-- ---------------------------------------------------------------------------
-- INACTIVE / uninvited user — nothing
-- ---------------------------------------------------------------------------
set role authenticated;
select tests.login('55555555-5555-5555-5555-555555555555');
select tests.assert_count('select * from public.projects', 0, 'inactive user sees no projects');
select tests.assert_count('select * from public.form_templates', 0, 'inactive user sees no templates');
select tests.assert_count('select * from public.lookup_values', 0, 'inactive user sees no lookups');
select tests.assert_count('select * from public.profiles', 1, 'inactive user sees only own (pending) profile');
reset role;

-- ---------------------------------------------------------------------------
-- Rules engine fan-out (service context, as a Phase 2 trigger would call it)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '', false);
do $$
declare ids uuid[];
begin
  ids := public.run_workflow_rules('safety_event', 'field_condition',
          '{"severity":"Critical","organization_id":"00000000-0000-0000-0000-00000000000a"}');
  if array_length(ids, 1) <> 1 then raise exception 'FAIL: expected one rule'; end if;
  if (select count(*) from public.notifications) <> 1 then raise exception 'FAIL: expected 1 in-app notification (1 leader)'; end if;
  if (select count(*) from public.notification_outbox where channel = 'email') <> 1 then raise exception 'FAIL: expected 1 email'; end if;
  raise notice 'ok  run_workflow_rules fans out notifications + email outbox';
end $$;
