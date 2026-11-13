-- =============================================================================
-- Phase 1 default configuration. Everything here is editable by Leaders in the
-- app (Workflow Settings / Template Builder / User Management) — nothing is
-- hardcoded in the front end.
-- =============================================================================

insert into public.organizations (name, type)
select 'Internal Company', 'internal'
where not exists (select 1 from public.organizations where type = 'internal');

-- Lookup lists --------------------------------------------------------------
insert into public.lookup_lists (key, name, description, visible_to_contractors, is_system) values
  ('event_types',       'Safety Event Types',  'Classification of safety events and incidents', true,  true),
  ('severity_levels',   'Severity Levels',     'Actual / potential severity ratings',            true,  true),
  ('plant_categories',  'Plant Categories',    'Plant & equipment classes for pre-starts',       true,  true),
  ('hazard_categories', 'Hazard Categories',   'Used in risk assessments and hazard reports',    true,  true),
  ('ticket_types',      'Tickets & Licences',  'High-risk work licences, inductions, training',  true,  true),
  ('cost_codes',        'Cost Codes',          'Commercial cost codes (internal only)',          false, true)
on conflict (key) do nothing;

insert into public.lookup_values (list_key, label, code, sort_order)
select v.list_key, v.label, v.code, v.sort_order from (values
  ('event_types', 'Near Miss', 'NM', 1),
  ('event_types', 'First Aid Injury', 'FAI', 2),
  ('event_types', 'Medical Treatment Injury', 'MTI', 3),
  ('event_types', 'Lost Time Injury', 'LTI', 4),
  ('event_types', 'Property / Plant Damage', 'PD', 5),
  ('event_types', 'Environmental Incident', 'ENV', 6),
  ('event_types', 'Hazard Report', 'HAZ', 7),
  ('event_types', 'Positive Observation', 'OBS', 8),
  ('severity_levels', 'Low', 'L', 1),
  ('severity_levels', 'Medium', 'M', 2),
  ('severity_levels', 'High', 'H', 3),
  ('severity_levels', 'Critical', 'C', 4),
  ('plant_categories', 'Excavator', 'EX', 1),
  ('plant_categories', 'Wheel Loader', 'WL', 2),
  ('plant_categories', 'Dozer', 'DZ', 3),
  ('plant_categories', 'Grader', 'GR', 4),
  ('plant_categories', 'Roller / Compactor', 'RC', 5),
  ('plant_categories', 'Water Cart', 'WC', 6),
  ('plant_categories', 'Light Vehicle', 'LV', 7),
  ('plant_categories', 'Elevating Work Platform', 'EWP', 8),
  ('plant_categories', 'Crane', 'CR', 9),
  ('hazard_categories', 'Working at Heights', null, 1),
  ('hazard_categories', 'Mobile Plant Interaction', null, 2),
  ('hazard_categories', 'Excavation / Trenching', null, 3),
  ('hazard_categories', 'Underground Services', null, 4),
  ('hazard_categories', 'Manual Handling', null, 5),
  ('hazard_categories', 'Heat Stress / Fatigue', null, 6),
  ('hazard_categories', 'Confined Space', null, 7),
  ('hazard_categories', 'Electrical', null, 8),
  ('ticket_types', 'Construction Induction (White Card)', 'WC', 1),
  ('ticket_types', 'First Aid (HLTAID011)', 'FA', 2),
  ('ticket_types', 'Working at Heights', 'WAH', 3),
  ('ticket_types', 'Confined Space Entry', 'CSE', 4),
  ('ticket_types', 'HRW – Forklift (LF)', 'LF', 5),
  ('ticket_types', 'HRW – Boom Type EWP (WP)', 'WP', 6),
  ('ticket_types', 'HRW – Dogging (DG)', 'DG', 7),
  ('ticket_types', 'Site Induction', 'SI', 8),
  ('cost_codes', 'Labour – Direct', '1000', 1),
  ('cost_codes', 'Plant – Owned', '2000', 2),
  ('cost_codes', 'Plant – Hired', '2100', 3),
  ('cost_codes', 'Materials', '3000', 4),
  ('cost_codes', 'Subcontractors', '4000', 5),
  ('cost_codes', 'Preliminaries', '5000', 6)
) as v(list_key, label, code, sort_order)
on conflict (list_key, label) do nothing;

