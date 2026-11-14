-- Records engine tests. Runs after rls_test.sql (reuses its users, companies and projects).
\set ON_ERROR_STOP 1
select set_config('request.jwt.claims', '', false);

-- Fixtures: a DFR version, plant pre-start version and safety event version ids.
create temp table v as
select (select current_version_id from public.form_templates where category = 'daily_field_report') as dfr,
       (select current_version_id from public.form_templates where category = 'plant_prestart' and name like 'Daily Plant Pre-Start%') as ps,
       (select current_version_id from public.form_templates where category = 'safety_event') as se;
grant select on v to authenticated;
create temp table ids (k text primary key, id uuid);
grant select, insert on ids to authenticated;

-- ---------------------------------------------------------------------------
-- Employee submits a DFR
-- ---------------------------------------------------------------------------
set role authenticated;
select tests.login('22222222-2222-2222-2222-222222222222');
insert into public.form_submissions (template_version_id, project_id, status, answers)
select dfr, 'aaaaaaaa-0000-0000-0000-000000000001', 'submitted',
       '{"q-shift":"Day","q-crew":[{"name":"A","hours":"8"},{"name":"B","hours":"7.5"}],"q-work":"Bulk earthworks"}'
  from v;
insert into ids select 'dfr1', id from public.form_submissions where submitted_by = auth.uid() order by created_at desc limit 1;
-- Saving returns the new row (the app inserts with RETURNING): must pass the read policy.
with x as (
  insert into public.form_submissions (template_version_id, project_id, status, answers)
  select dfr, 'aaaaaaaa-0000-0000-0000-000000000001', 'draft', '{"q-shift":"Night"}' from v
  returning id)
insert into ids select 'returning', id from x;
select tests.assert_count($$select 1 from ids where k = 'returning'$$, 1, 'insert … returning works for a worker');
select tests.assert_count($$select 1 from public.form_submissions s join ids on ids.id = s.id and ids.k = 'dfr1'
  where s.reference like 'DFR-%' and s.status = 'submitted' and s.module = 'daily_field_report' and (s.summary->>'total_hours')::numeric = 15.5$$,
  1, 'DFR gets a reference, submitted status and total hours');
select tests.assert_fails($$insert into public.form_submissions (template_version_id, status) select dfr, 'approved' from v$$,
  'worker cannot create a record straight into "approved"');
update public.form_submissions set status = 'approved' where id = (select id from ids where k = 'dfr1'); -- RLS: 0 rows
select tests.assert_count($$select 1 from public.form_submissions where id = (select id from ids where k = 'dfr1') and status = 'submitted'$$,
  1, 'worker cannot change status of a submitted record');
reset role;

select tests.assert_count($$select 1 from public.record_approvals a join ids on ids.id = a.submission_id and ids.k = 'dfr1' where a.status = 'pending' and a.approver_role = 'admin'$$,
  1, 'DFR rule opened an Admin approval');
select tests.assert_count($$select 1 from public.notifications n join public.workflow_rules r on r.id = n.rule_id where r.name = 'DFR submitted for approval' and n.link like '/records/%'$$,
  2, 'Admin and HSET notified with a link to the record');

