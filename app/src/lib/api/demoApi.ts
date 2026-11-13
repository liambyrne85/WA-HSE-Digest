import type { Api, DemoAccount, Session } from './types';
import { buildDemoSeed, type DemoDb } from './demoSeed';
import type {
  FormTemplate, FormTemplateVersion, Invitation, Profile, WorkflowModule, WorkflowRule, WorkflowTrigger,
} from '../types';

/**
 * Local demo backend. Persists to localStorage and imitates the database RLS
 * policies so each role sees what it would see in production. It is NOT a
 * security boundary — production access control lives in Postgres RLS.
 */
const DB_KEY = 'fieldops-demo-db-v1';
const SESSION_KEY = 'fieldops-demo-session';

const uuid = () =>
  (crypto as Crypto & { randomUUID?: () => string }).randomUUID?.() ??
  `id-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
const nowIso = () => new Date().toISOString();
const delay = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(structuredClone(v)), 120));

function load(): DemoDb {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) return JSON.parse(raw) as DemoDb;
  } catch { /* ignore */ }
  const seed = buildDemoSeed();
  save(seed);
  return seed;
}
function save(db: DemoDb) {
  try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch { /* ignore */ }
}

export function ruleMatches(r: WorkflowRule, event: WorkflowTrigger, record: Record<string, unknown>, old?: Record<string, unknown>) {
  if (r.trigger_event !== event) return false;
  const cfg = r.trigger_config ?? {};
  if (event === 'status_changed') {
    if (cfg.to_status && String(record.status ?? '') !== cfg.to_status) return false;
    if (cfg.from_status && String(old?.status ?? '') !== cfg.from_status) return false;
    return true;
  }
  if (event === 'field_condition') {
    if (!cfg.field) return false;
    const actual = record[cfg.field];
    if (actual === undefined || actual === null) return false;
    const a = String(actual).toLowerCase();
    const v = String(cfg.value ?? '').toLowerCase();
    const num = (x: string) => (/^-?[0-9.]+$/.test(x) ? Number(x) : NaN);
    switch (cfg.operator ?? 'eq') {
      case 'eq': return a === v;
      case 'neq': return a !== v;
      case 'in': return v.split(',').map((s) => s.trim()).includes(a);
      case 'contains': return a.includes(v);
      case 'gt': return num(a) > num(v);
      case 'gte': return num(a) >= num(v);
      case 'lt': return num(a) < num(v);
      case 'lte': return num(a) <= num(v);
      default: return false;
    }
  }
  return true;
}

export function createDemoApi(): Api {
  let db = load();
  let session: Session | null = null;
  const listeners = new Set<(s: Session | null) => void>();

  try {
    const s = localStorage.getItem(SESSION_KEY);
    if (s) session = JSON.parse(s);
  } catch { /* ignore */ }

  const commit = () => save(db);
  const emit = () => listeners.forEach((l) => l(session));

  const me = (): Profile | undefined => db.profiles.find((p) => p.id === session?.userId && p.is_active);
  const requireMe = () => {
    const p = me();
    if (!p) throw new Error('Not signed in or account inactive');
    return p;
  };
  const isLeader = () => me()?.role === 'leader';
  const isInternal = () => ['leader', 'employee'].includes(me()?.role ?? '');
  const isContractor = () => me()?.role === 'contractor';
  const requireLeader = () => {
    if (!isLeader()) throw new Error('Permission denied: leaders only');
  };
  const canAccessProject = (pid: string) =>
    isInternal() || !!db.projects.find((p) => p.id === pid)?.organization_ids?.includes(me()?.organization_id ?? '');
  const checkRoleOrg = (role: string, orgId: string) => {
    const o = db.organizations.find((x) => x.id === orgId);
    if (!o) throw new Error('Company not found');
    if (role === 'contractor' && o.type !== 'contractor') throw new Error('Contractor users must belong to a contractor company');
    if (role !== 'contractor' && o.type !== 'internal') throw new Error('Leaders and employees must belong to the internal company');
  };

  const accounts: DemoAccount[] = [
    { id: 'u-leader', label: 'Sam Carter', role: 'leader', description: 'Project Manager · Access & Site (Leader)' },
    { id: 'u-emp', label: 'Jordan Reid', role: 'employee', description: 'Plant Operator · Access & Site (Employee)' },
    { id: 'u-acme1', label: 'Alice Nguyen', role: 'contractor', description: 'Supervisor · Acme Earthworks (Contractor)' },
    { id: 'u-bravo1', label: 'Ben Hughes', role: 'contractor', description: 'Supervisor · Bravo Traffic Mgmt (Contractor)' },
    { id: 'u-pending', label: 'Casey Morgan', role: 'employee', description: 'Self-registered, awaiting activation' },
  ];

  const api: Api = {
    mode: 'demo',

    async getSession() { return session; },
    onAuthChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    async signInWithPassword(email) {
      const p = db.profiles.find((x) => x.email.toLowerCase() === email.trim().toLowerCase());
      if (!p) throw new Error('Demo mode: use one of the demo accounts below, or any seeded email (any password).');
      return api.demoSignIn!(p.id);
    },
    async signInWithMagicLink() {
      throw new Error('Magic links need Supabase — demo mode uses the account picker.');
    },
    async sendPasswordReset() {
      throw new Error('Password reset needs Supabase — not available in demo mode.');
    },
    async signUp() {
      throw new Error('Creating accounts needs Supabase — in demo mode, pick one of the demo accounts.');
    },
    async updatePassword() {
      throw new Error('Passwords need Supabase — not available in demo mode.');
    },
    async signOut() {
      session = null;
      try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
      emit();
    },
    demoAccounts: () => accounts,
    async demoSignIn(userId) {
      const p = db.profiles.find((x) => x.id === userId);
      if (!p) throw new Error('Unknown demo user');
      session = { userId: p.id, email: p.email };
      try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* ignore */ }
      emit();
    },
    demoReset() {
      db = buildDemoSeed();
      commit();
    },

    // ---- profiles / orgs -------------------------------------------------
    async getMyProfile() {
      return delay(db.profiles.find((p) => p.id === session?.userId) ?? null);
    },
    async listProfiles() {
      const m = me();
      if (!m) return delay(db.profiles.filter((p) => p.id === session?.userId));
      return delay(db.profiles
        .filter((p) => p.id === m.id || m.role === 'leader' || (m.role === 'contractor' && p.organization_id === m.organization_id))
        .sort((a, b) => a.full_name.localeCompare(b.full_name)));
    },
    async updateProfile(id, patch) {
      const m = requireMe();
      const p = db.profiles.find((x) => x.id === id);
      if (!p) throw new Error('Profile not found');
      if (m.role !== 'leader') {
        if (id !== m.id) throw new Error('Permission denied');
        const locked: (keyof Profile)[] = ['role', 'organization_id', 'job_role_id', 'employee_number', 'is_active', 'email'];
        for (const k of locked) if (k in patch && patch[k] !== p[k]) throw new Error('Only leaders can change role, company, job role or account status');
      }
      const next = { ...p, ...patch };
      checkRoleOrg(next.role, next.organization_id);
      if (p.role === 'leader' && p.is_active && (next.role !== 'leader' || !next.is_active)
        && !db.profiles.some((x) => x.id !== p.id && x.role === 'leader' && x.is_active)) {
        throw new Error('Cannot remove the last active leader');
      }
      Object.assign(p, next);
      commit();
      return delay(p);
    },
    async listOrganizations() {
      const m = me();
      if (!m) return delay([]);
      return delay(db.organizations.filter((o) => isInternal() || o.id === m.organization_id));
    },
    async saveOrganization(o) {
      requireLeader();
      if (o.id) {
        const ex = db.organizations.find((x) => x.id === o.id)!;
        if (o.type && o.type !== ex.type && db.profiles.some((p) => p.organization_id === ex.id)) {
          throw new Error('Cannot change company type while it has users');
        }
        Object.assign(ex, o);
        commit();
        return delay(ex);
      }
      if (o.type === 'internal' && db.organizations.some((x) => x.type === 'internal')) {
        throw new Error('There is already an internal company');
      }
      const row = {
        id: uuid(), name: o.name ?? 'New company', type: o.type ?? 'contractor', abn: o.abn ?? null,
        contact_name: o.contact_name ?? null, contact_email: o.contact_email ?? null, contact_phone: o.contact_phone ?? null,
        is_active: o.is_active ?? true, notes: o.notes ?? null, created_at: nowIso(),
      };
      db.organizations.push(row);
      commit();
      return delay(row);
    },

    // ---- invitations -----------------------------------------------------
    async listInvitations() {
      if (!isLeader()) return delay([]);
      return delay([...db.invitations].sort((a, b) => b.created_at.localeCompare(a.created_at)));
    },
    async inviteUser(input) {
      requireLeader();
      const email = input.email.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Valid email required');
      if (db.profiles.some((p) => p.email.toLowerCase() === email)) throw new Error('A user with this email already exists');
      checkRoleOrg(input.role, input.organization_id);
      db.invitations.forEach((i) => { if (i.email === email && i.status === 'pending') i.status = 'revoked'; });
      const inv = {
        id: uuid(), email, full_name: input.full_name ?? null, role: input.role, organization_id: input.organization_id,
        job_role_id: input.job_role_id ?? null, status: 'pending' as Invitation['status'], invited_by: session!.userId,
        expires_at: new Date(Date.now() + 14 * 864e5).toISOString(), created_at: nowIso(),
      };
      db.invitations.push(inv);
      if (input.temp_password) {
        // Mirror the server: the account exists immediately.
        inv.status = 'accepted';
        db.profiles.push({
          id: uuid(), email, full_name: input.full_name || email.split('@')[0]!, role: input.role,
          organization_id: input.organization_id, job_role_id: input.job_role_id ?? null, phone: null,
          employee_number: null, emergency_contact_name: null, emergency_contact_phone: null, is_active: true, created_at: nowIso(),
        });
      }
      commit();
      return delay(inv);
    },
    async resendInvitation(id) {
      requireLeader();
      const i = db.invitations.find((x) => x.id === id);
      if (i) { i.expires_at = new Date(Date.now() + 14 * 864e5).toISOString(); i.status = 'pending'; commit(); }
      await delay(null);
    },
    async revokeInvitation(id) {
      requireLeader();
      const i = db.invitations.find((x) => x.id === id);
      if (i && i.status === 'pending') { i.status = 'revoked'; commit(); }
      await delay(null);
    },

    // ---- job roles -------------------------------------------------------
    async listJobRoles() {
      if (!me()) return delay([]);
      return delay([...db.jobRoles].sort((a, b) => a.name.localeCompare(b.name)));
    },
    async saveJobRole(r) {
      requireLeader();
      if (r.id) {
        const ex = db.jobRoles.find((x) => x.id === r.id)!;
        Object.assign(ex, r);
        commit();
        return delay(ex);
      }
      if (db.jobRoles.some((x) => x.name.toLowerCase() === (r.name ?? '').toLowerCase())) throw new Error('Job role already exists');
      const row = { id: uuid(), name: r.name ?? '', classification: r.classification ?? null, description: r.description ?? null,
        applies_to: r.applies_to ?? ['internal', 'contractor'], is_active: r.is_active ?? true };
      db.jobRoles.push(row);
      commit();
      return delay(row);
    },
    async listJobRoleRates() {
      return delay(isLeader() ? db.rates : []);
    },
    async saveJobRoleRate(rate) {
      requireLeader();
      const ex = db.rates.find((x) => x.job_role_id === rate.job_role_id);
      if (ex) Object.assign(ex, rate); else db.rates.push(rate);
      commit();
      await delay(null);
    },

    // ---- projects --------------------------------------------------------
    async listProjects() {
      if (!me()) return delay([]);
      return delay(db.projects.filter((p) => canAccessProject(p.id)).sort((a, b) => a.name.localeCompare(b.name)));
    },
    async saveProject(p) {
      requireLeader();
      if (p.id) {
        const ex = db.projects.find((x) => x.id === p.id)!;
        Object.assign(ex, p);
        commit();
        return delay(ex);
      }
      if (p.code && db.projects.some((x) => x.code === p.code)) throw new Error('Project code already in use');
      const row = {
        id: uuid(), code: p.code ?? null, name: p.name ?? 'New project', client_name: p.client_name ?? null,
        site_location: p.site_location ?? null, status: p.status ?? 'active', is_active: p.is_active ?? true,
        start_date: p.start_date ?? null, end_date: p.end_date ?? null, description: p.description ?? null,
        created_at: nowIso(), organization_ids: p.organization_ids ?? [],
      };
      db.projects.push(row);
      commit();
      return delay(row);
    },

    // ---- lookups ---------------------------------------------------------
    async listLookupLists() {
      if (!me()) return delay([]);
      return delay(db.lookupLists.filter((l) => isInternal() || l.visible_to_contractors));
    },
    async saveLookupList(l) {
      requireLeader();
      const ex = db.lookupLists.find((x) => x.key === l.key);
      if (ex) Object.assign(ex, l);
      else {
        if (!l.key || !/^[a-z][a-z0-9_]*$/.test(l.key)) throw new Error('Key must be lower_snake_case');
        db.lookupLists.push({ key: l.key, name: l.name ?? l.key, description: l.description ?? null,
          visible_to_contractors: l.visible_to_contractors ?? true, is_system: false });
      }
      commit();
      return delay(db.lookupLists.find((x) => x.key === l.key)!);
    },
    async listLookupValues(listKey) {
      if (!me()) return delay([]);
      const visible = new Set(db.lookupLists.filter((l) => isInternal() || l.visible_to_contractors).map((l) => l.key));
      return delay(db.lookupValues
        .filter((v) => visible.has(v.list_key) && (!listKey || v.list_key === listKey))
        .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label)));
    },
    async saveLookupValue(v) {
      requireLeader();
      if (v.id) {
        const ex = db.lookupValues.find((x) => x.id === v.id)!;
        Object.assign(ex, v);
        commit();
        return delay(ex);
      }
      if (db.lookupValues.some((x) => x.list_key === v.list_key && x.label.toLowerCase() === (v.label ?? '').toLowerCase())) {
        throw new Error('That value already exists in this list');
      }
      const row = { id: uuid(), list_key: v.list_key!, label: v.label ?? '', code: v.code ?? null,
        sort_order: v.sort_order ?? db.lookupValues.filter((x) => x.list_key === v.list_key).length + 1, is_active: v.is_active ?? true };
      db.lookupValues.push(row);
      commit();
      return delay(row);
    },
    async deleteLookupValue(id) {
      requireLeader();
      db.lookupValues = db.lookupValues.filter((x) => x.id !== id);
      commit();
      await delay(null);
    },

    // ---- templates -------------------------------------------------------
    async listTemplates() {
      const m = me();
      if (!m) return delay([]);
      return delay(db.templates
        .filter((t) => m.role === 'leader' || (t.status === 'published' && (isInternal() || t.available_to_contractors)))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
    },
    async getTemplate(id) {
      const list = await api.listTemplates();
      return list.find((t) => t.id === id) ?? null;
    },
    async createTemplate(input) {
      requireLeader();
      const t: FormTemplate = {
        id: uuid(), name: input.name, description: input.description ?? null, category: input.category, status: 'draft',
        draft_schema: { settings: { requireProject: true, requireSignOff: true }, sections: [] },
        has_unpublished_changes: true, current_version: 0, current_version_id: null, available_to_contractors: true,
        created_at: nowIso(), updated_at: nowIso(),
      };
      db.templates.push(t);
      commit();
      return delay(t);
    },
    async saveTemplateDraft(id, patch) {
      requireLeader();
      const t = db.templates.find((x) => x.id === id);
      if (!t) throw new Error('Template not found');
      const dirty = (patch.draft_schema && JSON.stringify(patch.draft_schema) !== JSON.stringify(t.draft_schema))
        || (patch.name !== undefined && patch.name !== t.name);
      Object.assign(t, patch, { updated_at: nowIso() });
      if (dirty) t.has_unpublished_changes = true;
      commit();
      return delay(t);
    },
    async publishTemplate(id, changeNote) {
      requireLeader();
      const t = db.templates.find((x) => x.id === id);
      if (!t) throw new Error('Template not found');
      if (!t.draft_schema.sections.length) throw new Error('Add at least one section before publishing');
      const v: FormTemplateVersion = {
        id: uuid(), template_id: t.id, version: t.current_version + 1, name: t.name, category: t.category,
        schema: structuredClone(t.draft_schema), change_note: changeNote ?? null, published_by: session!.userId, published_at: nowIso(),
      };
      db.versions.push(v);
      Object.assign(t, { current_version: v.version, current_version_id: v.id, status: 'published', has_unpublished_changes: false, updated_at: nowIso() });
      commit();
      return delay(v);
    },
    async listTemplateVersions(templateId) {
      if (!me()) return delay([]);
      return delay(db.versions.filter((v) => v.template_id === templateId).sort((a, b) => b.version - a.version));
    },
    async duplicateTemplate(id) {
      requireLeader();
      const t = db.templates.find((x) => x.id === id)!;
      const copy: FormTemplate = {
        ...structuredClone(t), id: uuid(), name: `${t.name} (copy)`, status: 'draft', current_version: 0,
        current_version_id: null, has_unpublished_changes: true, created_at: nowIso(), updated_at: nowIso(),
      };
      db.templates.push(copy);
      commit();
      return delay(copy);
    },

    // ---- workflow --------------------------------------------------------
    async listPipelines() {
      return delay(me() ? db.pipelines : []);
    },
    async savePipeline(p) {
      requireLeader();
      const ex = db.pipelines.find((x) => x.module === p.module);
      if (ex) ex.statuses = p.statuses; else db.pipelines.push(p);
      commit();
      await delay(null);
    },
    async listRules() {
      return delay(isLeader() ? [...db.rules].sort((a, b) => a.module.localeCompare(b.module) || a.priority - b.priority) : []);
    },
    async saveRule(r) {
      requireLeader();
      if (r.id) {
        const ex = db.rules.find((x) => x.id === r.id)!;
        Object.assign(ex, r, { updated_at: nowIso() });
        commit();
        return delay(ex);
      }
      const row: WorkflowRule = {
        id: uuid(), name: r.name ?? 'New rule', description: r.description ?? null, module: r.module ?? 'safety_event',
        trigger_event: r.trigger_event ?? 'record_created', trigger_config: r.trigger_config ?? {},
        approval_chain: r.approval_chain ?? [], actions: r.actions ?? [], is_enabled: r.is_enabled ?? true,
        priority: r.priority ?? 100, updated_at: nowIso(),
      };
      db.rules.push(row);
      commit();
      return delay(row);
    },
    async deleteRule(id) {
      requireLeader();
      db.rules = db.rules.filter((x) => x.id !== id);
      commit();
      await delay(null);
    },
    async testRules(module: WorkflowModule, event, record, old) {
      requireLeader();
      return delay(db.rules
        .filter((r) => r.module === module && r.is_enabled && ruleMatches(r, event, record, old))
        .sort((a, b) => a.priority - b.priority));
    },

    // ---- tickets ---------------------------------------------------------
    async listTickets() {
      const m = me();
      if (!m) return delay([]);
      return delay(db.tickets.filter((t) => t.profile_id === m.id || m.role === 'leader'
        || (m.role === 'contractor' && t.organization_id === m.organization_id)));
    },
    async saveTicket(t) {
      const m = requireMe();
      const worker = db.profiles.find((p) => p.id === t.profile_id);
      if (!worker) throw new Error('Worker not found');
      const allowed = worker.id === m.id || m.role === 'leader'
        || (m.role === 'contractor' && worker.organization_id === m.organization_id);
      if (!allowed) throw new Error('Permission denied');
      if (t.id) {
        const ex = db.tickets.find((x) => x.id === t.id)!;
        Object.assign(ex, t, { organization_id: worker.organization_id });
        commit();
        return delay(ex);
      }
      const row = {
        id: uuid(), profile_id: worker.id, organization_id: worker.organization_id, ticket_type: t.ticket_type ?? '',
        ticket_number: t.ticket_number ?? null, issuer: t.issuer ?? null, issued_on: t.issued_on ?? null,
        expires_on: t.expires_on ?? null, verified_at: m.role === 'leader' ? nowIso() : null, created_at: nowIso(),
      };
      db.tickets.push(row);
      commit();
      return delay(row);
    },
    async deleteTicket(id) {
      const m = requireMe();
      const t = db.tickets.find((x) => x.id === id);
      if (!t) return;
      if (!(t.profile_id === m.id || m.role === 'leader' || (isContractor() && t.organization_id === m.organization_id))) {
        throw new Error('Permission denied');
      }
      db.tickets = db.tickets.filter((x) => x.id !== id);
      commit();
      await delay(null);
    },

    // ---- notifications ---------------------------------------------------
    async listNotifications() {
      return delay(db.notifications.filter((n) => n.user_id === session?.userId));
    },
    async markNotificationRead(id) {
      const n = db.notifications.find((x) => x.id === id && x.user_id === session?.userId);
      if (n) { n.read_at = nowIso(); commit(); }
      await delay(null);
    },
  };
  return api;
}