-- Job roles (rates are leader-only via job_role_rates) -----------------------
insert into public.job_roles (name, classification, applies_to) values
  ('Project Manager',        'Management', array['internal']::public.org_type[]),
  ('Site Supervisor',        'Supervision', array['internal','contractor']::public.org_type[]),
  ('HSEQ Advisor',           'HSEQ', array['internal']::public.org_type[]),
  ('Leading Hand',           'Level 4', array['internal','contractor']::public.org_type[]),
  ('Plant Operator',         'Level 3', array['internal','contractor']::public.org_type[]),
  ('Labourer',               'Level 1', array['internal','contractor']::public.org_type[]),
  ('Truck Driver',           'Level 2', array['internal','contractor']::public.org_type[])
on conflict (name) do nothing;

-- Status pipelines -----------------------------------------------------------
insert into public.workflow_pipelines (module, statuses) values
  ('safety_event', '[
    {"key":"draft","label":"Draft","color":"slate","is_terminal":false},
    {"key":"submitted","label":"Submitted","color":"blue","is_terminal":false},
    {"key":"under_investigation","label":"Under Investigation","color":"amber","is_terminal":false},
    {"key":"actions_open","label":"Actions Open","color":"orange","is_terminal":false},
    {"key":"closed","label":"Closed","color":"green","is_terminal":true}]'),
  ('daily_field_report', '[
    {"key":"draft","label":"Draft","color":"slate","is_terminal":false},
    {"key":"submitted","label":"Submitted","color":"blue","is_terminal":false},
    {"key":"approved","label":"Approved","color":"green","is_terminal":true},
    {"key":"rejected","label":"Returned","color":"red","is_terminal":false}]'),
  ('plant_prestart', '[
    {"key":"submitted","label":"Submitted","color":"blue","is_terminal":false},
    {"key":"defect_reported","label":"Defect Reported","color":"red","is_terminal":false},
    {"key":"cleared","label":"Cleared for Use","color":"green","is_terminal":true}]'),
  ('audit', '[
    {"key":"scheduled","label":"Scheduled","color":"slate","is_terminal":false},
    {"key":"in_progress","label":"In Progress","color":"amber","is_terminal":false},
    {"key":"submitted","label":"Submitted","color":"blue","is_terminal":false},
    {"key":"closed","label":"Closed","color":"green","is_terminal":true}]'),
  ('risk_assessment', '[
    {"key":"draft","label":"Draft","color":"slate","is_terminal":false},
    {"key":"submitted","label":"Submitted","color":"blue","is_terminal":false},
    {"key":"approved","label":"Approved","color":"green","is_terminal":true}]'),
  ('timesheet', '[
    {"key":"draft","label":"Draft","color":"slate","is_terminal":false},
    {"key":"submitted","label":"Submitted","color":"blue","is_terminal":false},
    {"key":"approved","label":"Approved","color":"green","is_terminal":true},
    {"key":"rejected","label":"Returned","color":"red","is_terminal":false}]'),
  ('training', '[
    {"key":"current","label":"Current","color":"green","is_terminal":false},
    {"key":"expiring","label":"Expiring","color":"amber","is_terminal":false},
    {"key":"expired","label":"Expired","color":"red","is_terminal":true}]')
on conflict (module) do nothing;

