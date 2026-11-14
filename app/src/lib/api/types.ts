import type {
  AppRole, AppSettings, AuditEntry, Investigation, LeadershipTarget, Vehicle, DirectoryEntry, FormTemplate, ProjectMember, FormTemplateVersion, Invitation, JobRole, JobRoleRate, LookupList,
  LookupValue, Notification, Organization, Profile, Project, TemplateCategory, WorkerTicket,
  Action, ActionInput, ActionCloseInput, ActionStatus,
  Scaffold, ScaffoldChecklist, ChecklistSection, ScaffoldDefect, ScaffoldInspection, ScaffoldInspectionInput, LicenceClass,
  WorkflowModule, WorkflowPipeline, WorkflowRule, WorkflowTrigger, RecordApproval, RecordEvent, RecordRow,
} from '../types';

export interface RecordInput {
  /** generate client-side so photo uploads can be filed under the record before it is saved */
  id: string;
  template_version_id: string;
  project_id: string | null;
  vehicle_id?: string | null;
  answers: Record<string, unknown>;
  /** 'draft' or 'submitted' (the server picks the real submitted status); leaders editing an
   *  in-progress record pass its current status to keep it unchanged */
  status: string;
  isNew: boolean;
}

export interface RecordDetail {
  record: RecordRow;
  version: FormTemplateVersion;
  approvals: RecordApproval[];
  events: RecordEvent[];
}

export interface Session {
  userId: string;
  email: string;
  /** Set when an admin created the account with a temporary password. */
  mustChangePassword?: boolean;
  /** Signed in from a "set your password" / reset email link. */
  recovery?: boolean;
}

/** Everything an admin enters when adding a person (also one CSV row). */
export interface PersonInput {
  email: string;
  full_name: string;
  role: AppRole;
  organization_id: string;
  job_role_id?: string | null;
  phone?: string | null;
  employee_number?: string | null;
  /** YYYY-MM-DD */
  start_date?: string | null;
  primary_project_id?: string | null;
  is_scaffold_inspector?: boolean;
  /** create the login now with this password instead of emailing a set-password link */
  temp_password?: string | null;
}

export interface ImportResult {
  row: number;
  email: string;
  ok: boolean;
  error?: string;
  profile_id?: string;
  invited?: boolean;
}

export interface DemoAccount {
  id: string;
  label: string;
  role: AppRole;
  description: string;
}

/**
 * Backend contract. Implemented by Supabase (production) and a localStorage
 * demo backend that mirrors the RLS rules so the UI can be tried without a DB.
 * Authorisation is ALWAYS enforced by Postgres RLS in production — the demo
 * backend only imitates it.
 */
export interface Api {
  mode: 'supabase' | 'demo';

  // auth
  getSession(): Promise<Session | null>;
  onAuthChange(cb: (s: Session | null) => void): () => void;
  signInWithPassword(email: string, password: string): Promise<void>;
  signInWithMagicLink(email: string): Promise<void>;
  sendPasswordReset(email: string): Promise<void>;
  /** Self sign-up. The very first account becomes the Leader; later ones wait for activation unless invited. */
  signUp(email: string, password: string, fullName: string): Promise<{ needsConfirmation: boolean }>;
  updatePassword(password: string): Promise<void>;
  signOut(): Promise<void>;
  demoAccounts?(): DemoAccount[];
  demoSignIn?(userId: string): Promise<void>;
  demoReset?(): void;

  // profiles & orgs
  getMyProfile(): Promise<Profile | null>;
  listProfiles(): Promise<Profile[]>;
  updateProfile(id: string, patch: Partial<Profile>): Promise<Profile>;
  listOrganizations(): Promise<Organization[]>;
  saveOrganization(org: Partial<Organization>): Promise<Organization>;

  // invitations
  listInvitations(): Promise<Invitation[]>;
  /** Admin: create a person (login + profile). Emails a set-password link unless a temporary password is given. */
  createPerson(input: PersonInput, sendInvite: boolean): Promise<{ profile_id: string; invited: boolean }>;
  importPeople(rows: PersonInput[], sendInvites: boolean): Promise<ImportResult[]>;
  /** Admin: (re)send the "set your password" email. */
  sendInvite(profileId: string): Promise<void>;
  /** Admin: deactivate / reactivate (never delete). Also blocks sign-in. */
  setPersonActive(profileId: string, active: boolean): Promise<void>;
  touchLastSeen(): Promise<void>;
  listProjectMembers(filter?: { profileId?: string; projectId?: string }): Promise<ProjectMember[]>;
  /** Admin: add an assignment, change primary, or end it (end_date). */
  saveProjectMember(m: Partial<ProjectMember> & { project_id?: string; profile_id?: string }): Promise<ProjectMember>;
  listAudit(table: string, recordId: string): Promise<AuditEntry[]>;
  /** Upload a person's photo or licence scan; returns a storage reference. */
  uploadPersonFile(profileId: string, file: Blob, kind: 'photo' | 'licence'): Promise<string>;

  // job roles & commercial rates
  listJobRoles(): Promise<JobRole[]>;
  saveJobRole(role: Partial<JobRole>): Promise<JobRole>;
  listJobRoleRates(): Promise<JobRoleRate[]>;
  saveJobRoleRate(rate: JobRoleRate): Promise<void>;

  // projects
  listProjects(): Promise<Project[]>;
  saveProject(p: Partial<Project>): Promise<Project>;

