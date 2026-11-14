-- Actions tests. Runs after the other suites (reuses their people, projects and records):
--   11 admin · 13 internal PM (P1) · 22 internal worker (P1) · 33 Acme supervisor (P1) · 44 Bravo worker
\set ON_ERROR_STOP 1
select set_config('request.jwt.claims', '{}', false);

create temp table src as
select (select id from public.form_submissions where module = 'safety_event' and record_date = '2026-11-10' limit 1) as incident,
       (select id from public.investigations limit 1) as inv;
grant select on src to authenticated;
create temp table act (k text primary key, id uuid);
grant select, insert on act to authenticated;

set role authenticated;
-- PM raises an action on the incident, assigned to the worker
select tests.login('13131313-1313-1313-1313-131313131313');
with x as (
  insert into public.actions (submission_id, title, description, priority, assignee_id, due_date)
  select incident, 'Fit kick plates to lift 4', 'Toeboards missing on two bays', 'high', '22222222-2222-2222-2222-222222222222', current_date + 7 from src
  returning id)
insert into act select 'a', id from x;
reset role;
select tests.assert_count($$select 1 from public.actions where reference = 'ACT-00001' and source_module = 'safety_event' and source_reference like 'SE-%'
  and project_id = 'aaaaaaaa-0000-0000-0000-000000000001' and raised_by = '13131313-1313-1313-1313-131313131313' and status = 'open'$$,
  1, 'PM raises an action: reference, source and project filled in');
select tests.assert_count($$select 1 from public.notifications where user_id = '22222222-2222-2222-2222-222222222222' and title like 'Action assigned to you:%'$$,
  1, 'the person assigned is notified in the app');
select tests.assert_count($$select 1 from public.notification_outbox where channel = 'email' and subject like 'Action assigned to you:%'$$,
  1, '…and an email is queued');

-- Who sees / raises
set role authenticated;
select tests.login('44444444-4444-4444-4444-444444444444');
select tests.assert_count('select 1 from public.actions', 0, 'another company''s worker cannot see the action');
select tests.assert_fails($$insert into public.actions (submission_id, title, assignee_id, due_date) select incident, 'x', '44444444-4444-4444-4444-444444444444', current_date from src$$,
  'cannot raise an action on a record you can''t see');
select tests.login('22222222-2222-2222-2222-222222222222');
select tests.assert_count('select 1 from public.actions', 1, 'the person assigned sees it');
select tests.assert_fails($$update public.actions set due_date = current_date + 30$$, 'the person assigned cannot move the due date');

-- Close-out needs a comment and evidence, by the person assigned
select tests.assert_fails($$update public.actions set status = 'closed', close_comment = 'Done'$$, 'cannot close without evidence');
select tests.assert_fails($$update public.actions set status = 'closed', close_evidence = '{storage:form-uploads/x/fix.jpg}'$$, 'cannot close without a comment');
update public.actions set status = 'closed', close_comment = 'Kick plates fitted to bays 3 and 4', close_evidence = '{storage:form-uploads/x/fix.jpg}';
reset role;
select tests.assert_count($$select 1 from public.actions where status = 'closed' and closed_by = '22222222-2222-2222-2222-222222222222' and closed_at is not null$$,
  1, 'the person assigned closes it out with a comment and evidence');
select tests.assert_count($$select 1 from public.notifications where user_id = '13131313-1313-1313-1313-131313131313' and title like 'Action closed:%'$$,
  1, 'whoever raised it is told it was closed');

-- Only the person assigned can close; reopen / cancel need a reason
set role authenticated;
select tests.login('13131313-1313-1313-1313-131313131313');
with x as (
  insert into public.actions (submission_id, title, assignee_id, due_date)
  select incident, 'Toolbox talk on dropped objects', '22222222-2222-2222-2222-222222222222', current_date + 3 from src returning id)
insert into act select 'b', id from x;
select tests.assert_fails($$update public.actions set status = 'closed', close_comment = 'x', close_evidence = '{a}' where id = (select id from act where k = 'b')$$,
  'the raiser cannot close someone else''s action');
select tests.assert_fails($$update public.actions set status = 'open' where id = (select id from act where k = 'a')$$, 'reopening needs a reason');
update public.actions set status = 'open', status_note = 'Photo shows bay 3 only' where id = (select id from act where k = 'a');
reset role;
select tests.assert_count($$select 1 from public.actions where reference = 'ACT-00001' and status = 'open' and close_comment is null and close_evidence = '{}'$$,
  1, 'reopened: close-out cleared for the person assigned to redo');
