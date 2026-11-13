// Domain types mirroring supabase/migrations/*.sql

export type AppRole = 'leader' | 'employee' | 'contractor';
export type OrgType = 'internal' | 'contractor';
export type ProjectStatus = 'planning' | 'active' | 'on_hold' | 'completed' | 'closed';
export type TemplateCategory = 'audit' | 'plant_prestart' | 'risk_assessment' | 'safety_event';
export type TemplateStatus = 'draft' | 'published' | 'archived';
export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';
export type WorkflowModule =
  | 'safety_event' | 'daily_field_report' | 'plant_prestart' | 'audit'
  | 'risk_assessment' | 'timesheet' | 'training';
export type WorkflowTrigger =
  | 'record_created' | 'status_changed' | 'field_condition' | 'record_overdue' | 'ticket_expiring';

export interface Organization {
  id: string;
  name: string;
  type: OrgType;
  abn: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
}

export interface JobRole {
  id: string;
  name: string;
  classification: string | null;
  description: string | null;
  applies_to: OrgType[];
  is_active: boolean;
}

export interface JobRoleRate {
  job_role_id: string;
  cost_rate: number | null;
  charge_rate: number | null;
  currency: string;
}

export interface Profile {
  id: string;
  organization_id: string;
  role: AppRole;
  email: string;
  full_name: string;
  phone: string | null;
  job_role_id: string | null;
  employee_number: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Invitation {
  id: string;
  email: string;
  full_name: string | null;
  role: AppRole;
  organization_id: string;
  job_role_id: string | null;
  status: InvitationStatus;
  invited_by: string | null;
  expires_at: string;
  created_at: string;
}

export interface Project {
  id: string;
  code: string | null;
  name: string;
  client_name: string | null;
  site_location: string | null;
  status: ProjectStatus;
  is_active: boolean;
  start_date: string | null;
  end_date: string | null;
  description: string | null;
  created_at: string;
  /** contractor organisations engaged on this project */
  organization_ids?: string[];
}

export interface LookupList {
  key: string;
  name: string;
  description: string | null;
  visible_to_contractors: boolean;
  is_system: boolean;
}

export interface LookupValue {
  id: string;
  list_key: string;
  label: string;
  code: string | null;
  sort_order: number;
  is_active: boolean;
}

// ---- Dynamic forms --------------------------------------------------------
export type QuestionType =
  | 'pass_fail_na' | 'yes_no' | 'text' | 'number' | 'dropdown' | 'photo' | 'signature';

export interface Question {
  id: string;
  label: string;
  type: QuestionType;
  required: boolean;
  helpText?: string;
  /** dropdown */
  options?: string[];
  /** dropdown: pull options from a lookup list instead */
  lookupKey?: string;
  /** number */
  unit?: string;
  min?: number;
  max?: number;
  /** text */
  multiline?: boolean;
  /** pass_fail_na / yes_no: require a photo when answer is Fail / No */
  photoOnFail?: boolean;
  /** a Fail on this question is a critical defect (feeds workflow rules) */
  critical?: boolean;
}

export interface Section {
  id: string;
  title: string;
  description?: string;
  questions: Question[];
}

export interface TemplateSchema {
  settings?: { requireProject?: boolean; requireSignOff?: boolean };
  sections: Section[];
}

export interface FormTemplate {
  id: string;
  name: string;
  description: string | null;
  category: TemplateCategory;
  status: TemplateStatus;
  draft_schema: TemplateSchema;
  has_unpublished_changes: boolean;
  current_version: number;
  current_version_id: string | null;
  available_to_contractors: boolean;
  updated_at: string;
  created_at: string;
}

export interface FormTemplateVersion {
  id: string;
  template_id: string;
  version: number;
  name: string;
  category: TemplateCategory;
  schema: TemplateSchema;
  change_note: string | null;
  published_by: string | null;
  published_at: string;
}

// ---- Workflow -------------------------------------------------------------
export interface PipelineStatus {
  key: string;
  label: string;
  color: BadgeColor;
  is_terminal: boolean;
}

export interface WorkflowPipeline {
  module: WorkflowModule;
  statuses: PipelineStatus[];
  updated_at?: string;
}

export interface ApprovalStep {
  step: number;
  role: AppRole;
  job_role_id?: string | null;
  sla_hours?: number | null;
}

export type ActionType = 'in_app' | 'email' | 'sms';
export interface RuleAction {
  type: ActionType;
  /** "role:leader" | "submitter" | "email:someone@x.com" | "user:<uuid>" */
  recipients: string[];
  message?: string;
}

export interface TriggerConfig {
  to_status?: string;
  from_status?: string;
  field?: string;
  operator?: 'eq' | 'neq' | 'in' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte';
  value?: string;
  after_hours?: number;
  status?: string;
  days_before?: number;
}

export interface WorkflowRule {
  id: string;
  name: string;
  description: string | null;
  module: WorkflowModule;
  trigger_event: WorkflowTrigger;
  trigger_config: TriggerConfig;
  approval_chain: ApprovalStep[];
  actions: RuleAction[];
  is_enabled: boolean;
  priority: number;
  updated_at: string;
}

// ---- Tickets --------------------------------------------------------------
export interface WorkerTicket {
  id: string;
  profile_id: string;
  organization_id: string;
  ticket_type: string;
  ticket_number: string | null;
  issuer: string | null;
  issued_on: string | null;
  expires_on: string | null;
  verified_at: string | null;
  created_at: string;
}

export type BadgeColor = 'slate' | 'blue' | 'amber' | 'orange' | 'green' | 'red' | 'purple';

export interface Notification {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}
