import { clsx } from 'clsx';
import { ArrowLeft, ArrowRight, History, Save, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  Badge, Button, Card, EmptyState, ErrorBanner, Field, Input, PageHeader, Select, Spinner, Tabs, Textarea,
} from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { api } from '../lib/api';
import { INCIDENT_CATEGORY, INVESTIGATION_STATUS, ROLE_LABEL, daysUntil, formatDate, formatDateTime } from '../lib/labels';
import type { AuditEntry, Investigation, InvestigationStatus } from '../lib/types';
import { errMsg, useAsync } from '../lib/useAsync';

type Tab = 'open' | 'overdue' | 'closed' | 'all';
const isOverdue = (i: Investigation) => i.status !== 'closed' && (daysUntil(i.due_date) ?? 0) < 0;

/** Investigations register: open ones first, overdue in red. Visibility follows the incident (database RLS). */
export default function InvestigationsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'open';
  const [q, setQ] = useState('');
  const { data, loading, error, reload } = useAsync(async () => {
    const [investigations, incidents, people, projects] = await Promise.all([
      api.listInvestigations(), api.listRecords('safety_event'), api.listDirectory(), api.listProjects(),
    ]);
    return { investigations, incidents, people, projects };
  }, []);
  useEffect(() => api.subscribeChanges(() => { void reload(); }), [reload]);

  const list = useMemo(() => (data?.investigations ?? []).filter((i) => {
    if (tab === 'open' && i.status === 'closed') return false;
    if (tab === 'closed' && i.status !== 'closed') return false;
    if (tab === 'overdue' && !isOverdue(i)) return false;
    const s = q.trim().toLowerCase();
    if (!s) return true;
    const inc = data!.incidents.find((r) => r.id === i.incident_id);
    return [i.reference, inc?.reference, String(inc?.summary?.event_type ?? ''), data!.people.find((p) => p.id === i.lead_id)?.full_name]
      .some((x) => x?.toLowerCase().includes(s));
  }).sort((a, b) => Number(isOverdue(b)) - Number(isOverdue(a)) || (a.due_date ?? '9').localeCompare(b.due_date ?? '9')), [data, tab, q]);

  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorBanner message={error ?? 'Could not load investigations'} onRetry={reload} />;
  const all = data.investigations;

  return (
    <div>
      <PageHeader eyebrow="Safety" title="Investigations" subtitle="Open an investigation from a safety event. Due 14 days after the event unless changed." />
      <Tabs value={tab} onChange={(k) => setParams(k === 'open' ? {} : { tab: k }, { replace: true })} tabs={[
        { key: 'open', label: 'Open', count: all.filter((i) => i.status !== 'closed').length },
        { key: 'overdue', label: 'Overdue', count: all.filter(isOverdue).length },
        { key: 'closed', label: 'Closed', count: all.filter((i) => i.status === 'closed').length },
        { key: 'all', label: 'All', count: all.length },
      ]} />
      <div className="relative my-4 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-steel-400" />
        <Input aria-label="Search investigations" placeholder="Reference, event type, lead…" className="pl-10" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!list.length ? (
        <EmptyState icon={<Search className="h-10 w-10" />} title="No investigations here" body="Start one from a safety event's page." />
      ) : (
        <ul className="card divide-y divide-steel-100 overflow-hidden">
          {list.map((i) => {
            const inc = data.incidents.find((r) => r.id === i.incident_id);
            const overdue = isOverdue(i);
            const cat = INCIDENT_CATEGORY[String(inc?.summary?.incident_category)];
            return (
              <li key={i.id}>
                <Link to={`/investigations/${i.id}`} className={clsx('flex min-h-[72px] items-center gap-3 px-4 py-3 hover:bg-steel-50', overdue && 'bg-red-50 hover:bg-red-100')}>
                  <div className="min-w-0 flex-1">
                    <p className={clsx('truncate font-bold', overdue ? 'text-red-800' : 'text-steel-900')}>
                      <span className="mr-2 font-mono text-sm">{i.reference}</span>{String(inc?.summary?.event_type ?? 'Safety event')}
                    </p>
                    <p className="truncate text-xs text-steel-500">
                      {[inc?.reference, data.projects.find((p) => p.id === i.project_id)?.code, data.people.find((p) => p.id === i.lead_id)?.full_name ?? 'No lead',
                        i.status === 'closed' ? `closed ${formatDate(i.closed_at)}` : `due ${formatDate(i.due_date)}`].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  {cat && <span className="hidden sm:inline"><Badge color={cat.color} dot={false}>{cat.label}</Badge></span>}
                  {overdue ? <Badge color="red">{-(daysUntil(i.due_date) ?? 0)}d overdue</Badge> : <Badge color={INVESTIGATION_STATUS[i.status]!.color}>{INVESTIGATION_STATUS[i.status]!.label}</Badge>}
                  <ArrowRight className="h-4 w-4 shrink-0 text-steel-400" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const FIELD: Record<string, string> = {
  status: 'Status', lead_id: 'Lead', due_date: 'Due date', findings: 'Findings', root_cause: 'Root cause', corrective_actions: 'Corrective actions', closed_at: 'Closed',
};

export function InvestigationDetailPage() {
  const { id } = useParams();
  const { profile, isLeader, isProjectLead } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState<Investigation | null>(null);
  const [busy, setBusy] = useState(false);
  const { data, loading, error, reload } = useAsync(async () => {
    const all = await api.listInvestigations();
    const inv = all.find((i) => i.id === id);
    if (!inv) throw new Error("This investigation doesn't exist or you don't have access to it.");
    const [detail, people, projects, audit] = await Promise.all([
      api.getRecord(inv.incident_id).catch(() => null), api.listDirectory(), api.listProjects(), api.listAudit('investigations', inv.id).catch(() => [] as AuditEntry[]),
    ]);
    setForm(inv);
    return { inv, incident: detail?.record ?? null, people, projects, audit };
  }, [id]);

  if (loading && !data) return <Spinner />;
  if (error || !data || !form) return <ErrorBanner message={error ?? 'Not found'} />;
  const { inv, incident } = data;
  const canEdit = isLeader || inv.lead_id === profile?.id || isProjectLead;
  const person = (pid: string | null | undefined) => data.people.find((p) => p.id === pid)?.full_name ?? (pid ? 'Team member' : 'Unassigned');
  const dirty = (['status', 'lead_id', 'due_date', 'findings', 'root_cause', 'corrective_actions'] as const).some((k) => (form[k] ?? '') !== (inv[k] ?? ''));
  const overdue = isOverdue(inv);
  const set = (p: Partial<Investigation>) => setForm({ ...form, ...p });
  const show = (k: string, v: unknown) => v === null || v === undefined || v === '' ? '—'
    : k === 'lead_id' ? person(String(v)) : k === 'status' ? INVESTIGATION_STATUS[String(v)]?.label ?? String(v)
    : k === 'due_date' ? formatDate(String(v)) : k === 'closed_at' ? formatDateTime(String(v)) : String(v).length > 60 ? `${String(v).slice(0, 60)}…` : String(v);

  const save = async () => {
    if (form.status === 'closed' && !form.findings?.trim()) { toast('Record the findings before closing', 'error'); return; }
    setBusy(true);
    try {
      await api.saveInvestigation({ id: inv.id, status: form.status, lead_id: form.lead_id || null, due_date: form.due_date || null,
        findings: form.findings || null, root_cause: form.root_cause || null, corrective_actions: form.corrective_actions || null });
      toast(form.status === 'closed' && inv.status !== 'closed' ? `${inv.reference} closed` : 'Saved');
      await reload();
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex items-start gap-3">
        <Link to="/investigations" aria-label="Back" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white text-steel-600 shadow-card hover:text-steel-900">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-widest text-brand-600">Investigation · <span className="font-mono">{inv.reference}</span></p>
          <h1 className="text-3xl font-bold uppercase leading-tight">{String(incident?.summary?.event_type ?? 'Safety event')}</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge color={INVESTIGATION_STATUS[inv.status]!.color}>{INVESTIGATION_STATUS[inv.status]!.label}</Badge>
            {overdue && <Badge color="red">{-(daysUntil(inv.due_date) ?? 0)} days overdue</Badge>}
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <Card title="Investigation">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Status">
                <Select value={form.status} disabled={!canEdit} onChange={(e) => set({ status: e.target.value as InvestigationStatus })}>
                  {Object.entries(INVESTIGATION_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </Select>
              </Field>
              <Field label="Lead">
                <Select value={form.lead_id ?? ''} disabled={!canEdit} onChange={(e) => set({ lead_id: e.target.value || null })}>
                  <option value="">Unassigned</option>
                  {data.people.filter((p) => ['admin', 'hset', 'project_manager', 'supervisor'].includes(p.role)).map((p) => <option key={p.id} value={p.id}>{p.full_name} ({ROLE_LABEL[p.role]})</option>)}
                </Select>
              </Field>
              <Field label="Due date">
                <Input type="date" value={form.due_date ?? ''} disabled={!canEdit} className={clsx(overdue && 'border-red-500 text-red-700')} onChange={(e) => set({ due_date: e.target.value || null })} />
              </Field>
            </div>
            <div className="mt-4 space-y-4">
              <Field label="Findings" required={form.status === 'closed'}><Textarea value={form.findings ?? ''} disabled={!canEdit} onChange={(e) => set({ findings: e.target.value })} placeholder="What happened and why" /></Field>
              <Field label="Root cause"><Textarea value={form.root_cause ?? ''} disabled={!canEdit} onChange={(e) => set({ root_cause: e.target.value })} /></Field>
              <Field label="Corrective actions"><Textarea value={form.corrective_actions ?? ''} disabled={!canEdit} onChange={(e) => set({ corrective_actions: e.target.value })} placeholder="Who does what, by when" /></Field>
            </div>
            {canEdit && (
              <div className="mt-4 flex justify-end">
                <Button size="lg" icon={<Save className="h-5 w-5" />} loading={busy} disabled={!dirty} onClick={save}>{form.status === 'closed' && inv.status !== 'closed' ? 'Close investigation' : 'Save'}</Button>
              </div>
            )}
          </Card>
        </div>
        <aside className="space-y-5">
          <Card title="Incident" padded={false}>
            {incident ? (
              <Link to={`/records/${incident.id}`} className="block px-4 py-3 hover:bg-steel-50">
                <p className="font-mono font-bold text-brand-700">{incident.reference}</p>
                <p className="mt-1 text-sm text-steel-700">{formatDate(incident.record_date)} · {data.projects.find((p) => p.id === incident.project_id)?.name ?? 'No project'}</p>
                <p className="mt-1 line-clamp-3 text-sm text-steel-600">{String(incident.answers?.['q-desc'] ?? '')}</p>
                <p className="mt-1 text-xs text-steel-500">Reported by {person(incident.submitted_by)}</p>
              </Link>
            ) : <p className="px-4 py-3 text-sm text-steel-500">You can't open the incident record.</p>}
          </Card>
          <Card title="History" padded={false}>
            <ol className="max-h-96 divide-y divide-steel-100 overflow-y-auto">
              <li className="flex gap-2.5 px-4 py-2.5 text-sm"><History className="mt-0.5 h-4 w-4 shrink-0 text-steel-400" />
                <div><p>Opened</p><p className="text-xs text-steel-400">{formatDateTime(inv.opened_at)}</p></div></li>
              {[...data.audit].filter((a) => a.action === 'update').sort((a, b) => b.changed_at.localeCompare(a.changed_at)).map((a) => (
                <li key={a.id} className="flex gap-2.5 px-4 py-2.5 text-sm">
                  <History className="mt-0.5 h-4 w-4 shrink-0 text-steel-400" />
                  <div className="min-w-0">
                    <p className="text-steel-800"><b>{person(a.changed_by)}</b>: {Object.keys(a.new_data ?? {}).filter((k) => FIELD[k]).map((k) => `${FIELD[k]} ${show(k, a.old_data?.[k])} → ${show(k, a.new_data?.[k])}`).join('; ') || 'updated'}</p>
                    <p className="text-xs text-steel-400">{formatDateTime(a.changed_at)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </aside>
      </div>
    </div>
  );
}
