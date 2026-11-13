import { clsx } from 'clsx';
import { Building2, Lock, Mail, Pencil, Plus, RefreshCw, Search, ShieldCheck, UserPlus, Users, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Avatar, Badge, Button, Checkbox, EmptyState, ErrorBanner, Field, Input, Modal, PageHeader, Select, Spinner, Tabs, Textarea, Toggle,
} from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { api } from '../../lib/api';
import { ROLE_COLOR, ROLE_DESCRIPTION, ROLE_LABEL, formatDate } from '../../lib/labels';
import type { AppRole, Invitation, JobRole, JobRoleRate, Organization, OrgType, Profile } from '../../lib/types';
import { errMsg, useAsync } from '../../lib/useAsync';

type Tab = 'people' | 'companies' | 'invitations' | 'jobroles';
const ROLES: AppRole[] = ['leader', 'employee', 'contractor'];

function RolePicker({ value, onChange }: { value: AppRole; onChange: (r: AppRole) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {ROLES.map((r) => (
        <button key={r} type="button" onClick={() => onChange(r)} aria-pressed={value === r}
          className={clsx('rounded-xl border-2 p-3 text-left transition-colors',
            value === r ? 'border-brand-500 bg-brand-50' : 'border-steel-200 bg-white hover:border-steel-300')}>
          <Badge color={ROLE_COLOR[r]}>{ROLE_LABEL[r]}</Badge>
          <p className="mt-2 text-xs leading-snug text-steel-600">{ROLE_DESCRIPTION[r]}</p>
        </button>
      ))}
    </div>
  );
}