set role authenticated;
select tests.login('13131313-1313-1313-1313-131313131313');
select tests.assert_fails($$update public.actions set status = 'cancelled' where id = (select id from act where k = 'b')$$, 'cancelling needs a reason');
update public.actions set status = 'cancelled', status_note = 'Covered at Monday pre-start' where id = (select id from act where k = 'b');
select tests.assert_count($$select 1 from public.actions where status = 'cancelled'$$, 1, 'raiser cancels with a reason');
select tests.assert_fails($$delete from public.actions$$, 'actions cannot be deleted');

-- Actions on an investigation (raised at the end of the investigation, then reviewed)
reset role;
select tests.login('11111111-1111-1111-1111-111111111111');
set role authenticated;
select tests.assert_fails($$insert into public.actions (investigation_id, title, assignee_id, due_date) select inv, 'x', '13131313-1313-1313-1313-131313131313', current_date from src$$,
  'no new actions on a closed investigation');
update public.investigations set status = 'in_progress', no_actions_reason = null;
select tests.login('13131313-1313-1313-1313-131313131313');
select tests.assert_fails($$update public.investigations set status = 'review'$$, 'review needs actions (or a reason there are none)');
with x as (
  insert into public.actions (investigation_id, title, assignee_id, due_date)
  select inv, 'Add intermediate step to bottom lift', '13131313-1313-1313-1313-131313131313', current_date + 14 from src returning id)
insert into act select 'c', id from x;
select tests.assert_count($$select 1 from public.actions where source_module = 'investigation' and source_reference like 'INV-%'$$, 1, 'action raised from an investigation');
update public.investigations set status = 'review';
select tests.assert_count($$select 1 from public.investigations where status = 'review' and submitted_for_review_by = '13131313-1313-1313-1313-131313131313'$$, 1, 'lead submits for review once actions are raised');
select tests.assert_fails($$update public.investigations set status = 'closed', actions_confirmed = true, review_comment = 'ok'$$, 'the lead cannot review their own investigation');
select tests.login('12121212-1212-1212-1212-121212121212');
select tests.assert_fails($$update public.investigations set status = 'closed', review_comment = 'ok'$$, 'reviewer must confirm the actions address the gaps');
update public.investigations set status = 'in_progress', review_comment = 'Root cause needs the 5 whys';
reset role;
select tests.assert_count($$select 1 from public.notifications where user_id = '13131313-1313-1313-1313-131313131313' and title like 'Investigation sent back:%'$$, 1, 'HSET sends it back; the lead is told why');
set role authenticated;
select tests.login('13131313-1313-1313-1313-131313131313');
update public.investigations set root_cause = 'No intermediate step; design standard not checked', status = 'review';
select tests.login('12121212-1212-1212-1212-121212121212');
update public.investigations set status = 'closed', actions_confirmed = true, review_comment = 'Action addresses the root cause';
select tests.assert_count($$select 1 from public.investigations where status = 'closed' and reviewed_by = '12121212-1212-1212-1212-121212121212' and actions_confirmed$$, 1, 'HSET reviews and closes');
select tests.login('13131313-1313-1313-1313-131313131313');

-- Subcontractor supervisor can't assign to people they can't see
select tests.login('33333333-3333-3333-3333-333333333333');
-- Anyone raising an action can assign it to people on the record's project, Admin or HSET
select tests.login('22222222-2222-2222-2222-222222222222');
with x as (
  insert into public.actions (submission_id, title, assignee_id, due_date)
  select incident, 'Replace missing barricade', '13131313-1313-1313-1313-131313131313', current_date + 2 from src returning id)
insert into act select 'w', id from x;
select tests.assert_count($$select 1 from public.actions where title = 'Replace missing barricade'$$, 1, 'a worker raises an action on their record and assigns it to the PM on the project');
reset role;
select tests.login('11111111-1111-1111-1111-111111111111');
insert into auth.users (id, email) values ('66666666-6666-6666-6666-666666666666', 'elsewhere@internal.test');
update public.profiles set is_active = true where id = '66666666-6666-6666-6666-666666666666';
set role authenticated;
select tests.login('22222222-2222-2222-2222-222222222222');
select tests.assert_fails($$insert into public.actions (submission_id, title, assignee_id, due_date)
  select incident, 'x', '66666666-6666-6666-6666-666666666666', current_date from src$$,
  'cannot assign to someone who is not on the project');
reset role;
select tests.assert_count($$select 1 from public.audit_log where table_name = 'actions'$$, 7, 'every change is in the history');
