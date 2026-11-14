-- RLS & business-rule tests. Run via scripts/test-db.sh.
\set ON_ERROR_STOP 1


create schema if not exists tests;
grant usage on schema tests to authenticated, anon;

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
grant execute on all functions in schema tests to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Fixtures (service context). People:
--   11 Admin            internal                        (first user)
--   12 HSET             internal
--   13 Project Manager  internal      P1
--   22 Worker           internal      P1 (primary), P2
--   33 Supervisor       Acme (sub)    P1
--   34 Worker           Acme (sub)    P1 (primary)
--   44 Worker           Bravo (sub)   P1 (primary)
--   45 Supervisor       Bravo (sub)   P1
--   55 uninvited sign-up -> inactive Worker
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name, type) values
  ('00000000-0000-0000-0000-00000000000a', 'Acme Scaffolding', 'contractor'),
  ('00000000-0000-0000-0000-00000000000b', 'Bravo Access', 'contractor');
insert into public.projects (id, code, name, client_name, status) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'P1', 'Port Hedland Wharf Access', 'PortCo', 'active'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'P2', 'Mine Plant Shutdown', 'MineCo', 'active');

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'admin@internal.test');

insert into public.user_invitations (email, full_name, role, organization_id, primary_project_id, employee_number, is_scaffold_inspector)
select x.email, x.name, x.role::public.app_role, coalesce(x.org, (select id from public.organizations where type = 'internal')), x.proj, x.emp, x.insp
  from (values
    ('hset@internal.test', 'Hana HSET', 'hset', null::uuid, null::uuid, 'E-12', false),
    ('pm@internal.test', 'Pat PM', 'project_manager', null, null, 'E-13', false),
    ('worker@internal.test', 'Wes Worker', 'worker', null, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'E-22', true),
    ('sup@acme.test', 'Sam Acme', 'supervisor', '00000000-0000-0000-0000-00000000000a'::uuid, null, null, false),
    ('worker@acme.test', 'Andy Acme', 'worker', '00000000-0000-0000-0000-00000000000a'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, null, false),
    ('worker@bravo.test', 'Bob Bravo', 'worker', '00000000-0000-0000-0000-00000000000b'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, null, false),
    ('sup@bravo.test', 'Bea Bravo', 'supervisor', '00000000-0000-0000-0000-00000000000b'::uuid, null, null, false)
  ) as x(email, name, role, org, proj, emp, insp);

insert into auth.users (id, email) values
  ('12121212-1212-1212-1212-121212121212', 'hset@internal.test'),
  ('13131313-1313-1313-1313-131313131313', 'pm@internal.test'),
  ('22222222-2222-2222-2222-222222222222', 'worker@internal.test'),
  ('33333333-3333-3333-3333-333333333333', 'sup@acme.test'),
  ('34444444-4444-4444-4444-444444444444', 'worker@acme.test'),
  ('44444444-4444-4444-4444-444444444444', 'worker@bravo.test'),
  ('45454545-4545-4545-4545-454545454545', 'sup@bravo.test'),
  ('55555555-5555-5555-5555-555555555555', 'random@nowhere.test');

-- Non-primary assignments (as the service would for an admin)
insert into public.project_members (project_id, profile_id, is_primary) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '13131313-1313-1313-1313-131313131313', true),
  ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', false),
  ('aaaaaaaa-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', true),
  ('aaaaaaaa-0000-0000-0000-000000000001', '45454545-4545-4545-4545-454545454545', true);

select tests.assert_count($$select 1 from public.profiles where id = '11111111-1111-1111-1111-111111111111' and role = 'admin' and is_active$$, 1, 'first user is an active Admin');
select tests.assert_count($$select 1 from public.profiles where id = '22222222-2222-2222-2222-222222222222' and employee_number = 'E-22' and is_scaffold_inspector$$, 1, 'invitation details copied to profile');
select tests.assert_count($$select 1 from public.project_members where profile_id = '22222222-2222-2222-2222-222222222222' and is_primary and project_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$, 1, 'invitation primary project assigned');
select tests.assert_count($$select 1 from public.profiles where id = '55555555-5555-5555-5555-555555555555' and not is_active and role = 'worker'$$, 1, 'uninvited sign-up is an inactive Worker');
select tests.assert_fails($$insert into public.user_invitations (email, role, organization_id) values ('x@acme.test', 'hset', '00000000-0000-0000-0000-00000000000a')$$,
  'HSET cannot belong to a subcontractor');
