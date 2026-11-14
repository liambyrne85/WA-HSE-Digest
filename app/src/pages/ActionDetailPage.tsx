import { clsx } from 'clsx';
import { ArrowLeft, Ban, CheckCircle2, History, Pencil, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EvidenceInput, EvidenceView } from '../components/actions/Evidence';
import { ActionStatusBadge, PRIORITY, isOverdue } from '../components/actions/ActionsPanel';
import { Badge, Button, Card, ErrorBanner, Field, Input, Modal, Select, Spinner, Textarea } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { api } from '../lib/api';
import { MODULE_LABEL, daysUntil, formatDate, formatDateTime, perthToday } from '../lib/labels';
import { submitOrQueue } from '../lib/offline/outbox';
import type { Action, ActionPriority, AuditEntry } from '../lib/types';
import { errMsg, useAsync } from '../lib/useAsync';

const FIELD: Record<string, string> = {
  status: 'Status', assignee_id: 'Assigned to', due_date: 'Due', title: 'Action', priority: 'Priority', status_note: 'Reason', close_comment: 'Close-out',
};

export default function ActionDetailPage() {
  const { id } = useParams();
  const { profile, isLeader, isProjectLead } = useAuth();
  const toast = useToast();
  const [comment, setComment] = useState('');
  const [evidence, setEvidence] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(false);
  const [editing, setEditing] = useState<Action | null>(null);
  const [statusChange, setStatusChange] = useState<'open' | 'cancelled' | null>(null);
  const [reason, setReason] = useState('');

  const { data, loading, error, reload } = useAsync(async () => {
    const a = await api.getAction(id!);
    if (!a) throw new Error("This action doesn't exist or you don't have access to it.");
    const [people, audit] = await Promise.all([api.listDirectory(), api.listAudit('actions', a.id).catch(() => [] as AuditEntry[])]);
    return { a, people, audit };
  }, [id]);

  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorBanner message={error ?? 'Not found'} />;
  const { a } = data;
  const person = (pid: string | null) => data.people.find((p) => p.id === pid)?.full_name ?? (pid === profile?.id ? profile?.full_name : pid ? 'Team member' : '—');
  const isAssignee = a.assignee_id === profile?.id;
  const manager = isLeader || a.raised_by === profile?.id || isProjectLead;
  const sourceLink = a.submission_id ? `/records/${a.submission_id}` : a.investigation_id ? `/investigations/${a.investigation_id}` : null;
  const sourceLabel = a.source_module === 'investigation' ? 'Investigation' : MODULE_LABEL[a.source_module as keyof typeof MODULE_LABEL] ?? 'Record';
  const left = daysUntil(a.due_date) ?? 0;
  const show = (k: string, v: unknown) => v === null || v === undefined || v === '' ? '—'
    : k === 'assignee_id' ? person(String(v)) ?? '—' : k === 'due_date' ? formatDate(String(v)) : String(v).length > 80 ? `${String(v).slice(0, 80)}…` : String(v);

  const closeOut = async () => {
    if (!comment.trim()) { toast('Add a close-out comment', 'error'); return; }
    if (!evidence.length) { toast('Attach a photo or file as evidence', 'error'); return; }
    setBusy(true);
    try {
      const res = await submitOrQueue<Action>({ id: `close-${a.id}`, kind: 'action_close', label: `Close out ${a.reference} · ${a.title}`,
        payload: { id: a.id, close_comment: comment.trim(), close_evidence: evidence }, link: `/actions/${a.id}` });
      if (res.queued) { setQueued(true); toast('Saved on this phone. It will send by itself when you have coverage.'); }
      else { toast(`${a.reference} closed out`); setComment(''); setEvidence([]); await reload(); }
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-start gap-3">
        <Link to="/actions" aria-label="Back" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white text-steel-600 shadow-card hover:text-steel-900">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-widest text-brand-600">Action · <span className="font-mono">{a.reference}</span></p>
          <h1 className="text-3xl font-bold uppercase leading-tight">{a.title}</h1>
          <div className="mt-2 flex flex-wrap gap-2"><ActionStatusBadge a={a} /><Badge color={PRIORITY[a.priority].color} dot={false}>{PRIORITY[a.priority].label} priority</Badge></div>
        </div>
      </div>

      <div className={clsx('mb-5 rounded-xl px-4 py-3 font-semibold',
        a.status === 'closed' ? 'bg-emerald-50 text-emerald-900' : a.status === 'cancelled' ? 'bg-steel-100 text-steel-700' : isOverdue(a) ? 'bg-red-600 text-white' : 'bg-blue-50 text-blue-900')}>
        {a.status === 'closed' ? `Closed out by ${person(a.closed_by)} on ${formatDateTime(a.closed_at)}`
          : a.status === 'cancelled' ? `Cancelled: ${a.status_note ?? ''}`
          : isOverdue(a) ? `Overdue by ${-left} day${left === -1 ? '' : 's'} — was due ${formatDate(a.due_date)}`
          : left === 0 ? 'Due today' : `Due ${formatDate(a.due_date)} (${left} day${left === 1 ? '' : 's'})`}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <Card title="Details">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Item k="Assigned to" v={person(a.assignee_id)} />
              <Item k="Close out by" v={formatDate(a.due_date)} />
              <Item k="Raised by" v={`${person(a.raised_by)} · ${formatDate(a.created_at)}`} />
              <div><dt className="text-xs font-bold uppercase text-steel-500">Raised from</dt><dd className="font-semibold">
                {sourceLink ? <Link className="text-brand-700 hover:underline" to={sourceLink}>{sourceLabel} {a.source_reference}</Link> : `${sourceLabel} ${a.source_reference ?? ''}`}
              </dd></div>
            </dl>
            {a.description && <p className="mt-4 whitespace-pre-wrap text-steel-800">{a.description}</p>}
            {a.status === 'open' && a.status_note && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><b>Reopened:</b> {a.status_note}</p>}
          </Card>

          {a.status === 'closed' && (
            <Card title="Close-out">
              <p className="whitespace-pre-wrap text-steel-800">{a.close_comment}</p>
              <p className="mb-2 mt-4 text-xs font-bold uppercase tracking-wider text-steel-500">Evidence</p>
              <EvidenceView items={a.close_evidence} />
            </Card>
          )}

          {a.status === 'open' && isAssignee && (
            <Card title="Close out this action">
              {queued ? (
                <p className="rounded-lg bg-blue-50 p-3 text-sm font-semibold text-blue-900">Your close-out is saved on this phone and will send when you have coverage.</p>
              ) : (
                <div className="space-y-4">
                  <Field label="What was done" required><Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Describe the fix and who was involved" /></Field>
                  <div><span className="label">Evidence <span className="text-red-600">*</span></span><EvidenceInput value={evidence} onChange={setEvidence} />
                    <p className="mt-1 text-xs text-steel-500">A photo of the fix, a signed register, a document — at least one is required.</p></div>
                  <Button size="lg" block icon={<CheckCircle2 className="h-6 w-6" />} loading={busy} onClick={closeOut}>Close out action</Button>
                </div>
              )}
            </Card>
          )}
          {a.status === 'open' && !isAssignee && (
            <p className="rounded-lg bg-steel-100 px-4 py-3 text-sm text-steel-700">Only {person(a.assignee_id)} can close this out, with a comment and evidence. Reassign it if someone else should.</p>
          )}
        </div>

        <aside className="space-y-5">
          {manager && (
            <Card title="Manage">
              <div className="grid gap-2">
                {a.status === 'open' && <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing({ ...a })}>Edit or reassign</Button>}
                {a.status === 'closed' && <Button variant="secondary" icon={<RotateCcw className="h-4 w-4" />} onClick={() => { setReason(''); setStatusChange('open'); }}>Reopen</Button>}
                {a.status === 'open' && <Button variant="secondary" icon={<Ban className="h-4 w-4" />} onClick={() => { setReason(''); setStatusChange('cancelled'); }}>Cancel action</Button>}
                {a.status === 'cancelled' && <p className="text-sm text-steel-500">Cancelled actions stay on record.</p>}
              </div>
            </Card>
          )}
          <Card title="History" padded={false}>
            <ol className="max-h-96 divide-y divide-steel-100 overflow-y-auto">
              {[...data.audit].sort((x, y) => y.changed_at.localeCompare(x.changed_at)).map((e) => (
                <li key={e.id} className="flex gap-2.5 px-4 py-2.5 text-sm">
                  <History className="mt-0.5 h-4 w-4 shrink-0 text-steel-400" />
                  <div className="min-w-0">
                    <p className="text-steel-800">{e.changed_by && <b>{person(e.changed_by)}: </b>}
                      {e.action === 'insert' ? 'Raised' : Object.keys(e.new_data ?? {}).filter((k) => FIELD[k]).map((k) => `${FIELD[k]} ${show(k, e.old_data?.[k])} → ${show(k, e.new_data?.[k])}`).join('; ') || 'Updated'}</p>
                    <p className="text-xs text-steel-400">{formatDateTime(e.changed_at)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </aside>
      </div>

      {editing && (
        <Modal open drawer onClose={() => setEditing(null)} title={`Edit ${a.reference}`}
          footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button size="lg" onClick={async () => {
              try {
                await api.updateAction(a.id, { title: editing.title.trim(), description: editing.description || null, priority: editing.priority, assignee_id: editing.assignee_id, due_date: editing.due_date });
                toast(editing.assignee_id !== a.assignee_id ? `Reassigned to ${person(editing.assignee_id)}` : 'Saved'); setEditing(null); void reload();
              } catch (e) { toast(errMsg(e), 'error'); }
            }}>Save</Button></>}>
          <div className="space-y-4">
            <Field label="Action"><Input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></Field>
            <Field label="Details"><Textarea value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field>
            <Field label="Assigned to">
              <Select value={editing.assignee_id} onChange={(e) => setEditing({ ...editing, assignee_id: e.target.value })}>
                {[...data.people].sort((x, y) => x.full_name.localeCompare(y.full_name)).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </Select>
            </Field>
            <Field label="Close out by"><Input type="date" min={perthToday()} value={editing.due_date} onChange={(e) => setEditing({ ...editing, due_date: e.target.value })} /></Field>
            <Field label="Priority">
              <Select value={editing.priority} onChange={(e) => setEditing({ ...editing, priority: e.target.value as ActionPriority })}>
                {(Object.keys(PRIORITY) as ActionPriority[]).map((k) => <option key={k} value={k}>{PRIORITY[k].label}</option>)}
              </Select>
            </Field>
          </div>
        </Modal>
      )}
      <Modal open={!!statusChange} onClose={() => setStatusChange(null)} title={statusChange === 'open' ? `Reopen ${a.reference}` : `Cancel ${a.reference}`}
        footer={<><Button variant="secondary" onClick={() => setStatusChange(null)}>Back</Button>
          <Button variant={statusChange === 'cancelled' ? 'danger' : 'primary'} disabled={!reason.trim()} onClick={async () => {
            try { await api.updateAction(a.id, { status: statusChange!, status_note: reason.trim() }); toast(statusChange === 'open' ? 'Reopened and sent back' : 'Action cancelled'); setStatusChange(null); void reload(); }
            catch (e) { toast(errMsg(e), 'error'); }
          }}>{statusChange === 'open' ? 'Reopen' : 'Cancel action'}</Button></>}>
        <Field label="Reason" required hint={statusChange === 'open' ? `${person(a.assignee_id)} is told why and has to close it out again.` : 'Kept on the record.'}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus
            placeholder={statusChange === 'open' ? 'e.g. Photo only shows bay 3 — bay 4 still missing kick plates' : 'e.g. Covered by ACT-00012'} />
        </Field>
      </Modal>
    </div>
  );
}

const Item = ({ k, v }: { k: string; v: string | null | undefined }) => (
  <div><dt className="text-xs font-bold uppercase text-steel-500">{k}</dt><dd className="font-semibold">{v || '—'}</dd></div>
);
