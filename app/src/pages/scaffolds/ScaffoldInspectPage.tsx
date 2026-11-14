import { clsx } from 'clsx';
import { AlertTriangle, ArrowLeft, Ban, CheckCircle2, MessageSquarePlus, PenLine } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PhotoInput, SignaturePad } from '../../components/forms/FormRenderer';
import { getPosition } from '../../components/scaffolds/shared';
import { Button, Card, ErrorBanner, Field, Input, Select, Spinner, Textarea } from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { api } from '../../lib/api';
import { newId } from '../../lib/id';
import { DUTY_CLASS, INSPECTION_TYPE, addDays, perthToday } from '../../lib/labels';
import { kvDel, kvGet, kvSet } from '../../lib/offline/kv';
import { submitOrQueue } from '../../lib/offline/outbox';
import { checklistItems, failedCount, inspectionProblem } from '../../lib/scaffoldLogic';
import type { InspectionItemAnswer, InspectionOutcome, InspectionType, ItemResult, ScaffoldInspection, ScaffoldInspectionInput } from '../../lib/types';
import { errMsg, useAsync } from '../../lib/useAsync';

interface Draft {
  id: string;
  checklist_id: string;
  inspection_type: InspectionType | '';
  items: Record<string, InspectionItemAnswer>;
  photos: string[];
  outcome: InspectionOutcome | '';
  restriction: string;
  notes: string;
  signature?: string;
}

const RESULT: { v: ItemResult; label: string; on: string }[] = [
  { v: 'pass', label: 'Pass', on: 'border-emerald-600 bg-emerald-600 text-white' },
  { v: 'fail', label: 'Fail', on: 'border-red-600 bg-red-600 text-white' },
  { v: 'na', label: 'N/A', on: 'border-steel-600 bg-steel-600 text-white' },
];

/** Scaffold inspection. Works with no coverage: the draft is kept on the phone and the
 *  signed inspection waits in the outbox until it can be sent. */
