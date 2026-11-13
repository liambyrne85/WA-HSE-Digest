import type {
  AppSettings, RecordApproval, RecordEvent, RecordRow, WorkflowModule, FormTemplate, FormTemplateVersion, Invitation, JobRole, JobRoleRate, LookupList, LookupValue,
  Notification, Organization, Profile, Project, TemplateSchema, WorkerTicket, WorkflowPipeline, WorkflowRule,
} from '../types';

export interface DemoDb {
  organizations: Organization[];
  profiles: Profile[];
  invitations: Invitation[];
  jobRoles: JobRole[];
  rates: JobRoleRate[];
  projects: Project[];
  lookupLists: LookupList[];
  lookupValues: LookupValue[];
  templates: FormTemplate[];
  versions: FormTemplateVersion[];
  pipelines: WorkflowPipeline[];
  rules: WorkflowRule[];
  tickets: WorkerTicket[];
  notifications: (Notification & { user_id: string })[];
  records: RecordRow[];
  approvals: RecordApproval[];
  events: RecordEvent[];
  counters: Partial<Record<WorkflowModule, number>>;
  settings: AppSettings;
}

const now = new Date().toISOString();
const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

export const ORG_INTERNAL = 'org-internal';
export const ORG_ACME = 'org-acme';
export const ORG_BRAVO = 'org-bravo';

const org = (id: string, name: string, type: Organization['type'], extra: Partial<Organization> = {}): Organization => ({
  id, name, type, abn: null, contact_name: null, contact_email: null, contact_phone: null,
  is_active: true, notes: null, created_at: now, ...extra,
});

const jr = (id: string, name: string, classification: string, applies_to: JobRole['applies_to']): JobRole => ({
  id, name, classification, description: null, applies_to, is_active: true,
});

const person = (id: string, full_name: string, email: string, role: Profile['role'], organization_id: string,
  job_role_id: string | null, extra: Partial<Profile> = {}): Profile => ({
  id, full_name, email, role, organization_id, job_role_id, phone: null, employee_number: null,
  emergency_contact_name: null, emergency_contact_phone: null, is_active: true, created_at: now, ...extra,
});

const lv = (list_key: string, labels: string[], codes?: (string | null)[]): LookupValue[] =>
  labels.map((label, i) => ({
    id: `lv-${list_key}-${i}`, list_key, label, code: codes?.[i] ?? null, sort_order: i + 1, is_active: true,
  }));

