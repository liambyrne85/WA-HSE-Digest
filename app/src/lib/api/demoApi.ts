import type { Api, DemoAccount, Session } from './types';
import { buildDemoSeed, type DemoDb } from './demoSeed';
import { computeSummary, MODULE_PREFIX, nextStatus, resolveSubmitStatus, ruleRecord } from '../recordsLogic';
import type {
  FormTemplate, FormTemplateVersion, Invitation, Profile, RecordApproval, RecordRow, WorkflowModule, WorkflowRule, WorkflowTrigger,
} from '../types';

/**
 * Local demo backend. Persists to localStorage and imitates the database RLS
 * policies so each role sees what it would see in production. It is NOT a
 * security boundary — production access control lives in Postgres RLS.
 */
const DB_KEY = 'fieldops-demo-db-v2';
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

  // ---- records engine (mirrors the database triggers) ------------------------
  const pipelines = () => db.pipelines;
  const canSee = (r: RecordRow) => {
    const m = me();
    if (!m) return false;
    return m.role === 'leader' || r.submitted_by === m.id
      || (m.role === 'contractor' && r.organization_id === m.organization_id)
      || db.approvals.some((a) => a.submission_id === r.id && a.status === 'pending' && a.approver_role === m.role);
  };
  const logEvent = (submission_id: string, kind: 'created' | 'status' | 'approval_requested' | 'approval' | 'comment',
    extra: { from_status?: string | null; to_status?: string | null; body?: string | null; actor?: string | null } = {}) => {
    db.events.push({ id: uuid(), submission_id, kind, from_status: extra.from_status ?? null, to_status: extra.to_status ?? null,
      body: extra.body ?? null, actor: extra.actor === undefined ? session?.userId ?? null : extra.actor, created_at: nowIso() });
  };
  const runRules = (module: WorkflowModule, event: WorkflowTrigger, rec: Record<string, unknown>, old?: Record<string, unknown>) => {
    const recId = rec.id as string | undefined;
    for (const r of [...db.rules].filter((x) => x.module === module && x.trigger_event === event && x.is_enabled).sort((a, b) => a.priority - b.priority)) {
      if (!ruleMatches(r, event, rec, old)) continue;
      if (recId && r.approval_chain.length && !db.approvals.some((a) => a.submission_id === recId && a.rule_id === r.id && ['waiting', 'pending'].includes(a.status))) {
        const first = Math.min(...r.approval_chain.map((s) => s.step));
        for (const s of r.approval_chain) {
          db.approvals.push({ id: uuid(), submission_id: recId, rule_id: r.id, step: s.step, approver_role: s.role, job_role_id: s.job_role_id ?? null,
            status: s.step === first ? 'pending' : 'waiting', due_at: s.step === first && s.sla_hours ? new Date(Date.now() + s.sla_hours * 36e5).toISOString() : null,
            decided_by: null, decided_at: null, comment: null, created_at: nowIso() });
        }
        logEvent(recId, 'approval_requested', { body: r.name, actor: null });
      }
      for (const a of r.actions) {
        if (a.type !== 'in_app') continue;
        const msg = `${rec.reference ? `${rec.reference}: ` : ''}${a.message || r.name}`;
        const targets = db.profiles.filter((p) => p.is_active && a.recipients.some((rc) =>
          (rc.startsWith('role:') && p.role === rc.slice(5) && (p.role !== 'contractor' || p.organization_id === rec.organization_id))
          || (rc === 'submitter' && p.id === rec.submitted_by)));
        for (const p of targets) {
          db.notifications.push({ id: uuid(), user_id: p.id, title: r.name, body: msg, link: (rec.link as string) ?? null, read_at: null, created_at: nowIso() });
        }
      }
    }
  };
  const afterWrite = (row: RecordRow, prev: RecordRow | null) => {
    if (!prev) logEvent(row.id, 'created', { to_status: row.status, actor: row.submitted_by });
    else if (prev.status !== row.status) logEvent(row.id, 'status', { from_status: prev.status, to_status: row.status });
    if (row.status === 'draft') return;
    const rec = ruleRecord(row as unknown as RecordRow & Record<string, unknown>);
    const old = prev ? (prev as unknown as Record<string, unknown>) : undefined;
    if (!prev || prev.status === 'draft') {
      runRules(row.module, 'record_created', rec);
      runRules(row.module, 'field_condition', rec);
    }
    if (!prev || prev.status !== row.status) runRules(row.module, 'status_changed', rec, old);
  };
  const recordsApi = {
    async listRecords(module?: WorkflowModule) {
      return delay(db.records.filter((r) => canSee(r) && (!module || r.module === module))
        .sort((a, b) => b.created_at.localeCompare(a.created_at)));
    },
    async getRecord(id: string) {
      const record = db.records.find((r) => r.id === id);
      if (!record || !canSee(record)) return delay(null);
      const version = db.versions.find((v) => v.id === record.template_version_id)!;
      return delay({
        record, version,
        approvals: db.approvals.filter((a) => a.submission_id === id).sort((a, b) => a.step - b.step),
        events: db.events.filter((e) => e.submission_id === id).sort((a, b) => a.created_at.localeCompare(b.created_at)),
      });
    },
    async getTemplateVersion(id: string) {
      return delay(db.versions.find((v) => v.id === id) ?? null);
    },
    async saveRecord(input: { id: string; template_version_id: string; project_id: string | null; answers: Record<string, unknown>; status: 'draft' | 'submitted'; isNew: boolean }) {
      const m = requireMe();
      const version = db.versions.find((v) => v.id === input.template_version_id);
      if (!version) throw new Error('Template version not found');
      if (input.project_id && !canAccessProject(input.project_id)) throw new Error("You don't have access to that project");
      const prev = input.isNew ? null : db.records.find((r) => r.id === input.id) ?? null;
      if (!input.isNew) {
        if (!prev || !canSee(prev)) throw new Error('Record not found');
        if (m.role !== 'leader' && !(prev.submitted_by === m.id && ['draft', 'rejected', 'returned'].includes(prev.status))) {
          throw new Error('This record can no longer be edited');
        }
      }
      const summary = computeSummary(version.schema, input.answers);
      const module = version.category as WorkflowModule;
      let status: string = input.status;
      let submitted_at = prev?.submitted_at ?? null;
      if (input.status === 'submitted' && (!prev || prev.status !== 'submitted')) {
        status = resolveSubmitStatus(pipelines(), module, version.schema, Number(summary.critical_failures) || 0);
        submitted_at = submitted_at ?? nowIso();
      }
      let row: RecordRow;
      if (prev) {
        row = { ...prev, project_id: input.project_id, answers: input.answers, summary, status, submitted_at, updated_at: nowIso(),
          last_status_change_at: prev.status !== status ? nowIso() : prev.last_status_change_at };
        db.records = db.records.map((r) => (r.id === row.id ? row : r));
      } else {
        const n = (db.counters[module] ?? 0) + 1;
        db.counters[module] = n;
        row = { id: input.id, template_version_id: version.id, module, reference: `${MODULE_PREFIX[module]}-${String(n).padStart(5, '0')}`,
          title: version.name, project_id: input.project_id, organization_id: m.organization_id, submitted_by: m.id, status,
          answers: input.answers, summary, submitted_at, created_at: nowIso(), updated_at: nowIso(), last_status_change_at: nowIso() };
        db.records.push(row);
      }
      afterWrite(row, prev);
      commit();
      return delay(row);
    },
    async setRecordStatus(id: string, status: string) {
      requireLeader();
      const prev = db.records.find((r) => r.id === id)!;
      const row = { ...prev, status, last_status_change_at: nowIso(), updated_at: nowIso() };
      db.records = db.records.map((r) => (r.id === id ? row : r));
      afterWrite(row, prev);
      commit();
      await delay(null);
    },
    async deleteRecord(id: string) {
      const m = requireMe();
      const r = db.records.find((x) => x.id === id);
      if (!r) return;
      if (!(m.role === 'leader' || (r.submitted_by === m.id && r.status === 'draft'))) throw new Error('Only drafts can be deleted');
      db.records = db.records.filter((x) => x.id !== id);
      db.approvals = db.approvals.filter((x) => x.submission_id !== id);
      db.events = db.events.filter((x) => x.submission_id !== id);
      commit();
      await delay(null);
    },
    async decideApproval(approvalId: string, decision: 'approved' | 'rejected', comment?: string) {
      const m = requireMe();
      const a = db.approvals.find((x) => x.id === approvalId);
      if (!a || a.status !== 'pending') throw new Error('This approval step is no longer waiting for a decision');
      if (!(m.role === 'leader' || (m.role === a.approver_role && (!a.job_role_id || m.job_role_id === a.job_role_id)))) {
        throw new Error('You are not an approver for this step');
      }
      if (decision === 'rejected' && !comment?.trim()) throw new Error('Add a comment explaining what needs to change');
      Object.assign(a, { status: decision, decided_by: m.id, decided_at: nowIso(), comment: comment?.trim() || null });
      const prev = db.records.find((r) => r.id === a.submission_id)!;
      logEvent(prev.id, 'approval', { body: `${decision === 'approved' ? 'Approved' : 'Rejected'}${comment?.trim() ? `: ${comment.trim()}` : ''}` });
      let target: string | null = null;
      if (decision === 'approved') {
        const nxt = db.approvals.filter((x) => x.submission_id === prev.id && x.rule_id === a.rule_id && x.status === 'waiting').sort((x, y) => x.step - y.step)[0];
        if (nxt) nxt.status = 'pending';
        else if (!db.approvals.some((x) => x.submission_id === prev.id && ['waiting', 'pending'].includes(x.status))) {
          target = nextStatus(pipelines(), prev.module, prev.status);
        }
      } else {
        db.approvals.filter((x) => x.submission_id === prev.id && ['waiting', 'pending'].includes(x.status)).forEach((x) => { x.status = 'cancelled'; });
        const keys = pipelines().find((p) => p.module === prev.module)?.statuses.map((s) => s.key) ?? [];
        target = keys.includes('rejected') ? 'rejected' : keys.includes('returned') ? 'returned' : 'draft';
      }
      if (target) {
        const row = { ...prev, status: target, last_status_change_at: nowIso() };
        db.records = db.records.map((r) => (r.id === row.id ? row : r));
        afterWrite(row, prev);
      }
      commit();
      await delay(null);
    },
    async addComment(recordId: string, body: string) {
      const r = db.records.find((x) => x.id === recordId);
      if (!r || !canSee(r)) throw new Error('Record not found');
      logEvent(recordId, 'comment', { body });
      commit();
      await delay(null);
    },
    async listMyPendingApprovals() {
      const m = me();
      if (!m) return delay([]);
      return delay(db.approvals
        .filter((a) => a.status === 'pending' && (m.role === 'leader' || a.approver_role === m.role))
        .map((a) => ({ ...a, record: db.records.find((r) => r.id === a.submission_id)! }))
        .filter((a) => a.record) as (RecordApproval & { record: RecordRow })[]);
    },
    async fileUrl(ref: string) { return ref; },
    async listDirectory() {
      const m = me();
      if (!m) return delay([]);
      return delay(db.profiles.filter((p) => m.role === 'leader'
        || (p.is_active && m.role === 'employee' && p.role !== 'contractor')
        || (p.is_active && m.role === 'contractor' && p.organization_id === m.organization_id))
        .map(({ id, full_name, role, organization_id }) => ({ id, full_name, role, organization_id })));
    },
    async getSettings() { return delay(db.settings); },
    async saveSettings(patch: Partial<DemoDb['settings']>) {
      requireLeader();
      db.settings = { ...db.settings, ...patch };
      commit();
      return delay(db.settings);
    },
    async uploadLogo(file: File) {
      requireLeader();
      return new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.onerror = () => rej(new Error('Could not read the file'));
        r.readAsDataURL(file);
      });
    },
  };

  // Seed a few sample records the first time so lists aren't empty.
  if (!db.records.length && !(db as Partial<DemoDb>).counters?.safety_event) {
    const ver = (cat: string) => db.versions.find((v) => v.category === cat)!;
    const asUser = (uid: string, fn: () => void) => { const s = session; session = { userId: uid, email: '' }; try { fn(); } finally { session = s; } };
    const mk = (uid: string, cat: string, project: string | null, answers: Record<string, unknown>) => asUser(uid, () => {
      void recordsApi.saveRecord({ id: uuid(), template_version_id: ver(cat).id, project_id: project, answers, status: 'submitted', isNew: true });
    });
    mk('u-emp', 'safety_event', 'p-1', { 'q-type': 'Near Miss', 'q-sev': 'High', 'q-desc': 'Light vehicle entered excavator swing radius while loading trucks. No contact.', 'q-made-safe': 'yes', 'q-actions': 'Stopped work, re-briefed spotter, exclusion zone re-marked with bunting.' });
    mk('u-acme1', 'daily_field_report', 'p-1', { 'q-shift': 'Day', 'q-weather': 'Hot (over 35°C)',
      'q-crew': [{ name: 'Alice Nguyen', role: 'Supervisor', hours: '10' }, { name: 'Tom Walsh', role: 'Operator', hours: '10' }, { name: 'Ravi Patel', role: 'Labourer', hours: '9.5' }],
      'q-plant': [{ plant: 'EX-12 30t excavator', plant_hours: '8' }], 'q-work': 'Bulk cut ch 1200–1350, 1,800 m³ to fill.', 'q-incidents': 'no' });
    mk('u-acme1', 'plant_prestart', 'p-2', { 'q-plant': 'Excavator', 'q-fleet': 'EX-12', 'q-hours': '4521', 'q-fluids': 'pass', 'q-leaks': 'pass', 'q-tracks': 'pass', 'q-glass': 'pass',
      'q-seatbelt': 'pass', 'q-alarm': 'fail', 'q-brakes': 'pass', 'q-fire': 'yes', 'q-fit': 'yes' });
    db.notifications = db.notifications.filter((n) => !n.body?.match(/^(SE|DFR|PS)-/) || n.user_id === 'u-leader');
    commit();
  }

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

    ...recordsApi,

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
