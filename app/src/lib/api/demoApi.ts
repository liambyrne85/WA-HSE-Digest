import type { Api, DemoAccount, Session } from './types';
import { buildDemoSeed, type DemoDb } from './demoSeed';
import { computeSummary, MODULE_PREFIX, nextStatus, resolveSubmitStatus, ruleRecord } from '../recordsLogic';
import { perthToday } from '../labels';
import type {
  FormTemplate, FormTemplateVersion, Profile, ProjectMember, RecordApproval, RecordRow, WorkflowModule, WorkflowRule, WorkflowTrigger,
} from '../types';

/**
 * Local demo backend. Persists to localStorage and imitates the database RLS
 * policies so each role sees what it would see in production. It is NOT a
 * security boundary — production access control lives in Postgres RLS.
 */
const DB_KEY = 'fieldops-demo-db-v3';
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
  // ---- access rules (mirror supabase/migrations/*_people_access.sql) ---------
  const today = () => perthToday();
  const orgOf = (p?: Profile) => db.organizations.find((o) => o.id === p?.organization_id);
  const isAdmin = () => me()?.role === 'admin';
  const isLeader = () => ['admin', 'hset'].includes(me()?.role ?? '');
  const isInternal = () => orgOf(me())?.type === 'internal';
  const isProjectLead = () => ['project_manager', 'supervisor'].includes(me()?.role ?? '');
  const requireLeader = () => {
    if (!isLeader()) throw new Error('Permission denied: Admin or HSET only');
  };
  const requireAdmin = () => {
    if (!isAdmin()) throw new Error('Permission denied: Admin only');
  };
  const openOn = (mb: ProjectMember, day = today()) => mb.start_date <= day && (!mb.end_date || mb.end_date >= day);
  const projectIdsFor = (p?: Profile) => {
    if (!p?.is_active) return [] as string[];
    return db.members.filter((mb) => mb.profile_id === p.id && openOn(mb)
      && (['project_manager', 'supervisor'].includes(p.role) || (p.role === 'worker' && mb.is_primary))).map((mb) => mb.project_id);
  };
  const myProjectIds = () => projectIdsFor(me());
  const canAccessProject = (pid: string) => isLeader() || myProjectIds().includes(pid);
  const canSeePerson = (pid: string) => {
    const m = me();
    if (!m) return pid === session?.userId;
    if (pid === m.id || isLeader()) return true;
    if (!isProjectLead()) return false;
    const mine = myProjectIds();
    const them = db.profiles.find((x) => x.id === pid);
    return db.members.some((mb) => mb.profile_id === pid && mine.includes(mb.project_id) && (!mb.end_date || mb.end_date >= today()))
      && (isInternal() || them?.organization_id === m.organization_id);
  };
  const personSeesProjectRecord = (p: Profile, projectId: string | null, orgId: string | null) => {
    if (!p.is_active) return false;
    if (['admin', 'hset'].includes(p.role)) return true;
    if (!['project_manager', 'supervisor'].includes(p.role) || !projectId) return false;
    return db.members.some((mb) => mb.profile_id === p.id && mb.project_id === projectId && openOn(mb))
      && (orgOf(p)?.type === 'internal' || p.organization_id === orgId);
  };
  const checkRoleOrg = (role: string, orgId: string) => {
    const o = db.organizations.find((x) => x.id === orgId);
    if (!o) throw new Error('Company not found');
    if (['admin', 'hset'].includes(role) && o.type !== 'internal') throw new Error('Admin and HSET users must belong to your own company');
  };
  const audit = (table: string, id: string, action: 'insert' | 'update', oldData: object | null, newData: object | null) => {
    let o = oldData as Record<string, unknown> | null;
    let n = newData as Record<string, unknown> | null;
    if (action === 'update' && o && n) {
      const keys = Object.keys(n).filter((k) => k !== 'updated_at' && JSON.stringify(n![k]) !== JSON.stringify(o![k]));
      if (!keys.length) return;
      o = Object.fromEntries(keys.map((k) => [k, o![k]]));
      n = Object.fromEntries(keys.map((k) => [k, n![k]]));
    }
    db.audit.unshift({ id: Date.now() + Math.random(), table_name: table, record_id: id, action, changed_by: session?.userId ?? null,
      changed_at: nowIso(), old_data: o, new_data: n });
  };

  // ---- records engine (mirrors the database triggers) ------------------------
  const pipelines = () => db.pipelines;
  const canSee = (r: RecordRow) => {
    const m = me();
    if (!m) return false;
    return isLeader() || r.submitted_by === m.id
      || (isProjectLead() && !!r.project_id && myProjectIds().includes(r.project_id)
          && (isInternal() || r.organization_id === m.organization_id));
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
          (rc.startsWith('role:') && p.role === rc.slice(5) && personSeesProjectRecord(p, (rec.project_id as string) ?? null, (rec.organization_id as string) ?? null))
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
    async saveRecord(input: { id: string; template_version_id: string; project_id: string | null; answers: Record<string, unknown>; status: string; isNew: boolean }) {
      const m = requireMe();
      const version = db.versions.find((v) => v.id === input.template_version_id);
      if (!version) throw new Error('Template version not found');
      if (input.project_id && !canAccessProject(input.project_id)) throw new Error("You don't have access to that project");
      const prev = input.isNew ? null : db.records.find((r) => r.id === input.id) ?? null;
      if (!input.isNew) {
        if (!prev || !canSee(prev)) throw new Error('Record not found');
        if (!isLeader() && !(prev.submitted_by === m.id && ['draft', 'rejected', 'returned'].includes(prev.status))) {
          throw new Error('This record can no longer be edited');
        }
      }
      const summary = computeSummary(version.schema, input.answers);
      const module = version.category as WorkflowModule;
      if (!isLeader() && !['draft', 'submitted'].includes(input.status)) throw new Error(`Only Admin or HSET can move a record to "${input.status}"`);
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
    async archiveRecord(id: string) {
      const m = requireMe();
      const r = db.records.find((x) => x.id === id);
      if (!r) return;
      if (!(isLeader() || (r.submitted_by === m.id && r.status === 'draft'))) throw new Error('Only drafts can be archived');
      db.records = db.records.filter((x) => x.id !== id);
      commit();
      await delay(null);
    },
    async decideApproval(approvalId: string, decision: 'approved' | 'rejected', comment?: string) {
      const m = requireMe();
      const a = db.approvals.find((x) => x.id === approvalId);
      if (!a || a.status !== 'pending') throw new Error('This approval step is no longer waiting for a decision');
      const rec = db.records.find((x) => x.id === a.submission_id);
      if (!(isLeader() || (m.role === a.approver_role && !!rec && canSee(rec) && (!a.job_role_id || m.job_role_id === a.job_role_id)))) {
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
        .filter((a) => a.status === 'pending' && (isLeader() || a.approver_role === m.role))
        .map((a) => ({ ...a, record: db.records.find((r) => r.id === a.submission_id)! }))
        .filter((a) => a.record) as (RecordApproval & { record: RecordRow })[]);
    },
    async fileUrl(ref: string) { return ref; },
    async listDirectory() {
      const m = me();
      if (!m) return delay([]);
      const myOpen = db.members.filter((mb) => mb.profile_id === m.id && (!mb.end_date || mb.end_date >= today())).map((mb) => mb.project_id);
      return delay(db.profiles.filter((p) => isLeader() || canSeePerson(p.id)
        || (p.is_active && db.members.some((mb) => mb.profile_id === p.id && myOpen.includes(mb.project_id) && (!mb.end_date || mb.end_date >= today()))
            && (isInternal() || p.organization_id === m.organization_id)))
        .map(({ id, full_name, role, organization_id }) => ({ id, full_name, role, organization_id })));
    },
    async getSettings() { return delay(db.settings); },
    async saveSettings(patch: Partial<DemoDb['settings']>) {
      requireAdmin();
      db.settings = { ...db.settings, ...patch };
      commit();
      return delay(db.settings);
    },
    async uploadLogo(file: File) {
      requireAdmin();
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
    mk('u-emp', 'safety_event', 'p-1', { 'q-type': 'Near Miss', 'q-sev': 'High', 'q-desc': 'Scaffold tube dropped from lift 4 into the exclusion zone below the wharf deck. Nobody in the drop zone.', 'q-made-safe': 'yes', 'q-actions': 'Stopped work, checked toeboards and mesh on lift 4, re-briefed crew on tool tethering.' });
    mk('u-acme1', 'daily_field_report', 'p-1', { 'q-shift': 'Day', 'q-weather': 'Hot (over 35°C)',
      'q-crew': [{ name: 'Alice Nguyen', role: 'Supervisor', hours: '10' }, { name: 'Ravi Patel', role: 'Scaffolder', hours: '10' }],
      'q-plant': [{ plant: 'HIAB-03 truck', plant_hours: '3' }], 'q-work': 'Erected hung scaffold bays 12–16 under berth 3. Handover inspection booked.', 'q-incidents': 'no' });
    mk('u-acme1', 'plant_prestart', 'p-2', { 'q-plant': 'Excavator', 'q-fleet': 'EX-12', 'q-hours': '4521', 'q-fluids': 'pass', 'q-leaks': 'pass', 'q-tracks': 'pass', 'q-glass': 'pass',
      'q-seatbelt': 'pass', 'q-alarm': 'fail', 'q-brakes': 'pass', 'q-fire': 'yes', 'q-fit': 'yes' });
    db.notifications = db.notifications.filter((n) => !n.body?.match(/^(SE|DFR|PS)-/) || ['u-admin', 'u-hset'].includes(n.user_id));
    commit();
  }

  const accounts: DemoAccount[] = [
    { id: 'u-admin', label: 'Sam Carter', role: 'admin', description: 'Admin · sees everything, manages people' },
    { id: 'u-hset', label: 'Priya Shah', role: 'hset', description: 'HSET Advisor · sees everything' },
    { id: 'u-pm', label: 'Daniel Kerr', role: 'project_manager', description: 'Project Manager · Port Hedland & Karratha' },
    { id: 'u-acme1', label: 'Alice Nguyen', role: 'supervisor', description: 'Supervisor · Acme Scaffolding (subcontractor)' },
    { id: 'u-emp', label: 'Jordan Reid', role: 'worker', description: 'Scaffolder · Port Hedland' },
    { id: 'u-pending', label: 'Casey Morgan', role: 'worker', description: 'Signed up, waiting for an Admin to activate' },
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
      return delay(db.profiles.filter((p) => canSeePerson(p.id)).sort((a, b) => a.full_name.localeCompare(b.full_name)));
    },
    async updateProfile(id, patch) {
      const m = requireMe();
      const p = db.profiles.find((x) => x.id === id);
      if (!p) throw new Error('Profile not found');
      if (!isAdmin()) {
        if (id !== m.id) throw new Error('Permission denied');
        const locked: (keyof Profile)[] = ['role', 'organization_id', 'job_role_id', 'employee_number', 'start_date', 'is_scaffold_inspector', 'is_active', 'email'];
        for (const k of locked) if (k in patch && patch[k] !== p[k]) throw new Error('Only admins can change role, company, position, employee ID, start date, inspector status or account status');
      }
      const next = { ...p, ...patch };
      checkRoleOrg(next.role, next.organization_id);
      if (p.role === 'admin' && p.is_active && (next.role !== 'admin' || !next.is_active)
        && !db.profiles.some((x) => x.id !== p.id && x.role === 'admin' && x.is_active)) {
        throw new Error('Cannot remove the last active admin');
      }
      audit('profiles', p.id, 'update', { ...p }, next);
      Object.assign(p, next);
      commit();
      return delay(p);
    },
    async listOrganizations() {
      const m = me();
      if (!m) return delay([]);
      return delay(db.organizations.filter((o) => isLeader() || isInternal() || o.id === m.organization_id));
    },
    async saveOrganization(o) {
      requireAdmin();
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

    // ---- people (admin) ----------------------------------------------------
    async listInvitations() {
      if (!isAdmin()) return delay([]);
      return delay([...db.invitations].sort((a, b) => b.created_at.localeCompare(a.created_at)));
    },
    async createPerson(input, _sendInvite) {
      requireAdmin();
      const email = input.email.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Valid email required');
      if (!input.full_name?.trim()) throw new Error('Full name required');
      if (db.profiles.some((p) => p.email.toLowerCase() === email)) throw new Error('A person with this email already exists');
      checkRoleOrg(input.role, input.organization_id);
      const id = uuid();
      const row: Profile = {
        id, email, full_name: input.full_name.trim(), role: input.role, organization_id: input.organization_id,
        job_role_id: input.job_role_id ?? null, phone: input.phone ?? null, employee_number: input.employee_number ?? null,
        start_date: input.start_date ?? null, is_scaffold_inspector: !!input.is_scaffold_inspector,
        emergency_contact_name: null, emergency_contact_phone: null, is_active: true, last_seen_at: null, created_at: nowIso(),
      };
      db.profiles.push(row);
      audit('profiles', id, 'insert', null, row);
      if (input.primary_project_id) {
        const mb: ProjectMember = { id: uuid(), profile_id: id, project_id: input.primary_project_id, is_primary: true,
          start_date: input.start_date ?? today(), end_date: null, created_at: nowIso() };
        db.members.push(mb);
        audit('project_members', mb.id, 'insert', null, mb);
      }
      commit();
      return delay({ profile_id: id, invited: false });
    },
    async importPeople(rows, sendInvites) {
      requireAdmin();
      const results = [];
      for (const [i, row] of rows.entries()) {
        try {
          const r = await api.createPerson(row, sendInvites);
          results.push({ row: i + 1, email: row.email, ok: true, profile_id: r.profile_id, invited: false });
        } catch (e) {
          results.push({ row: i + 1, email: row.email, ok: false, error: e instanceof Error ? e.message : String(e) });
        }
      }
      return results;
    },
    async sendInvite() {
      requireAdmin();
      await delay(null); // demo: no email is sent
    },
    async setPersonActive(profileId, active) {
      requireAdmin();
      if (profileId === session?.userId && !active) throw new Error("You can't deactivate yourself");
      await api.updateProfile(profileId, { is_active: active });
    },
    async touchLastSeen() {
      const p = db.profiles.find((x) => x.id === session?.userId);
      if (p) { p.last_seen_at = nowIso(); commit(); }
    },
    async listProjectMembers(filter) {
      if (!me()) return delay([]);
      return delay(db.members.filter((mb) => (mb.profile_id === session?.userId || canSeePerson(mb.profile_id))
        && (!filter?.profileId || mb.profile_id === filter.profileId)
        && (!filter?.projectId || mb.project_id === filter.projectId))
        .sort((a, b) => b.start_date.localeCompare(a.start_date)));
    },
    async saveProjectMember(m) {
      requireAdmin();
      if (m.id) {
        const ex = db.members.find((x) => x.id === m.id);
        if (!ex) throw new Error('Assignment not found');
        const next = { ...ex, ...m, project_id: ex.project_id, profile_id: ex.profile_id };
        if (next.end_date && next.end_date < next.start_date) throw new Error('End date is before the start date');
        audit('project_members', ex.id, 'update', { ...ex }, next);
        Object.assign(ex, next);
        if (ex.is_primary && !ex.end_date) db.members.forEach((x) => { if (x.profile_id === ex.profile_id && x.id !== ex.id && !x.end_date) x.is_primary = false; });
        commit();
        return delay(ex);
      }
      if (!m.project_id || !m.profile_id) throw new Error('Project and person are required');
      if (db.members.some((x) => x.profile_id === m.profile_id && x.project_id === m.project_id && !x.end_date)) {
        throw new Error('This person is already assigned to that project');
      }
      const row: ProjectMember = { id: uuid(), project_id: m.project_id, profile_id: m.profile_id, is_primary: !!m.is_primary,
        start_date: m.start_date ?? today(), end_date: m.end_date ?? null, created_at: nowIso() };
      if (row.is_primary) db.members.forEach((x) => { if (x.profile_id === row.profile_id && !x.end_date) x.is_primary = false; });
      db.members.push(row);
      audit('project_members', row.id, 'insert', null, row);
      commit();
      return delay(row);
    },
    async listAudit(table, recordId) {
      const m = me();
      if (!m) return delay([]);
      if (!isLeader() && !(table === 'profiles' && recordId === m.id)) return delay([]);
      return delay(db.audit.filter((a) => a.table_name === table && a.record_id === recordId));
    },
    async uploadPersonFile(profileId, file) {
      const m = requireMe();
      if (!(isLeader() || profileId === m.id)) throw new Error('Permission denied');
      return new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.onerror = () => rej(new Error('Could not read the file'));
        r.readAsDataURL(file);
      });
    },

    // ---- job roles -------------------------------------------------------
    async listJobRoles() {
      if (!me()) return delay([]);
      return delay([...db.jobRoles].sort((a, b) => a.name.localeCompare(b.name)));
    },
    async saveJobRole(r) {
      requireAdmin();
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
      return delay(isAdmin() ? db.rates : []);
    },
    async saveJobRoleRate(rate) {
      requireAdmin();
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
    // ---- templates -------------------------------------------------------
    async listTemplates() {
      const m = me();
      if (!m) return delay([]);
      return delay(db.templates
        .filter((t) => isLeader() || (t.status === 'published' && (isInternal() || t.available_to_contractors)))
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
      return delay(isLeader() ? [...db.rules].filter((x) => !(x as WorkflowRule & { archived_at?: string }).archived_at).sort((a, b) => a.module.localeCompare(b.module) || a.priority - b.priority) : []);
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
    async archiveRule(id) {
      requireLeader();
      const ex = db.rules.find((x) => x.id === id);
      if (ex) Object.assign(ex, { is_enabled: false, archived_at: nowIso() });
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
      if (!me()) return delay([]);
      return delay(db.tickets.filter((t) => !t.archived_at && canSeePerson(t.profile_id)));
    },
    async saveTicket(t) {
      const m = requireMe();
      const worker = db.profiles.find((p) => p.id === t.profile_id);
      if (!worker) throw new Error('Person not found');
      if (!(worker.id === m.id || isLeader())) throw new Error('Only the person themselves, Admin or HSET can change licences');
      if (t.id) {
        const ex = db.tickets.find((x) => x.id === t.id)!;
        const next = { ...ex, ...t, organization_id: worker.organization_id };
        if (!isLeader()) { next.verified_at = ex.verified_at; }
        audit('worker_tickets', ex.id, 'update', { ...ex }, next);
        Object.assign(ex, next);
        commit();
        return delay(ex);
      }
      const row = {
        id: uuid(), profile_id: worker.id, organization_id: worker.organization_id, ticket_type: t.ticket_type ?? '',
        licence_class: t.licence_class ?? null, ticket_number: t.ticket_number ?? null, issuer: t.issuer ?? null,
        issued_on: t.issued_on ?? null, expires_on: t.expires_on ?? null, file_path: t.file_path ?? null,
        verified_at: isLeader() ? nowIso() : null, archived_at: null, created_at: nowIso(),
      };
      db.tickets.push(row);
      audit('worker_tickets', row.id, 'insert', null, row);
      commit();
      return delay(row);
    },
    async archiveTicket(id) {
      const m = requireMe();
      const t = db.tickets.find((x) => x.id === id);
      if (!t) return;
      if (!(t.profile_id === m.id || isLeader())) throw new Error('Permission denied');
      t.archived_at = nowIso();
      audit('worker_tickets', t.id, 'update', { archived_at: null }, { archived_at: t.archived_at });
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