export default function ScaffoldInspectPage() {
  const { id } = useParams();
  const { profile } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const draftKey = `draft:scaffold-inspection:${id}`;
  const restored = useRef(false);

  const { data, loading, error } = useAsync(async () => {
    const [scaffolds, people, inspector, saved] = await Promise.all([
      api.listScaffolds(), api.listDirectory(), api.myInspectorStatus(), kvGet<Draft>(draftKey),
    ]);
    const s = scaffolds.find((x) => x.id === id);
    if (!s) throw new Error("This scaffold isn't on your projects (or hasn't been opened on this phone yet).");
    const checklist = await api.getScaffoldChecklist(saved?.checklist_id);
    if (!checklist) throw new Error('No scaffold checklist has been set up.');
    if (saved) restored.current = true;
    setDraft(saved ?? {
      id: newId(), checklist_id: checklist.id, inspection_type: s.last_inspection_id ? 'periodic' : 'handover',
      items: {}, photos: [], outcome: '', restriction: '', notes: '',
    });
    return { s, people, inspector, checklist };
  }, [id]);

  useEffect(() => { if (restored.current && draft) { toast('Picked up your unfinished inspection'); restored.current = false; } }, [draft, toast]);
  // Autosave the draft on the phone (photos included) so nothing is lost if the app closes.
  useEffect(() => {
    if (!draft) return;
    const t = setTimeout(() => { void kvSet(draftKey, draft); }, 400);
    return () => clearTimeout(t);
  }, [draft, draftKey]);

  const items = useMemo(() => (data ? checklistItems(data.checklist.sections) : []), [data]);
  if (loading && !data) return <Spinner />;
  if (error || !data || !draft) return <ErrorBanner message={error ?? 'Not found'} />;
  const { s, checklist, inspector } = data;
  if (!inspector.ok) return <ErrorBanner message={`You can't sign off scaffold inspections. ${inspector.reason ?? ''}`} />;

  const set = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const setItem = (itemId: string, p: Partial<InspectionItemAnswer>) =>
    setDraft((d) => (d ? { ...d, items: { ...d.items, [itemId]: { ...d.items[itemId], ...p } } } : d));
  const answered = items.filter((i) => draft.items[i.id]?.result).length;
  const fails = failedCount(checklist, draft.items);
  const leads = data.people.filter((p) => ['admin', 'hset', 'project_manager', 'supervisor'].includes(p.role) || p.id === profile?.id);

  const submit = async () => {
    const input = {
      id: draft.id, scaffold_id: s.id, inspection_type: draft.inspection_type as InspectionType, checklist_id: checklist.id,
      items: draft.items, photos: draft.photos, outcome: draft.outcome as InspectionOutcome, restriction: draft.restriction.trim() || null,
      notes: draft.notes.trim() || null, signature: draft.signature ?? '', signed_at: '', latitude: null, longitude: null, gps_accuracy_m: null,
    } satisfies ScaffoldInspectionInput;
    const p = !draft.inspection_type ? 'Choose the inspection type' : inspectionProblem(checklist, input);
    setProblem(p);
    if (p) {
      toast(p, 'error');
      const first = items.find((i) => !draft.items[i.id]?.result);
      if (first && p.startsWith('Answer')) document.getElementById(`item-${first.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setBusy('Getting your location…');
    const pos = await getPosition();
    const signed: ScaffoldInspectionInput = {
      ...input, signed_at: new Date().toISOString(),
      latitude: pos ? Math.round(pos.coords.latitude * 1e6) / 1e6 : null, longitude: pos ? Math.round(pos.coords.longitude * 1e6) / 1e6 : null,
      gps_accuracy_m: pos ? Math.round(pos.coords.accuracy) : null,
    };
    setBusy('Sending…');
    try {
      const res = await submitOrQueue<ScaffoldInspection>({ id: draft.id, kind: 'scaffold_inspection', label: `Inspection · ${s.scaffold_number}`,
        payload: signed, link: `/scaffolds/${s.id}`, scaffold_id: s.id });
      await kvDel(draftKey);
      if (res.queued) {
        toast('Saved on this phone. It will send by itself when you have coverage.');
        nav(`/scaffolds/${s.id}`, { replace: true });
      } else {
        toast(`${res.result!.reference} signed off`);
        nav(`/scaffolds/inspections/${res.result!.id}`, { replace: true });
      }
    } catch (e) {
      toast(errMsg(e), 'error');
      setProblem(errMsg(e));
    } finally { setBusy(null); }
  };

  return (
    <div className="mx-auto max-w-2xl pb-8">
      <div className="mb-4 flex items-start gap-3">
        <Link to={`/scaffolds/${s.id}`} aria-label="Back" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white text-steel-600 shadow-card hover:text-steel-900">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-widest text-brand-600">Inspection · checklist v{checklist.version}</p>
          <h1 className="font-display text-3xl font-bold uppercase leading-tight">{s.scaffold_number}</h1>
          <p className="text-sm font-semibold text-steel-700">{s.location} · {DUTY_CLASS[s.duty_class]}{s.max_load_kg ? ` · ${s.max_load_kg} kg/bay` : ''}</p>
          <p className="mt-1 text-xs text-steel-500">Signing as {profile?.full_name} · {inspector.licenceClass} scaffolding licence</p>
        </div>
      </div>

      <div className="sticky top-0 z-10 -mx-4 mb-4 bg-steel-100/95 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-xl">
        <div className="flex items-center justify-between text-sm font-bold">
          <span>{answered} of {items.length} answered</span>
          {fails > 0 && <span className="text-red-700">{fails} failed</span>}
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-steel-200"><div className="h-full bg-brand-500 transition-all" style={{ width: `${(answered / items.length) * 100}%` }} /></div>
      </div>

      <Card title="Inspection type" className="mb-4">
        <div className="grid gap-2">
          {Object.entries(INSPECTION_TYPE).map(([k, label]) => (
            <button key={k} type="button" aria-pressed={draft.inspection_type === k} onClick={() => set({ inspection_type: k as InspectionType })}
              className={clsx('min-h-[52px] rounded-lg border-2 px-4 text-left font-bold', draft.inspection_type === k ? 'border-brand-600 bg-brand-600 text-white' : 'border-steel-200 bg-white text-steel-700')}>
              {label}
            </button>
          ))}
        </div>
      </Card>

      {checklist.sections.map((sec) => (
        <Card key={sec.id} title={sec.title} className="mb-4" padded={false}>
          <ul className="divide-y divide-steel-100">
            {sec.items.map((it) => {
              const a = draft.items[it.id] ?? {};
              const showExtra = a.result === 'fail' || open[it.id] || !!a.comment || !!a.photos?.length;
              return (
                <li key={it.id} id={`item-${it.id}`} className={clsx('scroll-mt-24 space-y-3 px-4 py-4', a.result === 'fail' && 'bg-red-50')}>
                  <p className="font-semibold text-steel-900">{it.label}</p>
                  <div className="grid grid-cols-3 gap-2">
                    {RESULT.map((r) => (
                      <button key={r.v} type="button" aria-pressed={a.result === r.v} aria-label={`${r.label}: ${it.label}`}
                        onClick={() => setItem(it.id, { result: r.v })}
                        className={clsx('min-h-[56px] rounded-lg border-2 text-base font-bold uppercase tracking-wide', a.result === r.v ? r.on : 'border-steel-200 bg-white text-steel-600')}>
                        {r.label}
                      </button>
                    ))}
                  </div>
                  {showExtra ? (
                    <div className="space-y-3">
                      <Field label={a.result === 'fail' ? "What's wrong" : 'Comment'}>
                        <Textarea className="min-h-[64px]" value={a.comment ?? ''} onChange={(e) => setItem(it.id, { comment: e.target.value })}
                          placeholder={a.result === 'fail' ? 'e.g. Toeboard missing on lift 6, bay 2' : ''} />
                      </Field>
                      <div><span className="label">Photos</span><PhotoInput value={a.photos ?? []} onChange={(photos) => setItem(it.id, { photos })} /></div>
                      {a.result === 'fail' && (
                        <div className="grid gap-3 rounded-lg border-2 border-red-200 bg-white p-3 sm:grid-cols-2">
                          <p className="text-sm font-bold text-red-800 sm:col-span-2">Defect: who fixes it, and by when</p>
                          <Field label="Owner">
                            <Select value={a.defect_owner_id ?? ''} onChange={(e) => setItem(it.id, { defect_owner_id: e.target.value || undefined })}>
                              <option value="">Me ({profile?.full_name})</option>
                              {leads.filter((p) => p.id !== profile?.id).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                            </Select>
                          </Field>
                          <Field label="Fix by">
                            <Input type="date" min={perthToday()} value={a.defect_due ?? addDays(perthToday(), 7)} onChange={(e) => setItem(it.id, { defect_due: e.target.value || undefined })} />
                          </Field>
                        </div>
                      )}
                    </div>
                  ) : (
                    <button type="button" className="flex min-h-[44px] items-center gap-1.5 text-sm font-semibold text-brand-700" onClick={() => setOpen({ ...open, [it.id]: true })}>
                      <MessageSquarePlus className="h-4 w-4" />Add comment or photo
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      ))}

      <Card title="General photos of the scaffold" className="mb-4">
        <PhotoInput value={draft.photos} onChange={(photos) => set({ photos })} />
      </Card>

      <Card title="Outcome" className="mb-4">
        <div className="grid gap-2">
          {([
            { v: 'safe', label: 'Safe for Use', icon: CheckCircle2, on: 'border-emerald-600 bg-emerald-600 text-white', disabled: fails > 0 },
            { v: 'restricted', label: 'Restricted Use', icon: AlertTriangle, on: 'border-amber-400 bg-amber-400 text-steel-900', disabled: false },
            { v: 'unsafe', label: 'Unsafe – Do Not Use', icon: Ban, on: 'border-red-600 bg-red-600 text-white', disabled: false },
          ] as const).map((o) => (
            <button key={o.v} type="button" disabled={o.disabled} aria-pressed={draft.outcome === o.v} onClick={() => set({ outcome: o.v })}
              className={clsx('flex min-h-[60px] items-center gap-3 rounded-lg border-2 px-4 text-left text-lg font-bold uppercase',
                draft.outcome === o.v ? o.on : 'border-steel-200 bg-white text-steel-700', o.disabled && 'cursor-not-allowed opacity-40')}>
              <o.icon className="h-6 w-6" />{o.label}
            </button>
          ))}
          {fails > 0 && <p className="text-sm font-semibold text-red-700">Safe for Use isn't available while {fails} item{fails === 1 ? ' has' : 's have'} failed.</p>}
        </div>
        {draft.outcome === 'restricted' && (
          <div className="mt-3">
            <Field label="Restriction" required hint="Shown on the scaffold's page and printed tag.">
              <Textarea value={draft.restriction} onChange={(e) => set({ restriction: e.target.value })} placeholder="e.g. Light duty only, max 2 persons" />
            </Field>
          </div>
        )}
        <div className="mt-3"><Field label="Notes"><Textarea className="min-h-[64px]" value={draft.notes} onChange={(e) => set({ notes: e.target.value })} /></Field></div>
      </Card>

      <Card title="Inspector signature" className="mb-4">
        <SignaturePad value={draft.signature} onChange={(signature) => set({ signature })} />
        <p className="mt-2 text-xs text-steel-500">The date, time and your GPS location are recorded when you sign off.</p>
      </Card>

      {problem && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">{problem}</p>}
      <Button size="lg" block icon={<PenLine className="h-6 w-6" />} loading={!!busy} onClick={submit}>{busy ?? 'Sign off inspection'}</Button>
    </div>
  );
}
