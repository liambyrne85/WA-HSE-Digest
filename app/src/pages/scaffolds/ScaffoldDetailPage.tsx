import { clsx } from 'clsx';
import { ArrowLeft, ArrowRight, Ban, ClipboardCheck, CloudUpload, History, MapPin, Pencil, PackageX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { StoredImage } from '../../components/forms/AnswerView';
import { CloseDefectModal, ScaffoldFormModal, StatusBanner, dueText, typeLabel } from '../../components/scaffolds/shared';
import { Badge, Button, Card, ErrorBanner, Field, Modal, Spinner, Textarea } from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useToast } from '../../contexts/ToastContext';
import { api } from '../../lib/api';
import { DUTY_CLASS, INSPECTION_TYPE, SCAFFOLD_STATUS, daysUntil, formatDate, formatDateTime } from '../../lib/labels';
import { useOutbox } from '../../lib/offline/outbox';
import type { AuditEntry, ScaffoldDefect } from '../../lib/types';
import { errMsg, useAsync } from '../../lib/useAsync';

const FIELD: Record<string, string> = {
  status: 'Status', restriction: 'Restriction', status_reason: 'Reason', location: 'Location', duty_class: 'Duty class', max_load_kg: 'Max load',
  scaffold_type: 'Type', height_m: 'Height', lifts: 'Lifts', bays: 'Bays', next_inspection_due: 'Next inspection', dismantled_on: 'Dismantled',
  erected_on: 'Erected', notes: 'Notes', latitude: 'GPS',
};

