-- Stage 3 scaffold tests. Runs after rls_test.sql (reuses its people and projects):
--   11 admin · 13 internal PM (P1) · 22 internal worker, inspector, Intermediate licence (P1 primary)
--   33 Acme supervisor (P1, inspector flag but no scaffolding licence) · 45 Bravo supervisor (P1)
\set ON_ERROR_STOP 1
select set_config('request.jwt.claims', '{}', false);

create temp table ck as
select c.id,
       (select jsonb_object_agg(i->>'id', jsonb_build_object('result', 'pass'))
          from jsonb_array_elements(c.sections) s, jsonb_array_elements(s->'items') i) as allpass
  from public.scaffold_checklists c where c.version = 1;
grant select on ck to authenticated;
create temp table sc (k text primary key, id uuid);
grant select, insert on sc to authenticated;

select tests.assert_count($$select 1 from public.scaffold_checklists where version = 1 and jsonb_array_length(sections) = 10$$, 1, 'starter checklist has the 10 sections');

-- Register
set role authenticated;
select tests.login('22222222-2222-2222-2222-222222222222');
select tests.assert_fails($$insert into public.scaffolds (project_id, location, scaffold_type, duty_class) values ('aaaaaaaa-0000-0000-0000-000000000001', 'x', 'mobile', 'light')$$,
  'worker cannot register a scaffold');
select tests.login('13131313-1313-1313-1313-131313131313');
with x as (
  insert into public.scaffolds (project_id, location, scaffold_type, duty_class, max_load_kg, height_m, lifts, bays, erected_on, status)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'Berth 3 conveyor, bays 12–16', 'hung', 'medium', 450, 12, 6, 5, current_date, 'safe')
  returning id)
insert into sc select 'a', id from x;
select tests.assert_count($$select 1 from public.scaffolds where scaffold_number = 'SCF-P1-0001' and status = 'unsafe' and status_reason = 'Awaiting handover inspection' and length(qr_token) = 64$$,
  1, 'PM registers a scaffold: SCF-P1-0001, Unsafe until handover, random QR token');
select tests.assert_fails($$update public.scaffolds set status = 'safe' where scaffold_number = 'SCF-P1-0001'$$, 'status can''t be set to Safe by hand');
select tests.login('45454545-4545-4545-4545-454545454545');
select tests.assert_count('select 1 from public.scaffolds', 1, 'subcontractor supervisor on the project sees its scaffolds');

-- Who can inspect
select tests.login('33333333-3333-3333-3333-333333333333');
select tests.assert_fails($$insert into public.scaffold_inspections (scaffold_id, inspection_type, checklist_id, items, outcome, signature, signed_at)
  select (select id from sc where k = 'a'), 'handover', ck.id, ck.allpass, 'safe', 'sig', now() from ck$$,
  'inspector flag without a scaffolding licence cannot sign off');
select tests.login('22222222-2222-2222-2222-222222222222');
select tests.assert_fails($$insert into public.scaffold_inspections (scaffold_id, inspection_type, checklist_id, items, outcome, signature, signed_at)
  select (select id from sc where k = 'a'), 'handover', ck.id, ck.allpass - 'fnd-plates', 'safe', 'sig', now() from ck$$,
  'every checklist item must be answered');
select tests.assert_fails($$insert into public.scaffold_inspections (scaffold_id, inspection_type, checklist_id, items, outcome, signature, signed_at)
  select (select id from sc where k = 'a'), 'handover', ck.id, ck.allpass || '{"edg-toe":{"result":"fail"}}', 'safe', 'sig', now() from ck$$,
  'cannot be Safe for Use with a failed item');
select tests.assert_fails($$insert into public.scaffold_inspections (scaffold_id, inspection_type, checklist_id, items, outcome, signature, signed_at)
  select (select id from sc where k = 'a'), 'handover', ck.id, ck.allpass, 'restricted', 'sig', now() from ck$$,
  'Restricted needs the restriction written');