  // lookups
  listLookupLists(): Promise<LookupList[]>;
  saveLookupList(l: Partial<LookupList>): Promise<LookupList>;
  listLookupValues(listKey?: string): Promise<LookupValue[]>;
  saveLookupValue(v: Partial<LookupValue>): Promise<LookupValue>;
  deleteLookupValue?(id: string): Promise<void>;

  // templates
  listTemplates(): Promise<FormTemplate[]>;
  getTemplate(id: string): Promise<FormTemplate | null>;
  createTemplate(input: { name: string; category: TemplateCategory; description?: string }): Promise<FormTemplate>;
  saveTemplateDraft(id: string, patch: Partial<FormTemplate>): Promise<FormTemplate>;
  publishTemplate(id: string, changeNote?: string): Promise<FormTemplateVersion>;
  listTemplateVersions(templateId: string): Promise<FormTemplateVersion[]>;
  duplicateTemplate(id: string): Promise<FormTemplate>;

  // workflow
  listPipelines(): Promise<WorkflowPipeline[]>;
  savePipeline(p: WorkflowPipeline): Promise<void>;
  listRules(): Promise<WorkflowRule[]>;
  saveRule(r: Partial<WorkflowRule>): Promise<WorkflowRule>;
  /** archive (never delete) */
  archiveRule(id: string): Promise<void>;
  testRules(module: WorkflowModule, event: WorkflowTrigger, record: Record<string, unknown>, old?: Record<string, unknown>): Promise<WorkflowRule[]>;

  // tickets
  listTickets(): Promise<WorkerTicket[]>;
  saveTicket(t: Partial<WorkerTicket>): Promise<WorkerTicket>;
  /** archive (never delete) */
  archiveTicket(id: string): Promise<void>;

  // records (field modules)
  /** range filters on record_date (YYYY-MM-DD, inclusive) */
  listRecords(module?: WorkflowModule, range?: { from?: string; to?: string }): Promise<RecordRow[]>;

  // vehicles, investigations, field leadership targets
  listVehicles(): Promise<Vehicle[]>;
  saveVehicle(v: Partial<Vehicle>): Promise<Vehicle>;
  listInvestigations(): Promise<Investigation[]>;
  saveInvestigation(i: Partial<Investigation>): Promise<Investigation>;
  listTargets(): Promise<LeadershipTarget[]>;
  saveTarget(t: LeadershipTarget): Promise<void>;
  /** call cb whenever records, vehicles, investigations or targets change (live dashboard) */
  subscribeChanges(cb: () => void): () => void;
  getRecord(id: string): Promise<RecordDetail | null>;
  getTemplateVersion(id: string): Promise<FormTemplateVersion | null>;
  saveRecord(input: RecordInput): Promise<RecordRow>;
  setRecordStatus(id: string, status: string): Promise<void>;
  /** archive a draft (never delete) */
  archiveRecord(id: string): Promise<void>;
  decideApproval(approvalId: string, decision: 'approved' | 'rejected', comment?: string): Promise<void>;
  addComment(recordId: string, body: string): Promise<void>;
  /** pending approval steps the current user can act on */
  listMyPendingApprovals(): Promise<(RecordApproval & { record: RecordRow })[]>;
  /** turn a stored file reference into a viewable URL */
  fileUrl(ref: string): Promise<string>;
  listDirectory(): Promise<DirectoryEntry[]>;

  // actions
  listActions(filter?: { submissionId?: string; investigationId?: string }): Promise<Action[]>;
  getAction(id: string): Promise<Action | null>;
  raiseAction(input: ActionInput): Promise<Action>;
  /** raiser / Admin / HSET / project lead: edit, reassign, reopen or cancel (status_note = reason) */
  updateAction(id: string, patch: Partial<ActionInput> & { status?: ActionStatus; status_note?: string }): Promise<Action>;
  /** the person assigned closes out with a comment and evidence (data: URLs uploaded); idempotent */
  closeAction(input: ActionCloseInput): Promise<Action>;

  // scaffolds
  listScaffolds(): Promise<Scaffold[]>;
  /** register or edit; photos may be data: URLs (uploaded on save) */
  saveScaffold(s: Partial<Scaffold>): Promise<Scaffold>;
  listScaffoldInspections(scaffoldId?: string): Promise<ScaffoldInspection[]>;
  getScaffoldInspection(id: string): Promise<ScaffoldInspection | null>;
  /** sign off an inspection; idempotent on input.id so an offline retry never doubles up */
  submitScaffoldInspection(input: ScaffoldInspectionInput): Promise<ScaffoldInspection>;
  listScaffoldDefects(scaffoldId?: string): Promise<ScaffoldDefect[]>;
  /** update owner / due date, or close with photos (data: URLs uploaded) */
  saveScaffoldDefect(d: Partial<ScaffoldDefect> & { id: string }): Promise<ScaffoldDefect>;
  getScaffoldChecklist(id?: string): Promise<ScaffoldChecklist | null>;
  listScaffoldChecklists(): Promise<ScaffoldChecklist[]>;
  /** Admin: publish a new checklist version */
  publishScaffoldChecklist(sections: ChecklistSection[], changeNote?: string): Promise<ScaffoldChecklist>;
  /** can the signed-in user sign off inspections, and with which licence class */
  myInspectorStatus(): Promise<{ ok: boolean; licenceClass: LicenceClass | null; reason?: string }>;

  // branding
  getSettings(): Promise<AppSettings>;
  saveSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  uploadLogo(file: File): Promise<string>;

  // notifications
  listNotifications(): Promise<Notification[]>;
  markNotificationRead(id: string): Promise<void>;
}
