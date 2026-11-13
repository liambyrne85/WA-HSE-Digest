import type {
  AppRole, BadgeColor, ProjectStatus, QuestionType, TemplateCategory, TemplateStatus,
  WorkflowModule, WorkflowTrigger,
} from './types';

export const ROLE_LABEL: Record<AppRole, string> = {
  leader: 'Leader',
  employee: 'Employee',
  contractor: 'Contractor',
};
export const ROLE_COLOR: Record<AppRole, BadgeColor> = {
  leader: 'purple',
  employee: 'blue',
  contractor: 'amber',
};
export const ROLE_DESCRIPTION: Record<AppRole, string> = {
  leader: 'Full access, approvals, templates & workflow admin',
  employee: 'Internal field worker — own records, profile & training',
  contractor: 'Scoped to their own company — crew, DFRs, pre-starts',
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
};

export const MODULE_LABEL: Record<WorkflowModule, string> = {
  safety_event: 'Safety Events',
  daily_field_report: 'Daily Field Reports',
  plant_prestart: 'Plant Pre-Starts',
  audit: 'Audits & Inspections',
  risk_assessment: 'Risk Assessments',
  timesheet: 'Timesheets / Hours',
  training: 'Training & Tickets',
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
export const MODULE_FIELDS: Record<WorkflowModule, { key: string; label: string; lookup?: string }[]> = {
  safety_event: [
    { key: 'severity', label: 'Severity', lookup: 'severity_levels' },
    { key: 'event_type', label: 'Event Type', lookup: 'event_types' },
    { key: 'project_id', label: 'Project' },
  ],
  daily_field_report: [
    { key: 'total_hours', label: 'Total hours' },
    { key: 'cost_code', label: 'Cost code', lookup: 'cost_codes' },
  ],
  plant_prestart: [
    { key: 'plant_category', label: 'Plant category', lookup: 'plant_categories' },
    { key: 'critical_failures', label: 'Critical failures (count)' },
  ],
  audit: [{ key: 'score', label: 'Score %' }, { key: 'critical_failures', label: 'Critical failures (count)' }],
  risk_assessment: [{ key: 'residual_risk', label: 'Residual risk score' }, { key: 'hazard_category', label: 'Hazard category', lookup: 'hazard_categories' }],
  timesheet: [{ key: 'total_hours', label: 'Total hours' }],
  training: [{ key: 'ticket_type', label: 'Ticket type', lookup: 'ticket_types' }],
};

export function formatDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function daysUntil(d: string | null | undefined) {
  if (!d) return null;
  const t = new Date(d);
  t.setHours(0, 0, 0, 0);
  const n = new Date();
  n.setHours(0, 0, 0, 0);
  return Math.round((t.getTime() - n.getTime()) / 864e5);
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