export const STARTER_TEMPLATES: { name: string; description: string; category: FormTemplate['category']; schema: TemplateSchema }[] = [
  {
    name: 'Daily Plant Pre-Start – Earthmoving',
    description: 'Operator pre-start for excavators, loaders and dozers.',
    category: 'plant_prestart',
    schema: {
      settings: { requireProject: true, requireSignOff: true },
      sections: [
        { id: 's-details', title: 'Plant Details', questions: [
          { id: 'q-plant', label: 'Plant category', type: 'dropdown', required: true, lookupKey: 'plant_categories' },
          { id: 'q-fleet', label: 'Fleet / asset number', type: 'text', required: true },
          { id: 'q-hours', label: 'Hour meter reading', type: 'number', required: true, unit: 'hrs' },
        ] },
        { id: 's-walk', title: 'Walk-around Inspection', questions: [
          { id: 'q-fluids', label: 'Engine oil, coolant & hydraulic levels OK', type: 'pass_fail_na', required: true, photoOnFail: true },
          { id: 'q-leaks', label: 'No visible leaks or damaged hoses', type: 'pass_fail_na', required: true, photoOnFail: true },
          { id: 'q-tracks', label: 'Tracks / tyres & undercarriage condition', type: 'pass_fail_na', required: true, photoOnFail: true },
          { id: 'q-glass', label: 'Windows, mirrors & cameras clean and undamaged', type: 'pass_fail_na', required: true },
        ] },
        { id: 's-cab', title: 'In-Cab & Safety Systems', questions: [
          { id: 'q-seatbelt', label: 'Seatbelt functional', type: 'pass_fail_na', required: true, critical: true },
          { id: 'q-alarm', label: 'Reversing alarm & beacon operational', type: 'pass_fail_na', required: true, critical: true },
          { id: 'q-brakes', label: 'Service & park brakes tested', type: 'pass_fail_na', required: true, critical: true },
          { id: 'q-fire', label: 'Fire extinguisher present and tagged', type: 'yes_no', required: true },
        ] },
        { id: 's-sign', title: 'Operator Sign-off', questions: [
          { id: 'q-fit', label: 'I am fit for work and the plant is safe to operate', type: 'yes_no', required: true },
          { id: 'q-sig', label: 'Operator signature', type: 'signature', required: true },
        ] },
      ],
    },
  },
  {
    name: 'Site Safety Walk Audit',
    description: 'Weekly supervisor site inspection.',
    category: 'audit',
    schema: {
      settings: { requireProject: true, requireSignOff: true },
      sections: [
        { id: 's-house', title: 'Housekeeping & Access', questions: [
          { id: 'q-access', label: 'Access/egress routes clear', type: 'pass_fail_na', required: true, photoOnFail: true },
          { id: 'q-house', label: 'Housekeeping acceptable', type: 'pass_fail_na', required: true },
        ] },
        { id: 's-plant', title: 'Plant & Traffic', questions: [
          { id: 'q-tmp', label: 'Traffic management plan implemented', type: 'pass_fail_na', required: true },
          { id: 'q-excl', label: 'Exclusion zones established around operating plant', type: 'pass_fail_na', required: true, critical: true },
        ] },
        { id: 's-close', title: 'Close-out', questions: [
          { id: 'q-notes', label: 'General observations', type: 'text', required: false, multiline: true },
          { id: 'q-photo', label: 'Site overview photo', type: 'photo', required: true },
          { id: 'q-sig', label: 'Auditor signature', type: 'signature', required: true },
        ] },
      ],
    },
  },
  {
    name: 'Take 5 / Step Back Risk Assessment',
    description: 'Personal task risk assessment before starting work.',
    category: 'risk_assessment',
    schema: {
      settings: { requireProject: true, requireSignOff: true },
      sections: [
        { id: 's-task', title: 'The Task', questions: [
          { id: 'q-task', label: 'Describe the task', type: 'text', required: true, multiline: true },
          { id: 'q-hazcat', label: 'Main hazard category', type: 'dropdown', required: true, lookupKey: 'hazard_categories' },
        ] },
        { id: 's-check', title: 'Step Back', questions: [
          { id: 'q-swms', label: 'I have read and understood the SWMS / JSEA', type: 'yes_no', required: true },
          { id: 'q-ppe', label: 'I have the correct PPE', type: 'yes_no', required: true },
          { id: 'q-controls', label: 'Controls are in place for all hazards', type: 'yes_no', required: true, critical: true },
          { id: 'q-risk', label: 'Residual risk score (1–25)', type: 'number', required: true, min: 1, max: 25 },
        ] },
        { id: 's-sign', title: 'Sign-off', questions: [
          { id: 'q-sig', label: 'Worker signature', type: 'signature', required: true },
        ] },
      ],
    },
  },
  {
    name: 'Safety Event Report',
    description: 'Initial notification of an incident, near miss or hazard.',
    category: 'safety_event',
    schema: {
      settings: { requireProject: true, requireSignOff: false },
      sections: [
        { id: 's-what', title: 'What Happened', questions: [
          { id: 'q-type', label: 'Event type', type: 'dropdown', required: true, lookupKey: 'event_types' },
          { id: 'q-sev', label: 'Severity', type: 'dropdown', required: true, lookupKey: 'severity_levels' },
          { id: 'q-desc', label: 'Description', type: 'text', required: true, multiline: true },
          { id: 'q-photo', label: 'Photo of the scene', type: 'photo', required: false },
        ] },
        { id: 's-immediate', title: 'Immediate Actions', questions: [
          { id: 'q-made-safe', label: 'Area made safe', type: 'yes_no', required: true },
          { id: 'q-actions', label: 'Immediate actions taken', type: 'text', required: true, multiline: true },
        ] },
      ],
    },
  },
];