select tests.assert_fails($$insert into public.scaffold_inspections (scaffold_id, inspection_type, checklist_id, items, outcome, signature, signed_at)
  select (select id from sc where k = 'a'), 'handover', ck.id, ck.allpass, 'safe', '', now() from ck$$,
  'inspection must be signed');

-- Restricted handover with a failed toeboard -> defect owned by the PM
with x as (
  insert into public.scaffold_inspections (scaffold_id, inspection_type, checklist_id, items, outcome, restriction, signature, signed_at, latitude, longitude)
  select (select id from sc where k = 'a'), 'handover', ck.id,
         ck.allpass || '{"edg-toe":{"result":"fail","comment":"Toeboard missing bay 14","photos":["storage:x/y.jpg"],"defect_owner_id":"13131313-1313-1313-1313-131313131313"}}',
         'restricted', 'Light duty only, max 2 persons', 'storage:sig.png', now(), -20.31, 118.57 from ck
  returning id)
insert into sc select 'i1', id from x;
reset role;
select tests.assert_count($$select 1 from public.scaffold_inspections where reference = 'SI-00001' and inspector_licence_class = 'Intermediate'
  and failed_count = 1 and next_due = public.perth_today() + 30$$, 1, 'inspection: reference, licence snapshot, next due = 30 days (project default)');
select tests.assert_count($$select 1 from public.scaffolds where scaffold_number = 'SCF-P1-0001' and status = 'restricted'
  and restriction = 'Light duty only, max 2 persons' and next_inspection_due = public.perth_today() + 30$$, 1, 'scaffold takes the inspection result');
select tests.assert_count($$select 1 from public.scaffold_defects where item_id = 'edg-toe' and status = 'open' and owner_id = '13131313-1313-1313-1313-131313131313'
  and due_date = public.perth_today() + 7 and description = 'Toeboard missing bay 14' and photos = '{storage:x/y.jpg}'$$, 1, 'failed item becomes a defect with owner and due date');

-- Signed inspections can't be edited
set role authenticated;
select tests.login('22222222-2222-2222-2222-222222222222');
update public.scaffold_inspections set outcome = 'safe';
select tests.assert_count($$select 1 from public.scaffold_inspections where outcome = 'restricted'$$, 1, 'inspector cannot change a signed inspection');
select tests.login('11111111-1111-1111-1111-111111111111');
select tests.assert_fails($$update public.scaffold_inspections set notes = 'changed'$$, 'not even an Admin can change a signed inspection');

-- Defect close-out needs a photo
select tests.login('13131313-1313-1313-1313-131313131313');
select tests.assert_fails($$update public.scaffold_defects set status = 'closed'$$, 'defect cannot close without a photo');
update public.scaffold_defects set status = 'closed', close_photos = '{storage:fix.jpg}', close_comment = 'Toeboard fitted';
select tests.assert_count($$select 1 from public.scaffold_defects where status = 'closed' and closed_by = '13131313-1313-1313-1313-131313131313' and closed_at is not null$$,
  1, 'owner closes the defect with a photo');

-- Weekly site: interval set per project
select tests.login('11111111-1111-1111-1111-111111111111');
update public.projects set scaffold_inspection_days = 7 where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select tests.login('22222222-2222-2222-2222-222222222222');
insert into public.scaffold_inspections (scaffold_id, inspection_type, checklist_id, items, outcome, signature, signed_at)
select (select id from sc where k = 'a'), 'periodic', ck.id, ck.allpass, 'safe', 'storage:sig2.png', now() from ck;
reset role;
select tests.assert_count($$select 1 from public.scaffolds where status = 'safe' and restriction is null and next_inspection_due = public.perth_today() + 7$$,
  1, 'periodic all-pass: Safe for Use, next due 7 days on a weekly site');