-- Starter workflow rules -----------------------------------------------------
insert into public.workflow_rules (name, description, module, trigger_event, trigger_config, approval_chain, actions, priority)
select * from (values
  ('High severity safety event alert',
   'Escalate any High or Critical event to leaders immediately.',
   'safety_event'::public.workflow_module, 'field_condition'::public.workflow_trigger,
   '{"field":"severity","operator":"in","value":"High,Critical"}'::jsonb,
   '[{"step":1,"role":"leader","sla_hours":4}]'::jsonb,
   '[{"type":"in_app","recipients":["role:leader"],"message":"High severity safety event logged"},{"type":"email","recipients":["role:leader"],"message":"A High/Critical safety event requires review within 4 hours."}]'::jsonb,
   10),
  ('DFR submitted for approval',
   'Daily Field Reports need leader approval once submitted.',
   'daily_field_report', 'status_changed',
   '{"to_status":"submitted"}'::jsonb,
   '[{"step":1,"role":"leader","sla_hours":24}]'::jsonb,
   '[{"type":"in_app","recipients":["role:leader"],"message":"A Daily Field Report is awaiting approval"}]'::jsonb,
   50),
  ('Plant defect reported',
   'Notify leaders when a pre-start records a defect.',
   'plant_prestart', 'status_changed',
   '{"to_status":"defect_reported"}'::jsonb,
   '[]'::jsonb,
   '[{"type":"in_app","recipients":["role:leader"],"message":"Plant defect reported on pre-start — tag out until cleared"},{"type":"email","recipients":["role:leader"],"message":"Plant defect reported."}]'::jsonb,
   20),
  ('Ticket expiring in 30 days',
   'Remind the worker (and leaders) before a licence or ticket expires.',
   'training', 'ticket_expiring',
   '{"days_before":30}'::jsonb,
   '[]'::jsonb,
   '[{"type":"in_app","recipients":["submitter","role:leader"],"message":"A ticket or licence expires within 30 days"}]'::jsonb,
   100)
) as v(name, description, module, trigger_event, trigger_config, approval_chain, actions, priority)
where not exists (select 1 from public.workflow_rules);

-- Starter templates (published v1) ------------------------------------------
do $$
declare
  t_id uuid;
  v_id uuid;
  rec record;