STARTER_TEMPLATES.push(
  {
    name: 'Daily Field Report',
    description: 'Shift report: crew, hours, plant, progress and issues.',
    category: 'daily_field_report',
    schema: {
      settings: { requireProject: true, requireSignOff: true },
      sections: [
        { id: 's-shift', title: 'Shift', questions: [
          { id: 'q-shift', label: 'Shift', type: 'dropdown', required: true, options: ['Day', 'Night'] },
          { id: 'q-weather', label: 'Weather', type: 'dropdown', required: true, options: ['Fine', 'Hot (over 35°C)', 'Wet', 'Windy', 'Storm / lightning'] },
        ] },
        { id: 's-crew', title: 'Crew & Hours', questions: [
          { id: 'q-crew', label: 'Crew on site', type: 'table', required: true, columns: [
            { id: 'name', label: 'Name', type: 'text' }, { id: 'role', label: 'Role', type: 'text' }, { id: 'hours', label: 'Hours', type: 'number' }] },
        ] },
        { id: 's-plant', title: 'Plant & Equipment', questions: [
          { id: 'q-plant', label: 'Plant used', type: 'table', required: false, columns: [
            { id: 'plant', label: 'Plant / fleet no.', type: 'text' }, { id: 'plant_hours', label: 'Hours', type: 'number' }] },
        ] },
        { id: 's-progress', title: 'Progress', questions: [
          { id: 'q-work', label: 'Work completed', type: 'text', required: true, multiline: true },
          { id: 'q-delays', label: 'Delays or issues', type: 'text', required: false, multiline: true },
          { id: 'q-photos', label: 'Progress photos', type: 'photo', required: false },
        ] },
        { id: 's-sign', title: 'Safety & Sign-off', questions: [
          { id: 'q-incidents', label: 'Were there any incidents or near misses this shift?', type: 'yes_no', required: true, helpText: 'If yes, also log a Safety Event.' },
          { id: 'q-sig', label: 'Supervisor signature', type: 'signature', required: true },
        ] },
      ],
    },
  },
  {
    name: 'Weekly Timesheet',
    description: 'Hours worked by each person for the week.',
    category: 'timesheet',
    schema: {
      settings: { requireProject: true, requireSignOff: true },
      sections: [
        { id: 's-week', title: 'Week', questions: [
          { id: 'q-week', label: 'Week ending', type: 'text', required: true, helpText: 'e.g. Sunday 15 November' },
        ] },
        { id: 's-hours', title: 'Hours', questions: [
          { id: 'q-hours', label: 'Hours worked', type: 'table', required: true, columns: [
            { id: 'name', label: 'Worker', type: 'text' }, { id: 'day', label: 'Day', type: 'text' }, { id: 'hours', label: 'Hours', type: 'number' }] },
        ] },
        { id: 's-sign', title: 'Sign-off', questions: [
          { id: 'q-sig', label: 'Supervisor signature', type: 'signature', required: true },
        ] },
      ],
    },
  },
);

