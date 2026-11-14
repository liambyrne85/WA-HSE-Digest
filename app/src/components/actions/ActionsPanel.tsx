import { clsx } from 'clsx';
import { ArrowRight, ListChecks, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { api } from '../../lib/api';
import { addDays, daysUntil, formatDate, perthToday } from '../../lib/labels';
import type { Action, ActionPriority, DirectoryEntry } from '../../lib/types';
import { errMsg, useAsync } from '../../lib/useAsync';
import { Badge, Button, Card, Field, Input, Modal, Select, Textarea } from '../ui';

export const PRIORITY: Record<ActionPriority, { label: string; color: 'red' | 'amber' | 'slate'; on: string }> = {
  high: { label: 'High', color: 'red', on: 'border-red-600 bg-red-600 text-white' },
  medium: { label: 'Medium', color: 'amber', on: 'border-amber-400 bg-amber-400 text-steel-900' },
  low: { label: 'Low', color: 'slate', on: 'border-steel-600 bg-steel-600 text-white' },
};

export const isOverdue = (a: Action) => a.status === 'open' && (daysUntil(a.due_date) ?? 0) < 0;

export function ActionStatusBadge({ a }: { a: Action }) {
  if (a.status === 'closed') return <Badge color="green">Closed</Badge>;
  if (a.status === 'cancelled') return <Badge color="slate">Cancelled</Badge>;
  const d = daysUntil(a.due_date) ?? 0;
  if (d < 0) return <Badge color="red">{-d}d overdue</Badge>;
  if (d === 0) return <Badge color="amber">Due today</Badge>;
  return <Badge color="blue">Open</Badge>;
}

export function ActionRow({ a, people, showSource }: { a: Action; people: DirectoryEntry[]; showSource?: boolean }) {
  const who = people.find((p) => p.id === a.assignee_id)?.full_name ?? 'Team member';
  return (
    <li>
      <Link to={`/actions/${a.id}`} className={clsx('flex min-h-[64px] items-center gap-3 px-4 py-3 hover:bg-steel-50', isOverdue(a) && 'bg-red-50 hover:bg-red-100')}>
        <div className="min-w-0 flex-1">
          <p className={clsx('font-bold', isOverdue(a) ? 'text-red-800' : 'text-steel-900')}><span className="mr-2 font-mono text-sm text-brand-700">{a.reference}</span>{a.title}</p>
          <p className="truncate text-xs text-steel-500">
            {[who, a.status === 'closed' ? `closed ${formatDate(a.closed_at)}` : `due ${formatDate(a.due_date)}`, showSource ? a.source_reference : null, `${PRIORITY[a.priority].label} priority`].filter(Boolean).join(' · ')}
          </p>
        </div>
        <ActionStatusBadge a={a} />
        <ArrowRight className="h-4 w-4 shrink-0 text-steel-400" />
      </Link>
    </li>
  );
}

/** Actions raised on a record (incident, audit, field leadership) or an investigation. */
export function ActionsPanel({ submissionId, investigationId, canRaise }: { submissionId?: string; investigationId?: string; canRaise: boolean }) {
  const [raising, setRaising] = useState(false);
  const { data, reload } = useAsync(async () => {
    const [actions, people] = await Promise.all([api.listActions({ submissionId, investigationId }), api.listDirectory()]);
    return { actions, people };
  }, [submissionId, investigationId]);
  useEffect(() => api.subscribeChanges(() => { void reload(); }), [reload]);
  const open = data?.actions.filter((a) => a.status === 'open').length ?? 0;
  return (
    <Card title={<span className="flex items-center gap-2"><ListChecks className="h-5 w-5" />Actions{data ? ` (${open} open)` : ''}</span>} padded={false}
      actions={canRaise ? <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setRaising(true)}>Raise action</Button> : undefined}>
      <ul className="divide-y divide-steel-100">
        {data?.actions.map((a) => <ActionRow key={a.id} a={a} people={data.people} />)}
        {data && !data.actions.length && <li className="px-4 py-5 text-sm text-steel-500">No actions raised yet.{canRaise ? ' Raise one to assign a fix to someone with a due date.' : ''}</li>}
      </ul>
      {raising && data && (
        <RaiseActionModal submissionId={submissionId} investigationId={investigationId} people={data.people}
          onClose={() => setRaising(false)} onSaved={() => { setRaising(false); void reload(); }} />
      )}
    </Card>
  );
}

export function RaiseActionModal({ submissionId, investigationId, people, onClose, onSaved }: {
  submissionId?: string; investigationId?: string; people: DirectoryEntry[]; onClose: () => void; onSaved: (a: Action) => void;
}) {
  const { profile } = useAuth();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState(addDays(perthToday(), 7));
  const [priority, setPriority] = useState<ActionPriority>('medium');
  const [busy, setBusy] = useState(false);
  const sorted = [...people].sort((a, b) => a.full_name.localeCompare(b.full_name));
  const save = async () => {
    if (!title.trim()) { toast('Say what needs to be done', 'error'); return; }
    if (!assignee) { toast('Choose who the action is assigned to', 'error'); return; }
    setBusy(true);
    try {
      const a = await api.raiseAction({ submission_id: submissionId ?? null, investigation_id: investigationId ?? null, title: title.trim(),
        description: description.trim() || null, assignee_id: assignee, due_date: due, priority });
      toast(`${a.reference} raised and assigned`);
      onSaved(a);
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal open drawer onClose={onClose} title="Raise action"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button size="lg" loading={busy} onClick={save}>Raise and assign</Button></>}>
      <div className="space-y-4">
        <Field label="Action" required><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Fit kick plates to lift 4, bays 3–5" autoFocus /></Field>
        <Field label="Details"><Textarea className="min-h-[72px]" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What needs doing and what good looks like" /></Field>
        <Field label="Assigned to" required hint="They're notified in the app and by email, and must close it out with a comment and evidence.">
          <Select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Choose a person…</option>
            {profile && <option value={profile.id}>Me ({profile.full_name})</option>}
            {sorted.filter((p) => p.id !== profile?.id).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </Select>
        </Field>
        <Field label="Close out by" required>
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" className="max-w-[200px]" min={perthToday()} value={due} onChange={(e) => setDue(e.target.value)} />
            {[1, 7, 14, 28].map((n) => (
              <Button key={n} size="sm" variant={due === addDays(perthToday(), n) ? 'dark' : 'secondary'} onClick={() => setDue(addDays(perthToday(), n))}>
                {n === 1 ? 'Tomorrow' : n === 7 ? '1 week' : n === 14 ? '2 weeks' : '4 weeks'}
              </Button>
            ))}
          </div>
        </Field>
        <div>
          <span className="label">Priority</span>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(PRIORITY) as ActionPriority[]).reverse().map((k) => (
              <button key={k} type="button" aria-pressed={priority === k} onClick={() => setPriority(k)}
                className={clsx('min-h-[52px] rounded-lg border-2 font-bold uppercase', priority === k ? PRIORITY[k].on : 'border-steel-200 bg-white text-steel-600')}>
                {PRIORITY[k].label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