select tests.assert_fails($$insert into public.user_invitations (email, role, organization_id) select 'old@x.test', 'leader', id from public.organizations where type = 'internal'$$,
  'old roles can no longer be used');

insert into public.job_role_rates (job_role_id, cost_rate, charge_rate) select id, 55, 95 from public.job_roles;
insert into public.worker_tickets (profile_id, organization_id, ticket_type, licence_class, expires_on) values
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-00000000000b', 'HRW – Scaffolding', 'Intermediate', current_date + 400),
  ('34444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-00000000000a', 'White Card', null, null),
  ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-00000000000b', 'White Card', null, null);
select tests.assert_count($$select 1 from public.worker_tickets w join public.profiles p on p.id = w.profile_id where w.organization_id <> p.organization_id$$, 0, 'ticket company derived from the person');

-- ---------------------------------------------------------------------------
-- ADMIN
-- ---------------------------------------------------------------------------
set role authenticated;
select tests.login('11111111-1111-1111-1111-111111111111');
select tests.assert_count('select * from public.profiles', 9, 'admin sees everyone');
select tests.assert_count('select * from public.job_role_rates', (select count(*) from public.job_roles), 'admin sees commercial rates');
select tests.assert_count('select * from public.user_invitations', 7, 'admin sees invitations');
select tests.assert_count('select * from public.projects', 2, 'admin sees all projects');
select tests.assert_fails($$insert into public.project_members (project_id, profile_id, is_primary) values ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', true)$$,
  'duplicate open assignment to the same project is rejected');
select tests.assert_count($$select 1 from public.project_members where profile_id = '22222222-2222-2222-2222-222222222222' and is_primary and end_date is null and project_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  1, '… and the person keeps their primary project');
-- Switching primary: make the existing P2 assignment primary -> P1 stops being primary.
update public.project_members set is_primary = true where profile_id = '13131313-1313-1313-1313-131313131313';
insert into public.project_members (project_id, profile_id, is_primary) values ('aaaaaaaa-0000-0000-0000-000000000002', '13131313-1313-1313-1313-131313131313', true);
select tests.assert_count($$select project_id from public.project_members where profile_id = '13131313-1313-1313-1313-131313131313' and is_primary and end_date is null$$, 1, 'a person has one primary project at a time');
update public.project_members set is_primary = true where profile_id = '13131313-1313-1313-1313-131313131313' and project_id = 'aaaaaaaa-0000-0000-0000-000000000001';
update public.project_members set start_date = current_date - 5, end_date = current_date - 1 where profile_id = '13131313-1313-1313-1313-131313131313' and project_id = 'aaaaaaaa-0000-0000-0000-000000000002';
update public.profiles set is_scaffold_inspector = true where id = '33333333-3333-3333-3333-333333333333';
select tests.assert_count($$select 1 from public.profiles where id = '33333333-3333-3333-3333-333333333333' and is_scaffold_inspector$$, 1, 'admin can mark a competent scaffold inspector');
select tests.assert_fails($$update public.profiles set role = 'worker' where id = '11111111-1111-1111-1111-111111111111'$$, 'last admin cannot be demoted');
update public.profiles set is_active = true where id = '55555555-5555-5555-5555-555555555555';
update public.profiles set is_active = false where id = '55555555-5555-5555-5555-555555555555';
select tests.assert_count($$select 1 from public.audit_log where table_name = 'profiles' and record_id = '55555555-5555-5555-5555-555555555555' and action = 'update'$$, 2, 'profile changes are recorded in the audit log');
select tests.assert_fails($$delete from public.worker_tickets where profile_id = '44444444-4444-4444-4444-444444444444'$$, 'records cannot be deleted, even by admin (archive instead)');
select tests.assert_fails($$delete from public.profiles where id = '55555555-5555-5555-5555-555555555555'$$, 'people cannot be deleted (deactivate instead)');
reset role;

-- Publishing still works and versions stay immutable.
set role authenticated;
select tests.login('11111111-1111-1111-1111-111111111111');
do $$
declare t uuid;
begin
  select id into t from public.form_templates where category = 'plant_prestart' limit 1;
  update public.form_templates set draft_schema = jsonb_set(draft_schema, '{sections,0,title}', '"Plant Details (rev)"') where id = t;
  perform public.publish_form_template(t, 'Renamed section');
  if (select current_version from public.form_templates where id = t) <> 2 then raise exception 'FAIL: expected version 2'; end if;
  raise notice 'ok  publishing creates v2';