export function buildDemoSeed(): DemoDb {
  const jobRoles = [
    jr('jr-pm', 'Project Manager', 'Management', ['internal']),
    jr('jr-ss', 'Site Supervisor', 'Supervision', ['internal', 'contractor']),
    jr('jr-hseq', 'HSEQ Advisor', 'HSEQ', ['internal']),
    jr('jr-lh', 'Leading Hand', 'Level 4', ['internal', 'contractor']),
    jr('jr-op', 'Plant Operator', 'Level 3', ['internal', 'contractor']),
    jr('jr-lab', 'Labourer', 'Level 1', ['internal', 'contractor']),
    jr('jr-td', 'Truck Driver', 'Level 2', ['internal', 'contractor']),
  ];
  const rateTable: Record<string, [number, number]> = {
    'jr-pm': [110, 185], 'jr-ss': [85, 145], 'jr-hseq': [80, 140], 'jr-lh': [62, 105],
    'jr-op': [58, 98], 'jr-lab': [45, 78], 'jr-td': [52, 88],
  };

  const templates: FormTemplate[] = [];
  const versions: FormTemplateVersion[] = [];
  STARTER_TEMPLATES.forEach((t, i) => {
    const id = `tpl-${i + 1}`;
    const vid = `tplv-${i + 1}-1`;
    templates.push({
      id, name: t.name, description: t.description, category: t.category, status: 'published',
      draft_schema: structuredClone(t.schema), has_unpublished_changes: false, current_version: 1,
      current_version_id: vid, available_to_contractors: true, created_at: now, updated_at: now,
    });
    versions.push({
      id: vid, template_id: id, version: 1, name: t.name, category: t.category,
      schema: structuredClone(t.schema), change_note: 'Initial starter template', published_by: 'u-leader', published_at: now,
    });
  });

  return {
    organizations: [
      org(ORG_INTERNAL, 'Access & Site Services', 'internal', { abn: '12 345 678 901', contact_email: 'hseq@accesssite.example' }),
      org(ORG_ACME, 'Acme Earthworks Pty Ltd', 'contractor', { abn: '98 765 432 100', contact_name: 'Alice Nguyen', contact_email: 'alice@acme.example', contact_phone: '0412 555 101' }),
      org(ORG_BRAVO, 'Bravo Traffic Management', 'contractor', { contact_name: 'Ben Hughes', contact_email: 'ben@bravo.example', contact_phone: '0412 555 202' }),
    ],
    profiles: [
      person('u-leader', 'Sam Carter', 'sam.carter@accesssite.example', 'leader', ORG_INTERNAL, 'jr-pm', { phone: '0400 111 222', employee_number: 'E-1001' }),
      person('u-hseq', 'Priya Shah', 'priya.shah@accesssite.example', 'leader', ORG_INTERNAL, 'jr-hseq', { employee_number: 'E-1002' }),
      person('u-emp', 'Jordan Reid', 'jordan.reid@accesssite.example', 'employee', ORG_INTERNAL, 'jr-op', { phone: '0400 333 444', employee_number: 'E-1040', emergency_contact_name: 'Kim Reid', emergency_contact_phone: '0400 999 000' }),
      person('u-emp2', 'Mia Thompson', 'mia.thompson@accesssite.example', 'employee', ORG_INTERNAL, 'jr-lh', { employee_number: 'E-1051' }),
      person('u-acme1', 'Alice Nguyen', 'alice@acme.example', 'contractor', ORG_ACME, 'jr-ss', { phone: '0412 555 101' }),
      person('u-acme2', 'Tom Walsh', 'tom@acme.example', 'contractor', ORG_ACME, 'jr-op'),
      person('u-acme3', 'Ravi Patel', 'ravi@acme.example', 'contractor', ORG_ACME, 'jr-lab'),
      person('u-bravo1', 'Ben Hughes', 'ben@bravo.example', 'contractor', ORG_BRAVO, 'jr-ss'),
      person('u-pending', 'Casey Morgan', 'casey.morgan@gmail.example', 'employee', ORG_INTERNAL, null, { is_active: false }),
    ],
    invitations: [
      { id: 'inv-1', email: 'dan.oconnor@accesssite.example', full_name: "Dan O'Connor", role: 'employee', organization_id: ORG_INTERNAL, job_role_id: 'jr-td', status: 'pending', invited_by: 'u-leader', expires_at: day(12), created_at: now },
      { id: 'inv-2', email: 'crew@bravo.example', full_name: 'Bravo crew lead', role: 'contractor', organization_id: ORG_BRAVO, job_role_id: 'jr-lh', status: 'pending', invited_by: 'u-hseq', expires_at: day(5), created_at: now },
    ],
    jobRoles,
    rates: Object.entries(rateTable).map(([job_role_id, [cost_rate, charge_rate]]) => ({ job_role_id, cost_rate, charge_rate, currency: 'AUD' })),
    projects: [
      { id: 'p-1', code: 'GNH-24', name: 'Great Northern Hwy – Bindoon Bypass', client_name: 'State Roads Authority', site_location: 'Bindoon, WA', status: 'active', is_active: true, start_date: '2026-02-01', end_date: '2027-06-30', description: 'Earthworks, drainage and pavement for 9 km bypass.', created_at: now, organization_ids: [ORG_ACME, ORG_BRAVO] },
      { id: 'p-2', code: 'PHR-07', name: 'Pilbara Haul Road Stage 2', client_name: 'Red Ridge Mining', site_location: 'Newman, WA', status: 'active', is_active: true, start_date: '2026-05-15', end_date: null, description: null, created_at: now, organization_ids: [ORG_ACME] },
      { id: 'p-3', code: 'KWI-02', name: 'Kwinana Industrial Lot Subdivision', client_name: 'Coastal Land Development', site_location: 'Kwinana, WA', status: 'planning', is_active: true, start_date: '2027-01-10', end_date: null, description: null, created_at: now, organization_ids: [] },
      { id: 'p-4', code: 'ESP-19', name: 'Esperance Port Access Road', client_name: 'Southern Port Authority', site_location: 'Esperance, WA', status: 'completed', is_active: false, start_date: '2025-03-01', end_date: '2026-04-30', description: null, created_at: now, organization_ids: [] },
    ],
    lookupLists: [
      { key: 'event_types', name: 'Safety Event Types', description: 'Classification of safety events and incidents', visible_to_contractors: true, is_system: true },
      { key: 'severity_levels', name: 'Severity Levels', description: 'Actual / potential severity ratings', visible_to_contractors: true, is_system: true },
      { key: 'plant_categories', name: 'Plant Categories', description: 'Plant & equipment classes for pre-starts', visible_to_contractors: true, is_system: true },
      { key: 'hazard_categories', name: 'Hazard Categories', description: 'Used in risk assessments and hazard reports', visible_to_contractors: true, is_system: true },
      { key: 'ticket_types', name: 'Tickets & Licences', description: 'High-risk work licences, inductions, training', visible_to_contractors: true, is_system: true },
      { key: 'cost_codes', name: 'Cost Codes', description: 'Commercial cost codes (internal only)', visible_to_contractors: false, is_system: true },
    ],
    lookupValues: [
      ...lv('event_types', ['Near Miss', 'First Aid Injury', 'Medical Treatment Injury', 'Lost Time Injury', 'Property / Plant Damage', 'Environmental Incident', 'Hazard Report', 'Positive Observation'], ['NM', 'FAI', 'MTI', 'LTI', 'PD', 'ENV', 'HAZ', 'OBS']),
      ...lv('severity_levels', ['Low', 'Medium', 'High', 'Critical'], ['L', 'M', 'H', 'C']),
      ...lv('plant_categories', ['Excavator', 'Wheel Loader', 'Dozer', 'Grader', 'Roller / Compactor', 'Water Cart', 'Light Vehicle', 'Elevating Work Platform', 'Crane'], ['EX', 'WL', 'DZ', 'GR', 'RC', 'WC', 'LV', 'EWP', 'CR']),
      ...lv('hazard_categories', ['Working at Heights', 'Mobile Plant Interaction', 'Excavation / Trenching', 'Underground Services', 'Manual Handling', 'Heat Stress / Fatigue', 'Confined Space', 'Electrical']),
      ...lv('ticket_types', ['Construction Induction (White Card)', 'First Aid (HLTAID011)', 'Working at Heights', 'Confined Space Entry', 'HRW – Forklift (LF)', 'HRW – Boom Type EWP (WP)', 'HRW – Dogging (DG)', 'Site Induction']),
      ...lv('cost_codes', ['Labour – Direct', 'Plant – Owned', 'Plant – Hired', 'Materials', 'Subcontractors', 'Preliminaries'], ['1000', '2000', '2100', '3000', '4000', '5000']),
    ],
    templates,
    versions,
    pipelines: [
      { module: 'safety_event', statuses: [
        { key: 'draft', label: 'Draft', color: 'slate', is_terminal: false },
        { key: 'submitted', label: 'Submitted', color: 'blue', is_terminal: false },
        { key: 'under_investigation', label: 'Under Investigation', color: 'amber', is_terminal: false },
        { key: 'actions_open', label: 'Actions Open', color: 'orange', is_terminal: false },
        { key: 'closed', label: 'Closed', color: 'green', is_terminal: true },
      ] },
      { module: 'daily_field_report', statuses: [
        { key: 'draft', label: 'Draft', color: 'slate', is_terminal: false },
        { key: 'submitted', label: 'Submitted', color: 'blue', is_terminal: false },
        { key: 'approved', label: 'Approved', color: 'green', is_terminal: true },
        { key: 'rejected', label: 'Returned', color: 'red', is_terminal: false },
      ] },
      { module: 'plant_prestart', statuses: [
        { key: 'submitted', label: 'Submitted', color: 'blue', is_terminal: false },
        { key: 'defect_reported', label: 'Defect Reported', color: 'red', is_terminal: false },
        { key: 'cleared', label: 'Cleared for Use', color: 'green', is_terminal: true },
      ] },
      { module: 'audit', statuses: [
        { key: 'scheduled', label: 'Scheduled', color: 'slate', is_terminal: false },
        { key: 'in_progress', label: 'In Progress', color: 'amber', is_terminal: false },
        { key: 'submitted', label: 'Submitted', color: 'blue', is_terminal: false },
        { key: 'closed', label: 'Closed', color: 'green', is_terminal: true },
      ] },
      { module: 'risk_assessment', statuses: [
        { key: 'draft', label: 'Draft', color: 'slate', is_terminal: false },
        { key: 'submitted', label: 'Submitted', color: 'blue', is_terminal: false },
        { key: 'approved', label: 'Approved', color: 'green', is_terminal: true },
      ] },
      { module: 'timesheet', statuses: [
        { key: 'draft', label: 'Draft', color: 'slate', is_terminal: false },
        { key: 'submitted', label: 'Submitted', color: 'blue', is_terminal: false },
        { key: 'approved', label: 'Approved', color: 'green', is_terminal: true },
        { key: 'rejected', label: 'Returned', color: 'red', is_terminal: false },
      ] },
      { module: 'training', statuses: [
        { key: 'current', label: 'Current', color: 'green', is_terminal: false },
        { key: 'expiring', label: 'Expiring', color: 'amber', is_terminal: false },
        { key: 'expired', label: 'Expired', color: 'red', is_terminal: true },
      ] },
    ],
    rules: [
      { id: 'rule-1', name: 'High severity safety event alert', description: 'Escalate any High or Critical event to leaders immediately.', module: 'safety_event', trigger_event: 'field_condition', trigger_config: { field: 'severity', operator: 'in', value: 'High,Critical' }, approval_chain: [{ step: 1, role: 'leader', sla_hours: 4 }], actions: [{ type: 'in_app', recipients: ['role:leader'], message: 'High severity safety event logged' }, { type: 'email', recipients: ['role:leader'], message: 'A High/Critical safety event requires review within 4 hours.' }], is_enabled: true, priority: 10, updated_at: now },
      { id: 'rule-2', name: 'DFR submitted for approval', description: 'Daily Field Reports need leader approval once submitted.', module: 'daily_field_report', trigger_event: 'status_changed', trigger_config: { to_status: 'submitted' }, approval_chain: [{ step: 1, role: 'leader', sla_hours: 24 }], actions: [{ type: 'in_app', recipients: ['role:leader'], message: 'A Daily Field Report is awaiting approval' }], is_enabled: true, priority: 50, updated_at: now },
      { id: 'rule-3', name: 'Plant defect reported', description: 'Notify leaders when a pre-start records a defect.', module: 'plant_prestart', trigger_event: 'status_changed', trigger_config: { to_status: 'defect_reported' }, approval_chain: [], actions: [{ type: 'in_app', recipients: ['role:leader'], message: 'Plant defect reported on pre-start — tag out until cleared' }, { type: 'email', recipients: ['role:leader'] }], is_enabled: true, priority: 20, updated_at: now },
      { id: 'rule-5', name: 'Timesheet submitted for approval', description: 'Leaders approve submitted timesheets before payroll.', module: 'timesheet', trigger_event: 'status_changed', trigger_config: { to_status: 'submitted' }, approval_chain: [{ step: 1, role: 'leader', sla_hours: 48 }], actions: [{ type: 'in_app', recipients: ['role:leader'], message: 'A timesheet is awaiting approval' }], is_enabled: true, priority: 50, updated_at: now },
      { id: 'rule-4', name: 'Ticket expiring in 30 days', description: 'Remind the worker (and leaders) before a licence or ticket expires.', module: 'training', trigger_event: 'ticket_expiring', trigger_config: { days_before: 30 }, approval_chain: [], actions: [{ type: 'in_app', recipients: ['submitter', 'role:leader'], message: 'A ticket or licence expires within 30 days' }], is_enabled: false, priority: 100, updated_at: now },
    ],
    tickets: [
      { id: 't-1', profile_id: 'u-emp', organization_id: ORG_INTERNAL, ticket_type: 'Construction Induction (White Card)', ticket_number: 'WC-448812', issuer: 'WorkSafe WA', issued_on: '2019-03-04', expires_on: null, verified_at: now, created_at: now },
      { id: 't-2', profile_id: 'u-emp', organization_id: ORG_INTERNAL, ticket_type: 'First Aid (HLTAID011)', ticket_number: 'FA-90211', issuer: 'St John WA', issued_on: '2023-12-01', expires_on: day(18), verified_at: null, created_at: now },
      { id: 't-3', profile_id: 'u-emp', organization_id: ORG_INTERNAL, ticket_type: 'HRW – Forklift (LF)', ticket_number: 'LF0049921', issuer: 'WorkSafe WA', issued_on: '2022-06-10', expires_on: '2027-06-10', verified_at: now, created_at: now },
      { id: 't-4', profile_id: 'u-acme2', organization_id: ORG_ACME, ticket_type: 'Construction Induction (White Card)', ticket_number: 'WC-11002', issuer: 'WorkSafe WA', issued_on: '2020-01-01', expires_on: null, verified_at: null, created_at: now },
      { id: 't-5', profile_id: 'u-acme3', organization_id: ORG_ACME, ticket_type: 'Working at Heights', ticket_number: 'WAH-5521', issuer: 'Safety Training WA', issued_on: '2024-02-01', expires_on: day(-3), verified_at: null, created_at: now },
      { id: 't-6', profile_id: 'u-acme1', organization_id: ORG_ACME, ticket_type: 'First Aid (HLTAID011)', ticket_number: 'FA-12001', issuer: 'St John WA', issued_on: '2025-01-01', expires_on: day(400), verified_at: now, created_at: now },
      { id: 't-7', profile_id: 'u-bravo1', organization_id: ORG_BRAVO, ticket_type: 'Site Induction', ticket_number: null, issuer: 'Access & Site Services', issued_on: '2026-02-02', expires_on: day(25), verified_at: null, created_at: now },
    ],
    notifications: [
      { id: 'n-1', user_id: 'u-leader', title: 'Invitation pending', body: "Dan O'Connor hasn't accepted their invitation yet.", link: '/admin/users', read_at: null, created_at: now },
      { id: 'n-2', user_id: 'u-emp', title: 'Ticket expiring soon', body: 'Your First Aid (HLTAID011) expires in 18 days.', link: '/training', read_at: null, created_at: now },
      { id: 'n-3', user_id: 'u-acme1', title: 'Crew ticket expired', body: 'Ravi Patel – Working at Heights has expired.', link: '/crew', read_at: null, created_at: now },
    ],
    records: [],
    approvals: [],
    events: [],
    counters: {},
    settings: { company_name: 'Access & Site Services', primary_color: '#2047c6', accent_color: '#f5b81a', dark_color: '#13213f', logo_url: null },
  };
}
