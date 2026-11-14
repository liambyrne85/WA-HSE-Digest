import { clsx } from 'clsx';
import { ArrowLeft, Check, CheckCircle2, Circle, Clock, MessageSquare, Pencil, Send, Trash2, X, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AnswerView } from '../components/forms/AnswerView';
import { Button, Card, ErrorBanner, Field, Modal, Select, Spinner, Textarea } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { useToast } from '../contexts/ToastContext';
import { api } from '../lib/api';
import { MODULE_LABEL, MODULE_ROUTE, ROLE_LABEL, formatDateTime } from '../lib/labels';
import type { RecordApproval } from '../lib/types';
import { errMsg, useAsync } from '../lib/useAsync';
import { RecordChips, StatusBadge } from './ModulePage';

export default function RecordDetailPage() {
  const { id } = useParams();
  const { profile, isLeader, role } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const nav = useNavigate();
  const [comment, setComment] = useState('');
  const [rejecting, setRejecting] = useState<RecordApproval | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [moveTo, setMoveTo] = useState('');

  const { data, loading, error, reload } = useAsync(async () => {
    const d = await api.getRecord(id!);
    if (!d) throw new Error("This record doesn't exist or you don't have access to it.");
    const [pipelines, projects, people, orgs] = await Promise.all([api.listPipelines(), api.listProjects(), api.listDirectory(), api.listOrganizations()]);
    return { ...d, statuses: pipelines.find((p) => p.module === d.record.module)?.statuses ?? [], projects, people, orgs };
  }, [id]);

  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorBanner message={error ?? 'Not found'} />;
  const { record: r, version, approvals, events, statuses } = data;
  const person = (pid: string | null) => (pid ? data.people.find((p) => p.id === pid)?.full_name ?? (pid === profile?.id ? profile?.full_name : 'Team member') : 'System');
  const project = data.projects.find((p) => p.id === r.project_id);
  const org = data.orgs.find((o) => o.id === r.organization_id);
  const isOwner = r.submitted_by === profile?.id;
  const canEdit = isLeader || (isOwner && ['draft', 'rejected', 'returned'].includes(r.status));
  const canDecide = (a: RecordApproval) => a.status === 'pending' && (isLeader || a.approver_role === role);
  const label = (k: string | null) => (k === 'draft' ? 'Draft' : statuses.find((s) => s.key === k)?.label ?? k ?? '');
  const currentIdx = statuses.findIndex((s) => s.key === r.status);

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try { await fn(); toast(msg); await reload(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex items-start gap-3">
        <Link to={MODULE_ROUTE[r.module] ?? '/'} aria-label="Back" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white text-steel-600 shadow-card hover:text-steel-900">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-widest text-brand-600">{MODULE_LABEL[r.module]} · <span className="font-mono">{r.reference}</span></p>
          <h1 className="text-3xl font-bold uppercase leading-tight">{r.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2"><StatusBadge status={r.status} statuses={statuses} /><RecordChips r={r} /></div>
        </div>
      </div>

      {/* Pipeline progress */}
      {r.status !== 'draft' && statuses.length > 0 && (
        <ol className="-mx-4 mb-5 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0" aria-label="Status pipeline">
          {statuses.filter((s) => !['rejected', 'returned'].includes(s.key) || s.key === r.status).map((s) => {
            const idx = statuses.findIndex((x) => x.key === s.key);
            const done = currentIdx >= 0 && idx < currentIdx && !['rejected', 'returned'].includes(r.status);
            const current = s.key === r.status;
            return (
              <li key={s.key} className={clsx('flex min-w-[110px] flex-1 items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold uppercase',
                current ? 'bg-steel-900 text-white' : done ? 'bg-emerald-50 text-emerald-800' : 'bg-white text-steel-400 ring-1 ring-steel-200')}>
                {done ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <Circle className={clsx('h-4 w-4 shrink-0', current && 'fill-hivis-500 text-hivis-500')} />}
                <span className="truncate">{s.label}</span>
              </li>
            );
          })}
        </ol>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          {/* Actions */}
          {(canEdit || isLeader) && (
            <div className="card flex flex-wrap items-end gap-2 p-3">
              {canEdit && (
                <Link to={`/records/${r.id}/edit`}><Button variant={r.status === 'draft' ? 'primary' : 'secondary'} icon={<Pencil className="h-4 w-4" />}>
                  {r.submitted_at && (r.status === 'draft' || ['rejected', 'returned'].includes(r.status)) && isOwner ? 'Fix & resubmit'
                    : r.status === 'draft' ? 'Continue & submit' : 'Edit answers'}
                </Button></Link>
              )}
              {(r.status === 'draft' && !r.submitted_at && (isOwner || isLeader)) && (
                <Button variant="ghost" className="!text-red-600" icon={<Trash2 className="h-4 w-4" />} disabled={busy}
                  onClick={async () => {
                    if (!(await confirm({ title: 'Discard draft', message: `Discard ${r.reference}? It's archived and no longer shown.`, confirmLabel: 'Discard', danger: true }))) return;
                    try { await api.archiveRecord(r.id); toast('Draft discarded'); nav(MODULE_ROUTE[r.module] ?? '/'); } catch (e) { toast(errMsg(e), 'error'); }
                  }}>Discard draft</Button>
              )}
              {isLeader && r.status !== 'draft' && (
                <div className="ml-auto flex items-end gap-2">
                  <div className="w-48">
                    <Field label="Move to status">
                      <Select value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                        <option value="">Choose…</option>
                        {statuses.filter((s) => s.key !== r.status).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                      </Select>
                    </Field>
                  </div>
                  <Button variant="dark" disabled={!moveTo || busy} onClick={() => run(async () => { await api.setRecordStatus(r.id, moveTo); setMoveTo(''); }, `Moved to ${label(moveTo)}`)}>Move</Button>
                </div>
              )}
            </div>
          )}

          <Card title="Details">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div><dt className="text-xs font-bold uppercase text-steel-500">Project / site</dt><dd className="font-semibold">{project ? `${project.code ? `${project.code} – ` : ''}${project.name}` : '—'}</dd></div>
              <div><dt className="text-xs font-bold uppercase text-steel-500">Company</dt><dd className="font-semibold">{org?.name ?? '—'}</dd></div>
              <div><dt className="text-xs font-bold uppercase text-steel-500">Submitted by</dt><dd className="font-semibold">{person(r.submitted_by)}</dd></div>
              <div><dt className="text-xs font-bold uppercase text-steel-500">Submitted</dt><dd className="font-semibold">{r.submitted_at ? formatDateTime(r.submitted_at) : 'Not yet'}</dd></div>
              <div><dt className="text-xs font-bold uppercase text-steel-500">Form</dt><dd className="font-semibold">{version.name} · v{version.version}</dd></div>
            </dl>
          </Card>

          <AnswerView schema={version.schema} answers={r.answers} />
        </div>

        <aside className="space-y-5">
          {approvals.length > 0 && (
            <Card title="Approvals" padded={false}>
              <ol className="divide-y divide-steel-100">
                {approvals.map((a) => (
                  <li key={a.id} className="space-y-2 px-4 py-3">
                    <div className="flex items-center gap-2">
                      {a.status === 'approved' ? <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                        : a.status === 'rejected' ? <XCircle className="h-5 w-5 text-red-600" />
                        : a.status === 'pending' ? <Clock className="h-5 w-5 text-amber-600" />
                        : <Circle className="h-5 w-5 text-steel-300" />}
                      <span className="flex-1 text-sm font-bold">Step {a.step}: {ROLE_LABEL[a.approver_role]}</span>
                      <span className={clsx('text-xs font-bold uppercase', a.status === 'pending' ? 'text-amber-700' : 'text-steel-500')}>{a.status}</span>
                    </div>
                    {a.due_at && a.status === 'pending' && (
                      <p className={clsx('text-xs', new Date(a.due_at) < new Date() ? 'font-bold text-red-600' : 'text-steel-500')}>
                        {new Date(a.due_at) < new Date() ? 'Overdue — was due ' : 'Due '}{formatDateTime(a.due_at)}
                      </p>
                    )}
                    {a.decided_at && <p className="text-xs text-steel-500">{person(a.decided_by)} · {formatDateTime(a.decided_at)}{a.comment ? ` — “${a.comment}”` : ''}</p>}
                    {canDecide(a) && (
                      <div className="flex gap-2">
                        <Button className="flex-1" icon={<Check className="h-5 w-5" />} disabled={busy}
                          onClick={() => run(() => api.decideApproval(a.id, 'approved'), 'Approved')}>Approve</Button>
                        <Button className="flex-1" variant="secondary" icon={<X className="h-5 w-5" />} disabled={busy}
                          onClick={() => { setRejecting(a); setRejectNote(''); }}>Reject</Button>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </Card>
          )}

          <Card title="Activity" padded={false}>
            <ol className="space-y-3 px-4 py-3">
              {events.map((e) => (
                <li key={e.id} className="flex gap-2.5 text-sm">
                  <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', e.kind === 'comment' ? 'bg-brand-500' : e.kind === 'approval' ? 'bg-emerald-500' : 'bg-steel-300')} />
                  <div className="min-w-0">
                    <p className="text-steel-800">
                      <span className="font-semibold">{e.kind === 'approval_requested' ? 'Workflow' : person(e.actor)}</span>{' '}
                      {e.kind === 'created' && (e.to_status === 'draft' ? 'started a draft' : <>submitted it as <b>{label(e.to_status)}</b></>)}
                      {e.kind === 'status' && <>moved it {e.from_status ? <>from <b>{label(e.from_status)}</b> </> : null}to <b>{label(e.to_status)}</b></>}
                      {e.kind === 'approval_requested' && <>requested approval ({e.body})</>}
                      {e.kind === 'approval' && <>— {e.body}</>}
                      {e.kind === 'comment' && 'commented'}
                    </p>
                    {e.kind === 'comment' && <p className="mt-0.5 whitespace-pre-wrap rounded-lg bg-steel-50 px-3 py-2 text-steel-800">{e.body}</p>}
                    <p className="text-xs text-steel-400">{formatDateTime(e.created_at)}</p>
                  </div>
                </li>
              ))}
            </ol>
            <form className="border-t border-steel-100 p-3" onSubmit={(ev) => {
              ev.preventDefault();
              if (!comment.trim()) return;
              void run(async () => { await api.addComment(r.id, comment.trim()); setComment(''); }, 'Comment added');
            }}>
              <Textarea aria-label="Add a comment" className="!min-h-[72px]" placeholder="Add a comment" value={comment} onChange={(e) => setComment(e.target.value)} />
              <Button type="submit" className="mt-2" size="sm" variant="secondary" icon={<Send className="h-4 w-4" />} disabled={!comment.trim() || busy}>Comment</Button>
            </form>
          </Card>
          <p className="flex items-center gap-1.5 px-1 text-xs text-steel-500"><MessageSquare className="h-4 w-4" />Everyone who can see this record sees its comments.</p>
        </aside>
      </div>

      <Modal open={!!rejecting} onClose={() => setRejecting(null)} title="Reject"
        footer={<>
          <Button variant="secondary" onClick={() => setRejecting(null)}>Cancel</Button>
          <Button variant="danger" disabled={!rejectNote.trim() || busy}
            onClick={() => rejecting && run(async () => { await api.decideApproval(rejecting.id, 'rejected', rejectNote); setRejecting(null); }, 'Rejected and returned')}>Reject</Button>
        </>}>
        <Field label="What needs to change?" required hint="The submitter sees this and can fix and resubmit.">
          <Textarea value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} autoFocus />
        </Field>
      </Modal>
    </div>
  );
}