-- ---------------------------------------------------------------------------
-- Visibility
-- ---------------------------------------------------------------------------
set role authenticated;
select tests.login('33333333-3333-3333-3333-333333333333');
select tests.assert_count($$select 1 from public.form_submissions where id = (select id from ids where k = 'dfr1')$$, 0, 'subcontractor supervisor cannot see internal DFR on same project');
select tests.login('34444444-4444-4444-4444-444444444444');
insert into public.form_submissions (template_version_id, project_id, status, answers)
select dfr, 'aaaaaaaa-0000-0000-0000-000000000001', 'draft', '{}' from v;
insert into ids select 'acme_draft', id from public.form_submissions where submitted_by = auth.uid() and status = 'draft' limit 1;
select tests.login('33333333-3333-3333-3333-333333333333');
select tests.assert_count($$select 1 from public.form_submissions where id = (select id from ids where k = 'acme_draft')$$, 1, 'Acme supervisor sees Acme worker record on their project');
select tests.login('13131313-1313-1313-1313-131313131313');
select tests.assert_count($$select 1 from public.form_submissions where id = (select id from ids where k = 'acme_draft')$$, 1, 'internal PM sees subcontractor records on their project');
select tests.login('45454545-4545-4545-4545-454545454545');
select tests.assert_count($$select 1 from public.form_submissions where id = (select id from ids where k = 'acme_draft')$$, 0, 'Bravo supervisor cannot see Acme records on the same project');
select tests.login('44444444-4444-4444-4444-444444444444');
select tests.assert_count($$select 1 from public.form_submissions where id = (select id from ids where k = 'acme_draft')$$, 0, 'other worker cannot see it');
select tests.assert_count($$select 1 from public.record_events where submission_id = (select id from ids where k = 'acme_draft')$$, 0, 'other worker cannot see its history');
select tests.assert_fails($$insert into public.record_events (submission_id, kind, body, actor) values ((select id from ids where k = 'acme_draft'), 'comment', 'hi', auth.uid())$$,
  'other worker cannot comment on it');
select tests.login('22222222-2222-2222-2222-222222222222');
insert into public.record_events (submission_id, kind, body, actor) values ((select id from ids where k = 'dfr1'), 'comment', 'Rain from 2pm', auth.uid());
select tests.assert_count($$select 1 from public.record_events where kind = 'comment' and body = 'Rain from 2pm'$$, 1, 'submitter can comment');
reset role;

-- ---------------------------------------------------------------------------
-- Leader approves -> record moves to next status
-- ---------------------------------------------------------------------------
set role authenticated;
select tests.login('22222222-2222-2222-2222-222222222222');
select tests.assert_fails($$select public.decide_approval((select a.id from public.record_approvals a join ids on ids.id = a.submission_id and ids.k = 'dfr1'), 'approved')$$,
  'worker cannot approve an Admin step');
select tests.login('11111111-1111-1111-1111-111111111111');
select public.decide_approval((select a.id from public.record_approvals a join ids on ids.id = a.submission_id and ids.k = 'dfr1'), 'approved', 'Looks good');
select tests.assert_count($$select 1 from public.form_submissions where id = (select id from ids where k = 'dfr1') and status = 'approved'$$, 1, 'approval moves DFR to Approved');
select tests.assert_count($$select 1 from public.record_events where submission_id = (select id from ids where k = 'dfr1') and kind = 'status' and to_status = 'approved'$$, 1, 'status change logged');
reset role;

-- ---------------------------------------------------------------------------
-- Reject -> returned to submitter -> resubmit opens a new approval
-- ---------------------------------------------------------------------------
set role authenticated;
select tests.login('22222222-2222-2222-2222-222222222222');
insert into public.form_submissions (template_version_id, status, answers) select dfr, 'submitted', '{"q-work":"x"}' from v;
insert into ids select 'dfr2', id from public.form_submissions where submitted_by = auth.uid() order by created_at desc, reference desc limit 1;
select tests.login('11111111-1111-1111-1111-111111111111');
select tests.assert_fails($$select public.decide_approval((select a.id from public.record_approvals a join ids on ids.id = a.submission_id and ids.k = 'dfr2' where a.status = 'pending'), 'rejected')$$,
  'rejecting needs a comment');
