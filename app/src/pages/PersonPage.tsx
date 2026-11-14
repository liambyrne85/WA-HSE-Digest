import { ArrowLeft, Camera, CheckCircle2, History, Mail, Pencil, Plus, Power, Star, XCircle } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { StoredImage } from '../components/forms/AnswerView';
import { LicencesPanel, currentScaffoldLicence } from '../components/people/LicencesPanel';
import { Avatar, Badge, Button, Card, Checkbox, ErrorBanner, Field, Input, Modal, Select, Spinner, Toggle } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { useToast } from '../contexts/ToastContext';
import { api } from '../lib/api';
import { compressImage } from '../lib/image';
import { ROLE_COLOR, ROLE_LABEL, formatDate, formatDateTime, perthToday } from '../lib/labels';
import type { AuditEntry, Profile, ProjectMember } from '../lib/types';
import { errMsg, useAsync } from '../lib/useAsync';
import { RolePicker } from './admin/PeoplePage';

const FIELD_LABEL: Record<string, string> = {
  full_name: 'Name', email: 'Email', phone: 'Mobile', role: 'Role', organization_id: 'Company', job_role_id: 'Position',
  employee_number: 'Employee ID', start_date: 'Start date', is_scaffold_inspector: 'Scaffold inspector', is_active: 'Active',
  avatar_path: 'Photo', emergency_contact_name: 'Emergency contact', emergency_contact_phone: 'Emergency phone', last_seen_at: 'Last seen',
  is_primary: 'Primary', end_date: 'End date', project_id: 'Project',
};

function describeChange(a: AuditEntry, names: { org: (id: string) => string; job: (id: string) => string; project: (id: string) => string }) {
  const show = (k: string, v: unknown) => {
    if (v === null || v === undefined || v === '') return '—';
    if (k === 'role') return ROLE_LABEL[v as keyof typeof ROLE_LABEL] ?? String(v);
    if (k === 'organization_id') return names.org(String(v));
    if (k === 'job_role_id') return names.job(String(v));
    if (k === 'project_id') return names.project(String(v));
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (k.endsWith('_date')) return formatDate(String(v));
    if (k === 'avatar_path') return 'updated';
    return String(v);
  };
  if (a.action === 'insert') return a.table_name === 'project_members' ? `Assigned to ${show('project_id', a.new_data?.project_id)}` : 'Created';
  return Object.keys(a.new_data ?? {}).filter((k) => k !== 'last_seen_at').map((k) =>
    `${FIELD_LABEL[k] ?? k}: ${show(k, a.old_data?.[k])} → ${show(k, a.new_data?.[k])}`).join('; ');
}

