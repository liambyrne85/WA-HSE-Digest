import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Api, ImportResult, Session } from './types';
import type { RecordEvent } from '../types';
type RecordDetailEvents = RecordEvent[];
import type {
  AppSettings, AuditEntry, DirectoryEntry, Investigation, LeadershipTarget, Vehicle, ProjectMember, RecordApproval, RecordRow, FormTemplate, FormTemplateVersion, Invitation, JobRole, JobRoleRate, LookupList, LookupValue,
  Notification, Organization, Profile, Project, WorkerTicket, WorkflowPipeline, WorkflowRule,
  Action, LicenceClass, Scaffold, ScaffoldChecklist, ScaffoldDefect, ScaffoldInspection,
} from '../types';
import { newId } from '../id';

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}
function check(res: { error: { message: string } | null }) {
  if (res.error) throw new Error(res.error.message);
}

export function createSupabaseApi(url: string, anonKey: string): Api {
  const sb: SupabaseClient = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  const toSession = (s: { user: { id: string; email?: string; user_metadata?: Record<string, unknown> } } | null): Session | null =>
    s ? { userId: s.user.id, email: s.user.email ?? '', mustChangePassword: s.user.user_metadata?.must_change_password === true } : null;
  // Full app URL including any sub-path the app is served from (e.g. GitHub Pages).
  const appUrl = () => new URL(import.meta.env.BASE_URL, window.location.origin).toString();

  async function uid() {
    const { data } = await sb.auth.getSession();
    if (!data.session) throw new Error('Not signed in');
    return data.session.user.id;
  }

  async function invoke(body: Record<string, unknown>) {
    const { data, error } = await sb.functions.invoke('invite-user', { body: { redirect_to: appUrl(), ...body } });
    if (error) {
      // Surface the function's JSON error message when available.
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') {
        const j = await ctx.json().catch(() => null);
        if (j?.error) throw new Error(j.error);
      }
      throw new Error(error.message);
    }
    return data;
  }

  // Photos and signatures arrive as data: URLs; store them as files and keep a reference in the answers.
  async function uploadDataUrls(answers: Record<string, unknown>, folder: string) {
    let n = 0;
    const upload = async (key: string, v: string) => {
      const blob = await (await fetch(v)).blob();
      const ext = blob.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'bin';
      const path = `${folder}/${key.replace(/[^a-z0-9_-]/gi, '_')}-${Date.now()}-${n++}.${ext}`;
      const { error } = await sb.storage.from('form-uploads').upload(path, blob, { contentType: blob.type });
      if (error) throw new Error(`Upload failed: ${error.message}`);
      return `storage:form-uploads/${path}`;
    };
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(answers)) {
      if (typeof v === 'string' && v.startsWith('data:')) out[k] = await upload(k, v);
      else if (Array.isArray(v) && v.some((x) => typeof x === 'string' && x.startsWith('data:'))) {
        out[k] = await Promise.all(v.map((x) => (typeof x === 'string' && x.startsWith('data:') ? upload(k, x) : x)));
      } else out[k] = v;
    }
    return out;
  }

  /** Upload any data: URLs in a list of photos; storage references pass through. */
  async function uploadList(list: string[], folder: string, key: string) {
    return (await uploadDataUrls({ [key]: list }, folder))[key] as string[];
  }

  return {
    mode: 'supabase',

    async getSession() {
      const { data } = await sb.auth.getSession();
      return toSession(data.session);
    },
    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange((event, s) => {
        const sess = toSession(s);
        // Arrived from a "set your password" / reset link: make them choose a password first.
        cb(sess && event === 'PASSWORD_RECOVERY' ? { ...sess, recovery: true } : sess);
      });
      return () => data.subscription.unsubscribe();
    },
    async signInWithPassword(email, password) {
      check(await sb.auth.signInWithPassword({ email, password }));
    },
    async signInWithMagicLink(email) {
      check(await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: appUrl() } }));
    },
    async sendPasswordReset(email) {
      check(await sb.auth.resetPasswordForEmail(email, { redirectTo: `${appUrl()}profile` }));
    },
    async signUp(email, password, fullName) {
      const { data, error } = await sb.auth.signUp({
        email, password, options: { data: { full_name: fullName }, emailRedirectTo: appUrl() },
      });
      if (error) throw new Error(error.message);
      return { needsConfirmation: !data.session };
    },
    async updatePassword(password) {
      check(await sb.auth.updateUser({ password, data: { must_change_password: false } }));
    },
    async signOut() {
      await sb.auth.signOut();
    },

    async getMyProfile() {
      const id = await uid();
      return unwrap(await sb.from('profiles').select('*').eq('id', id).maybeSingle()) as Profile | null;
    },
    async listProfiles() {
      return unwrap(await sb.from('profiles').select('*').order('full_name')) as Profile[];
    },
    async updateProfile(id, patch) {
      const { id: _ignore, created_at: _c, ...rest } = patch;
      return unwrap(await sb.from('profiles').update(rest).eq('id', id).select().single()) as Profile;
    },
    async listOrganizations() {
      return unwrap(await sb.from('organizations').select('*').order('type').order('name')) as Organization[];
    },
    async saveOrganization(org) {
      const q = org.id
        ? sb.from('organizations').update(org).eq('id', org.id)
        : sb.from('organizations').insert(org);
      return unwrap(await q.select().single()) as Organization;
    },

    async listInvitations() {
      return unwrap(await sb.from('user_invitations').select('*').order('created_at', { ascending: false })) as Invitation[];
    },
    async createPerson(input, sendInvite) {
      const data = await invoke({ action: 'create', ...input, send_invite: sendInvite });
      return { profile_id: data.profile_id as string, invited: !!data.invited };
    },
    async importPeople(rows, sendInvites) {
      // Batches of 20 keep each server call well inside the function time limit.
      const out: ImportResult[] = [];
      for (let i = 0; i < rows.length; i += 20) {
        const data = await invoke({ action: 'import', rows: rows.slice(i, i + 20), send_invite: sendInvites });
        out.push(...(data.results as ImportResult[]).map((r) => ({ ...r, row: r.row + i })));
      }
      return out;
    },
    async sendInvite(profileId) {
      await invoke({ action: 'send_invite', profile_id: profileId });
    },
    async setPersonActive(profileId, active) {
      await invoke({ action: 'set_active', profile_id: profileId, active });
    },
    async touchLastSeen() {
      const id = await uid();
      await sb.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', id);
    },
    async listProjectMembers(filter) {
      let q = sb.from('project_members').select('*').order('start_date', { ascending: false });
      if (filter?.profileId) q = q.eq('profile_id', filter.profileId);
      if (filter?.projectId) q = q.eq('project_id', filter.projectId);
      return unwrap(await q) as ProjectMember[];
    },
    async saveProjectMember(m) {
      const { id, created_at: _c, ...row } = m;
      const q = id ? sb.from('project_members').update(row).eq('id', id) : sb.from('project_members').insert(row);
      return unwrap(await q.select().single()) as ProjectMember;
    },
    async listAudit(table, recordId) {
      return unwrap(await sb.from('audit_log').select('*').eq('table_name', table).eq('record_id', recordId)
        .order('changed_at', { ascending: false }).limit(100)) as AuditEntry[];
    },
    async uploadPersonFile(profileId, file, kind) {
      const person = unwrap(await sb.from('profiles').select('organization_id').eq('id', profileId).single()) as { organization_id: string };
      const ext = (file.type.split('/')[1] ?? 'jpg').replace('jpeg', 'jpg');
      const path = `${person.organization_id}/${profileId}/${kind}-${Date.now()}.${ext}`;
      const { error } = await sb.storage.from('worker-tickets').upload(path, file, { contentType: file.type });
      if (error) throw new Error(`Upload failed: ${error.message}`);
      return `storage:worker-tickets/${path}`;
    },

    async listJobRoles() {
      return unwrap(await sb.from('job_roles').select('*').order('name')) as JobRole[];
    },
    async saveJobRole(role) {
      const q = role.id ? sb.from('job_roles').update(role).eq('id', role.id) : sb.from('job_roles').insert(role);
      return unwrap(await q.select().single()) as JobRole;
    },
    async listJobRoleRates() {
      return unwrap(await sb.from('job_role_rates').select('*')) as JobRoleRate[];
    },
    async saveJobRoleRate(rate) {
      unwrap(await sb.from('job_role_rates').upsert(rate));
    },

    async listProjects() {
      const rows = unwrap(await sb.from('projects').select('*, project_organizations(organization_id)').order('name')) as
        (Project & { project_organizations: { organization_id: string }[] })[];
      return rows.map(({ project_organizations, ...p }) => ({
        ...p,
        organization_ids: project_organizations?.map((x) => x.organization_id) ?? [],
      }));
    },
    async saveProject(p) {
      const { organization_ids, ...row } = p;
      const me = await uid();
      const q = row.id
        ? sb.from('projects').update(row).eq('id', row.id)
        : sb.from('projects').insert({ ...row, created_by: me });
      const saved = unwrap(await q.select().single()) as Project;
      if (organization_ids) {
        unwrap(await sb.from('project_organizations').delete().eq('project_id', saved.id));
        if (organization_ids.length) {
          unwrap(await sb.from('project_organizations').insert(
            organization_ids.map((organization_id) => ({ project_id: saved.id, organization_id })),
          ));
        }
      }
      return { ...saved, organization_ids };
    },

    async listLookupLists() {
      return unwrap(await sb.from('lookup_lists').select('*').order('name')) as LookupList[];
    },
    async saveLookupList(l) {
      return unwrap(await sb.from('lookup_lists').upsert(l).select().single()) as LookupList;
    },
    async listLookupValues(listKey) {
      let q = sb.from('lookup_values').select('*').order('sort_order').order('label');
      if (listKey) q = q.eq('list_key', listKey);
      return unwrap(await q) as LookupValue[];
    },
    async saveLookupValue(v) {
      const q = v.id ? sb.from('lookup_values').update(v).eq('id', v.id) : sb.from('lookup_values').insert(v);
      return unwrap(await q.select().single()) as LookupValue;
    },

    async listTemplates() {
      return unwrap(await sb.from('form_templates').select('*').order('updated_at', { ascending: false })) as FormTemplate[];
    },
    async getTemplate(id) {
      return unwrap(await sb.from('form_templates').select('*').eq('id', id).maybeSingle()) as FormTemplate | null;
    },
    async createTemplate(input) {
      const me = await uid();
      return unwrap(await sb.from('form_templates')
        .insert({ ...input, created_by: me, updated_by: me, draft_schema: { sections: [] } })
        .select().single()) as FormTemplate;
    },
    async saveTemplateDraft(id, patch) {
      const me = await uid();
      const allowed = (({ name, description, category, draft_schema, available_to_contractors, status }) =>
        ({ name, description, category, draft_schema, available_to_contractors, status }))(patch);
      const clean = Object.fromEntries(Object.entries(allowed).filter(([, v]) => v !== undefined));
      return unwrap(await sb.from('form_templates').update({ ...clean, updated_by: me }).eq('id', id).select().single()) as FormTemplate;
    },
    async publishTemplate(id, changeNote) {
      return unwrap(await sb.rpc('publish_form_template', { p_template_id: id, p_change_note: changeNote ?? null })) as FormTemplateVersion;
    },
    async listTemplateVersions(templateId) {
      return unwrap(await sb.from('form_template_versions').select('*').eq('template_id', templateId)
        .order('version', { ascending: false })) as FormTemplateVersion[];
    },
    async duplicateTemplate(id) {
      const t = unwrap(await sb.from('form_templates').select('*').eq('id', id).single()) as FormTemplate;
      const me = await uid();
      return unwrap(await sb.from('form_templates').insert({
        name: `${t.name} (copy)`, description: t.description, category: t.category,
        draft_schema: t.draft_schema, available_to_contractors: t.available_to_contractors,
        created_by: me, updated_by: me,
      }).select().single()) as FormTemplate;
    },

    async listPipelines() {
      return unwrap(await sb.from('workflow_pipelines').select('*')) as WorkflowPipeline[];
    },
    async savePipeline(p) {
      const me = await uid();
      unwrap(await sb.from('workflow_pipelines').upsert({ module: p.module, statuses: p.statuses, updated_by: me }));
    },
    async listRules() {
      return unwrap(await sb.from('workflow_rules').select('*').is('archived_at', null).order('module').order('priority')) as WorkflowRule[];
    },
    async saveRule(r) {
      const me = await uid();
      const { id, updated_at: _u, ...row } = r;
      const q = id
        ? sb.from('workflow_rules').update({ ...row, updated_by: me }).eq('id', id)
        : sb.from('workflow_rules').insert({ ...row, created_by: me, updated_by: me });
      return unwrap(await q.select().single()) as WorkflowRule;
    },
    async archiveRule(id) {
      unwrap(await sb.from('workflow_rules').update({ archived_at: new Date().toISOString(), is_enabled: false }).eq('id', id));
    },
    async testRules(module, event, record, old) {
      return unwrap(await sb.rpc('test_workflow_rules', {
        p_module: module, p_event: event, p_record: record, p_old: old ?? null,
      })) as WorkflowRule[];
    },

    async listTickets() {
      return unwrap(await sb.from('worker_tickets').select('*').is('archived_at', null).order('expires_on', { nullsFirst: false })) as WorkerTicket[];
    },
    async saveTicket(t) {
      const { id, created_at: _c, archived_at: _a, ...row } = t;
      // organization_id is overwritten server-side from the worker's profile.
      const q = id
        ? sb.from('worker_tickets').update(row).eq('id', id)
        : sb.from('worker_tickets').insert({ organization_id: '00000000-0000-0000-0000-000000000000', ...row });
      return unwrap(await q.select().single()) as WorkerTicket;
    },
    async archiveTicket(id) {
      unwrap(await sb.from('worker_tickets').update({ archived_at: new Date().toISOString() }).eq('id', id));
    },

    // ---- records ------------------------------------------------------------
    async listRecords(module, range) {
      let q = sb.from('form_submissions').select('*').is('archived_at', null).order('created_at', { ascending: false }).limit(2000);
      if (module) q = q.eq('module', module);
      if (range?.from) q = q.gte('record_date', range.from);
      if (range?.to) q = q.lte('record_date', range.to);
      return unwrap(await q) as RecordRow[];
    },
    async listVehicles() {
      return unwrap(await sb.from('vehicles').select('*').is('archived_at', null).order('fleet_number')) as Vehicle[];
    },
    async saveVehicle(v) {
      const { id, created_at: _c, ...row } = v;
      const q = id ? sb.from('vehicles').update(row).eq('id', id) : sb.from('vehicles').insert(row);
      return unwrap(await q.select().single()) as Vehicle;
    },
    async listInvestigations() {
      return unwrap(await sb.from('investigations').select('*').is('archived_at', null).order('opened_at', { ascending: false })) as Investigation[];
    },
    async saveInvestigation(i) {
      const { id, created_at: _c, reference: _r, opened_at: _o, closed_at: _x, ...row } = i;
      const q = id ? sb.from('investigations').update(row).eq('id', id) : sb.from('investigations').insert(row);
      return unwrap(await q.select().single()) as Investigation;
    },
    async listTargets() {
      return unwrap(await sb.from('leadership_targets').select('profile_id, period, target')) as LeadershipTarget[];
    },
    async saveTarget(t) {
      unwrap(await sb.from('leadership_targets').upsert({ profile_id: t.profile_id, period: t.period, target: t.target }));
    },
    subscribeChanges(cb) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const fire = () => { clearTimeout(timer); timer = setTimeout(cb, 400); };
      const channel = sb.channel(`dash-${Math.random().toString(36).slice(2)}`);
      for (const table of ['form_submissions', 'vehicles', 'investigations', 'leadership_targets', 'scaffolds', 'scaffold_inspections', 'scaffold_defects', 'actions']) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table }, fire);
      }
      channel.subscribe();
      // Fallback for flaky connections: refresh every 2 minutes as well.
      const poll = setInterval(cb, 120000);
      return () => { clearTimeout(timer); clearInterval(poll); void sb.removeChannel(channel); };
    },
    async getRecord(id) {
      const record = unwrap(await sb.from('form_submissions').select('*').eq('id', id).maybeSingle()) as RecordRow | null;
      if (!record) return null;
      const [version, approvals, events] = await Promise.all([
        sb.from('form_template_versions').select('*').eq('id', record.template_version_id).single(),
        sb.from('record_approvals').select('*').eq('submission_id', id).order('step'),
        sb.from('record_events').select('*').eq('submission_id', id).order('created_at'),
      ]);
      return {
        record,
        version: unwrap(version) as FormTemplateVersion,
        approvals: unwrap(approvals) as RecordApproval[],
        events: unwrap(events) as RecordDetailEvents,
      };
    },
    async getTemplateVersion(id) {
      return unwrap(await sb.from('form_template_versions').select('*').eq('id', id).maybeSingle()) as FormTemplateVersion | null;
    },
    async saveRecord(input) {
      const me = unwrap(await sb.from('profiles').select('organization_id').eq('id', await uid()).single()) as { organization_id: string };
      const answers = await uploadDataUrls(input.answers, `${me.organization_id}/${input.id}`);
      const row = { project_id: input.project_id, vehicle_id: input.vehicle_id ?? null, answers, status: input.status };
      const q = input.isNew
        ? sb.from('form_submissions').insert({ id: input.id, template_version_id: input.template_version_id, ...row })
        : sb.from('form_submissions').update(row).eq('id', input.id);
      return unwrap(await q.select().single()) as RecordRow;
    },
    async setRecordStatus(id, status) {
      unwrap(await sb.from('form_submissions').update({ status }).eq('id', id).select().single());
    },
    async archiveRecord(id) {
      unwrap(await sb.from('form_submissions').update({ archived_at: new Date().toISOString() }).eq('id', id));
    },
    async decideApproval(approvalId, decision, comment) {
      unwrap(await sb.rpc('decide_approval', { p_approval_id: approvalId, p_decision: decision, p_comment: comment ?? null }));
    },
    async addComment(recordId, body) {
      unwrap(await sb.from('record_events').insert({ submission_id: recordId, kind: 'comment', body, actor: await uid() }));
    },
    async listMyPendingApprovals() {
      const me = unwrap(await sb.from('profiles').select('role').eq('id', await uid()).single()) as { role: string };
      const rows = unwrap(await sb.from('record_approvals').select('*, record:form_submissions(*)').eq('status', 'pending')
        .order('due_at', { ascending: true, nullsFirst: false })) as (RecordApproval & { record: RecordRow })[];
      return rows.filter((r) => r.record && (me.role === 'leader' || r.approver_role === me.role));
    },
    async fileUrl(ref) {
      if (!ref.startsWith('storage:')) return ref;
      const [bucket, ...rest] = ref.slice('storage:'.length).split('/');
      const { data, error } = await sb.storage.from(bucket!).createSignedUrl(rest.join('/'), 3600);
      if (error) throw new Error(error.message);
      return data.signedUrl;
    },
    async listDirectory() {
      return unwrap(await sb.from('profile_directory').select('id, full_name, role, organization_id')) as DirectoryEntry[];
    },

    // ---- branding -----------------------------------------------------------
    // ---- actions -----------------------------------------------------------
    async listActions(filter) {
      let q = sb.from('actions').select('*').is('archived_at', null).order('due_date');
      if (filter?.submissionId) q = q.eq('submission_id', filter.submissionId);
      if (filter?.investigationId) q = q.eq('investigation_id', filter.investigationId);
      return unwrap(await q) as Action[];
    },
    async getAction(id) {
      return unwrap(await sb.from('actions').select('*').eq('id', id).maybeSingle()) as Action | null;
    },
    async raiseAction(input) {
      const { id, submission_id, investigation_id, title, description, priority, assignee_id, due_date } = input;
      return unwrap(await sb.from('actions').insert({ id: id ?? newId(), submission_id: submission_id ?? null, investigation_id: investigation_id ?? null,
        title, description, priority, assignee_id, due_date }).select().single()) as Action;
    },
    async updateAction(id, patch) {
      const { title, description, priority, assignee_id, due_date, status, status_note } = patch;
      const row = Object.fromEntries(Object.entries({ title, description, priority, assignee_id, due_date, status, status_note }).filter(([, v]) => v !== undefined));
      return unwrap(await sb.from('actions').update(row).eq('id', id).select().single()) as Action;
    },
    async closeAction(input) {
      const current = unwrap(await sb.from('actions').select('*').eq('id', input.id).single()) as Action;
      if (current.status === 'closed') return current; // an earlier (offline) attempt already got through
      const me = unwrap(await sb.from('profiles').select('organization_id').eq('id', await uid()).single()) as { organization_id: string };
      const evidence = await uploadList(input.close_evidence, `${me.organization_id}/${input.id}`, 'evidence');
      return unwrap(await sb.from('actions').update({ status: 'closed', close_comment: input.close_comment, close_evidence: evidence })
        .eq('id', input.id).select().single()) as Action;
    },

    // ---- scaffolds ---------------------------------------------------------
    async listScaffolds() {
      return unwrap(await sb.from('scaffolds').select('*').is('archived_at', null).order('scaffold_number')) as Scaffold[];
    },
    async saveScaffold(input) {
      const me = unwrap(await sb.from('profiles').select('organization_id').eq('id', await uid()).single()) as { organization_id: string };
      const id = input.id ?? newId();
      const { id: _i, scaffold_number: _n, qr_token: _q, created_at: _c, last_inspection_id: _l, last_inspected_at: _la, next_inspection_due: _nd, ...row } = input;
      if (row.photos) row.photos = await uploadList(row.photos, `${me.organization_id}/${id}`, 'scaffold');
      const exists = !!input.id && !!unwrap(await sb.from('scaffolds').select('id').eq('id', id).maybeSingle());
      const q = exists ? sb.from('scaffolds').update(row).eq('id', id) : sb.from('scaffolds').insert({ ...row, id });
      return unwrap(await q.select().single()) as Scaffold;
    },
    async listScaffoldInspections(scaffoldId) {
      let q = sb.from('scaffold_inspections').select('*').is('archived_at', null).order('signed_at', { ascending: false });
      if (scaffoldId) q = q.eq('scaffold_id', scaffoldId);
      return unwrap(await q) as ScaffoldInspection[];
    },
    async getScaffoldInspection(id) {
      return unwrap(await sb.from('scaffold_inspections').select('*').eq('id', id).maybeSingle()) as ScaffoldInspection | null;
    },
    async submitScaffoldInspection(input) {
      // Already synced (an earlier attempt got through but the reply was lost)? Return it.
      const existing = unwrap(await sb.from('scaffold_inspections').select('*').eq('id', input.id).maybeSingle()) as ScaffoldInspection | null;
      if (existing) return existing;
      const me = unwrap(await sb.from('profiles').select('organization_id').eq('id', await uid()).single()) as { organization_id: string };
      const folder = `${me.organization_id}/${input.id}`;
      const items: ScaffoldInspection['items'] = {};
      for (const [k, a] of Object.entries(input.items)) {
        items[k] = a.photos?.length ? { ...a, photos: await uploadList(a.photos, folder, k) } : a;
      }
      const row = {
        ...input, items, photos: await uploadList(input.photos, folder, 'general'),
        signature: (await uploadList([input.signature], folder, 'signature'))[0]!,
      };
      const res = await sb.from('scaffold_inspections').insert(row).select().single();
      if (res.error && /duplicate key/i.test(res.error.message)) {
        return unwrap(await sb.from('scaffold_inspections').select('*').eq('id', input.id).single()) as ScaffoldInspection;
      }
      return unwrap(res) as ScaffoldInspection;
    },
    async listScaffoldDefects(scaffoldId) {
      let q = sb.from('scaffold_defects').select('*').is('archived_at', null).order('due_date');
      if (scaffoldId) q = q.eq('scaffold_id', scaffoldId);
      return unwrap(await q) as ScaffoldDefect[];
    },
    async saveScaffoldDefect(d) {
      const { id, owner_id, due_date, status, close_comment } = d;
      const patch: Record<string, unknown> = Object.fromEntries(Object.entries({ owner_id, due_date, status, close_comment }).filter(([, v]) => v !== undefined));
      if (d.close_photos) {
        const me = unwrap(await sb.from('profiles').select('organization_id').eq('id', await uid()).single()) as { organization_id: string };
        patch.close_photos = await uploadList(d.close_photos, `${me.organization_id}/${id}`, 'fix');
      }
      return unwrap(await sb.from('scaffold_defects').update(patch).eq('id', id).select().single()) as ScaffoldDefect;
    },
    async getScaffoldChecklist(id) {
      const q = id ? sb.from('scaffold_checklists').select('*').eq('id', id)
        : sb.from('scaffold_checklists').select('*').order('version', { ascending: false }).limit(1);
      return unwrap(await q.maybeSingle()) as ScaffoldChecklist | null;
    },
    async listScaffoldChecklists() {
      return unwrap(await sb.from('scaffold_checklists').select('*').order('version', { ascending: false })) as ScaffoldChecklist[];
    },
    async publishScaffoldChecklist(sections, changeNote) {
      return unwrap(await sb.from('scaffold_checklists').insert({ version: 0, sections, change_note: changeNote ?? null }).select().single()) as ScaffoldChecklist;
    },
    async myInspectorStatus() {
      const me = await uid();
      const [profile, ok, cls, settings] = await Promise.all([
        sb.from('profiles').select('is_scaffold_inspector').eq('id', me).single(),
        sb.rpc('can_inspect_scaffolds', { p_profile_id: me }),
        sb.rpc('scaffold_licence_class', { p_profile_id: me }),
        sb.from('app_settings').select('scaffold_min_licence').eq('id', 1).single(),
      ]);
      const licenceClass = (cls.data as LicenceClass | null) ?? null;
      const min = (settings.data as { scaffold_min_licence?: string } | null)?.scaffold_min_licence ?? 'Basic';
      if (ok.data === true) return { ok: true, licenceClass };
      const reason = !(profile.data as { is_scaffold_inspector?: boolean } | null)?.is_scaffold_inspector
        ? 'You are not marked as a competent scaffold inspector on your profile.'
        : !licenceClass ? 'You need a current scaffolding licence (HRW) on your profile.'
        : `Your ${licenceClass} licence is below the minimum (${min}) for signing off inspections.`;
      return { ok: false, licenceClass, reason };
    },

    async getSettings() {
      return unwrap(await sb.from('app_settings').select('*').eq('id', 1).single()) as AppSettings;
    },
    async saveSettings(patch) {
      const { company_name, primary_color, accent_color, dark_color, logo_url, scaffold_min_licence } = patch;
      const clean = Object.fromEntries(Object.entries({ company_name, primary_color, accent_color, dark_color, logo_url, scaffold_min_licence }).filter(([, v]) => v !== undefined));
      return unwrap(await sb.from('app_settings').update({ ...clean, updated_by: await uid() }).eq('id', 1).select().single()) as AppSettings;
    },
    async uploadLogo(file) {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const path = `logo-${Date.now()}.${ext}`;
      const { error } = await sb.storage.from('branding').upload(path, file, { contentType: file.type, upsert: true });
      if (error) throw new Error(error.message);
      return sb.storage.from('branding').getPublicUrl(path).data.publicUrl;
    },

    async listNotifications() {
      return unwrap(await sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(50)) as Notification[];
    },
    async markNotificationRead(id) {
      unwrap(await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id));
    },
  };
}