select public.decide_approval((select a.id from public.record_approvals a join ids on ids.id = a.submission_id and ids.k = 'dfr2' where a.status = 'pending'), 'rejected', 'Add crew hours');
select tests.assert_count($$select 1 from public.form_submissions where id = (select id from ids where k = 'dfr2') and status = 'rejected'$$, 1, 'rejection returns the DFR');
select tests.login('22222222-2222-2222-2222-222222222222');
update public.form_submissions set answers = answers || '{"q-crew":[{"name":"A","hours":"8"}]}', status = 'submitted' where id = (select id from ids where k = 'dfr2');
select tests.assert_count($$select 1 from public.form_submissions where id = (select id from ids where k = 'dfr2') and status = 'submitted'$$, 1, 'submitter can fix and resubmit');
reset role;
select tests.assert_count($$select 1 from public.record_approvals a join ids on ids.id = a.submission_id and ids.k = 'dfr2' where a.status = 'pending'$$, 1, 'resubmission opens a fresh approval');

-- ---------------------------------------------------------------------------
-- Plant pre-start with a critical fail -> Defect Reported + alert
-- ---------------------------------------------------------------------------
set role authenticated;
select tests.login('34444444-4444-4444-4444-444444444444');
insert into public.form_submissions (template_version_id, project_id, status, answers)
select ps, 'aaaaaaaa-0000-0000-0000-000000000001', 'submitted', '{"q-plant":"Excavator","q-seatbelt":"fail"}' from v;
reset role;
select tests.assert_count($$select 1 from public.form_submissions where module = 'plant_prestart' and status = 'defect_reported'
  and (summary->>'critical_failures')::int = 1 and summary->>'plant_category' = 'Excavator'$$, 1, 'critical fail -> Defect Reported, lookup field derived');
select tests.assert_count($$select 1 from public.notifications n join public.workflow_rules r on r.id = n.rule_id where r.name = 'Plant defect reported'$$,
  2, 'plant defect rule alerted Admin and HSET');

-- ---------------------------------------------------------------------------
-- Safety event severity from a lookup dropdown drives the High severity rule
-- ---------------------------------------------------------------------------
set role authenticated;
select tests.login('22222222-2222-2222-2222-222222222222');
insert into public.form_submissions (template_version_id, status, answers)
select se, 'submitted', '{"q-type":"Near Miss","q-sev":"High","q-desc":"Swing radius breach"}' from v;
reset role;
select tests.assert_count($$select 1 from public.form_submissions where module = 'safety_event' and reference = 'SE-00001' and summary->>'severity' = 'High'$$,
  1, 'safety event numbered SE-00001 with severity field');
select tests.assert_count($$select 1 from public.record_approvals a join public.form_submissions s on s.id = a.submission_id where s.module = 'safety_event' and a.status = 'pending'$$,
  1, 'high severity rule opened a leader approval');
select tests.assert_count($$select 1 from public.notifications where body like 'SE-00001:%'$$, 2, 'alert names the record reference');

-- Branding readable signed-out; only admins can change it
set role anon;
select tests.assert_count($$select 1 from public.app_settings where company_name <> ''$$, 1, 'branding readable before sign-in');
reset role;
set role authenticated;
select tests.login('22222222-2222-2222-2222-222222222222');
update public.app_settings set company_name = 'Hacked';
select tests.assert_count($$select 1 from public.app_settings where company_name = 'Hacked'$$, 0, 'worker cannot change branding');
select tests.login('11111111-1111-1111-1111-111111111111');
update public.app_settings set primary_color = '#123456';
select tests.assert_count($$select 1 from public.app_settings where primary_color = '#123456'$$, 1, 'admin can change branding');
reset role;

-- Rejecting in a pipeline with no Rejected/Returned status sends the record back as a draft.
set role authenticated;
select tests.login('11111111-1111-1111-1111-111111111111');
select public.decide_approval((select a.id from public.record_approvals a join public.form_submissions s on s.id = a.submission_id
  where s.reference = 'SE-00001' and a.status = 'pending'), 'rejected', 'Add photos');
reset role;
select tests.assert_count($$select 1 from public.form_submissions where reference = 'SE-00001' and status = 'draft' and submitted_at is not null$$,
  1, 'rejected safety event returns to submitter as a draft');
