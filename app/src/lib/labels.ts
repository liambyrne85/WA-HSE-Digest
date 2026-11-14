import type {
  AppRole, BadgeColor, ProjectStatus, QuestionType, TemplateCategory, TemplateStatus,
  WorkflowModule, WorkflowTrigger,
} from './types';

export const ROLES: AppRole[] = ['admin', 'hset', 'project_manager', 'supervisor', 'worker'];
export const ROLE_LABEL: Record<AppRole, string> = {
  admin: 'Admin',
  hset: 'HSET',
  project_manager: 'Project Manager',
  supervisor: 'Supervisor',
  worker: 'Worker',
};
export const ROLE_COLOR: Record<AppRole, BadgeColor> = {
  admin: 'purple',
  hset: 'red',
  project_manager: 'blue',
  supervisor: 'green',
  worker: 'slate',
};
export const ROLE_DESCRIPTION: Record<AppRole, string> = {
  admin: 'Sees everything. Manages people, projects, settings and forms.',
  hset: 'Sees everything. Manages safety forms, workflow and lists.',
  project_manager: 'Sees the people and records on their assigned projects.',
  supervisor: 'Sees the people and records on their assigned projects.',
  worker: 'Sees their own submissions and their primary project.',
};

export const PROJECT_STATUS: Record<ProjectStatus, { label: string; color: BadgeColor }> = {
  planning: { label: 'Planning', color: 'slate' },
  active: { label: 'Active', color: 'green' },
  on_hold: { label: 'On Hold', color: 'amber' },
  completed: { label: 'Completed', color: 'blue' },
  closed: { label: 'Closed', color: 'slate' },
};

export const TEMPLATE_CATEGORY: Record<TemplateCategory, { label: string; color: BadgeColor }> = {
  audit: { label: 'Audit', color: 'blue' },
  plant_prestart: { label: 'Plant Pre-Start', color: 'orange' },
  risk_assessment: { label: 'Risk Assessment', color: 'purple' },
  safety_event: { label: 'Safety Event', color: 'red' },
  daily_field_report: { label: 'Daily Field Report', color: 'blue' },
  timesheet: { label: 'Timesheet', color: 'green' },
  training: { label: 'Training Record', color: 'slate' },
  field_leadership: { label: 'Field Leadership', color: 'purple' },
};

export const TEMPLATE_STATUS: Record<TemplateStatus, { label: string; color: BadgeColor }> = {
  draft: { label: 'Draft', color: 'slate' },
  published: { label: 'Published', color: 'green' },
  archived: { label: 'Archived', color: 'slate' },
};

export const QUESTION_TYPE: Record<QuestionType, { label: string; hint: string }> = {
  pass_fail_na: { label: 'Pass / Fail / N/A', hint: 'Inspection item' },
  yes_no: { label: 'Yes / No', hint: 'Simple confirmation' },
  text: { label: 'Text', hint: 'Free-text answer' },
  number: { label: 'Number', hint: 'Readings, quantities, scores' },
  dropdown: { label: 'Dropdown', hint: 'Pick one from a list' },
  photo: { label: 'Photo Upload', hint: 'Camera / photo required' },
  signature: { label: 'Digital Signature', hint: 'Sign on screen' },
  table: { label: 'Table (rows)', hint: 'Crew, plant, hours' },
  date: { label: 'Date', hint: 'Pick a day' },
  datetime: { label: 'Date & time', hint: 'Day and time' },
};

export const MODULE_LABEL: Record<WorkflowModule, string> = {
  safety_event: 'Safety Events',
  daily_field_report: 'Daily Field Reports',
  plant_prestart: 'Plant Pre-Starts',
  audit: 'Audits & Inspections',
  risk_assessment: 'Risk Assessments',
  timesheet: 'Timesheets / Hours',
  training: 'Training & Tickets',
  field_leadership: 'Field Leadership',
};

export const TRIGGER_LABEL: Record<WorkflowTrigger, string> = {
  record_created: 'Record is created',
  status_changed: 'Status changes',
  field_condition: 'Field matches a condition',
  record_overdue: 'Record is overdue',
  ticket_expiring: 'Ticket / licence expiring',
};

export const OPERATOR_LABEL = {
  eq: 'equals',
  neq: 'does not equal',
  in: 'is one of',
  contains: 'contains',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
} as const;

/** Fields each module exposes for rule conditions (Phase 2 modules will extend). */
/**
 * Named fields each module exposes to rule conditions. A dropdown linked to a
 * lookup list fills its field automatically (severity_levels -> severity); any
 * question can also be given a field name in the template builder. Rules can
 * additionally test any individual form question.
 */
