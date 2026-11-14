import { Building2, MapPin, Pencil, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  Badge, Button, Checkbox, EmptyState, ErrorBanner, Field, Input, Modal, PageHeader, Select, Spinner, Tabs, Textarea, Toggle,
} from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { api } from '../lib/api';
import { PROJECT_STATUS, formatDate } from '../lib/labels';
import type { Organization, Project, ProjectStatus } from '../lib/types';
import { errMsg, useAsync } from '../lib/useAsync';

type Filter = 'active' | 'inactive' | 'all';

function ProjectForm({ initial, contractors, onClose, onSaved }: {
  initial: Partial<Project>; contractors: Organization[]; onClose: () => void; onSaved: () => void;
}) {
  const [p, setP] = useState<Partial<Project>>({ status: 'active', is_active: true, organization_ids: [], ...initial });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const set = <K extends keyof Project>(k: K, v: Project[K]) => setP((x) => ({ ...x, [k]: v }));

  const save = async () => {
    if (!p.name?.trim()) return setError('Project name is required');
    setBusy(true);
    setError(null);
    try {
      await api.saveProject({
        ...p,
        name: p.name.trim(),
        code: p.code?.trim() || null,
        start_date: p.start_date || null,
        end_date: p.end_date || null,
      });
      toast(p.id ? 'Project updated' : 'Project created');
      onSaved();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open drawer onClose={onClose} title={p.id ? 'Edit project' : 'New project / site'}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} loading={busy}>{p.id ? 'Save changes' : 'Create project'}</Button>
      </>}>
      <div className="space-y-4">
        {error && <ErrorBanner message={error} />}
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-1">
            <Field label="Code" hint="e.g. GNH-24"><Input value={p.code ?? ''} onChange={(e) => set('code', e.target.value)} /></Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Project name" required><Input value={p.name ?? ''} onChange={(e) => set('name', e.target.value)} autoFocus /></Field>
          </div>
        </div>
        <Field label="Client name"><Input value={p.client_name ?? ''} onChange={(e) => set('client_name', e.target.value)} /></Field>
        <Field label="Site location" hint="Town, address or mine site"><Input value={p.site_location ?? ''} onChange={(e) => set('site_location', e.target.value)} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Status">
            <Select value={p.status} onChange={(e) => set('status', e.target.value as ProjectStatus)}>
              {Object.entries(PROJECT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </Select>
          </Field>
          <div>
            <span className="label">Active flag</span>
            <div className="flex min-h-[48px] items-center gap-3">
              <Toggle checked={!!p.is_active} onChange={(v) => set('is_active', v)} label="Active" />
              <span className="text-sm text-steel-600">{p.is_active ? 'Selectable in all modules' : 'Hidden from new records'}</span>
            </div>
          </div>
          <Field label="Start date"><Input type="date" value={p.start_date ?? ''} onChange={(e) => set('start_date', e.target.value)} /></Field>
          <Field label="End date"><Input type="date" value={p.end_date ?? ''} onChange={(e) => set('end_date', e.target.value)} /></Field>
        </div>
        <Field label="Description / scope"><Textarea value={p.description ?? ''} onChange={(e) => set('description', e.target.value)} /></Field>
        <Field label="Scaffold inspection interval" hint="Days between periodic scaffold inspections on this project. The next due date is worked out from each inspection.">
          <div className="flex flex-wrap items-center gap-2">
            <Input type="number" inputMode="numeric" min={1} max={365} className="w-28" value={p.scaffold_inspection_days ?? 30}
              onChange={(e) => set('scaffold_inspection_days', Math.min(365, Math.max(1, Number(e.target.value) || 30)))} />
            <span className="text-sm font-semibold text-steel-600">days</span>
            {[7, 14, 30].map((n) => (
              <Button key={n} size="sm" variant={(p.scaffold_inspection_days ?? 30) === n ? 'dark' : 'secondary'} onClick={() => set('scaffold_inspection_days', n)}>
                {n === 7 ? 'Weekly' : n === 14 ? 'Fortnightly' : '30 days'}
              </Button>
            ))}
          </div>
        </Field>
        <div>
          <span className="label">Contractor companies engaged</span>
          <p className="mb-2 text-xs text-steel-500">Contractors can only see and log records against projects they're engaged on.</p>
          <div className="rounded-lg border-2 border-steel-200 p-3">
            {contractors.length === 0 && <p className="text-sm text-steel-500">No contractor companies yet — add them in Users & Contractors.</p>}
            {contractors.map((o) => (
              <Checkbox key={o.id} label={o.name} checked={!!p.organization_ids?.includes(o.id)}
                onChange={(v) => set('organization_ids', v ? [...(p.organization_ids ?? []), o.id] : (p.organization_ids ?? []).filter((x) => x !== o.id))} />
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default function ProjectsPage() {
  const { isLeader, isContractor } = useAuth();
  const { data, loading, error, reload } = useAsync(() => Promise.all([api.listProjects(), api.listOrganizations()]), []);
  const [filter, setFilter] = useState<Filter>('active');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Partial<Project> | null>(null);

  const [projects, orgs] = data ?? [[], []];
  const contractors = orgs.filter((o) => o.type === 'contractor');
  const orgName = (id: string) => orgs.find((o) => o.id === id)?.name;

  const shown = useMemo(() => projects.filter((p) => {
    if (filter === 'active' && !p.is_active) return false;
    if (filter === 'inactive' && p.is_active) return false;
    const s = q.trim().toLowerCase();
    return !s || [p.name, p.code, p.client_name, p.site_location].some((x) => x?.toLowerCase().includes(s));
  }), [projects, filter, q]);

  return (
    <div>
      <PageHeader eyebrow="Master register" title="Projects & Sites"
        subtitle={isContractor ? 'Projects your company is engaged on.' : 'Every DFR, safety event, pre-start and audit links back to a project or site.'}
        actions={isLeader && <Button icon={<Plus className="h-5 w-5" />} onClick={() => setEditing({})}>New project</Button>} />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-steel-400" />
          <Input aria-label="Search projects" placeholder="Search name, code, client or location" className="pl-10" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="sm:w-auto [&>div]:mb-0">
          <Tabs value={filter} onChange={setFilter} tabs={[
            { key: 'active', label: 'Active', count: projects.filter((p) => p.is_active).length },
            { key: 'inactive', label: 'Inactive', count: projects.filter((p) => !p.is_active).length },
            { key: 'all', label: 'All', count: projects.length },
          ]} />
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data ? <Spinner /> : shown.length === 0 ? (
        <EmptyState icon={<MapPin className="h-10 w-10" />} title="No projects found"
          body={isContractor ? 'Your company has not been engaged on any projects yet.' : 'Try a different filter or create a project.'}
          action={isLeader && <Button icon={<Plus className="h-5 w-5" />} onClick={() => setEditing({})}>New project</Button>} />
      ) : (
        <>
          {/* Mobile cards */}
          <ul className="space-y-3 md:hidden">
            {shown.map((p) => (
              <li key={p.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {p.code && <p className="text-xs font-bold uppercase tracking-wider text-brand-700">{p.code}</p>}
                    <p className="text-lg font-bold leading-snug text-steel-900">{p.name}</p>
                  </div>
                  <Badge color={PROJECT_STATUS[p.status].color}>{PROJECT_STATUS[p.status].label}</Badge>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  <div><dt className="text-xs font-semibold uppercase text-steel-500">Client</dt><dd className="font-medium">{p.client_name ?? '—'}</dd></div>
                  <div><dt className="text-xs font-semibold uppercase text-steel-500">Location</dt><dd className="font-medium">{p.site_location ?? '—'}</dd></div>
                </dl>
                {!isContractor && !!p.organization_ids?.length && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-steel-600"><Building2 className="h-4 w-4" />{p.organization_ids.map(orgName).filter(Boolean).join(', ')}</p>
                )}
                {isLeader && <Button className="mt-3" variant="secondary" block icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(p)}>Edit</Button>}
              </li>
            ))}
          </ul>

          {/* Desktop table */}
          <div className="card hidden overflow-hidden md:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-steel-50 text-xs font-bold uppercase tracking-wider text-steel-500">
                <tr>
                  <th className="px-4 py-3">Project</th>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Location</th>
                  {!isContractor && <th className="px-4 py-3">Contractors</th>}
                  <th className="px-4 py-3">Dates</th>
                  <th className="px-4 py-3">Status</th>
                  {isLeader && <th className="px-4 py-3" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-steel-100">
                {shown.map((p) => (
                  <tr key={p.id} className="hover:bg-steel-50/60">
                    <td className="px-4 py-3">
                      <p className="font-bold text-steel-900">{p.name}</p>
                      <p className="text-xs font-semibold text-brand-700">{p.code}</p>
                    </td>
                    <td className="px-4 py-3">{p.client_name ?? '—'}</td>
                    <td className="px-4 py-3">{p.site_location ?? '—'}</td>
                    {!isContractor && (
                      <td className="px-4 py-3 text-xs">{p.organization_ids?.length ? p.organization_ids.map(orgName).filter(Boolean).join(', ') : <span className="text-steel-400">None</span>}</td>
                    )}
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-steel-600">{formatDate(p.start_date)} → {p.end_date ? formatDate(p.end_date) : 'ongoing'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-start gap-1">
                        <Badge color={PROJECT_STATUS[p.status].color}>{PROJECT_STATUS[p.status].label}</Badge>
                        {!p.is_active && <span className="text-[11px] font-semibold uppercase text-steel-400">Inactive</span>}
                      </div>
                    </td>
                    {isLeader && (
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(p)}>Edit</Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editing && <ProjectForm initial={editing} contractors={contractors} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
    </div>
  );
}
