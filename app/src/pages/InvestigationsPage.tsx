import { clsx } from 'clsx';
import { ArrowLeft, ArrowRight, CheckCircle2, History, Save, Search, Send, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  Badge, Button, Card, Checkbox, EmptyState, ErrorBanner, Field, Input, PageHeader, Select, Spinner, Tabs, Textarea,
} from '../components/ui';
import { ActionsPanel } from '../components/actions/ActionsPanel';
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
  status: 'Status', lead_id: 'Lead', due_date: 'Due date', findings: 'Findings', root_cause: 'Root cause', corrective_actions: 'Summary',
  no_actions_reason: 'No actions because', review_comment: 'Review', closed_at: 'Closed',
};

const STEPS = [
  { key: 'investigate', label: 'Findings & root cause' },
  { key: 'actions', label: 'Actions' },
  { key: 'review', label: 'Review' },
  { key: 'closed', label: 'Closed' },
] as const;

/** Investigation: findings and root cause → actions raised at the end → submitted for review →
 *  an independent reviewer confirms the actions address the gaps and closes it (or sends it back). */
export function InvestigationDetailPage() {
  const { id } = useParams();
  const { profile, isLeader, isProjectLead } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState<Investigation | null>(null);
  const [busy, setBusy] = useState(false);
  const [noActions, setNoActions] = useState(false);
  const [review, setReview] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const { data, loading, error, reload } = useAsync(async () => {
    const all = await api.listInvestigations();
    const inv = all.find((i) => i.id === id);
    if (!inv) throw new Error("This investigation doesn't exist or you don't have access to it.");
    const [detail, people, projects, audit, actions] = await Promise.all([
      api.getRecord(inv.incident_id).catch(() => null), api.listDirectory(), api.listProjects(),
      api.listAudit('investigations', inv.id).catch(() => [] as AuditEntry[]), api.listActions({ investigationId: inv.id }).catch(() => []),
    ]);
    setForm(inv);
    setNoActions(!!inv.no_actions_reason);
    return { inv, incident: detail?.record ?? null, people, projects, audit, actions };
  }, [id]);
  useEffect(() => api.subscribeChanges(() => { void reload(); }), [reload]);

  if (loading && !data) return <Spinner />;
  if (error || !data || !form) return <ErrorBanner message={error ?? 'Not found'} />;
  const { inv, incident } = data;
  const isLead = inv.lead_id === profile?.id;
  const canEdit = (isLeader || isLead || isProjectLead) && ['open', 'in_progress'].includes(inv.status);
  const canReview = (isLeader || isProjectLead) && !isLead && inv.status === 'review';
  const person = (pid: string | null | undefined) => data.people.find((p) => p.id === pid)?.full_name ?? (pid === profile?.id ? profile?.full_name : pid ? 'Team member' : 'Unassigned');
  const dirty = (['lead_id', 'due_date', 'findings', 'root_cause', 'corrective_actions', 'no_actions_reason'] as const).some((k) => (form[k] ?? '') !== (inv[k] ?? ''));
  const overdue = isOverdue(inv);
  const set = (p: Partial<Investigation>) => setForm({ ...form, ...p });
  const liveActions = data.actions.filter((a) => a.status !== 'cancelled');
  const hasFindings = !!inv.findings?.trim() && !!inv.root_cause?.trim();
  const findingsReady = hasFindings || (!!form.findings?.trim() && !!form.root_cause?.trim());
  const step = inv.status === 'closed' ? 3 : inv.status === 'review' ? 2 : hasFindings ? 1 : 0;
  const show = (k: string, v: unknown) => v === null || v === undefined || v === '' ? '—'
    : k === 'lead_id' ? person(String(v)) ?? '—' : k === 'status' ? INVESTIGATION_STATUS[String(v)]?.label ?? String(v)
    : k === 'due_date' ? formatDate(String(v)) : k === 'closed_at' ? formatDateTime(String(v)) : String(v).length > 60 ? `${String(v).slice(0, 60)}…` : String(v);

  const run = async (patch: Partial<Investigation>, msg: string) => {
    setBusy(true);
    try { await api.saveInvestigation({ id: inv.id, ...patch }); toast(msg); await reload(); return true; }
    catch (e) { toast(errMsg(e), 'error'); return false; } finally { setBusy(false); }
  };
  const saveDetails = () => run({
    lead_id: form.lead_id || null, due_date: form.due_date || null, findings: form.findings || null, root_cause: form.root_cause || null,
    corrective_actions: form.corrective_actions || null, no_actions_reason: noActions ? form.no_actions_reason || null : null,
    ...(inv.status === 'open' && (form.findings || form.root_cause) ? { status: 'in_progress' as InvestigationStatus } : {}),
  }, 'Saved');
  const submitForReview = async () => {
    if (!form.findings?.trim() || !form.root_cause?.trim()) { toast('Record the findings and root cause first', 'error'); return; }
    if (!liveActions.length && !(noActions && form.no_actions_reason?.trim())) { toast('Raise the actions that address the gaps found, or say why none are needed', 'error'); return; }
    await run({ findings: form.findings, root_cause: form.root_cause, corrective_actions: form.corrective_actions || null,
      no_actions_reason: noActions ? form.no_actions_reason || null : null, status: 'review' }, 'Submitted for review');
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
            <span className="text-sm text-steel-600">Lead: {person(inv.lead_id)} · due {formatDate(inv.due_date)}</span>
          </div>
        </div>
      </div>

      {/* Progress */}
      <ol className="-mx-4 mb-5 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0" aria-label="Investigation steps">
        {STEPS.map((st, i) => (
          <li key={st.key} className={clsx('flex min-w-[120px] flex-1 items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold uppercase',
            i === step ? 'bg-steel-900 text-white' : i < step ? 'bg-emerald-50 text-emerald-800' : 'bg-white text-steel-400 ring-1 ring-steel-200')}>
            {i < step ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-current/10 text-[10px]">{i + 1}</span>}
            <span className="truncate">{st.label}</span>
          </li>
        ))}
      </ol>

      {inv.status !== 'review' && inv.review_comment && inv.status !== 'closed' && (
        <p className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900"><b>Sent back by the reviewer:</b> {inv.review_comment}</p>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <Card title="1 · Findings and root cause">
            <div className="grid gap-4 sm:grid-cols-2">
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
              <Field label="Findings" required><Textarea value={form.findings ?? ''} disabled={!canEdit} onChange={(e) => set({ findings: e.target.value })} placeholder="What happened, and what gaps were found" /></Field>
              <Field label="Root cause" required><Textarea value={form.root_cause ?? ''} disabled={!canEdit} onChange={(e) => set({ root_cause: e.target.value })} placeholder="Why it happened (5 whys, ICAM etc.)" /></Field>
            </div>
            {canEdit && (
              <div className="mt-4 flex justify-end">
                <Button icon={<Save className="h-5 w-5" />} loading={busy} disabled={!dirty} onClick={saveDetails}>Save</Button>
              </div>
            )}
          </Card>

          {(findingsReady || data.actions.length > 0) ? (
            <ActionsPanel investigationId={inv.id} projectId={inv.project_id} canRaise={canEdit} title="2 · Actions to close the gaps"
              emptyText="Raise an action for each gap or root cause found, assigned to a person with a close-out date." />
          ) : (
            <Card title="2 · Actions to close the gaps"><p className="text-sm text-steel-500">Record the findings and root cause first, then raise the actions that address them.</p></Card>
          )}

          {canEdit && findingsReady && (
            <Card title="3 · Submit for review">
              <p className="mb-3 text-sm text-steel-600">A reviewer (Admin, HSET or the project's PM — not the lead) checks the findings and confirms the actions address the gaps before the investigation closes.</p>
              {!liveActions.length && (
                <div className="mb-3">
                  <Checkbox label="No actions are needed" checked={noActions} onChange={setNoActions} />
                  {noActions && <Field label="Why no actions are needed" required><Textarea value={form.no_actions_reason ?? ''} onChange={(e) => set({ no_actions_reason: e.target.value })} /></Field>}
                </div>
              )}
              <Field label="Summary for the reviewer (optional)"><Textarea className="min-h-[64px]" value={form.corrective_actions ?? ''} onChange={(e) => set({ corrective_actions: e.target.value })} /></Field>
              <Button size="lg" block className="mt-3" icon={<Send className="h-5 w-5" />} loading={busy} onClick={submitForReview}>
                Submit for review{liveActions.length ? ` (${liveActions.length} action${liveActions.length === 1 ? '' : 's'})` : ''}
              </Button>
            </Card>
          )}

          {inv.status === 'review' && (
            <Card title="Review">
              <p className="text-sm text-steel-600">Submitted by {person(inv.submitted_for_review_by)} on {formatDateTime(inv.submitted_for_review_at)}.</p>
              {inv.no_actions_reason && <p className="mt-2 text-sm"><b>No actions because:</b> {inv.no_actions_reason}</p>}
              {inv.corrective_actions && <p className="mt-2 whitespace-pre-wrap text-sm"><b>Summary:</b> {inv.corrective_actions}</p>}
              {canReview ? (
                <div className="mt-4 space-y-3">
                  <Checkbox label="The actions address the gaps and root causes found" description="Read the findings, root cause and each action above before confirming." checked={confirmed} onChange={setConfirmed} />
                  <Field label="Review comment" required><Textarea value={review} onChange={(e) => setReview(e.target.value)} placeholder="What you checked, or what needs more work" /></Field>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button size="lg" icon={<CheckCircle2 className="h-5 w-5" />} disabled={!confirmed || !review.trim()} loading={busy}
                      onClick={() => run({ status: 'closed', actions_confirmed: true, review_comment: review.trim() }, `${inv.reference} closed`)}>Close investigation</Button>
                    <Button size="lg" variant="secondary" icon={<Undo2 className="h-5 w-5" />} disabled={!review.trim()} loading={busy}
                      onClick={() => run({ status: 'in_progress', review_comment: review.trim() }, 'Sent back to the lead')}>Send back</Button>
                  </div>
                </div>
              ) : (
                <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-900">
                  {isLead ? 'Waiting for review by Admin, HSET or the project manager.' : "Only Admin, HSET or a project lead (other than the investigation lead) can review this."}
                </p>
              )}
            </Card>
          )}

          {inv.status === 'closed' && (
            <Card title="Review">
              <p className="text-sm"><b>{person(inv.reviewed_by)}</b> confirmed the actions address the gaps found · {formatDateTime(inv.reviewed_at ?? inv.closed_at)}</p>
              {inv.review_comment && <p className="mt-2 whitespace-pre-wrap text-steel-800">{inv.review_comment}</p>}
              {inv.no_actions_reason && <p className="mt-2 text-sm"><b>No actions because:</b> {inv.no_actions_reason}</p>}
            </Card>
          )}
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
