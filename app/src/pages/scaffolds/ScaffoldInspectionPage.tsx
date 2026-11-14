import { clsx } from 'clsx';
import { ArrowLeft, MapPin } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { StoredImage } from '../../components/forms/AnswerView';
import { Badge, Card, ErrorBanner, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { INSPECTION_TYPE, SCAFFOLD_STATUS, formatDate, formatDateTime } from '../../lib/labels';
import type { ScaffoldChecklist, ScaffoldDefect, ScaffoldInspection } from '../../lib/types';
import { useAsync } from '../../lib/useAsync';

const RESULT_BADGE = { pass: { label: 'Pass', color: 'green' }, fail: { label: 'Fail', color: 'red' }, na: { label: 'N/A', color: 'slate' } } as const;

/** Every checklist item with its result, comment and photos. Reused by the public QR page (Stage 4). */
export function InspectionReport({ ins, checklist, defects = [] }: { ins: ScaffoldInspection; checklist: ScaffoldChecklist; defects?: ScaffoldDefect[] }) {
  return (
    <div className="space-y-4">
      {checklist.sections.map((sec) => (
        <Card key={sec.id} title={sec.title} padded={false}>
          <ul className="divide-y divide-steel-100">
            {sec.items.map((it) => {
              const a = ins.items[it.id] ?? {};
              const r = a.result ? RESULT_BADGE[a.result] : null;
              const d = defects.find((x) => x.item_id === it.id);
              return (
                <li key={it.id} className={clsx('space-y-2 px-4 py-3', a.result === 'fail' && 'bg-red-50')}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-semibold text-steel-900">{it.label}</p>
                    {r ? <Badge color={r.color}>{r.label}</Badge> : <span className="text-xs italic text-steel-400">Not answered</span>}
                  </div>
                  {a.comment && <p className="text-sm text-steel-700">{a.comment}</p>}
                  {!!a.photos?.length && <div className="flex flex-wrap gap-2">{a.photos.map((p, i) => <StoredImage key={i} value={p} alt={`${it.label} photo ${i + 1}`} className="h-24 w-24" />)}</div>}
                  {d && <p className="text-xs font-semibold text-steel-600">Defect {d.reference}: {d.status === 'closed' ? `closed ${formatDate(d.closed_at)}` : `open, due ${formatDate(d.due_date)}`}</p>}
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
      {ins.photos.length > 0 && (
        <Card title="General photos"><div className="flex flex-wrap gap-2">{ins.photos.map((p, i) => <StoredImage key={i} value={p} alt={`Photo ${i + 1}`} className="h-28 w-28" />)}</div></Card>
      )}
    </div>
  );
}

export default function ScaffoldInspectionPage() {
  const { id } = useParams();
  const { data, loading, error } = useAsync(async () => {
    const ins = await api.getScaffoldInspection(id!);
    if (!ins) throw new Error("This inspection doesn't exist or you don't have access to it.");
    const [checklist, scaffolds, defects] = await Promise.all([
      api.getScaffoldChecklist(ins.checklist_id), api.listScaffolds(), api.listScaffoldDefects(ins.scaffold_id),
    ]);
    if (!checklist) throw new Error('Checklist not found');
    return { ins, checklist, s: scaffolds.find((x) => x.id === ins.scaffold_id), defects: defects.filter((d) => d.inspection_id === ins.id) };
  }, [id]);

  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorBanner message={error ?? 'Not found'} />;
  const { ins, checklist, s } = data;
  const st = SCAFFOLD_STATUS[ins.outcome]!;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-start gap-3">
        <Link to={`/scaffolds/${ins.scaffold_id}`} aria-label="Back" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white text-steel-600 shadow-card hover:text-steel-900">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-widest text-brand-600">{s?.scaffold_number} · <span className="font-mono">{ins.reference}</span></p>
          <h1 className="text-3xl font-bold uppercase leading-tight">{INSPECTION_TYPE[ins.inspection_type]}</h1>
          {s && <p className="font-semibold text-steel-700">{s.location}</p>}
        </div>
      </div>

      <div className={clsx('mb-4 rounded-xl px-4 py-4', st.banner)}>
        <p className="font-display text-2xl font-bold uppercase">Result: {st.label}</p>
        {ins.restriction && <p className="font-semibold">{ins.restriction}</p>}
      </div>

      <Card className="mb-4">
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div><dt className="text-xs font-bold uppercase text-steel-500">Inspector</dt><dd className="font-semibold">{ins.inspector_name}{ins.inspector_licence_class ? ` · ${ins.inspector_licence_class} licence` : ''}</dd></div>
          <div><dt className="text-xs font-bold uppercase text-steel-500">Signed</dt><dd className="font-semibold">{formatDateTime(ins.signed_at)}</dd></div>
          <div><dt className="text-xs font-bold uppercase text-steel-500">Next inspection due</dt><dd className="font-semibold">{ins.next_due ? formatDate(ins.next_due) : 'Before next use'}</dd></div>
          <div><dt className="text-xs font-bold uppercase text-steel-500">Items</dt><dd className="font-semibold">{ins.failed_count ? `${ins.failed_count} failed` : 'All passed or N/A'}</dd></div>
          {ins.latitude != null && (
            <div><dt className="text-xs font-bold uppercase text-steel-500">Signed at</dt><dd>
              <a className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${ins.latitude},${ins.longitude}`}>
                <MapPin className="h-4 w-4" />{ins.latitude}, {ins.longitude}{ins.gps_accuracy_m ? ` (±${ins.gps_accuracy_m} m)` : ''}</a>
            </dd></div>
          )}
          <div><dt className="text-xs font-bold uppercase text-steel-500">Checklist</dt><dd className="font-semibold">Version {checklist.version}</dd></div>
        </dl>
        {ins.notes && <p className="mt-3 whitespace-pre-wrap text-sm text-steel-700">{ins.notes}</p>}
        <div className="mt-3">
          <p className="text-xs font-bold uppercase text-steel-500">Signature</p>
          <StoredImage value={ins.signature} alt="Inspector signature" className="mt-1 h-24 w-full max-w-xs bg-white object-contain" />
        </div>
      </Card>

      <InspectionReport ins={ins} checklist={checklist} defects={data.defects} />
    </div>
  );
}
