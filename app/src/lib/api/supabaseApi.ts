import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Api, Session } from './types';
import type {
  FormTemplate, FormTemplateVersion, Invitation, JobRole, JobRoleRate, LookupList, LookupValue,
  Notification, Organization, Profile, Project, WorkerTicket, WorkflowPipeline, WorkflowRule,
} from '../types';

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

  const toSession = (s: { user: { id: string; email?: string } } | null): Session | null =>
    s ? { userId: s.user.id, email: s.user.email ?? '' } : null;

  async function uid() {
    const { data } = await sb.auth.getSession();
    if (!data.session) throw new Error('Not signed in');
    return data.session.user.id;
  }

  async function invoke(body: Record<string, unknown>) {
    const { data, error } = await sb.functions.invoke('invite-user', { body });
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

  return {
    mode: 'supabase',

    async getSession() {
      const { data } = await sb.auth.getSession();
      return toSession(data.session);
    },
    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange((_e, s) => cb(toSession(s)));
      return () => data.subscription.unsubscribe();
    },
    async signInWithPassword(email, password) {
      check(await sb.auth.signInWithPassword({ email, password }));
    },
    async signInWithMagicLink(email) {
      check(await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: window.location.origin } }));
    },
    async sendPasswordReset(email) {
      check(await sb.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/profile` }));
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
    async inviteUser(input) {
      const data = await invoke({ action: 'invite', ...input });
      return data.invitation as Invitation;
    },
    async resendInvitation(id) {
      await invoke({ action: 'resend', invitation_id: id });
    },
    async revokeInvitation(id) {
      await invoke({ action: 'revoke', invitation_id: id });
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
    async deleteLookupValue(id) {
      unwrap(await sb.from('lookup_values').delete().eq('id', id));
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
      return unwrap(await sb.from('workflow_rules').select('*').order('module').order('priority')) as WorkflowRule[];
    },
    async saveRule(r) {
      const me = await uid();
      const { id, updated_at: _u, ...row } = r;
      const q = id
        ? sb.from('workflow_rules').update({ ...row, updated_by: me }).eq('id', id)
        : sb.from('workflow_rules').insert({ ...row, created_by: me, updated_by: me });
      return unwrap(await q.select().single()) as WorkflowRule;
    },
    async deleteRule(id) {
      unwrap(await sb.from('workflow_rules').delete().eq('id', id));
    },
    async testRules(module, event, record, old) {
      return unwrap(await sb.rpc('test_workflow_rules', {
        p_module: module, p_event: event, p_record: record, p_old: old ?? null,
      })) as WorkflowRule[];
    },

    async listTickets() {
      return unwrap(await sb.from('worker_tickets').select('*').order('expires_on', { nullsFirst: false })) as WorkerTicket[];
    },
    async saveTicket(t) {
      const { id, created_at: _c, verified_at: _v, ...row } = t;
      // organization_id is overwritten server-side from the worker's profile.
      const q = id
        ? sb.from('worker_tickets').update(row).eq('id', id)
        : sb.from('worker_tickets').insert({ organization_id: '00000000-0000-0000-0000-000000000000', ...row });
      return unwrap(await q.select().single()) as WorkerTicket;
    },
    async deleteTicket(id) {
      unwrap(await sb.from('worker_tickets').delete().eq('id', id));
    },

    async listNotifications() {
      return unwrap(await sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(50)) as Notification[];
    },
    async markNotificationRead(id) {
      unwrap(await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id));
    },
  };
}
