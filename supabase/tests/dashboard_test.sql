-- Stage 2 dashboard data tests. Runs after rls_test.sql and records_test.sql.
\set ON_ERROR_STOP 1
select set_config('request.jwt.claims', '{}', false);

insert into public.vehicles (id, fleet_number, rego, vehicle_type, project_id, operator_id, daily_prestart_required) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'UTE-01', '1ABC123', 'Ute', 'aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', true),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'HIAB-02', '1XYZ789', 'HIAB Truck', 'aaaaaaaa-0000-0000-0000-000000000001', '34444444-4444-4444-4444-444444444444', true),
  ('bbbbbbbb-0000-0000-0000-000000000003', 'UTE-09', '1QQQ999', 'Ute', 'aaaaaaaa-0000-0000-0000-000000000002', null, true);

create temp table dv as
select (select current_version_id from public.form_templates where name = 'Vehicle Pre-Start') as vps,
       (select current_version_id from public.form_templates where name = 'Safety Event Report') as se,
       (select current_version_id from public.form_templates where category = 'field_leadership') as fl;
grant select on dv to authenticated;

-- Visibility of the register
set role authenticated;
select tests.login('22222222-2222-2222-2222-222222222222');
select tests.assert_count('select * from public.vehicles', 2, 'worker sees vehicles on their primary project');
select tests.assert_fails($$insert into public.vehicles (fleet_number) values ('ROGUE')$$, 'worker cannot add vehicles');
select tests.login('13131313-1313-1313-1313-131313131313');
select tests.assert_count('select * from public.vehicles', 2, 'PM sees vehicles on their projects');

-- Pre-start with a critical fail tags the vehicle out of service; record date = today (Perth)
select tests.login('22222222-2222-2222-2222-222222222222');
insert into public.form_submissions (template_version_id, project_id, vehicle_id, status, answers)
select vps, 'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'submitted',
       '{"q-v-odo":"88120","q-v-tyres":"fail","q-v-lights":"pass","q-v-brakes":"pass"}' from dv;
reset role;
select tests.assert_count($$select 1 from public.form_submissions where vehicle_id = 'bbbbbbbb-0000-0000-0000-000000000001'
  and record_date = public.perth_today() and (summary->>'failed_items')::int = 1 and status = 'defect_reported'$$, 1,
  'vehicle pre-start: record date, failed items, defect status');
select tests.assert_count($$select 1 from public.vehicles where id = 'bbbbbbbb-0000-0000-0000-000000000001' and status = 'out_of_service' and out_of_service_reason like 'Critical item failed%'$$,
  1, 'critical fail tags the vehicle out of service');
select tests.assert_fails($$insert into public.form_submissions (template_version_id, vehicle_id, status) select vps, gen_random_uuid(), 'draft' from dv$$,
  'pre-start must use a vehicle from the register');

-- Supervisor on the project returns it to service
set role authenticated;
select tests.login('13131313-1313-1313-1313-131313131313');
update public.vehicles set status = 'in_service', out_of_service_reason = null where id = 'bbbbbbbb-0000-0000-0000-000000000001';
select tests.assert_count($$select 1 from public.vehicles where id = 'bbbbbbbb-0000-0000-0000-000000000001' and status = 'in_service'$$, 1, 'PM on the project can return a vehicle to service');
select tests.login('22222222-2222-2222-2222-222222222222');
update public.vehicles set status = 'out_of_service' where id = 'bbbbbbbb-0000-0000-0000-000000000002';
select tests.assert_count($$select 1 from public.vehicles where id = 'bbbbbbbb-0000-0000-0000-000000000002' and status = 'in_service'$$, 1, 'worker cannot change a vehicle (RLS)');

-- Incident: record date from the incident date/time, category from the event type
insert into public.form_submissions (template_version_id, project_id, status, answers)
select se, 'aaaaaaaa-0000-0000-0000-000000000001', 'submitted',
       '{"q-when":"2026-11-10T14:30","q-type":"Lost Time Injury","q-sev":"Medium","q-desc":"x","q-made-safe":"yes","q-actions":"y"}' from dv;
reset role;
select tests.assert_count($$select 1 from public.form_submissions where module = 'safety_event' and record_date = '2026-11-10' and summary->>'incident_category' = 'injury'$$,
  1, 'incident date and injury category derived');

-- Investigations
set role authenticated;
select tests.login('22222222-2222-2222-2222-222222222222');
select tests.assert_fails($$insert into public.investigations (incident_id) select id from public.form_submissions where record_date = '2026-11-10' and module = 'safety_event'$$,
  'worker cannot open an investigation');
select tests.login('13131313-1313-1313-1313-131313131313');
insert into public.investigations (incident_id, lead_id)
select id, '13131313-1313-1313-1313-131313131313' from public.form_submissions where record_date = '2026-11-10' and module = 'safety_event';
select tests.assert_count($$select 1 from public.investigations where reference like 'INV-%' and due_date = '2026-11-24' and project_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  1, 'internal PM opens investigation: reference, due date = incident + 14 days');
reset role;
select tests.assert_count($$select 1 from public.form_submissions where record_date = '2026-11-10' and module = 'safety_event' and status = 'under_investigation'$$,
  1, 'incident moves to Under Investigation');
set role authenticated;
select tests.login('33333333-3333-3333-3333-333333333333');
select tests.assert_count('select * from public.investigations', 0, 'subcontractor supervisor cannot see an internal incident''s investigation');
select tests.login('13131313-1313-1313-1313-131313131313');
update public.investigations set status = 'closed', findings = 'Done';
select tests.assert_count($$select 1 from public.investigations where status = 'closed' and closed_at is not null and closed_by = '13131313-1313-1313-1313-131313131313'$$, 1, 'closing records who and when');
select tests.assert_fails($$delete from public.investigations$$, 'investigations cannot be deleted');

-- Field leadership + targets
insert into public.form_submissions (template_version_id, project_id, status, answers)
select fl, 'aaaaaaaa-0000-0000-0000-000000000001', 'submitted', '{"q-fl-date":"2026-11-12","q-fl-type":"Toolbox talk","q-fl-obs":"Good"}' from dv;
select tests.assert_count($$select 1 from public.form_submissions where module = 'field_leadership' and record_date = '2026-11-12' and status = 'submitted' and summary->>'activity_type' = 'Toolbox talk'$$,
  1, 'field leadership record: date and activity type');
select tests.assert_fails($$insert into public.leadership_targets (profile_id, period, target) values ('13131313-1313-1313-1313-131313131313', 'week', 3)$$,
  'only admins set leadership targets');
select tests.login('11111111-1111-1111-1111-111111111111');
insert into public.leadership_targets (profile_id, period, target) values ('13131313-1313-1313-1313-131313131313', 'week', 3);
select tests.login('13131313-1313-1313-1313-131313131313');
select tests.assert_count('select * from public.leadership_targets', 1, 'leader can see their own target');
select tests.login('22222222-2222-2222-2222-222222222222');
select tests.assert_count('select * from public.leadership_targets', 0, 'worker cannot see leaders'' targets');
reset role;
select tests.assert_count($$select 1 from public.audit_log where table_name = 'leadership_targets' and record_id = '13131313-1313-1313-1313-131313131313'$$, 1, 'target changes are audited');
