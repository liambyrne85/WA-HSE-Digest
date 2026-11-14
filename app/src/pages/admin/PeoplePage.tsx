import { clsx } from 'clsx';
import { AlertTriangle, ArrowRight, Building2, FileUp, HardHat, Pencil, Plus, Search, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CompanyModal, JobRoleModal } from '../../components/people/CompanyAndPositionModals';
import { currentScaffoldLicence } from '../../components/people/LicencesPanel';
import { Avatar, Badge, Button, Checkbox, EmptyState, ErrorBanner, Field, Input, Modal, PageHeader, Select, Spinner, Tabs } from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { api } from '../../lib/api';
import type { PersonInput } from '../../lib/api/types';
import { ROLES, ROLE_COLOR, ROLE_DESCRIPTION, ROLE_LABEL, daysUntil, perthToday } from '../../lib/labels';
import type { AppRole, JobRole, Organization, Project } from '../../lib/types';
import { errMsg, useAsync } from '../../lib/useAsync';
import ImportPeople from './ImportPeople';

type Tab = 'people' | 'companies' | 'positions' | 'import';

export function RolePicker({ value, onChange, internal }: { value: AppRole; onChange: (r: AppRole) => void; internal: boolean }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {ROLES.map((r) => {
        const disabled = !internal && (r === 'admin' || r === 'hset');
        return (
          <button key={r} type="button" disabled={disabled} onClick={() => onChange(r)} aria-pressed={value === r}
            className={clsx('min-h-[64px] rounded-xl border-2 p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40',
              value === r ? 'border-brand-500 bg-brand-50' : 'border-steel-200 bg-white hover:border-steel-300')}>
            <Badge color={ROLE_COLOR[r]}>{ROLE_LABEL[r]}</Badge>
            <p className="mt-1.5 text-xs leading-snug text-steel-600">{disabled ? 'Only for people at your own company' : ROLE_DESCRIPTION[r]}</p>
          </button>
        );
      })}
    </div>
  );
}

export function makeTempPassword() {
  const words = ['Ledger', 'Transom', 'Coupler', 'Standard', 'Toeboard', 'Brace', 'Sole', 'Plank'];
  const pick = () => words[Math.floor(Math.random() * words.length)]!;
  return `${pick()}-${pick()}-${Math.floor(1000 + Math.random() * 9000)}`;
}