end $$;
update public.form_template_versions set schema = '{}'::jsonb;
select tests.assert_count($$select 1 from public.form_template_versions where schema = '{}'::jsonb$$, 0, 'published versions cannot be modified');
select tests.assert_count($$select * from public.test_workflow_rules('safety_event', 'field_condition', '{"severity":"high"}')$$, 1, 'High severity rule matches');
select tests.assert_fails($$select public.run_workflow_rules('safety_event', 'field_condition', '{"severity":"High"}')$$, 'clients cannot run the rules engine directly');
reset role;

-- ---------------------------------------------------------------------------
-- HSET: sees everything, but can't administer people or see pay rates
-- ---------------------------------------------------------------------------
set role authenticated;
select tests.login('12121212-1212-1212-1212-121212121212');
select tests.assert_count('select * from public.profiles', 9, 'HSET sees everyone');
select tests.assert_count('select * from public.projects', 2, 'HSET sees all projects');
select tests.assert_count('select * from public.workflow_rules', 5, 'HSET sees workflow rules');
select tests.assert_count('select * from public.job_role_rates', 0, 'HSET cannot see commercial rates');
select tests.assert_count('select * from public.user_invitations', 0, 'HSET cannot see invitations');
update public.profiles set role = 'supervisor' where id = '22222222-2222-2222-2222-222222222222'; -- RLS: 0 rows
select tests.assert_count($$select 1 from public.profiles where id = '22222222-2222-2222-2222-222222222222' and role = 'worker'$$, 1, 'HSET cannot change roles');
select tests.assert_fails($$update public.profiles set role = 'admin' where id = '12121212-1212-1212-1212-121212121212'$$, 'HSET cannot promote themselves');
update public.worker_tickets set verified_at = now() where profile_id = '34444444-4444-4444-4444-444444444444';
select tests.assert_count($$select 1 from public.worker_tickets where profile_id = '34444444-4444-4444-4444-444444444444' and verified_at is not null$$, 1, 'HSET can verify licences');
reset role;

-- ---------------------------------------------------------------------------
-- Internal PROJECT MANAGER (P1): everyone on P1, any company
-- ---------------------------------------------------------------------------
set role authenticated;
select tests.login('13131313-1313-1313-1313-131313131313');
select tests.assert_count('select * from public.profiles', 6, 'internal PM sees everyone on their project (any company)');
select tests.assert_count('select * from public.projects', 1, 'PM sees only assigned projects');
select tests.assert_count('select * from public.worker_tickets', 3, 'PM sees licences of people on their project');
select tests.assert_count('select * from public.job_role_rates', 0, 'PM cannot see rates');
select tests.assert_count('select * from public.workflow_rules', 0, 'PM cannot see workflow rules');
select tests.assert_fails($$insert into public.project_members (project_id, profile_id) values ('aaaaaaaa-0000-0000-0000-000000000002', '13131313-1313-1313-1313-131313131313')$$,
  'only admins assign people to projects');
reset role;

-- ---------------------------------------------------------------------------
-- Subcontractor SUPERVISOR (Acme, P1): only Acme people on P1
-- ---------------------------------------------------------------------------
set role authenticated;
select tests.login('33333333-3333-3333-3333-333333333333');
select tests.assert_count('select * from public.profiles', 2, 'Acme supervisor sees only Acme people on their project');
select tests.assert_count($$select * from public.profile_directory$$, 2, 'Acme supervisor name list limited to Acme');
select tests.assert_count('select * from public.worker_tickets', 1, 'Acme supervisor sees only Acme licences');
select tests.assert_count('select * from public.organizations', 1, 'subcontractor sees only own company');
select tests.assert_count('select * from public.projects', 1, 'supervisor sees assigned project');
select tests.assert_count($$select * from public.lookup_values where list_key = 'cost_codes'$$, 0, 'subcontractor cannot see cost codes');
select tests.assert_fails($$update public.profiles set is_scaffold_inspector = false where id = '33333333-3333-3333-3333-333333333333'$$, 'cannot change own inspector status');
reset role;