export const MODULE_FIELDS: Record<WorkflowModule, { key: string; label: string; lookup?: string }[]> = {
  safety_event: [
    { key: 'severity', label: 'Severity', lookup: 'severity_levels' },
    { key: 'event_type', label: 'Event Type', lookup: 'event_types' },
    { key: 'critical_failures', label: 'Critical items failed (count)' },
  ],
  daily_field_report: [
    { key: 'total_hours', label: 'Total crew hours' },
    { key: 'cost_code', label: 'Cost code', lookup: 'cost_codes' },
    { key: 'critical_failures', label: 'Critical items failed (count)' },
  ],
  plant_prestart: [
    { key: 'plant_category', label: 'Plant category', lookup: 'plant_categories' },
    { key: 'critical_failures', label: 'Critical items failed (count)' },
  ],
  audit: [{ key: 'score', label: 'Score %' }, { key: 'critical_failures', label: 'Critical items failed (count)' }],
  risk_assessment: [
    { key: 'residual_risk', label: 'Residual risk score' },
    { key: 'hazard_category', label: 'Hazard category', lookup: 'hazard_categories' },
    { key: 'critical_failures', label: 'Critical items failed (count)' },
  ],
  timesheet: [{ key: 'total_hours', label: 'Total hours' }, { key: 'cost_code', label: 'Cost code', lookup: 'cost_codes' }],
  training: [{ key: 'ticket_type', label: 'Ticket type', lookup: 'ticket_types' }],
  field_leadership: [{ key: 'activity_type', label: 'Activity type', lookup: 'leadership_activities' }],
};

/** Incident categories for the dashboard; each event type maps to one (lookup metadata.category). */
export const INCIDENT_CATEGORY: Record<string, { label: string; color: BadgeColor }> = {
  injury: { label: 'Injury', color: 'red' },
  near_miss: { label: 'Near miss', color: 'amber' },
  property_damage: { label: 'Property damage', color: 'orange' },
  vehicle_plant: { label: 'Vehicle / plant', color: 'blue' },
  environmental: { label: 'Environmental', color: 'green' },
};

export const INVESTIGATION_STATUS: Record<string, { label: string; color: BadgeColor }> = {
  open: { label: 'Open', color: 'red' },
  in_progress: { label: 'In progress', color: 'amber' },
  review: { label: 'In review', color: 'blue' },
  closed: { label: 'Closed', color: 'green' },
};

export const LOOKUP_FIELD: Record<string, string> = {
  event_types: 'event_type', severity_levels: 'severity', plant_categories: 'plant_category',
  hazard_categories: 'hazard_category', cost_codes: 'cost_code', ticket_types: 'ticket_type',
};

/** Field-module routes. Template category == module. */
export const MODULE_ROUTE: Partial<Record<WorkflowModule, string>> = {
  safety_event: '/safety',
  daily_field_report: '/dfr',
  timesheet: '/timesheets',
  plant_prestart: '/prestart',
  risk_assessment: '/risk',
  audit: '/audits',
  field_leadership: '/leadership',
};

// ---- Dates: DD/MM/YYYY, Australia/Perth, weeks Monday–Sunday ---------------
export const TZ = 'Australia/Perth';
const isDateOnly = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

/** Today's date in Perth as YYYY-MM-DD. */
export function perthToday(at: Date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** Add days to a YYYY-MM-DD date. */
export function addDays(ymd: string, n: number) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d! + n));
  return t.toISOString().slice(0, 10);
}

/** Monday of the week containing ymd (Perth calendar). */
export function weekStart(ymd: string = perthToday()) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay(); // 0 = Sunday
  return addDays(ymd, dow === 0 ? -6 : 1 - dow);
}

/** DD/MM/YYYY. Accepts a YYYY-MM-DD date or a timestamp (shown in Perth time). */
export function formatDate(d: string | null | undefined) {
  if (!d) return '—';
  if (isDateOnly(d)) {
    const [y, m, day] = d.split('-');
    return `${day}/${m}/${y}`;
  }
  return new Intl.DateTimeFormat('en-AU', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(d));
}

/** DD/MM/YYYY HH:mm (24-hour, Perth time). */
export function formatDateTime(d: string | null | undefined) {
  if (!d) return '—';
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(d));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
}

/** Current Perth wall-clock time as YYYY-MM-DDTHH:mm (the value of a datetime-local input). */
export function perthNowLocal(at: Date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** A form answer: YYYY-MM-DD → DD/MM/YYYY, YYYY-MM-DDTHH:mm (Perth wall clock) → DD/MM/YYYY HH:mm. */
export function formatAnswerDate(v: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(v);
  if (!m) return v;
  return `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ''}`;
}

/** Whole days from today (Perth) to a date; negative = in the past. */
export function daysUntil(d: string | null | undefined) {
  if (!d) return null;
  const target = isDateOnly(d) ? d : perthToday(new Date(d));
  const a = Date.parse(`${target}T00:00:00Z`);
  const b = Date.parse(`${perthToday()}T00:00:00Z`);
  return Math.round((a - b) / 864e5);
}

export function ticketState(expires: string | null): { label: string; color: BadgeColor } {
  const d = daysUntil(expires);
  if (d === null) return { label: 'No expiry', color: 'slate' };
  if (d < 0) return { label: 'Expired', color: 'red' };
  if (d <= 30) return { label: `Expires in ${d}d`, color: 'amber' };
  return { label: 'Current', color: 'green' };
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join('') || '?';
}
