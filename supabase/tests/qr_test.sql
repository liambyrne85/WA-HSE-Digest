-- Stage 4 tests: public QR view and tag print log. Runs after the other suites.
--   13 internal PM (P1) · 22 worker + competent inspector (P1) · 66 active person on no project
\set ON_ERROR_STOP 1
select set_config('request.jwt.claims', '{}', false);
create temp table q (k text primary key, id uuid, tok text);
grant select, insert on q to authenticated;
create temp table ck2 as
select c.id, (select jsonb_object_agg(i->>'id', jsonb_build_object('result', 'pass')) from jsonb_array_elements(c.sections) s, jsonb_array_elements(s->'items') i) as allpass
  from public.scaffold_checklists c where c.version = 1;
grant select on ck2 to authenticated;

set role authenticated;
select tests.login('13131313-1313-1313-1313-131313131313');
with x as (insert into public.scaffolds (project_id, location, scaffold_type, duty_class, max_load_kg)
           values ('aaaaaaaa-0000-0000-0000-000000000001', 'QR test bay', 'independent', 'light', 225) returning id, qr_token)
insert into q select 's', id, qr_token from x;
select tests.login('22222222-2222-2222-2222-222222222222');
with x as (
  insert into public.scaffold_inspections (scaffold_id, inspection_type, checklist_id, items, outcome, restriction, signature, signed_at, latitude, longitude)
  select (select id from q where k = 's'), 'handover', ck2.id,
         ck2.allpass || '{"edg-toe":{"result":"fail","comment":"Toeboard missing","photos":["storage:form-uploads/o/i/a.jpg"],"defect_owner_id":"13131313-1313-1313-1313-131313131313"}}',
         'restricted', 'Light duty only', 'storage:form-uploads/o/i/sig.png', now(), -20.3, 118.5 from ck2 returning id)
insert into q select 'i', id, null from x;
select tests.assert_fails($$select public.scaffold_public_view((select tok from q where k = 's'))$$, 'signed-in users cannot call the QR view directly');
reset role;
set role anon;
select tests.assert_fails($$select public.scaffold_public_view('x')$$, 'anonymous callers cannot call the QR view directly');
reset role;

-- As the scaffold-public function (service role)
create temp table v as select public.scaffold_public_view((select tok from q where k = 's')) as j;
select tests.assert_count($$select 1 from v where j->'scaffold'->>'live_status' = 'restricted' and j->'scaffold'->>'restriction' = 'Light duty only'
  and j->'latest'->>'inspector_name' is not null and j->'latest'->>'inspector_licence_class' = 'Intermediate'
  and j->'latest'->'items'->'edg-toe'->>'comment' = 'Toeboard missing' and jsonb_array_length(j->'latest'->'sections') = 10
  and jsonb_array_length(j->'history') = 1 and (j->'scaffold'->>'open_defects')::int = 1$$, 1, 'QR view: live status, latest inspection in full, history');
select tests.assert_count($$select 1 from v where j::text like '%defect_owner_id%' or j::text like '%sig.png%' or j::text like '%118.5%'
  or j::text like '%@%' or j::text ~ 'phone|email|ticket_number'$$, 0, 'QR view leaves out signatures, GPS, emails, phones and licence numbers');
select tests.assert_count($$select 1 where public.scaffold_public_view('not-a-real-token-but-long-enough-0000000000') is null$$, 1, 'unknown token shows nothing');
select tests.assert_count($$select 1 where public.scaffold_public_view('') is null$$, 1, 'empty token shows nothing');

-- Overdue overrides the last result; dismantled shows dismantled
select set_config('app.scaffold_status_bypass', 'on', false);
update public.scaffolds set next_inspection_due = current_date - 1 where id = (select id from q where k = 's');
select set_config('app.scaffold_status_bypass', 'off', false);
select tests.assert_count($$select 1 where public.scaffold_public_view((select tok from q where k = 's'))->'scaffold'->>'live_status' = 'overdue'$$, 1, 'overdue inspection shows overdue');

-- Tag print log
set role authenticated;
select tests.login('22222222-2222-2222-2222-222222222222');
insert into public.scaffold_tag_prints (scaffold_id, inspection_id, label_size, printed_by)
select (select id from q where k = 's'), (select id from q where k = 'i'), '100x150', '13131313-1313-1313-1313-131313131313';
select tests.assert_count($$select 1 from public.scaffold_tag_prints where printed_by = '22222222-2222-2222-2222-222222222222' and label_size = '100x150'$$,
  1, 'print recorded against the person who printed it');
select tests.assert_fails($$insert into public.scaffold_tag_prints (scaffold_id, inspection_id, label_size)
  select (select id from q where k = 's'), (select id from public.scaffold_inspections where scaffold_id <> (select id from q where k = 's') limit 1), '4x6'$$,
  'print must match an inspection of the same scaffold');
select tests.assert_fails($$update public.scaffold_tag_prints set label_size = '62mm'$$, 'print log cannot be changed');
select tests.login('66666666-6666-6666-6666-666666666666');
select tests.assert_count('select 1 from public.scaffold_tag_prints', 0, 'someone not on the project cannot see prints');
select tests.assert_fails($$insert into public.scaffold_tag_prints (scaffold_id, label_size) select (select id from q where k = 's'), '4x6'$$,
  'someone not on the project cannot print the tag');
reset role;
select tests.assert_count($$select 1 from public.audit_log where table_name = 'scaffold_tag_prints'$$, 1, 'prints are in the history');