-- ---------------------------------------------------------------------------
-- Internal WORKER (primary P1, also on P2): own profile, primary project only
-- ---------------------------------------------------------------------------
set role authenticated;
select tests.login('22222222-2222-2222-2222-222222222222');
select tests.assert_count('select * from public.profiles', 1, 'worker sees only own profile');
select tests.assert_count('select * from public.projects', 1, 'worker sees only primary project');
select tests.assert_count($$select * from public.projects where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$, 1, '… which is P1');
select tests.assert_count('select * from public.worker_tickets', 1, 'worker sees own licences only');
select tests.assert_count('select * from public.project_members', 2, 'worker sees own assignment history');
select tests.assert_count('select * from public.job_role_rates', 0, 'worker cannot see rates');
select tests.assert_count('select * from public.user_invitations', 0, 'worker cannot see invitations');
select tests.assert_count($$select * from public.form_templates where status = 'published'$$, 6, 'worker sees published forms');
select tests.assert_fails($$update public.profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222'$$, 'worker cannot self-promote');
update public.profiles set phone = '0400 000 000' where id = '22222222-2222-2222-2222-222222222222';
select tests.assert_count($$select 1 from public.profiles where phone = '0400 000 000'$$, 1, 'worker can update own contact details');
insert into public.worker_tickets (profile_id, organization_id, ticket_type) values ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-00000000000a', 'First Aid');
select tests.assert_count('select * from public.worker_tickets', 2, 'worker can add own licence');
select tests.assert_fails($$insert into public.worker_tickets (profile_id, organization_id, ticket_type) values ('34444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-00000000000a', 'Fake')$$,
  'worker cannot add licences for others');
select tests.assert_count($$select * from public.audit_log where table_name = 'profiles'$$, 2, 'worker sees only own profile history');
select tests.assert_fails($$insert into public.projects (name) values ('Rogue')$$, 'worker cannot create projects');
reset role;

-- ---------------------------------------------------------------------------
-- Subcontractor WORKER (Bravo) and inactive user
-- ---------------------------------------------------------------------------
set role authenticated;
select tests.login('44444444-4444-4444-4444-444444444444');
select tests.assert_count('select * from public.profiles', 1, 'Bravo worker sees only self');
select tests.assert_count('select * from public.worker_tickets', 1, 'Bravo worker sees own ticket only');
select tests.assert_count($$select * from public.profile_directory$$, 2, 'Bravo worker name list: Bravo people on the same project');
select tests.login('55555555-5555-5555-5555-555555555555');
select tests.assert_count('select * from public.projects', 0, 'inactive user sees no projects');
select tests.assert_count('select * from public.form_templates', 0, 'inactive user sees no templates');
select tests.assert_count('select * from public.profiles', 1, 'inactive user sees only own (pending) profile');
reset role;

-- ---------------------------------------------------------------------------
-- Storage: people files foldered by {org}/{profile}
-- ---------------------------------------------------------------------------
insert into storage.objects (bucket_id, name, owner) values
  ('worker-tickets', '00000000-0000-0000-0000-00000000000a/34444444-4444-4444-4444-444444444444/ticket.jpg', '34444444-4444-4444-4444-444444444444'),
  ('worker-tickets', '00000000-0000-0000-0000-00000000000b/44444444-4444-4444-4444-444444444444/ticket.jpg', '44444444-4444-4444-4444-444444444444');
set role authenticated;
select tests.login('33333333-3333-3333-3333-333333333333');
select tests.assert_count($$select * from storage.objects where bucket_id = 'worker-tickets'$$, 1, 'Acme supervisor sees Acme licence scans only');
select tests.login('34444444-4444-4444-4444-444444444444');
insert into storage.objects (bucket_id, name) values ('worker-tickets', '00000000-0000-0000-0000-00000000000a/34444444-4444-4444-4444-444444444444/photo.jpg');
select tests.assert_fails($$insert into storage.objects (bucket_id, name) values ('worker-tickets', '00000000-0000-0000-0000-00000000000b/44444444-4444-4444-4444-444444444444/x.jpg')$$,
  'worker cannot upload into someone else''s folder');
reset role;

-- ---------------------------------------------------------------------------
-- Rules engine fan-out: alerts to "leaders" now go to Admin + HSET
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '', false);
do $$
declare ids uuid[];
begin
  ids := public.run_workflow_rules('safety_event', 'field_condition',
          '{"severity":"Critical","organization_id":"00000000-0000-0000-0000-00000000000a","project_id":"aaaaaaaa-0000-0000-0000-000000000001"}');
  if array_length(ids, 1) <> 1 then raise exception 'FAIL: expected one rule'; end if;
  if (select count(*) from public.notifications where rule_id = ids[1]) <> 2 then raise exception 'FAIL: expected 2 in-app notifications (admin + HSET)'; end if;
  if (select count(*) from public.notification_outbox where channel = 'email' and rule_id = ids[1]) <> 2 then raise exception 'FAIL: expected 2 emails'; end if;
  raise notice 'ok  rules fan out to Admin and HSET (in-app + email)';
end $$;
