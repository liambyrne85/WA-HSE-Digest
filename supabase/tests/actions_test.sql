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

-- Actions on an investigation
with x as (
  insert into public.actions (investigation_id, title, assignee_id, due_date)
  select inv, 'Add intermediate step to bottom lift', '13131313-1313-1313-1313-131313131313', current_date + 14 from src returning id)
insert into act select 'c', id from x;
select tests.assert_count($$select 1 from public.actions where source_module = 'investigation' and source_reference like 'INV-%'$$, 1, 'action raised from an investigation');

-- Subcontractor supervisor can't assign to people they can't see
select tests.login('33333333-3333-3333-3333-333333333333');
select tests.assert_fails($$insert into public.actions (submission_id, title, assignee_id, due_date)
  select id, 'x', '22222222-2222-2222-2222-222222222222', current_date from public.form_submissions limit 1$$,
  'subcontractor supervisor cannot assign our people');
reset role;
select tests.assert_count($$select 1 from public.audit_log where table_name = 'actions'$$, 6, 'every change is in the history');