export default function PersonPage() {
  const { id } = useParams();
  const { profile: me, isAdmin, isLeader } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Profile | null>(null);
  const [assigning, setAssigning] = useState<{ project_id: string; start_date: string; is_primary: boolean } | null>(null);
  const [ending, setEnding] = useState<ProjectMember | null>(null);
  const [endDate, setEndDate] = useState(perthToday());
  const [busy, setBusy] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);

  const { data, loading, error, reload } = useAsync(async () => {
    const people = await api.listProfiles();
    const person = people.find((p) => p.id === id);
    if (!person) throw new Error("This person doesn't exist or isn't on your projects.");
    const [orgs, positions, projects, members, tickets, types, audit] = await Promise.all([
      api.listOrganizations(), api.listJobRoles(), api.listProjects(), api.listProjectMembers({ profileId: id }),
      api.listTickets(), api.listLookupValues('ticket_types'), api.listAudit('profiles', id!),
    ]);
    return { person, orgs, positions, projects, members, tickets, types, audit };
  }, [id]);

  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorBanner message={error ?? 'Not found'} />;
  const p = data.person;
  const isSelf = p.id === me?.id;
  const org = data.orgs.find((o) => o.id === p.organization_id);
  const position = data.positions.find((j) => j.id === p.job_role_id);
  const projectLabel = (pid: string) => { const x = data.projects.find((y) => y.id === pid); return x ? `${x.code ? `${x.code} – ` : ''}${x.name}` : 'Project (no access)'; };
  const today = perthToday();
  const current = data.members.filter((m) => !m.end_date || m.end_date >= today).sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
  const past = data.members.filter((m) => m.end_date && m.end_date < today);
  const scaffoldLicence = currentScaffoldLicence(data.tickets.filter((t) => t.profile_id === p.id));
  const canInspect = p.is_active && p.is_scaffold_inspector && !!scaffoldLicence;
  const names = {
    org: (x: string) => data.orgs.find((o) => o.id === x)?.name ?? 'Company',
    job: (x: string) => data.positions.find((j) => j.id === x)?.name ?? 'Position',
    project: projectLabel,
  };

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try { await fn(); toast(msg); await reload(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <Link to="/people" className="mb-3 inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-steel-600 hover:text-steel-900">
        <ArrowLeft className="h-5 w-5" /> People
      </Link>

      {/* Header */}
      <div className="card mb-5 flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <div className="relative shrink-0">
          {p.avatar_path ? <StoredImage value={p.avatar_path} alt={p.full_name} className="h-20 w-20 rounded-full" /> : <Avatar name={p.full_name} size="lg" className="h-20 w-20 text-2xl" />}
          {(isAdmin || isSelf) && (
            <button onClick={() => photoRef.current?.click()} aria-label="Change photo"
              className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full bg-steel-900 text-white ring-2 ring-white">
              <Camera className="h-4 w-4" />
            </button>
          )}
          <input ref={photoRef} type="file" accept="image/*" capture="user" className="hidden" onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            await run(async () => {
              const ref = await api.uploadPersonFile(p.id, await compressImage(f, { maxDim: 600 }), 'photo');
              await api.updateProfile(p.id, { avatar_path: ref });
            }, 'Photo updated');
          }} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-bold uppercase leading-tight">{p.full_name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge color={ROLE_COLOR[p.role]}>{ROLE_LABEL[p.role]}</Badge>
            {!p.is_active && <Badge color="slate">Inactive</Badge>}
            <span className="text-sm text-steel-600">{[position?.name, org?.name].filter(Boolean).join(' · ')}</span>
          </div>
          <p className="mt-1 text-xs text-steel-500">
            {p.last_seen_at ? `Last signed in ${formatDateTime(p.last_seen_at)}` : 'Has not signed in yet'}
          </p>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing({ ...p })}>Edit</Button>
            {p.is_active && (
              <Button variant="secondary" icon={<Mail className="h-4 w-4" />} disabled={busy}
                onClick={() => run(() => api.sendInvite(p.id), api.mode === 'demo' ? 'Demo: no email is sent' : `Set-password email sent to ${p.email}`)}>
                {p.last_seen_at ? 'Send password link' : 'Send invite'}
              </Button>
            )}
            {!isSelf && (
              <Button variant={p.is_active ? 'ghost' : 'primary'} className={p.is_active ? '!text-red-600' : ''} icon={<Power className="h-4 w-4" />} disabled={busy}
                onClick={async () => {
                  if (p.is_active && !(await confirm({ title: 'Deactivate person', message: `${p.full_name} won't be able to sign in or see anything. Their records and history are kept, and you can reactivate them any time.`, confirmLabel: 'Deactivate', danger: true }))) return;
                  await run(() => api.setPersonActive(p.id, !p.is_active), p.is_active ? 'Deactivated' : 'Reactivated');
                }}>
                {p.is_active ? 'Deactivate' : 'Reactivate'}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <Card title="Details">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div><dt className="text-xs font-bold uppercase text-steel-500">Email</dt><dd className="break-all font-semibold">{p.email}</dd></div>
              <div><dt className="text-xs font-bold uppercase text-steel-500">Mobile</dt><dd className="font-semibold">{p.phone ? <a className="text-brand-700 underline" href={`tel:${p.phone.replace(/\s/g, '')}`}>{p.phone}</a> : '—'}</dd></div>
              <div><dt className="text-xs font-bold uppercase text-steel-500">Employee ID</dt><dd className="font-semibold">{p.employee_number ?? '—'}</dd></div>
              <div><dt className="text-xs font-bold uppercase text-steel-500">Start date</dt><dd className="font-semibold">{formatDate(p.start_date)}</dd></div>
              <div><dt className="text-xs font-bold uppercase text-steel-500">Company</dt><dd className="font-semibold">{org?.name ?? '—'}{org?.type === 'contractor' && ' (subcontractor)'}</dd></div>
              <div><dt className="text-xs font-bold uppercase text-steel-500">Position</dt><dd className="font-semibold">{position?.name ?? '—'}</dd></div>
            </dl>
          </Card>

          <Card title="Scaffold inspections">
            <div className="flex items-start gap-3">
              {canInspect ? <CheckCircle2 className="h-7 w-7 shrink-0 text-emerald-600" /> : <XCircle className="h-7 w-7 shrink-0 text-steel-400" />}
              <div className="min-w-0 flex-1">
                <p className="font-bold">{canInspect ? 'Can sign off scaffold inspections' : 'Cannot sign off scaffold inspections'}</p>
                <ul className="mt-1 space-y-0.5 text-sm text-steel-600">
                  <li>{p.is_scaffold_inspector ? '✓ Marked as a competent scaffold inspector' : '✗ Not marked as a competent scaffold inspector'}</li>
                  <li>{scaffoldLicence ? `✓ Current HRW scaffolding licence (${scaffoldLicence.licence_class ?? 'class not recorded'})` : '✗ No current HRW scaffolding licence'}</li>
                </ul>
              </div>
              {isAdmin && (
                <Toggle checked={p.is_scaffold_inspector} label="Competent scaffold inspector" disabled={busy}
                  onChange={(v) => run(() => api.updateProfile(p.id, { is_scaffold_inspector: v }), v ? 'Marked as competent inspector' : 'Inspector status removed')} />
              )}
            </div>
          </Card>

          <Card title="Projects" padded={false}
            actions={isAdmin && p.is_active && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setAssigning({ project_id: '', start_date: today, is_primary: current.length === 0 })}>Assign</Button>}>
            {!current.length && <p className="px-4 py-5 text-sm text-steel-500">Not assigned to any project.</p>}
            <ul className="divide-y divide-steel-100">
              {current.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
                  {m.is_primary ? <Star className="h-5 w-5 shrink-0 fill-hivis-500 text-hivis-600" /> : <span className="w-5" />}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{projectLabel(m.project_id)}</p>
                    <p className="text-xs text-steel-500">{m.is_primary ? 'Primary · ' : ''}From {formatDate(m.start_date)}{m.end_date ? ` to ${formatDate(m.end_date)}` : ''}</p>
                  </div>
                  {isAdmin && (
                    <div className="flex gap-1">
                      {!m.is_primary && <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => api.saveProjectMember({ id: m.id, is_primary: true }), 'Primary project changed')}>Make primary</Button>}
                      <Button size="sm" variant="ghost" onClick={() => { setEnding(m); setEndDate(today); }}>End</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {past.length > 0 && (
              <details className="border-t border-steel-100 px-4 py-3">
                <summary className="cursor-pointer text-sm font-semibold text-steel-600">Past assignments ({past.length})</summary>
                <ul className="mt-2 space-y-1 text-sm text-steel-600">
                  {past.map((m) => <li key={m.id}>{projectLabel(m.project_id)} · {formatDate(m.start_date)} – {formatDate(m.end_date)}{m.is_primary ? ' (primary)' : ''}</li>)}
                </ul>
              </details>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-5">
          <LicencesPanel profileId={p.id} tickets={data.tickets} types={data.types} canEdit={isSelf || isLeader} canVerify={isLeader} onChanged={reload} />

          {(isLeader || isSelf) && (
            <Card title="History" padded={false}>
              {!data.audit.length && <p className="px-4 py-5 text-sm text-steel-500">No changes recorded yet.</p>}
              <ol className="max-h-80 divide-y divide-steel-100 overflow-y-auto">
                {data.audit.sort((a, b) => b.changed_at.localeCompare(a.changed_at)).map((a) => (
                  <li key={a.id} className="flex gap-2.5 px-4 py-2.5 text-sm">
                    <History className="mt-0.5 h-4 w-4 shrink-0 text-steel-400" />
                    <div className="min-w-0">
                      <p className="text-steel-800">{describeChange(a, names) || 'Updated'}</p>
                      <p className="text-xs text-steel-400">{formatDateTime(a.changed_at)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          )}
        </div>
      </div>

      {editing && (
        <Modal open drawer onClose={() => setEditing(null)} title="Edit person"
          footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button size="lg" loading={busy} onClick={() => run(async () => {
              const { full_name, phone, employee_number, start_date, role, organization_id, job_role_id, emergency_contact_name, emergency_contact_phone } = editing;
              await api.updateProfile(p.id, { full_name, phone: phone || null, employee_number: employee_number || null, start_date: start_date || null, role, organization_id, job_role_id: job_role_id || null, emergency_contact_name, emergency_contact_phone });
              setEditing(null);
            }, 'Saved')}>Save</Button></>}>
          <div className="space-y-4">
            <Field label="Full name"><Input value={editing.full_name} onChange={(e) => setEditing({ ...editing, full_name: e.target.value })} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Mobile"><Input type="tel" value={editing.phone ?? ''} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></Field>
              <Field label="Employee ID"><Input value={editing.employee_number ?? ''} onChange={(e) => setEditing({ ...editing, employee_number: e.target.value })} /></Field>
              <Field label="Start date"><Input type="date" value={editing.start_date ?? ''} onChange={(e) => setEditing({ ...editing, start_date: e.target.value })} /></Field>
              <Field label="Position">
                <Select value={editing.job_role_id ?? ''} onChange={(e) => setEditing({ ...editing, job_role_id: e.target.value || null })}>
                  <option value="">— None —</option>
                  {data.positions.filter((j) => j.is_active || j.id === editing.job_role_id).map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="Company">
              <Select value={editing.organization_id} onChange={(e) => {
                const o = data.orgs.find((x) => x.id === e.target.value);
                setEditing({ ...editing, organization_id: e.target.value, role: o?.type !== 'internal' && ['admin', 'hset'].includes(editing.role) ? 'worker' : editing.role });
              }}>
                {data.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}{o.type === 'contractor' ? ' (subcontractor)' : ''}</option>)}
              </Select>
            </Field>
            <div><span className="label">App role</span>
              <RolePicker value={editing.role} onChange={(r) => setEditing({ ...editing, role: r })} internal={data.orgs.find((o) => o.id === editing.organization_id)?.type === 'internal'} />
              {isSelf && editing.role !== 'admin' && <p className="mt-2 text-xs font-semibold text-amber-700">You're changing your own role and will lose Admin access.</p>}
            </div>
            <p className="text-xs text-steel-500">Email can't be changed here because it's their sign-in. To change it, deactivate this person and add them again with the new email.</p>
          </div>
        </Modal>
      )}

      {assigning && (
        <Modal open onClose={() => setAssigning(null)} title="Assign to a project"
          footer={<><Button variant="secondary" onClick={() => setAssigning(null)}>Cancel</Button>
            <Button size="lg" disabled={!assigning.project_id} loading={busy} onClick={() => run(async () => {
              await api.saveProjectMember({ profile_id: p.id, ...assigning });
              setAssigning(null);
            }, 'Assigned')}>Assign</Button></>}>
          <div className="space-y-4">
            <Field label="Project" required>
              <Select value={assigning.project_id} onChange={(e) => setAssigning({ ...assigning, project_id: e.target.value })}>
                <option value="">Select…</option>
                {data.projects.filter((x) => x.is_active && !current.some((m) => m.project_id === x.id)).map((x) => <option key={x.id} value={x.id}>{x.code ? `${x.code} – ` : ''}{x.name}</option>)}
              </Select>
            </Field>
            <Field label="Start date"><Input type="date" value={assigning.start_date} onChange={(e) => setAssigning({ ...assigning, start_date: e.target.value })} /></Field>
            <Checkbox label="Make this their primary project" description="Workers only see their primary project." checked={assigning.is_primary} onChange={(v) => setAssigning({ ...assigning, is_primary: v })} />
          </div>
        </Modal>
      )}

      {ending && (
        <Modal open onClose={() => setEnding(null)} title="End assignment"
          footer={<><Button variant="secondary" onClick={() => setEnding(null)}>Cancel</Button>
            <Button size="lg" loading={busy} onClick={() => run(async () => { await api.saveProjectMember({ id: ending.id, end_date: endDate }); setEnding(null); }, 'Assignment ended')}>End assignment</Button></>}>
          <p className="mb-3 text-sm text-steel-700">{p.full_name} will stop seeing {projectLabel(ending.project_id)} after this date. The assignment stays in their history.</p>
          <Field label="Last day on the project"><Input type="date" min={ending.start_date} value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
        </Modal>
      )}
    </div>
  );
}