function makeTempPassword() {
  const words = ['Dozer', 'Grader', 'Roller', 'Loader', 'Tipper', 'Crane', 'Bobcat', 'Scraper'];
  const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)]!;
  return `${pick(words)}-${pick(words)}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function companiesFor(role: AppRole, orgs: Organization[]) {
  const t: OrgType = role === 'contractor' ? 'contractor' : 'internal';
  return orgs.filter((o) => o.type === t && o.is_active);
}
function jobRolesFor(role: AppRole, jobRoles: JobRole[]) {
  const t: OrgType = role === 'contractor' ? 'contractor' : 'internal';
  return jobRoles.filter((j) => j.is_active && j.applies_to.includes(t));
}

// ---------------------------------------------------------------------------
function InviteModal({ orgs, jobRoles, onClose, onDone }: { orgs: Organization[]; jobRoles: JobRole[]; onClose: () => void; onDone: () => void }) {
  const [role, setRole] = useState<AppRole>('employee');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [orgId, setOrgId] = useState('');
  const [jobRoleId, setJobRoleId] = useState('');
  const [method, setMethod] = useState<'email' | 'password'>('email');
  const [tempPassword, setTempPassword] = useState(() => makeTempPassword());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const toast = useToast();
  const companies = companiesFor(role, orgs);

  useEffect(() => {
    setOrgId(companies.length === 1 || role !== 'contractor' ? companies[0]?.id ?? '' : '');
    setJobRoleId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  const submit = async () => {
    if (!orgId) return setError(role === 'contractor' ? 'Choose the contractor company' : 'No internal company configured');
    setBusy(true);
    setError(null);
    try {
      await api.inviteUser({
        email, full_name: name || undefined, role, organization_id: orgId, job_role_id: jobRoleId || null,
        temp_password: method === 'password' ? tempPassword : undefined,
      });
      if (method === 'password') {
        setCreated({ email, password: tempPassword });
      } else {
        toast(`Invitation sent to ${email}`);
        onDone();
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <Modal open onClose={onDone} title="Account created"
        footer={<Button onClick={onDone}>Done</Button>}>
        <div className="space-y-4">
          <p className="text-steel-700">Give these sign-in details to the person directly (in person, SMS or phone). They'll be asked to choose their own password the first time they sign in.</p>
          <dl className="space-y-3 rounded-xl border-2 border-steel-200 bg-steel-50 p-4">
            <div><dt className="text-xs font-bold uppercase text-steel-500">Email</dt><dd className="select-all font-mono text-lg">{created.email}</dd></div>
            <div><dt className="text-xs font-bold uppercase text-steel-500">Temporary password</dt><dd className="select-all font-mono text-lg">{created.password}</dd></div>
          </dl>
          <p className="text-xs text-steel-500">This password isn't shown again. If it's lost, delete the person's access and create them again, or have them use "Forgot password".</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title="Add user" wide
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} loading={busy} icon={method === 'email' ? <Mail className="h-5 w-5" /> : <UserPlus className="h-5 w-5" />} disabled={!email}>
          {method === 'email' ? 'Send invitation' : 'Create account'}
        </Button>
      </>}>
      <div className="space-y-4">
        {error && <ErrorBanner message={error} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email" required><Input type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus placeholder="name@company.com.au" /></Field>
          <Field label="Full name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        </div>
        <div>
          <span className="label">Role</span>
          <RolePicker value={role} onChange={setRole} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={role === 'contractor' ? 'Contractor company' : 'Company'} required
            hint={role === 'contractor' ? 'The contractor will only ever see this company\'s data.' : 'Leaders and employees belong to the internal company.'}>
            <Select value={orgId} onChange={(e) => setOrgId(e.target.value)} disabled={role !== 'contractor'}>
              <option value="">Select company…</option>
              {companies.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
          </Field>
          <Field label="Job role / classification">
            <Select value={jobRoleId} onChange={(e) => setJobRoleId(e.target.value)}>
              <option value="">— None —</option>
              {jobRolesFor(role, jobRoles).map((j) => <option key={j.id} value={j.id}>{j.name}{j.classification ? ` (${j.classification})` : ''}</option>)}
            </Select>
          </Field>
        </div>
        <div>
          <span className="label">How will they get access?</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {([['email', 'Email an invitation', 'They get a link by email and set up their own sign-in.'],
               ['password', 'Set a temporary password', "Account is created now. You pass on the details; they change the password at first sign-in."]] as const).map(([k, t, d]) => (
              <button key={k} type="button" aria-pressed={method === k} onClick={() => setMethod(k)}
                className={clsx('rounded-xl border-2 p-3 text-left', method === k ? 'border-brand-500 bg-brand-50' : 'border-steel-200 bg-white hover:border-steel-300')}>
                <span className="block font-bold">{t}</span>
                <span className="mt-1 block text-xs text-steel-600">{d}</span>
              </button>
            ))}
          </div>
        </div>
        {method === 'password' && (
          <Field label="Temporary password" hint="At least 8 characters. Shown again after the account is created.">
            <div className="flex gap-2">
              <Input value={tempPassword} onChange={(e) => setTempPassword(e.target.value)} className="font-mono" />
              <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => setTempPassword(makeTempPassword())} aria-label="Generate a new password" />
            </div>
          </Field>
        )}
        <p className="rounded-lg bg-steel-50 p-3 text-xs text-steel-600">
          Their role and company are set from here, on the server. People can't choose them when they sign in.
        </p>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
function EditUserModal({ user, orgs, jobRoles, onClose, onSaved, isSelf }: {
  user: Profile; orgs: Organization[]; jobRoles: JobRole[]; onClose: () => void; onSaved: () => void; isSelf: boolean;
}) {
  const [u, setU] = useState<Profile>(user);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setU((x) => ({ ...x, [k]: v }));
  const companies = companiesFor(u.role, orgs);

  const changeRole = (r: AppRole) => {
    const valid = companiesFor(r, orgs);
    setU((x) => ({
      ...x, role: r,
      organization_id: valid.some((o) => o.id === x.organization_id) ? x.organization_id : r === 'contractor' ? '' : valid[0]?.id ?? '',
    }));
  };

  const save = async () => {
    if (!u.organization_id) return setError('Choose a company');
    setBusy(true);
    setError(null);
    try {
      await api.updateProfile(u.id, {
        full_name: u.full_name, phone: u.phone, role: u.role, organization_id: u.organization_id,
        job_role_id: u.job_role_id || null, employee_number: u.employee_number, is_active: u.is_active,
      });
      toast('User updated');
      onSaved();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open drawer onClose={onClose} title="Edit user"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
      <div className="space-y-4">
        {error && <ErrorBanner message={error} />}
        <div className="flex items-center gap-3">
          <Avatar name={u.full_name} size="lg" />
          <div className="min-w-0">
            <p className="truncate text-lg font-bold">{u.full_name}</p>
            <p className="truncate text-sm text-steel-500">{u.email}</p>
          </div>
        </div>
        <div className="flex items-center justify-between rounded-xl border-2 border-steel-200 p-3">
          <div>
            <p className="font-bold">Account active</p>
            <p className="text-xs text-steel-500">{u.is_active ? 'Can sign in and access data' : 'No access to any data'}</p>
          </div>
          <Toggle checked={u.is_active} onChange={(v) => set('is_active', v)} label="Account active" disabled={isSelf} />
        </div>
        <Field label="Full name"><Input value={u.full_name} onChange={(e) => set('full_name', e.target.value)} /></Field>
        <div><span className="label">Role</span><RolePicker value={u.role} onChange={changeRole} /></div>
        {isSelf && u.role !== 'leader' && <p className="text-xs font-semibold text-amber-700">You're changing your own role — you'll lose admin access.</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company" required>
            <Select value={u.organization_id} onChange={(e) => set('organization_id', e.target.value)} disabled={u.role !== 'contractor'}>
              <option value="">Select…</option>
              {companies.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
          </Field>
          <Field label="Job role / classification">
            <Select value={u.job_role_id ?? ''} onChange={(e) => set('job_role_id', e.target.value || null)}>
              <option value="">— None —</option>
              {jobRolesFor(u.role, jobRoles).map((j) => <option key={j.id} value={j.id}>{j.name}{j.classification ? ` (${j.classification})` : ''}</option>)}
            </Select>
          </Field>
          <Field label="Employee / worker no."><Input value={u.employee_number ?? ''} onChange={(e) => set('employee_number', e.target.value || null)} /></Field>
          <Field label="Phone"><Input type="tel" value={u.phone ?? ''} onChange={(e) => set('phone', e.target.value || null)} /></Field>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
function CompanyModal({ initial, onClose, onSaved }: { initial: Partial<Organization>; onClose: () => void; onSaved: () => void }) {
  const [o, setO] = useState<Partial<Organization>>({ type: 'contractor', is_active: true, ...initial });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const set = <K extends keyof Organization>(k: K, v: Organization[K]) => setO((x) => ({ ...x, [k]: v }));
  const save = async () => {
    if (!o.name?.trim()) return setError('Company name is required');
    setBusy(true);
    try {
      await api.saveOrganization(o);
      toast(o.id ? 'Company updated' : 'Contractor company added');
      onSaved();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={o.id ? 'Edit company' : 'Add contractor company'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
      <div className="space-y-4">
        {error && <ErrorBanner message={error} />}
        <Field label="Company name" required><Input value={o.name ?? ''} onChange={(e) => set('name', e.target.value)} autoFocus /></Field>
        <Field label="ABN"><Input value={o.abn ?? ''} onChange={(e) => set('abn', e.target.value)} inputMode="numeric" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact name"><Input value={o.contact_name ?? ''} onChange={(e) => set('contact_name', e.target.value)} /></Field>
          <Field label="Contact phone"><Input type="tel" value={o.contact_phone ?? ''} onChange={(e) => set('contact_phone', e.target.value)} /></Field>
        </div>
        <Field label="Contact email"><Input type="email" value={o.contact_email ?? ''} onChange={(e) => set('contact_email', e.target.value)} /></Field>
        <Field label="Notes"><Textarea value={o.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
        {o.type === 'contractor' && (
          <div className="flex items-center justify-between rounded-xl border-2 border-steel-200 p-3">
            <div><p className="font-bold">Active</p><p className="text-xs text-steel-500">Inactive companies can't be assigned to new users or projects.</p></div>
            <Toggle checked={!!o.is_active} onChange={(v) => set('is_active', v)} label="Active" />
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
function JobRoleModal({ initial, rate, onClose, onSaved }: { initial: Partial<JobRole>; rate?: JobRoleRate; onClose: () => void; onSaved: () => void }) {
  const [j, setJ] = useState<Partial<JobRole>>({ applies_to: ['internal', 'contractor'], is_active: true, ...initial });
  const [cost, setCost] = useState(rate?.cost_rate?.toString() ?? '');
  const [charge, setCharge] = useState(rate?.charge_rate?.toString() ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const toggleApplies = (t: OrgType, v: boolean) => setJ((x) => ({ ...x, applies_to: v ? [...(x.applies_to ?? []), t] : (x.applies_to ?? []).filter((y) => y !== t) }));
  const save = async () => {
    if (!j.name?.trim()) return setError('Name is required');
    setBusy(true);
    try {
      const saved = await api.saveJobRole({ ...j, name: j.name.trim() });
      await api.saveJobRoleRate({ job_role_id: saved.id, cost_rate: cost ? Number(cost) : null, charge_rate: charge ? Number(charge) : null, currency: 'AUD' });
      toast('Job role saved');
      onSaved();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={j.id ? 'Edit job role' : 'New job role'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
      <div className="space-y-4">
        {error && <ErrorBanner message={error} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Job role" required><Input value={j.name ?? ''} onChange={(e) => setJ({ ...j, name: e.target.value })} autoFocus /></Field>
          <Field label="Classification" hint="Award level, grade, etc."><Input value={j.classification ?? ''} onChange={(e) => setJ({ ...j, classification: e.target.value })} /></Field>
        </div>
        <div>
          <span className="label">Available to</span>
          <Checkbox label="Internal staff" checked={!!j.applies_to?.includes('internal')} onChange={(v) => toggleApplies('internal', v)} />
          <Checkbox label="Contractors" checked={!!j.applies_to?.includes('contractor')} onChange={(v) => toggleApplies('contractor', v)} />
        </div>
        <div className="rounded-xl border-2 border-amber-200 bg-amber-50/60 p-3">
          <p className="mb-3 flex items-center gap-2 text-sm font-bold text-amber-900"><Lock className="h-4 w-4" /> Commercial rates — visible to Leaders only</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Cost rate (AUD/hr)"><Input type="number" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
            <Field label="Charge-out rate (AUD/hr)"><Input type="number" inputMode="decimal" value={charge} onChange={(e) => setCharge(e.target.value)} /></Field>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-semibold">Active</span>
          <Toggle checked={!!j.is_active} onChange={(v) => setJ({ ...j, is_active: v })} label="Active" />
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
export default function UsersPage() {
  const { profile: me } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>('people');
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState<AppRole | 'all' | 'inactive'>('all');
  const [inviteOpen, setInviteOpen] = useState(params.get('invite') === '1');
  const [editUser, setEditUser] = useState<Profile | null>(null);
  const [editOrg, setEditOrg] = useState<Partial<Organization> | null>(null);
  const [editJob, setEditJob] = useState<Partial<JobRole> | null>(null);

  const { data, loading, error, reload } = useAsync(async () => {
    const [profiles, orgs, invitations, jobRoles, rates] = await Promise.all([
      api.listProfiles(), api.listOrganizations(), api.listInvitations(), api.listJobRoles(), api.listJobRoleRates(),
    ]);
    return { profiles, orgs, invitations, jobRoles, rates };
  }, []);

  useEffect(() => {
    if (params.get('invite') === '1') { params.delete('invite'); setParams(params, { replace: true }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const orgName = (id: string) => data?.orgs.find((o) => o.id === id)?.name ?? '—';
  const jobName = (id: string | null) => (id ? data?.jobRoles.find((j) => j.id === id)?.name : null);

  const people = useMemo(() => (data?.profiles ?? []).filter((p) => {
    if (roleFilter === 'inactive' && p.is_active) return false;
    if (roleFilter !== 'all' && roleFilter !== 'inactive' && p.role !== roleFilter) return false;
    const s = q.trim().toLowerCase();
    return !s || [p.full_name, p.email, orgName(p.organization_id)].some((x) => x.toLowerCase().includes(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [data, q, roleFilter]);

  const pending = data?.invitations.filter((i) => i.status === 'pending') ?? [];

  const invAction = async (inv: Invitation, action: 'resend' | 'revoke') => {
    try {
      if (action === 'resend') await api.resendInvitation(inv.id);
      else await api.revokeInvitation(inv.id);
      toast(action === 'resend' ? `Invitation re-sent to ${inv.email}` : 'Invitation revoked');
      void reload();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  return (
    <div>
      <PageHeader eyebrow="Administration" title="Users & Contractors"
        subtitle="Invite people, assign roles, link contractors to their company and set job classifications."
        actions={<>
          <Button variant="secondary" icon={<Building2 className="h-5 w-5" />} onClick={() => { setTab('companies'); setEditOrg({}); }}>Add company</Button>
          <Button icon={<UserPlus className="h-5 w-5" />} onClick={() => setInviteOpen(true)}>Invite user</Button>
        </>} />

      <Tabs value={tab} onChange={setTab} tabs={[
        { key: 'people', label: 'People', count: data?.profiles.length },
        { key: 'companies', label: 'Companies', count: data?.orgs.length },
        { key: 'invitations', label: 'Invitations', count: pending.length },
        { key: 'jobroles', label: 'Job Roles & Rates', count: data?.jobRoles.length },
      ]} />

      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data ? <Spinner /> : data && (
        <>
          {tab === 'people' && (
            <>
              <div className="mb-4 flex flex-col gap-3 sm:flex-row">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-steel-400" />
                  <Input aria-label="Search people" className="pl-10" placeholder="Search name, email or company" value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
                <Select aria-label="Filter by role" className="sm:w-56" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as typeof roleFilter)}>
                  <option value="all">All roles</option>
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}s</option>)}
                  <option value="inactive">Inactive / awaiting activation</option>
                </Select>
              </div>
              {people.length === 0 ? <EmptyState icon={<Users className="h-10 w-10" />} title="No matching people" /> : (
                <ul className="card divide-y divide-steel-100">
                  {people.map((p) => (
                    <li key={p.id}>
                      <button onClick={() => setEditUser(p)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-steel-50">
                        <Avatar name={p.full_name} className={p.is_active ? '' : 'opacity-40'} />
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-2 truncate font-bold text-steel-900">
                            {p.full_name}{p.id === me?.id && <span className="text-xs font-semibold text-steel-400">(you)</span>}
                          </p>
                          <p className="truncate text-sm text-steel-500">{p.email}</p>
                          <p className="truncate text-xs text-steel-500 md:hidden">{orgName(p.organization_id)}{jobName(p.job_role_id) ? ` · ${jobName(p.job_role_id)}` : ''}</p>
                        </div>
                        <div className="hidden w-56 min-w-0 md:block">
                          <p className="truncate text-sm font-semibold text-steel-700">{orgName(p.organization_id)}</p>
                          <p className="truncate text-xs text-steel-500">{jobName(p.job_role_id) ?? 'No job role'}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <Badge color={ROLE_COLOR[p.role]}>{ROLE_LABEL[p.role]}</Badge>
                          {!p.is_active && <Badge color="red">Inactive</Badge>}
                        </div>
                        <Pencil className="hidden h-4 w-4 text-steel-400 sm:block" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {tab === 'companies' && (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {data.orgs.map((o) => {
                const members = data.profiles.filter((p) => p.organization_id === o.id && p.is_active).length;
                return (
                  <div key={o.id} className={clsx('card p-4', !o.is_active && 'opacity-60')}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Badge color={o.type === 'internal' ? 'purple' : 'amber'}>{o.type === 'internal' ? 'Internal company' : 'Contractor'}</Badge>
                        <p className="mt-2 text-lg font-bold leading-snug">{o.name}</p>
                        {o.abn && <p className="text-xs text-steel-500">ABN {o.abn}</p>}
                      </div>
                      <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditOrg(o)} aria-label={`Edit ${o.name}`} />
                    </div>
                    <dl className="mt-3 space-y-1 text-sm">
                      <div className="flex justify-between"><dt className="text-steel-500">Active users</dt><dd className="font-bold">{members}</dd></div>
                      {o.contact_name && <div className="flex justify-between gap-2"><dt className="text-steel-500">Contact</dt><dd className="truncate font-medium">{o.contact_name}</dd></div>}
                      {o.contact_phone && <div className="flex justify-between gap-2"><dt className="text-steel-500">Phone</dt><dd className="font-medium">{o.contact_phone}</dd></div>}
                    </dl>
                    {!o.is_active && <p className="mt-2 text-xs font-bold uppercase text-red-600">Inactive</p>}
                  </div>
                );
              })}
              <button onClick={() => setEditOrg({})} className="flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-steel-300 text-steel-500 hover:border-brand-400 hover:text-brand-700">
                <Plus className="h-8 w-8" /><span className="font-bold">Add contractor company</span>
              </button>
            </div>
          )}

          {tab === 'invitations' && (
            data.invitations.length === 0 ? <EmptyState icon={<Mail className="h-10 w-10" />} title="No invitations yet" action={<Button onClick={() => setInviteOpen(true)}>Invite user</Button>} /> : (
              <ul className="card divide-y divide-steel-100">
                {data.invitations.map((i) => (
                  <li key={i.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold">{i.full_name || i.email}</p>
                      <p className="truncate text-sm text-steel-500">{i.email} · {orgName(i.organization_id)}</p>
                      <p className="text-xs text-steel-400">Sent {formatDate(i.created_at)}{i.status === 'pending' && ` · expires ${formatDate(i.expires_at)}`}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge color={ROLE_COLOR[i.role]}>{ROLE_LABEL[i.role]}</Badge>
                      <Badge color={i.status === 'pending' ? 'blue' : i.status === 'accepted' ? 'green' : 'slate'}>{i.status}</Badge>
                      {i.status !== 'accepted' && <Button size="sm" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => invAction(i, 'resend')}>Resend</Button>}
                      {i.status === 'pending' && <Button size="sm" variant="ghost" icon={<XCircle className="h-4 w-4" />} onClick={() => invAction(i, 'revoke')}>Revoke</Button>}
                    </div>
                  </li>
                ))}
              </ul>
            )
          )}

          {tab === 'jobroles' && (
            <>
              <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-center gap-2 text-sm text-steel-600"><ShieldCheck className="h-4 w-4 text-emerald-600" />
                  Rates are stored in a separate leader-only table — employees and contractors can never query them.</p>
                <Button icon={<Plus className="h-5 w-5" />} onClick={() => setEditJob({})}>New job role</Button>
              </div>
              <div className="card overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="bg-steel-50 text-xs font-bold uppercase tracking-wider text-steel-500">
                    <tr><th className="px-4 py-3">Job role</th><th className="px-4 py-3">Classification</th><th className="px-4 py-3">Applies to</th>
                      <th className="px-4 py-3 text-right">Cost /hr</th><th className="px-4 py-3 text-right">Charge /hr</th><th className="px-4 py-3" /></tr>
                  </thead>
                  <tbody className="divide-y divide-steel-100">
                    {data.jobRoles.map((j) => {
                      const r = data.rates.find((x) => x.job_role_id === j.id);
                      return (
                        <tr key={j.id} className={clsx(!j.is_active && 'opacity-50')}>
                          <td className="px-4 py-3 font-bold">{j.name}</td>
                          <td className="px-4 py-3">{j.classification ?? '—'}</td>
                          <td className="px-4 py-3"><div className="flex gap-1">{j.applies_to.map((t) => <Badge key={t} color={t === 'internal' ? 'purple' : 'amber'} dot={false}>{t}</Badge>)}</div></td>
                          <td className="px-4 py-3 text-right font-mono">{r?.cost_rate != null ? `$${Number(r.cost_rate).toFixed(2)}` : '—'}</td>
                          <td className="px-4 py-3 text-right font-mono">{r?.charge_rate != null ? `$${Number(r.charge_rate).toFixed(2)}` : '—'}</td>
                          <td className="px-4 py-3 text-right"><Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditJob(j)}>Edit</Button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {inviteOpen && <InviteModal orgs={data.orgs} jobRoles={data.jobRoles} onClose={() => setInviteOpen(false)} onDone={() => { setInviteOpen(false); setTab('invitations'); void reload(); }} />}
          {editUser && <EditUserModal user={editUser} orgs={data.orgs} jobRoles={data.jobRoles} isSelf={editUser.id === me?.id}
            onClose={() => setEditUser(null)} onSaved={() => { setEditUser(null); void reload(); }} />}
          {editOrg && <CompanyModal initial={editOrg} onClose={() => setEditOrg(null)} onSaved={() => { setEditOrg(null); void reload(); }} />}
          {editJob && <JobRoleModal initial={editJob} rate={data.rates.find((r) => r.job_role_id === editJob.id)}
            onClose={() => setEditJob(null)} onSaved={() => { setEditJob(null); void reload(); }} />}
        </>
      )}
    </div>
  );
}