// ---------------------------------------------------------------------------
function AddPersonModal({ orgs, positions, projects, onClose, onDone }: {
  orgs: Organization[]; positions: JobRole[]; projects: Project[]; onClose: () => void; onDone: (id: string) => void;
}) {
  const internalOrg = orgs.find((o) => o.type === 'internal');
  const [p, setP] = useState<PersonInput>({
    email: '', full_name: '', role: 'worker', organization_id: internalOrg?.id ?? '', start_date: perthToday(), is_scaffold_inspector: false,
  });
  const [method, setMethod] = useState<'email' | 'password'>('email');
  const [tempPassword, setTempPassword] = useState(makeTempPassword);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; invited: boolean } | null>(null);
  const toast = useToast();
  const set = <K extends keyof PersonInput>(k: K, v: PersonInput[K]) => setP((x) => ({ ...x, [k]: v }));
  const org = orgs.find((o) => o.id === p.organization_id);
  const internal = org?.type === 'internal';

  const submit = async () => {
    if (!p.full_name.trim()) return setError('Enter their full name');
    if (!p.email.trim()) return setError('Enter their email');
    if (!p.organization_id) return setError('Choose their company');
    setBusy(true);
    setError(null);
    try {
      const r = await api.createPerson({ ...p, temp_password: method === 'password' ? tempPassword : null }, method === 'email');
      if (method === 'password' || api.mode === 'demo') setCreated({ id: r.profile_id, invited: r.invited });
      else {
        toast(r.invited ? `Added — set-password email sent to ${p.email}` : `Added ${p.full_name}. The email didn't send; use "Send invite" on their profile.`, r.invited ? 'success' : 'error');
        onDone(r.profile_id);
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <Modal open onClose={() => onDone(created.id)} title="Person added" footer={<Button size="lg" onClick={() => onDone(created.id)}>Open their profile</Button>}>
        {method === 'password' ? (
          <div className="space-y-4">
            <p className="text-steel-700">Give these sign-in details to {p.full_name} directly. They'll choose their own password the first time they sign in.</p>
            <dl className="space-y-3 rounded-xl border-2 border-steel-200 bg-steel-50 p-4">
              <div><dt className="text-xs font-bold uppercase text-steel-500">Email</dt><dd className="select-all font-mono text-lg">{p.email}</dd></div>
              <div><dt className="text-xs font-bold uppercase text-steel-500">Temporary password</dt><dd className="select-all font-mono text-lg">{tempPassword}</dd></div>
            </dl>
          </div>
        ) : <p className="text-steel-700">{p.full_name} has been added. (Demo mode: no email is sent.)</p>}
      </Modal>
    );
  }

  return (
    <Modal open drawer onClose={onClose} title="Add person"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button size="lg" onClick={submit} loading={busy} icon={<UserPlus className="h-5 w-5" />}>Add person</Button></>}>
      <div className="space-y-4">
        {error && <ErrorBanner message={error} />}
        <Field label="Full name" required><Input value={p.full_name} onChange={(e) => set('full_name', e.target.value)} autoFocus autoComplete="off" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email" required><Input type="email" inputMode="email" value={p.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label="Mobile"><Input type="tel" inputMode="tel" value={p.phone ?? ''} onChange={(e) => set('phone', e.target.value)} placeholder="04xx xxx xxx" /></Field>
          <Field label="Employee ID"><Input value={p.employee_number ?? ''} onChange={(e) => set('employee_number', e.target.value)} /></Field>
          <Field label="Start date"><Input type="date" value={p.start_date ?? ''} onChange={(e) => set('start_date', e.target.value)} /></Field>
        </div>
        <Field label="Company" required>
          <Select value={p.organization_id} onChange={(e) => {
            const o = orgs.find((x) => x.id === e.target.value);
            setP((x) => ({ ...x, organization_id: e.target.value, role: o?.type !== 'internal' && ['admin', 'hset'].includes(x.role) ? 'worker' : x.role }));
          }}>
            {orgs.filter((o) => o.is_active).map((o) => <option key={o.id} value={o.id}>{o.name}{o.type === 'contractor' ? ' (subcontractor)' : ''}</option>)}
          </Select>
        </Field>
        <div><span className="label">App role</span><RolePicker value={p.role} onChange={(r) => set('role', r)} internal={internal} /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Position">
            <Select value={p.job_role_id ?? ''} onChange={(e) => set('job_role_id', e.target.value || null)}>
              <option value="">— None —</option>
              {positions.filter((j) => j.is_active).map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
            </Select>
          </Field>
          <Field label="Primary project">
            <Select value={p.primary_project_id ?? ''} onChange={(e) => set('primary_project_id', e.target.value || null)}>
              <option value="">— None yet —</option>
              {projects.filter((x) => x.is_active).map((x) => <option key={x.id} value={x.id}>{x.code ? `${x.code} – ` : ''}{x.name}</option>)}
            </Select>
          </Field>
        </div>
        <Checkbox label="Competent scaffold inspector" description="Can sign off scaffold inspections (also needs a current HRW scaffolding licence)."
          checked={!!p.is_scaffold_inspector} onChange={(v) => set('is_scaffold_inspector', v)} />
        <div>
          <span className="label">How will they sign in?</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {([['email', 'Email them a link', 'They get an email and set their own password.'],
               ['password', 'Temporary password', 'Account is ready now; you give them the password. They change it at first sign-in.']] as const).map(([k, t, d]) => (
              <button key={k} type="button" aria-pressed={method === k} onClick={() => setMethod(k)}
                className={clsx('min-h-[64px] rounded-xl border-2 p-3 text-left', method === k ? 'border-brand-500 bg-brand-50' : 'border-steel-200 bg-white')}>
                <span className="block font-bold">{t}</span><span className="block text-xs text-steel-600">{d}</span>
              </button>
            ))}
          </div>
          {method === 'password' && (
            <Field label="Temporary password"><Input className="font-mono" value={tempPassword} onChange={(e) => setTempPassword(e.target.value)} /></Field>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
export default function PeoplePage() {
  const { isAdmin, isLeader, isContractor, company } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) || 'people');
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState<AppRole | ''>('');
  const [orgFilter, setOrgFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive' | 'all'>('active');
  const [licenceFilter, setLicenceFilter] = useState<'' | 'attention' | 'inspectors'>('');
  const [adding, setAdding] = useState(params.get('add') === '1');
  const [editOrg, setEditOrg] = useState<Partial<Organization> | null>(null);
  const [editJob, setEditJob] = useState<Partial<JobRole> | null>(null);

  const { data, loading, error, reload } = useAsync(async () => {
    const [people, orgs, positions, rates, projects, members, tickets] = await Promise.all([
      api.listProfiles(), api.listOrganizations(), api.listJobRoles(), api.listJobRoleRates(), api.listProjects(),
      api.listProjectMembers(), api.listTickets(),
    ]);
    return { people, orgs, positions, rates, projects, members, tickets };
  }, []);

  useEffect(() => {
    if (params.get('add')) { params.delete('add'); setParams(params, { replace: true }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const today = perthToday();
  const openMembers = (pid: string) => (data?.members ?? []).filter((m) => m.profile_id === pid && (!m.end_date || m.end_date >= today));
  const projectName = (id: string) => data?.projects.find((p) => p.id === id)?.code ?? data?.projects.find((p) => p.id === id)?.name ?? '';
  const orgName = (id: string) => data?.orgs.find((o) => o.id === id)?.name ?? '—';
  const position = (id: string | null) => (id ? data?.positions.find((j) => j.id === id)?.name : null);
  const ticketsFor = (pid: string) => (data?.tickets ?? []).filter((t) => t.profile_id === pid && !t.archived_at);
  const attentionFor = (pid: string) => ticketsFor(pid).filter((t) => (daysUntil(t.expires_on) ?? 999) <= 30);

  const people = useMemo(() => (data?.people ?? []).filter((p) => {
    if (status === 'active' && !p.is_active) return false;
    if (status === 'inactive' && p.is_active) return false;
    if (roleFilter && p.role !== roleFilter) return false;
    if (orgFilter && p.organization_id !== orgFilter) return false;
    if (projectFilter && !openMembers(p.id).some((m) => m.project_id === projectFilter)) return false;
    if (licenceFilter === 'attention' && !attentionFor(p.id).length) return false;
    if (licenceFilter === 'inspectors' && !(p.is_scaffold_inspector && currentScaffoldLicence(ticketsFor(p.id)))) return false;
    const s = q.trim().toLowerCase();
    return !s || [p.full_name, p.email, p.employee_number ?? '', orgName(p.organization_id), position(p.job_role_id) ?? ''].some((x) => x.toLowerCase().includes(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [data, q, roleFilter, orgFilter, projectFilter, status, licenceFilter]);

  const title = isAdmin ? 'People' : isLeader ? 'People' : 'My Team';
  const subtitle = isAdmin ? 'Add, edit and deactivate people; assign roles, positions and projects.'
    : isLeader ? 'Everyone in the business. Only Admins can change roles and assignments.'
    : isContractor ? `${company?.name ?? 'Your company'}'s people on your projects.` : 'Everyone on your projects.';

  return (
    <div>
      <PageHeader eyebrow={isAdmin ? 'Administration' : 'People'} title={title} subtitle={subtitle}
        actions={isAdmin && <>
          <Button variant="secondary" icon={<FileUp className="h-5 w-5" />} onClick={() => setTab('import')}>Import CSV</Button>
          <Button icon={<UserPlus className="h-5 w-5" />} onClick={() => setAdding(true)}>Add person</Button>
        </>} />

      {isAdmin && (
        <Tabs value={tab} onChange={setTab} tabs={[
          { key: 'people', label: 'People', count: data?.people.filter((p) => p.is_active).length },
          { key: 'companies', label: 'Companies', count: data?.orgs.length },
          { key: 'positions', label: 'Positions', count: data?.positions.filter((j) => j.is_active).length },
          { key: 'import', label: 'Import' },
        ]} />
      )}

      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data ? <Spinner /> : data && (
        <>
          {tab === 'people' && (
            <>
              <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
                <div className="relative sm:col-span-2">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-steel-400" />
                  <Input aria-label="Search people" className="pl-10" placeholder="Name, email, employee ID" value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
                <Select aria-label="Role" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as AppRole | '')}>
                  <option value="">All roles</option>
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </Select>
                <Select aria-label="Company" value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)}>
                  <option value="">All companies</option>
                  {data.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </Select>
                <Select aria-label="Project" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
                  <option value="">All projects</option>
                  {data.projects.map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code} – ` : ''}{p.name}</option>)}
                </Select>
                <Select aria-label="Licences" value={licenceFilter} onChange={(e) => setLicenceFilter(e.target.value as typeof licenceFilter)}>
                  <option value="">All licences</option>
                  <option value="attention">Expired / expiring ≤30 days</option>
                  <option value="inspectors">Competent scaffold inspectors</option>
                </Select>
              </div>
              {(isAdmin || isLeader) && (
                <div className="mb-3 flex gap-2">
                  {(['active', 'inactive', 'all'] as const).map((k) => (
                    <button key={k} onClick={() => setStatus(k)} aria-pressed={status === k}
                      className={clsx('min-h-[40px] rounded-full border-2 px-4 text-sm font-semibold capitalize', status === k ? 'border-steel-900 bg-steel-900 text-white' : 'border-steel-200 bg-white')}>
                      {k}
                    </button>
                  ))}
                </div>
              )}
              {people.length === 0 ? <EmptyState icon={<Users className="h-10 w-10" />} title="No matching people" /> : (
                <ul className="card divide-y divide-steel-100">
                  {people.map((p) => {
                    const att = attentionFor(p.id);
                    const expired = att.some((t) => (daysUntil(t.expires_on) ?? 0) < 0);
                    const projs = openMembers(p.id);
                    const insp = p.is_scaffold_inspector && currentScaffoldLicence(ticketsFor(p.id));
                    return (
                      <li key={p.id}>
                        <Link to={`/people/${p.id}`} className="flex min-h-[72px] items-center gap-3 px-4 py-3 hover:bg-steel-50">
                          <Avatar name={p.full_name} className={p.is_active ? '' : 'opacity-40'} />
                          <div className="min-w-0 flex-1">
                            <p className="flex flex-wrap items-center gap-2 font-bold text-steel-900">
                              <span className="truncate">{p.full_name}</span>
                              <Badge color={ROLE_COLOR[p.role]}>{ROLE_LABEL[p.role]}</Badge>
                              {!p.is_active && <Badge color="slate">Inactive</Badge>}
                              {insp && <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-bold uppercase text-emerald-800"><ShieldCheck className="h-3.5 w-3.5" />Inspector</span>}
                            </p>
                            <p className="truncate text-sm text-steel-600">
                              {[position(p.job_role_id), orgName(p.organization_id), projs.map((m) => `${projectName(m.project_id)}${m.is_primary ? '★' : ''}`).join(', ')].filter(Boolean).join(' · ')}
                            </p>
                            {att.length > 0 && (
                              <p className={clsx('mt-0.5 flex items-center gap-1 text-xs font-bold', expired ? 'text-red-700' : 'text-amber-700')}>
                                <AlertTriangle className="h-3.5 w-3.5" />{att.length} licence{att.length > 1 ? 's' : ''} {expired ? 'expired' : 'expiring'}
                              </p>
                            )}
                          </div>
                          <ArrowRight className="h-5 w-5 shrink-0 text-steel-400" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="mt-2 text-xs text-steel-500">★ primary project</p>
            </>
          )}

          {tab === 'companies' && isAdmin && (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {data.orgs.map((o) => {
                const n = data.people.filter((p) => p.organization_id === o.id && p.is_active).length;
                return (
                  <div key={o.id} className={clsx('card p-4', !o.is_active && 'opacity-60')}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Badge color={o.type === 'internal' ? 'purple' : 'amber'}>{o.type === 'internal' ? 'Your company' : 'Subcontractor'}</Badge>
                        <p className="mt-2 text-lg font-bold leading-snug">{o.name}</p>
                        {o.abn && <p className="text-xs text-steel-500">ABN {o.abn}</p>}
                      </div>
                      <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditOrg(o)} aria-label={`Edit ${o.name}`} />
                    </div>
                    <p className="mt-3 text-sm"><span className="font-bold">{n}</span> active {n === 1 ? 'person' : 'people'}</p>
                  </div>
                );
              })}
              <button onClick={() => setEditOrg({})} className="flex min-h-[140px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-steel-300 text-steel-500 hover:border-brand-400 hover:text-brand-700">
                <Building2 className="h-8 w-8" /><span className="font-bold">Add subcontractor</span>
              </button>
            </div>
          )}

          {tab === 'positions' && isAdmin && (
            <>
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-steel-600">A position is the person's job (e.g. Scaffolder). It's separate from their app role. Pay rates are visible to Admins only.</p>
                <Button icon={<Plus className="h-5 w-5" />} onClick={() => setEditJob({})}>New position</Button>
              </div>
              <ul className="card divide-y divide-steel-100">
                {data.positions.map((j) => {
                  const rate = data.rates.find((x) => x.job_role_id === j.id);
                  const n = data.people.filter((p) => p.job_role_id === j.id && p.is_active).length;
                  return (
                    <li key={j.id} className={clsx('flex min-h-[64px] items-center gap-3 px-4 py-2', !j.is_active && 'opacity-50')}>
                      <HardHat className="h-5 w-5 shrink-0 text-steel-400" />
                      <div className="min-w-0 flex-1">
                        <p className="font-bold">{j.name}{!j.is_active && ' (inactive)'}</p>
                        <p className="text-xs text-steel-500">{[j.classification, `${n} ${n === 1 ? 'person' : 'people'}`, rate?.charge_rate != null ? `$${Number(rate.charge_rate).toFixed(2)}/h charge` : null].filter(Boolean).join(' · ')}</p>
                      </div>
                      <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditJob(j)}>Edit</Button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {tab === 'import' && isAdmin && (
            <ImportPeople orgs={data.orgs} positions={data.positions} projects={data.projects} existingEmails={data.people.map((p) => p.email.toLowerCase())}
              onDone={() => { void reload(); setTab('people'); }} />
          )}

          {adding && <AddPersonModal orgs={data.orgs} positions={data.positions} projects={data.projects}
            onClose={() => setAdding(false)} onDone={(id) => { setAdding(false); nav(`/people/${id}`); }} />}
          {editOrg && <CompanyModal initial={editOrg} onClose={() => setEditOrg(null)} onSaved={() => { setEditOrg(null); void reload(); }} />}
          {editJob && <JobRoleModal initial={editJob} rate={data.rates.find((r) => r.job_role_id === editJob.id)}
            onClose={() => setEditJob(null)} onSaved={() => { setEditJob(null); void reload(); }} />}
        </>
      )}
    </div>
  );
}
