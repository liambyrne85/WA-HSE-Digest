import type {
  AppRole, AppSettings, DirectoryEntry, FormTemplate, FormTemplateVersion, Invitation, JobRole, JobRoleRate, LookupList,
  LookupValue, Notification, Organization, Profile, Project, TemplateCategory, WorkerTicket,
  WorkflowModule, WorkflowPipeline, WorkflowRule, WorkflowTrigger, RecordApproval, RecordEvent, RecordRow,
} from '../types';

export interface RecordInput {
  /** generate client-side so photo uploads can be filed under the record before it is saved */
  id: string;
  template_version_id: string;
  project_id: string | null;
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
  /** Set when a leader created the account with a temporary password. */
  mustChangePassword?: boolean;
}

export interface InviteInput {
  email: string;
  full_name?: string;
  role: AppRole;
  organization_id: string;
  job_role_id?: string | null;
  /** Create the account now with this password instead of emailing an invite. */
  temp_password?: string;
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
  inviteUser(input: InviteInput): Promise<Invitation>;
  resendInvitation(id: string): Promise<void>;
  revokeInvitation(id: string): Promise<void>;

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
  deleteLookupValue(id: string): Promise<void>;

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
  deleteRule(id: string): Promise<void>;
  testRules(module: WorkflowModule, event: WorkflowTrigger, record: Record<string, unknown>, old?: Record<string, unknown>): Promise<WorkflowRule[]>;

  // tickets
  listTickets(): Promise<WorkerTicket[]>;
  saveTicket(t: Partial<WorkerTicket>): Promise<WorkerTicket>;
  deleteTicket(id: string): Promise<void>;

  // records (field modules)
  listRecords(module?: WorkflowModule): Promise<RecordRow[]>;
  getRecord(id: string): Promise<RecordDetail | null>;
  getTemplateVersion(id: string): Promise<FormTemplateVersion | null>;
  saveRecord(input: RecordInput): Promise<RecordRow>;
  setRecordStatus(id: string, status: string): Promise<void>;
  deleteRecord(id: string): Promise<void>;
  decideApproval(approvalId: string, decision: 'approved' | 'rejected', comment?: string): Promise<void>;
  addComment(recordId: string, body: string): Promise<void>;
  /** pending approval steps the current user can act on */
  listMyPendingApprovals(): Promise<(RecordApproval & { record: RecordRow })[]>;
  /** turn a stored file reference into a viewable URL */
  fileUrl(ref: string): Promise<string>;
  listDirectory(): Promise<DirectoryEntry[]>;

  // branding
  getSettings(): Promise<AppSettings>;
  saveSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  uploadLogo(file: File): Promise<string>;

  // notifications
  listNotifications(): Promise<Notification[]>;
  markNotificationRead(id: string): Promise<void>;
}
