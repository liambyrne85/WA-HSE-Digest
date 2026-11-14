// Domain types mirroring supabase/migrations/*.sql

export type AppRole = 'admin' | 'hset' | 'project_manager' | 'supervisor' | 'worker';
export type OrgType = 'internal' | 'contractor';
export type ProjectStatus = 'planning' | 'active' | 'on_hold' | 'completed' | 'closed';
export type TemplateCategory =
  | 'audit' | 'plant_prestart' | 'risk_assessment' | 'safety_event'
  | 'daily_field_report' | 'timesheet' | 'training' | 'field_leadership';
export type TemplateStatus = 'draft' | 'published' | 'archived';
export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';
export type WorkflowModule =
  | 'safety_event' | 'daily_field_report' | 'plant_prestart' | 'audit'
  | 'risk_assessment' | 'timesheet' | 'training' | 'field_leadership';
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
  avatar_path?: string | null;
  start_date: string | null;
  is_scaffold_inspector: boolean;
  is_active: boolean;
  last_seen_at?: string | null;
  created_at: string;
}

export interface ProjectMember {
  id: string;
  project_id: string;
  profile_id: string;
  is_primary: boolean;
  start_date: string;
  end_date: string | null;
  created_at: string;
}

export interface AuditEntry {
  id: number;
  table_name: string;
  record_id: string;
  action: 'insert' | 'update' | 'delete';
  changed_by: string | null;
  changed_at: string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
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
  /** periodic scaffold inspection interval in days (default 30) */
  scaffold_inspection_days?: number;
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
  /** e.g. { classes: ['Basic', 'Intermediate', 'Advanced'] } for licence types */
  metadata?: Record<string, unknown>;
}

// ---- Dynamic forms --------------------------------------------------------
export type QuestionType =
  | 'pass_fail_na' | 'yes_no' | 'text' | 'number' | 'dropdown' | 'photo' | 'signature' | 'table' | 'date' | 'datetime';

export interface TableColumn {
  id: string;
  label: string;
  type: 'text' | 'number';
}

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
  /** table: the columns each row has */
  columns?: TableColumn[];
  /** expose the answer to workflow rules under this name (e.g. severity, total_hours) */
  fieldKey?: string;
}

export interface Section {
  id: string;
  title: string;
  description?: string;
  questions: Question[];
}