export default function ScaffoldDetailPage() {
  const { id } = useParams();
  const { profile, isLeader, isProjectLead } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const outbox = useOutbox();
  const [editing, setEditing] = useState(false);
  const [tagging, setTagging] = useState(false);
  const [reason, setReason] = useState('');
  const [closing, setClosing] = useState<ScaffoldDefect | null>(null);

  const { data, loading, error, reload } = useAsync(async () => {
    const scaffolds = await api.listScaffolds();
    const s = scaffolds.find((x) => x.id === id);
    if (!s) throw new Error("This scaffold doesn't exist or isn't on your projects.");
    const [inspections, defects, projects, people, inspector, audit] = await Promise.all([
      api.listScaffoldInspections(s.id), api.listScaffoldDefects(s.id), api.listProjects(), api.listDirectory(),
      api.myInspectorStatus().catch(() => ({ ok: false, licenceClass: null, reason: 'Could not check your licence' })),
      api.listAudit('scaffolds', s.id).catch(() => [] as AuditEntry[]),
    ]);
    return { s, inspections, defects, projects, people, inspector, audit };
  }, [id]);
  useEffect(() => api.subscribeChanges(() => { void reload(); }), [reload]);

  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorBanner message={error ?? 'Not found'} />;
  const { s, inspections, defects, inspector } = data;
  const project = data.projects.find((p) => p.id === s.project_id);
  const person = (pid: string | null) => data.people.find((p) => p.id === pid)?.full_name ?? (pid ? 'Team member' : '—');
  const canManage = isLeader || isProjectLead;
  const waiting = outbox.items.filter((i) => i.scaffold_id === s.id);
  const openDefects = defects.filter((d) => d.status === 'open');
  const show = (k: string, v: unknown) => v === null || v === undefined || v === '' ? '—'
    : k === 'status' ? SCAFFOLD_STATUS[String(v)]?.label ?? String(v) : k === 'duty_class' ? DUTY_CLASS[String(v)] ?? String(v)
    : k.endsWith('_due') || k.endsWith('_on') ? formatDate(String(v)) : String(v);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex items-start gap-3">
        <Link to="/scaffolds" aria-label="Back" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white text-steel-600 shadow-card hover:text-steel-900">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-widest text-brand-600">{project ? `${project.code ? `${project.code} · ` : ''}${project.name}` : 'Scaffold'}</p>
          <h1 className="font-display text-4xl font-bold uppercase leading-tight">{s.scaffold_number}</h1>
          <p className="font-semibold text-steel-700">{s.location}</p>
        </div>
      </div>

      <StatusBanner s={s} />
      <p className="mt-2 text-sm font-semibold text-steel-600">{dueText(s)}</p>

      {waiting.length > 0 && (
        <p className="mt-3 flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-900">
          <CloudUpload className="h-5 w-5 shrink-0" />
          {waiting.length} inspection{waiting.length === 1 ? '' : 's'} saved on this phone, waiting for coverage to sync. The status above updates once it's sent.
        </p>
      )}

      {/* Actions */}
      <div className="mt-4 grid gap-2 sm:flex sm:flex-wrap">
        {inspector.ok ? (
          <Link to={`/scaffolds/${s.id}/inspect`} className="sm:w-auto">
            <Button size="lg" block icon={<ClipboardCheck className="h-6 w-6" />}>Inspect scaffold</Button>
          </Link>
        ) : s.status !== 'dismantled' && (
          <p className="rounded-lg bg-steel-100 px-3 py-2 text-sm text-steel-700"><b>You can't sign off inspections:</b> {inspector.reason}</p>
        )}
        {canManage && <Button size="lg" variant="secondary" icon={<Pencil className="h-5 w-5" />} onClick={() => setEditing(true)}>Edit details</Button>}
        {canManage && s.status !== 'unsafe' && s.status !== 'dismantled' && (
          <Button size="lg" variant="danger" icon={<Ban className="h-5 w-5" />} onClick={() => { setReason(''); setTagging(true); }}>Tag Unsafe</Button>
        )}
        {canManage && s.status !== 'dismantled' && (
          <Button size="lg" variant="secondary" icon={<PackageX className="h-5 w-5" />} onClick={async () => {
            if (!(await confirm({ title: 'Mark dismantled', message: `Mark ${s.scaffold_number} as dismantled? It shows "Dismantled – Not in Service" and leaves the active register. Its inspections are kept.`, confirmLabel: 'Mark dismantled', danger: true }))) return;
            try { await api.saveScaffold({ id: s.id, status: 'dismantled' }); toast(`${s.scaffold_number} marked dismantled`); void reload(); } catch (e) { toast(errMsg(e), 'error'); }
          }}>Mark dismantled</Button>
        )}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          {openDefects.length > 0 && (
            <Card title={`Open defects (${openDefects.length})`} padded={false}>
              <ul className="divide-y divide-steel-100">
                {openDefects.map((d) => {
                  const left = daysUntil(d.due_date);
                  const overdue = left !== null && left < 0;
                  return (
                    <li key={d.id} className={clsx('space-y-2 px-4 py-3', overdue && 'bg-red-50')}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-bold"><span className="mr-2 font-mono text-sm text-brand-700">{d.reference}</span>{d.item_label}</p>
                          <p className="text-xs text-steel-500">{d.section_title} · Owner {person(d.owner_id)} · due {formatDate(d.due_date)}</p>
                        </div>
                        {overdue ? <Badge color="red">{-left!}d overdue</Badge> : <Badge color="orange">Open</Badge>}
                      </div>
                      {d.description && <p className="text-sm text-steel-700">{d.description}</p>}
                      {d.photos.length > 0 && <div className="flex flex-wrap gap-2">{d.photos.map((p, i) => <StoredImage key={i} value={p} alt="Defect photo" className="h-20 w-20" />)}</div>}
                      {(isLeader || isProjectLead || d.owner_id === profile?.id) && <Button size="sm" variant="secondary" onClick={() => setClosing(d)}>Close with photo</Button>}
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          <Card title="Inspections" padded={false}>
            <ul className="divide-y divide-steel-100">
              {inspections.map((i) => (
                <li key={i.id}>
                  <Link to={`/scaffolds/inspections/${i.id}`} className="flex min-h-[64px] items-center gap-3 px-4 py-3 hover:bg-steel-50">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold"><span className="mr-2 font-mono text-sm text-brand-700">{i.reference}</span>{INSPECTION_TYPE[i.inspection_type]}</p>
                      <p className="truncate text-xs text-steel-500">{formatDateTime(i.signed_at)} · {i.inspector_name}{i.inspector_licence_class ? ` (${i.inspector_licence_class})` : ''}{i.failed_count ? ` · ${i.failed_count} failed` : ''}</p>
                    </div>
                    <Badge color={SCAFFOLD_STATUS[i.outcome]!.color}>{SCAFFOLD_STATUS[i.outcome]!.short}</Badge>
                    <ArrowRight className="h-4 w-4 text-steel-400" />
                  </Link>
                </li>
              ))}
              {!inspections.length && <li className="px-4 py-6 text-sm text-steel-500">No inspections yet. It stays Unsafe until the handover inspection is signed off.</li>}
            </ul>
          </Card>

          {s.photos.length > 0 && (
            <Card title="Photos"><div className="flex flex-wrap gap-2">{s.photos.map((p, i) => <StoredImage key={i} value={p} alt={`Scaffold photo ${i + 1}`} className="h-28 w-28" />)}</div></Card>
          )}
        </div>

        <aside className="space-y-5">
          <Card title="Details">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <Item k="Type" v={typeLabel(s)} />
              <Item k="Duty class" v={DUTY_CLASS[s.duty_class]} />
              <Item k="Max load per bay" v={s.max_load_kg != null ? `${s.max_load_kg} kg` : null} />
              <Item k="Height" v={s.height_m != null ? `${s.height_m} m` : null} />
              <Item k="Lifts" v={s.lifts?.toString()} />
              <Item k="Bays" v={s.bays?.toString()} />
              <Item k="Erected by" v={s.erected_by_id ? person(s.erected_by_id) : s.erected_by_name} />
              <Item k="Date erected" v={s.erected_on ? formatDate(s.erected_on) : null} />
              <Item k="Last inspected" v={s.last_inspected_at ? formatDateTime(s.last_inspected_at) : null} />
              <Item k="Inspection interval" v={`${project?.scaffold_inspection_days ?? 30} days`} />
            </dl>
            {s.latitude != null && (
              <a className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 font-semibold text-brand-700 hover:underline" target="_blank" rel="noreferrer"
                href={`https://www.google.com/maps?q=${s.latitude},${s.longitude}`}><MapPin className="h-4 w-4" />Open in maps</a>
            )}
            {s.notes && <p className="mt-3 whitespace-pre-wrap text-sm text-steel-700">{s.notes}</p>}
          </Card>
          <Card title="History" padded={false}>
            <ol className="max-h-80 divide-y divide-steel-100 overflow-y-auto">
              {[...data.audit].sort((a, b) => b.changed_at.localeCompare(a.changed_at)).map((a) => (
                <li key={a.id} className="flex gap-2.5 px-4 py-2.5 text-sm">
                  <History className="mt-0.5 h-4 w-4 shrink-0 text-steel-400" />
                  <div className="min-w-0">
                    <p className="text-steel-800">{a.changed_by ? <b>{person(a.changed_by)}: </b> : null}
                      {a.action === 'insert' ? 'Registered' : Object.keys(a.new_data ?? {}).filter((k) => FIELD[k]).map((k) => `${FIELD[k]} ${show(k, a.old_data?.[k])} → ${show(k, a.new_data?.[k])}`).join('; ') || 'Updated'}</p>
                    <p className="text-xs text-steel-400">{formatDateTime(a.changed_at)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </aside>
      </div>

      {editing && <ScaffoldFormModal initial={s} projects={data.projects} people={data.people} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void reload(); }} />}
      {closing && <CloseDefectModal d={closing} onClose={() => setClosing(null)} onSaved={() => { setClosing(null); void reload(); }} />}
      <Modal open={tagging} onClose={() => setTagging(false)} title={`Tag ${s.scaffold_number} Unsafe`}
        footer={<><Button variant="secondary" onClick={() => setTagging(false)}>Cancel</Button>
          <Button variant="danger" size="lg" disabled={!reason.trim()} onClick={async () => {
            try { await api.saveScaffold({ id: s.id, status: 'unsafe', status_reason: reason.trim() }); toast(`${s.scaffold_number} tagged Unsafe`); setTagging(false); void reload(); }
            catch (e) { toast(errMsg(e), 'error'); }
          }}>Tag Unsafe – Do Not Use</Button></>}>
        <Field label="Reason" required hint="Shown on the scaffold's page and tag. It stays Unsafe until a competent inspector signs off a new inspection.">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Struck by forklift, ledger bent at bay 3" autoFocus />
        </Field>
      </Modal>
    </div>
  );
}

const Item = ({ k, v }: { k: string; v: string | null | undefined }) => (
  <div><dt className="text-xs font-bold uppercase tracking-wider text-steel-500">{k}</dt><dd className="font-semibold text-steel-900">{v || '—'}</dd></div>
);