-- An older inspection synced late doesn't override the current status
set role authenticated;
select tests.login('22222222-2222-2222-2222-222222222222');
insert into public.scaffold_inspections (scaffold_id, inspection_type, checklist_id, items, outcome, signature, signed_at)
select (select id from sc where k = 'a'), 'incident_weather', ck.id, ck.allpass || '{"tie-secure":{"result":"fail"}}', 'unsafe', 'storage:sig3.png', now() - interval '2 days' from ck;
reset role;
select tests.assert_count($$select 1 from public.scaffolds where status = 'safe'$$, 1, 'late-synced older inspection does not change the status');
select tests.assert_count($$select 1 from public.scaffold_defects where item_id = 'tie-secure' and status = 'open'$$, 1, '…but its defect is still raised');

-- Licence rules
update public.app_settings set scaffold_min_licence = 'Advanced' where id = 1;
set role authenticated;
select tests.login('22222222-2222-2222-2222-222222222222');
select tests.assert_fails($$insert into public.scaffold_inspections (scaffold_id, inspection_type, checklist_id, items, outcome, signature, signed_at)
  select (select id from sc where k = 'a'), 'periodic', ck.id, ck.allpass, 'safe', 'sig', now() from ck$$,
  'Intermediate licence not enough when the minimum is Advanced');
reset role;
update public.app_settings set scaffold_min_licence = 'Basic' where id = 1;
update public.worker_tickets set expires_on = current_date - 1 where profile_id = '22222222-2222-2222-2222-222222222222' and ticket_type ilike '%scaffold%';
set role authenticated;
select tests.login('22222222-2222-2222-2222-222222222222');
select tests.assert_fails($$insert into public.scaffold_inspections (scaffold_id, inspection_type, checklist_id, items, outcome, signature, signed_at)
  select (select id from sc where k = 'a'), 'periodic', ck.id, ck.allpass, 'safe', 'sig', now() from ck$$,
  'expired licence cannot sign off');
reset role;
update public.worker_tickets set expires_on = current_date + 400 where profile_id = '22222222-2222-2222-2222-222222222222' and ticket_type ilike '%scaffold%';

-- Tag Unsafe / Dismantled
set role authenticated;
select tests.login('13131313-1313-1313-1313-131313131313');
select tests.assert_fails($$update public.scaffolds set status = 'unsafe' where scaffold_number = 'SCF-P1-0001'$$, 'tagging Unsafe needs a reason');
update public.scaffolds set status = 'unsafe', status_reason = 'Struck by forklift' where scaffold_number = 'SCF-P1-0001';
select tests.assert_count($$select 1 from public.scaffolds where status = 'unsafe' and status_reason = 'Struck by forklift' and next_inspection_due is not null$$, 1, 'PM tags a scaffold Unsafe');
update public.scaffolds set status = 'dismantled' where scaffold_number = 'SCF-P1-0001';
select tests.assert_count($$select 1 from public.scaffolds where status = 'dismantled' and dismantled_on = public.perth_today()$$, 1, 'PM marks it dismantled');
select tests.assert_fails($$delete from public.scaffolds$$, 'scaffolds cannot be deleted');

-- Checklist template
select tests.login('13131313-1313-1313-1313-131313131313');
select tests.assert_fails($$insert into public.scaffold_checklists (version, sections) values (0, '[{"id":"a","title":"A","items":[{"id":"x","label":"X"}]}]')$$,
  'only Admins edit the checklist');
select tests.login('11111111-1111-1111-1111-111111111111');
select tests.assert_fails($$insert into public.scaffold_checklists (version, sections) values (0, '[{"id":"a","title":"A","items":[]}]')$$,
  'checklist sections need items');
insert into public.scaffold_checklists (version, sections, change_note) values (0, '[{"id":"a","title":"A","items":[{"id":"x","label":"X"}]}]', 'test');
select tests.assert_count($$select 1 from public.scaffold_checklists where version = 2$$, 1, 'Admin publishes checklist version 2');

-- History and visibility of history
select tests.login('45454545-4545-4545-4545-454545454545');
select tests.assert_count($$select 1 from public.audit_log where table_name = 'scaffolds'$$, 5, 'project lead reads the scaffold''s history');
reset role;
select tests.assert_count($$select 1 from public.audit_log where table_name = 'scaffold_inspections'$$, 3, 'inspections are in the history');
