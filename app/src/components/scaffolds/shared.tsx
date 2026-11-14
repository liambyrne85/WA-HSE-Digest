import { clsx } from 'clsx';
import { AlertTriangle, Ban, CheckCircle2, Clock, Crosshair, Hammer, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '../../contexts/ToastContext';
import { api } from '../../lib/api';
import { DUTY_CLASS, SCAFFOLD_STATUS, SCAFFOLD_TYPE, formatDate, perthToday } from '../../lib/labels';
import { liveStatus, type LiveStatus } from '../../lib/scaffoldLogic';
import type { DirectoryEntry, DutyClass, Project, Scaffold, ScaffoldDefect, ScaffoldType } from '../../lib/types';
import { errMsg } from '../../lib/useAsync';
import { PhotoInput } from '../forms/FormRenderer';
import { Badge, Button, Field, Input, Modal, Select, Textarea } from '../ui';

const ICON: Record<LiveStatus, typeof CheckCircle2> = {
  safe: CheckCircle2, restricted: AlertTriangle, unsafe: Ban, overdue: Clock, awaiting: Hammer, dismantled: ShieldAlert,
};

/** Big status banner — the overdue / awaiting-handover state overrides the last result. */
export function StatusBanner({ s, compact }: { s: Scaffold; compact?: boolean }) {
  const live = liveStatus(s);
  const st = SCAFFOLD_STATUS[live]!;
  const Icon = ICON[live];
  return (
    <div className={clsx('flex items-center gap-3 rounded-xl', st.banner, compact ? 'px-3 py-2' : 'px-4 py-4')}>
      <Icon className={compact ? 'h-6 w-6 shrink-0' : 'h-9 w-9 shrink-0'} />
      <div className="min-w-0">
        <p className={clsx('font-display font-bold uppercase leading-tight', compact ? 'text-lg' : 'text-2xl sm:text-3xl')}>{st.label}</p>
        {!compact && live === 'restricted' && s.restriction && <p className="mt-0.5 text-base font-semibold">{s.restriction}</p>}
        {!compact && live === 'overdue' && <p className="mt-0.5 text-sm font-semibold">Inspection was due {formatDate(s.next_inspection_due)}. Last result: {SCAFFOLD_STATUS[s.status]!.label}.</p>}
        {!compact && live === 'unsafe' && s.status_reason && <p className="mt-0.5 text-sm font-semibold">{s.status_reason}</p>}
        {!compact && live === 'dismantled' && s.dismantled_on && <p className="mt-0.5 text-sm font-semibold">Dismantled {formatDate(s.dismantled_on)}</p>}
      </div>
    </div>
  );
}

export function StatusPill({ s }: { s: Scaffold }) {
  const live = liveStatus(s);
  return <Badge color={SCAFFOLD_STATUS[live]!.color}>{SCAFFOLD_STATUS[live]!.short}</Badge>;
}

export function dueText(s: Scaffold) {
  if (s.status === 'dismantled') return `Dismantled ${formatDate(s.dismantled_on)}`;
  if (!s.next_inspection_due) return s.last_inspection_id ? 'Needs inspection before use' : 'Awaiting handover inspection';
  const today = perthToday();
  if (s.next_inspection_due < today) return `Inspection overdue since ${formatDate(s.next_inspection_due)}`;
  if (s.next_inspection_due === today) return 'Inspection due today';
  return `Next inspection ${formatDate(s.next_inspection_due)}`;
}

export const typeLabel = (s: Pick<Scaffold, 'scaffold_type' | 'scaffold_type_other'>) =>
  s.scaffold_type === 'other' && s.scaffold_type_other ? s.scaffold_type_other : SCAFFOLD_TYPE[s.scaffold_type];

export function getPosition(): Promise<GeolocationPosition | null> {
  return new Promise((res) => {
    if (!('geolocation' in navigator)) { res(null); return; }
    navigator.geolocation.getCurrentPosition(res, () => res(null), { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  });
}

/** Register or edit a scaffold. */
export function ScaffoldFormModal({ initial, projects, people, onClose, onSaved }: {
  initial: Partial<Scaffold>; projects: Project[]; people: DirectoryEntry[]; onClose: () => void; onSaved: (s: Scaffold) => void;
}) {
  const toast = useToast();
  const [f, setF] = useState<Partial<Scaffold>>(initial);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const set = (p: Partial<Scaffold>) => setF((x) => ({ ...x, ...p }));
  const num = (v: string) => (v === '' ? null : Number(v));
  const save = async () => {
    if (!f.project_id) { toast('Choose the project', 'error'); return; }
    if (!f.location?.trim()) { toast('Describe the location or area', 'error'); return; }
    setBusy(true);
    try {
      const { status: _s, status_reason: _r, restriction: _x, ...row } = f;
      const saved = await api.saveScaffold({ ...row, location: f.location.trim() });
      toast(f.id ? 'Scaffold updated' : `${saved.scaffold_number} registered`);
      onSaved(saved);
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal open drawer onClose={onClose} title={f.id ? `Edit ${initial.scaffold_number}` : 'Register scaffold'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button size="lg" loading={busy} onClick={save}>{f.id ? 'Save' : 'Register'}</Button></>}>
      <div className="space-y-4">
        <Field label="Project" required>
          <Select value={f.project_id ?? ''} disabled={!!f.id} onChange={(e) => set({ project_id: e.target.value })}>
            <option value="">Select project…</option>
            {projects.filter((p) => p.is_active).map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code} – ` : ''}{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Location or area" required>
          <Textarea className="min-h-[64px]" value={f.location ?? ''} onChange={(e) => set({ location: e.target.value })} placeholder="e.g. Berth 3 conveyor, bays 12–16" />
        </Field>
        <div>
          <span className="label">GPS location (optional)</span>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" icon={<Crosshair className="h-5 w-5" />} loading={locating} onClick={async () => {
              setLocating(true);
              const pos = await getPosition();
              setLocating(false);
              if (!pos) { toast("Couldn't get your location", 'error'); return; }
              set({ latitude: Math.round(pos.coords.latitude * 1e6) / 1e6, longitude: Math.round(pos.coords.longitude * 1e6) / 1e6 });
            }}>Use my location</Button>
            {f.latitude != null && <span className="text-sm font-semibold tabular-nums text-steel-700">{f.latitude}, {f.longitude}</span>}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Scaffold type" required>
            <Select value={f.scaffold_type ?? ''} onChange={(e) => set({ scaffold_type: e.target.value as ScaffoldType })}>
              <option value="">Select…</option>
              {Object.entries(SCAFFOLD_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          {f.scaffold_type === 'other' && <Field label="Describe the type"><Input value={f.scaffold_type_other ?? ''} onChange={(e) => set({ scaffold_type_other: e.target.value })} /></Field>}
          <Field label="Duty class" required>
            <Select value={f.duty_class ?? ''} onChange={(e) => set({ duty_class: e.target.value as DutyClass })}>
              <option value="">Select…</option>
              {Object.entries(DUTY_CLASS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Max load per bay (kg)"><Input type="number" inputMode="decimal" min={0} value={f.max_load_kg ?? ''} onChange={(e) => set({ max_load_kg: num(e.target.value) })} /></Field>
          <Field label="Height (m)"><Input type="number" inputMode="decimal" min={0} value={f.height_m ?? ''} onChange={(e) => set({ height_m: num(e.target.value) })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Lifts"><Input type="number" inputMode="numeric" min={0} value={f.lifts ?? ''} onChange={(e) => set({ lifts: num(e.target.value) })} /></Field>
            <Field label="Bays"><Input type="number" inputMode="numeric" min={0} value={f.bays ?? ''} onChange={(e) => set({ bays: num(e.target.value) })} /></Field>
          </div>
          <Field label="Erected by">
            <Select value={f.erected_by_id ?? ''} onChange={(e) => set({ erected_by_id: e.target.value || null })}>
              <option value="">Not listed / crew</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </Select>
          </Field>
          {!f.erected_by_id && <Field label="Erected by (crew or company)"><Input value={f.erected_by_name ?? ''} onChange={(e) => set({ erected_by_name: e.target.value })} /></Field>}
          <Field label="Date erected"><Input type="date" max={perthToday()} value={f.erected_on ?? ''} onChange={(e) => set({ erected_on: e.target.value || null })} /></Field>
        </div>
        <div><span className="label">Photos</span><PhotoInput value={f.photos ?? []} onChange={(photos) => set({ photos })} /></div>
        <Field label="Notes"><Textarea className="min-h-[64px]" value={f.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} /></Field>
        {!f.id && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">New scaffolds show <b>Unsafe – Do Not Use</b> until a competent inspector signs off the handover inspection.</p>}
      </div>
    </Modal>
  );
}

/** Close a defect: a photo of the fix is required. */
export function CloseDefectModal({ d, onClose, onSaved }: { d: ScaffoldDefect; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [photos, setPhotos] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title={`Close ${d.reference}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="lg" loading={busy} disabled={!photos.length} onClick={async () => {
          setBusy(true);
          try {
            await api.saveScaffoldDefect({ id: d.id, status: 'closed', close_photos: photos, close_comment: comment.trim() || null });
            toast(`${d.reference} closed`);
            onSaved();
          } catch (e) { toast(errMsg(e), 'error'); setBusy(false); }
        }}>Close defect</Button></>}>
      <p className="mb-3 font-semibold">{d.item_label}</p>
      {d.description && <p className="mb-3 text-sm text-steel-600">{d.description}</p>}
      <div className="mb-4"><span className="label">Photo of the fix <span className="text-red-600">*</span></span><PhotoInput value={photos} onChange={setPhotos} required /></div>
      <Field label="What was done"><Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="e.g. Toeboards fitted to lift 6, bay 2" /></Field>
    </Modal>
  );
}