export interface TemplateSchema {
  settings?: {
    requireProject?: boolean;
    requireSignOff?: boolean;
    /** status to use when a critical item fails on submit (e.g. defect_reported) */
    criticalFailStatus?: string;
    /** pre-starts: the record must be linked to a vehicle from the register */
    requireVehicle?: boolean;
  };
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
  /** a preset name or a custom #rrggbb colour */
  color: BadgeColor | string;
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
  licence_class?: string | null;
  file_path?: string | null;
  verified_at: string | null;
  archived_at?: string | null;
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

// ---- Records (field modules) ---------------------------------------------
export interface RecordRow {
  id: string;
  template_version_id: string;
  module: WorkflowModule;
  reference: string | null;
  title: string | null;
  project_id: string | null;
  organization_id: string | null;
  submitted_by: string;
  status: string;
  answers: Record<string, unknown>;
  summary: Record<string, unknown>;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
  last_status_change_at: string;
  /** the day the record is about (incident date, pre-start day …), YYYY-MM-DD */
  record_date: string | null;
  vehicle_id: string | null;
  archived_at?: string | null;
}

export interface Vehicle {
  id: string;
  fleet_number: string;
  rego: string | null;
  vehicle_type: string | null;
  project_id: string | null;
  operator_id: string | null;
  is_active: boolean;
  daily_prestart_required: boolean;
  status: 'in_service' | 'out_of_service';
  out_of_service_reason: string | null;
  out_of_service_at: string | null;
  out_of_service_record_id: string | null;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
}

export type InvestigationStatus = 'open' | 'in_progress' | 'review' | 'closed';
export interface Investigation {
  id: string;
  reference: string | null;
  incident_id: string;
  project_id: string | null;
  organization_id: string | null;
  lead_id: string | null;
  status: InvestigationStatus;
  due_date: string | null;
  findings: string | null;
  root_cause: string | null;
  corrective_actions: string | null;
  opened_at: string;
  closed_at: string | null;
  created_at: string;
}

export interface LeadershipTarget {
  profile_id: string;
  period: 'week' | 'month';
  target: number;
}

export interface RecordApproval {
  id: string;
  submission_id: string;
  rule_id: string | null;
  step: number;
  approver_role: AppRole;
  job_role_id: string | null;
  status: 'waiting' | 'pending' | 'approved' | 'rejected' | 'cancelled';
  due_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  comment: string | null;
  created_at: string;
}

export interface RecordEvent {
  id: string;
  submission_id: string;
  kind: 'created' | 'status' | 'approval_requested' | 'approval' | 'comment';
  from_status: string | null;
  to_status: string | null;
  body: string | null;
  actor: string | null;
  created_at: string;
}

export interface DirectoryEntry {
  id: string;
  full_name: string;
  role: AppRole;
  organization_id: string;
}

export interface AppSettings {
  company_name: string;
  primary_color: string;
  accent_color: string;
  dark_color: string;
  logo_url: string | null;
  /** minimum scaffolding licence class to sign off an inspection */
  scaffold_min_licence?: LicenceClass;
}

// ---- Scaffolds (Stage 3) -----------------------------------------------------
export type LicenceClass = 'Basic' | 'Intermediate' | 'Advanced';
export type ScaffoldStatus = 'safe' | 'restricted' | 'unsafe' | 'dismantled';
export type ScaffoldType = 'independent' | 'mobile' | 'hung' | 'cantilever' | 'birdcage' | 'other';
export type DutyClass = 'light' | 'medium' | 'heavy' | 'special';
export type InspectionType = 'handover' | 'periodic' | 'alteration' | 'incident_weather' | 'pre_dismantle';
export type InspectionOutcome = 'safe' | 'restricted' | 'unsafe';
export type ItemResult = 'pass' | 'fail' | 'na';

export interface Scaffold {
  id: string;
  scaffold_number: string | null;
  project_id: string;
  location: string;
  latitude: number | null;
  longitude: number | null;
  scaffold_type: ScaffoldType;
  scaffold_type_other: string | null;
  duty_class: DutyClass;
  max_load_kg: number | null;
  height_m: number | null;
  lifts: number | null;
  bays: number | null;
  erected_by_id: string | null;
  erected_by_name: string | null;
  erected_on: string | null;
  photos: string[];
  status: ScaffoldStatus;
  restriction: string | null;
  status_reason: string | null;
  last_inspection_id: string | null;
  last_inspected_at: string | null;
  next_inspection_due: string | null;
  dismantled_on: string | null;
  qr_token: string;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
}

export interface ChecklistItem { id: string; label: string; help?: string }
export interface ChecklistSection { id: string; title: string; items: ChecklistItem[] }
export interface ScaffoldChecklist {
  id: string;
  version: number;
  sections: ChecklistSection[];
  change_note: string | null;
  created_at: string;
}

export interface InspectionItemAnswer {
  result?: ItemResult;
  comment?: string;
  photos?: string[];
  /** for a failed item: who fixes it and by when */
  defect_owner_id?: string;
  defect_due?: string;
}

export interface ScaffoldInspection {
  id: string;
  reference: string | null;
  scaffold_id: string;
  project_id: string | null;
  inspection_type: InspectionType;
  checklist_id: string;
  items: Record<string, InspectionItemAnswer>;
  photos: string[];
  outcome: InspectionOutcome;
  restriction: string | null;
  notes: string | null;
  inspector_id: string;
  inspector_name: string | null;
  inspector_licence_class: string | null;
  signature: string;
  signed_at: string;
  latitude: number | null;
  longitude: number | null;
  gps_accuracy_m: number | null;
  failed_count: number;
  next_due: string | null;
  created_at: string;
}

export type ScaffoldInspectionInput = Pick<ScaffoldInspection, 'id' | 'scaffold_id' | 'inspection_type' | 'checklist_id' | 'items' | 'photos'
  | 'outcome' | 'restriction' | 'notes' | 'signature' | 'signed_at' | 'latitude' | 'longitude' | 'gps_accuracy_m'>;

export interface ScaffoldDefect {
  id: string;
  reference: string | null;
  scaffold_id: string;
  inspection_id: string;
  project_id: string | null;
  item_id: string;
  item_label: string | null;
  section_title: string | null;
  description: string | null;
  photos: string[];
  owner_id: string | null;
  due_date: string | null;
  status: 'open' | 'closed';
  close_photos: string[];
  close_comment: string | null;
  closed_by: string | null;
  closed_at: string | null;
  created_at: string;
}