begin
  if exists (select 1 from public.form_templates) then
    return;
  end if;

  for rec in select * from (values
    ('Daily Plant Pre-Start – Earthmoving', 'Operator pre-start for excavators, loaders and dozers.', 'plant_prestart'::public.template_category,
     '{"settings":{"requireProject":true,"requireSignOff":true},"sections":[
       {"id":"s-details","title":"Plant Details","questions":[
         {"id":"q-plant","label":"Plant category","type":"dropdown","required":true,"options":["Excavator","Wheel Loader","Dozer","Grader","Roller / Compactor"]},
         {"id":"q-fleet","label":"Fleet / asset number","type":"text","required":true},
         {"id":"q-hours","label":"Hour meter reading","type":"number","required":true,"unit":"hrs"}]},
       {"id":"s-walk","title":"Walk-around Inspection","questions":[
         {"id":"q-fluids","label":"Engine oil, coolant & hydraulic levels OK","type":"pass_fail_na","required":true,"photoOnFail":true},
         {"id":"q-leaks","label":"No visible leaks or damaged hoses","type":"pass_fail_na","required":true,"photoOnFail":true},
         {"id":"q-tracks","label":"Tracks / tyres & undercarriage condition","type":"pass_fail_na","required":true,"photoOnFail":true},
         {"id":"q-glass","label":"Windows, mirrors & cameras clean and undamaged","type":"pass_fail_na","required":true}]},
       {"id":"s-cab","title":"In-Cab & Safety Systems","questions":[
         {"id":"q-seatbelt","label":"Seatbelt functional","type":"pass_fail_na","required":true,"critical":true},
         {"id":"q-alarm","label":"Reversing alarm & beacon operational","type":"pass_fail_na","required":true,"critical":true},
         {"id":"q-brakes","label":"Service & park brakes tested","type":"pass_fail_na","required":true,"critical":true},
         {"id":"q-fire","label":"Fire extinguisher present and tagged","type":"yes_no","required":true}]},
       {"id":"s-sign","title":"Operator Sign-off","questions":[
         {"id":"q-fit","label":"I am fit for work and the plant is safe to operate","type":"yes_no","required":true},
         {"id":"q-sig","label":"Operator signature","type":"signature","required":true}]}]}'::jsonb),
    ('Site Safety Walk Audit', 'Weekly supervisor site inspection.', 'audit'::public.template_category,
     '{"settings":{"requireProject":true,"requireSignOff":true},"sections":[
       {"id":"s-house","title":"Housekeeping & Access","questions":[
         {"id":"q-access","label":"Access/egress routes clear","type":"pass_fail_na","required":true,"photoOnFail":true},
         {"id":"q-house","label":"Housekeeping acceptable","type":"pass_fail_na","required":true}]},
       {"id":"s-plant","title":"Plant & Traffic","questions":[
         {"id":"q-tmp","label":"Traffic management plan implemented","type":"pass_fail_na","required":true},
         {"id":"q-excl","label":"Exclusion zones established around operating plant","type":"pass_fail_na","required":true,"critical":true}]},
       {"id":"s-close","title":"Close-out","questions":[
         {"id":"q-notes","label":"General observations","type":"text","required":false,"multiline":true},
         {"id":"q-photo","label":"Site overview photo","type":"photo","required":true},
         {"id":"q-sig","label":"Auditor signature","type":"signature","required":true}]}]}'::jsonb),
    ('Take 5 / Step Back Risk Assessment', 'Personal task risk assessment before starting work.', 'risk_assessment'::public.template_category,
     '{"settings":{"requireProject":true,"requireSignOff":true},"sections":[
       {"id":"s-task","title":"The Task","questions":[
         {"id":"q-task","label":"Describe the task","type":"text","required":true,"multiline":true},
         {"id":"q-hazcat","label":"Main hazard category","type":"dropdown","required":true,"options":["Working at Heights","Mobile Plant Interaction","Excavation / Trenching","Underground Services","Manual Handling","Heat Stress / Fatigue"]}]},
       {"id":"s-check","title":"Step Back","questions":[
         {"id":"q-swms","label":"I have read and understood the SWMS / JSEA","type":"yes_no","required":true},
         {"id":"q-ppe","label":"I have the correct PPE","type":"yes_no","required":true},
         {"id":"q-controls","label":"Controls are in place for all hazards","type":"yes_no","required":true,"critical":true},
         {"id":"q-risk","label":"Residual risk score (1–25)","type":"number","required":true,"min":1,"max":25}]},
       {"id":"s-sign","title":"Sign-off","questions":[
         {"id":"q-sig","label":"Worker signature","type":"signature","required":true}]}]}'::jsonb),
    ('Safety Event Report', 'Initial notification of an incident, near miss or hazard.', 'safety_event'::public.template_category,
     '{"settings":{"requireProject":true,"requireSignOff":false},"sections":[
       {"id":"s-what","title":"What Happened","questions":[
         {"id":"q-type","label":"Event type","type":"dropdown","required":true,"options":["Near Miss","First Aid Injury","Medical Treatment Injury","Lost Time Injury","Property / Plant Damage","Environmental Incident","Hazard Report"]},
         {"id":"q-sev","label":"Severity","type":"dropdown","required":true,"options":["Low","Medium","High","Critical"]},
         {"id":"q-desc","label":"Description","type":"text","required":true,"multiline":true},
         {"id":"q-photo","label":"Photo of the scene","type":"photo","required":false}]},
       {"id":"s-immediate","title":"Immediate Actions","questions":[
         {"id":"q-made-safe","label":"Area made safe","type":"yes_no","required":true},
         {"id":"q-actions","label":"Immediate actions taken","type":"text","required":true,"multiline":true}]}]}'::jsonb)
  ) as x(name, description, category, schema)
  loop
    insert into public.form_templates (name, description, category, draft_schema, status, has_unpublished_changes)
    values (rec.name, rec.description, rec.category, rec.schema, 'published', false)
    returning id into t_id;

    insert into public.form_template_versions (template_id, version, name, category, schema, change_note)
    values (t_id, 1, rec.name, rec.category, rec.schema, 'Initial starter template')
    returning id into v_id;

    update public.form_templates
       set current_version = 1, current_version_id = v_id
     where id = t_id;
    update public.form_templates set has_unpublished_changes = false where id = t_id;
  end loop;
end $$;
