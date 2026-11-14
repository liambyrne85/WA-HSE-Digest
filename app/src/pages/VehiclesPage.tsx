import { clsx } from 'clsx';
import { AlertTriangle, Archive, CheckCircle2, ClipboardCheck, Pencil, Plus, Search, Truck, Wrench } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Badge, Button, Checkbox, EmptyState, ErrorBanner, Field, Input, Modal, PageHeader, Select, Spinner, Textarea,
} from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { useToast } from '../contexts/ToastContext';
import { api } from '../lib/api';
import { addDays, formatDate, perthToday } from '../lib/labels';
import type { Vehicle } from '../lib/types';
import { errMsg, useAsync } from '../lib/useAsync';

/** Vehicle & plant register: who can see it follows the vehicle's project (enforced in the database). */
export default function VehiclesPage() {
  const { isLeader, isProjectLead } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [projectId, setProjectId] = useState('');
  const [status, setStatus] = useState<'' | 'in_service' | 'out_of_service' | 'missing'>('');
  const [editing, setEditing] = useState<Partial<Vehicle> | null>(null);
  const [tagging, setTagging] = useState<Vehicle | null>(null);

  const { data, loading, error, reload } = useAsync(async () => {
    const [vehicles, projects, people, prestarts, templates, types] = await Promise.all([
      api.listVehicles(), api.listProjects(), api.listDirectory(),
      api.listRecords('plant_prestart', { from: addDays(perthToday(), -30) }),
      api.listTemplates(), api.listLookupValues('vehicle_types').catch(() => []),
    ]);
    const tpl = templates.find((t) => t.status === 'published' && t.category === 'plant_prestart' && t.current_version_id && t.draft_schema?.settings?.requireVehicle)
      ?? templates.find((t) => t.status === 'published' && t.category === 'plant_prestart' && t.current_version_id);
    return { vehicles, projects, people, prestarts: prestarts.filter((r) => r.status !== 'draft'), templateId: tpl?.id ?? null, types: types.filter((t) => t.is_active) };
  }, []);
  useEffect(() => api.subscribeChanges(() => { void reload(); }), [reload]);

  const focus = params.get('focus');
  const focused = data?.vehicles.find((v) => v.id === focus) ?? null;
  const today = perthToday();
  const lastPrestart = (id: string) => data?.prestarts.filter((r) => r.vehicle_id === id).sort((a, b) => (b.record_date ?? '').localeCompare(a.record_date ?? ''))[0];
  const canManage = (v: Partial<Vehicle>) => isLeader || (isProjectLead && !!v.project_id && !!data?.projects.some((p) => p.id === v.project_id));
  const projName = (id: string | null) => { const p = data?.projects.find((x) => x.id === id); return p ? p.code || p.name : 'No project'; };
  const personName = (id: string | null) => data?.people.find((p) => p.id === id)?.full_name;

  const list = useMemo(() => (data?.vehicles ?? []).filter((v) => {
    if (projectId && v.project_id !== projectId) return false;
    if (status === 'missing') return v.is_active && v.daily_prestart_required && v.status === 'in_service' && lastPrestart(v.id)?.record_date !== today;
    if (status && v.status !== status) return false;
    const s = q.trim().toLowerCase();
    return !s || [v.fleet_number, v.rego, v.vehicle_type, personName(v.operator_id)].some((x) => x?.toLowerCase().includes(s));
  }), [data, q, projectId, status]); // eslint-disable-line react-hooks/exhaustive-deps

  const setOut = async (v: Vehicle, out: boolean, reason?: string) => {
    try {
      await api.saveVehicle({ id: v.id, status: out ? 'out_of_service' : 'in_service', out_of_service_reason: out ? reason ?? null : null,
        out_of_service_at: out ? new Date().toISOString() : null, ...(out ? {} : { out_of_service_record_id: null }) });
      toast(out ? `${v.fleet_number} tagged out of service` : `${v.fleet_number} returned to service`);
      setTagging(null);
      void reload();
    } catch (e) { toast(errMsg(e), 'error'); }
  };

  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorBanner message={error ?? 'Could not load vehicles'} onRetry={reload} />;
  const outCount = data.vehicles.filter((v) => v.status === 'out_of_service').length;

  return (
    <div>
      <PageHeader eyebrow="Fleet" title="Vehicles & Plant"
        subtitle={`${data.vehicles.length} in the register${outCount ? ` · ${outCount} out of service` : ''}`}
        actions={isLeader && <Button icon={<Plus className="h-5 w-5" />} onClick={() => setEditing({ is_active: true, daily_prestart_required: true, status: 'in_service' })}>Add vehicle</Button>} />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-steel-400" />
          <Input aria-label="Search vehicles" placeholder="Fleet no., rego, operator…" className="pl-10" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select aria-label="Project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">All projects</option>
          {data.projects.map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code} – ` : ''}{p.name}</option>)}
        </Select>
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="">Any status</option>
          <option value="missing">Pre-start not done today</option>
          <option value="out_of_service">Out of service</option>
          <option value="in_service">In service</option>
        </Select>
      </div>

      {!list.length ? (
        <EmptyState icon={<Truck className="h-10 w-10" />} title={data.vehicles.length ? 'No vehicles match' : 'No vehicles yet'}
          body={data.vehicles.length ? 'Try clearing the filters.' : isLeader ? 'Add your utes, trucks and plant so crews can do pre-starts against them.' : 'Ask Admin or HSET to add vehicles on your project.'} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((v) => {
            const last = lastPrestart(v.id);
            const doneToday = last?.record_date === today;
            const out = v.status === 'out_of_service';
            return (
              <li key={v.id} className={clsx('card flex flex-col overflow-hidden', out && 'ring-2 ring-red-500')}>
                <button type="button" className="flex-1 p-4 text-left" onClick={() => setParams({ focus: v.id }, { replace: true })}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-display text-2xl font-bold leading-tight">{v.fleet_number}</p>
                      <p className="truncate text-sm text-steel-600">{[v.rego, v.vehicle_type].filter(Boolean).join(' · ') || '—'}</p>
                    </div>
                    {out ? <Badge color="red">Out of service</Badge> : !v.is_active ? <Badge color="slate">Inactive</Badge> : <Badge color="green">In service</Badge>}
                  </div>
                  <p className="mt-2 truncate text-xs text-steel-500">{projName(v.project_id)}{personName(v.operator_id) ? ` · ${personName(v.operator_id)}` : ''}</p>
                  {out && <p className="mt-2 flex items-start gap-1.5 text-sm font-semibold text-red-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{v.out_of_service_reason ?? 'Tagged out'}</p>}
                  <p className={clsx('mt-2 text-sm font-semibold', doneToday ? 'text-emerald-700' : v.daily_prestart_required && !out ? 'text-amber-700' : 'text-steel-500')}>
                    {doneToday ? <><CheckCircle2 className="mr-1 inline h-4 w-4" />Pre-start done today</> : last ? `Last pre-start ${formatDate(last.record_date)}` : 'No pre-start in the last 30 days'}
                  </p>
                </button>
                {data.templateId && v.is_active && (
                  <Link to={`/records/new?template=${data.templateId}&vehicle=${v.id}`}
                    className={clsx('flex min-h-[56px] items-center justify-center gap-2 border-t-2 font-bold uppercase tracking-wide',
                      doneToday ? 'border-steel-100 bg-steel-50 text-steel-700' : 'border-hivis-500 bg-hivis-500 text-steel-900')}>
                    <ClipboardCheck className="h-5 w-5" /> {doneToday ? 'Another pre-start' : 'Do pre-start'}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {focused && (
        <Modal open onClose={() => setParams({}, { replace: true })} title={`${focused.fleet_number}${focused.rego ? ` · ${focused.rego}` : ''}`}
          footer={<>
            {isLeader && <Button variant="secondary" icon={<Archive className="h-4 w-4" />} onClick={async () => {
              if (!(await confirm({ title: 'Archive vehicle', message: `Archive ${focused.fleet_number}? It leaves the register but its pre-starts are kept.`, confirmLabel: 'Archive', danger: true }))) return;
              try { await api.saveVehicle({ id: focused.id, archived_at: new Date().toISOString(), is_active: false }); toast('Vehicle archived'); setParams({}, { replace: true }); void reload(); } catch (e) { toast(errMsg(e), 'error'); }
            }}>Archive</Button>}
            {canManage(focused) && <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(focused)}>Edit</Button>}
            {canManage(focused) && (focused.status === 'out_of_service'
              ? <Button icon={<Wrench className="h-4 w-4" />} onClick={async () => {
                if (await confirm({ title: 'Return to service', message: `Confirm ${focused.fleet_number} has been repaired and is safe to use?`, confirmLabel: 'Return to service' })) await setOut(focused, false);
              }}>Return to service</Button>
              : <Button variant="danger" icon={<AlertTriangle className="h-4 w-4" />} onClick={() => setTagging(focused)}>Tag out</Button>)}
          </>}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <Item k="Type" v={focused.vehicle_type} />
            <Item k="Project" v={projName(focused.project_id)} />
            <Item k="Usual operator" v={personName(focused.operator_id)} />
            <Item k="Daily pre-start" v={focused.daily_prestart_required ? 'Required' : 'Not required'} />
            <Item k="Status" v={focused.status === 'out_of_service' ? `Out of service since ${formatDate(focused.out_of_service_at)}` : 'In service'} />
            {focused.out_of_service_reason && <Item k="Reason" v={focused.out_of_service_reason} />}
            {focused.notes && <div className="col-span-2"><Item k="Notes" v={focused.notes} /></div>}
          </dl>
          {focused.out_of_service_record_id && (
            <Link className="mt-3 inline-block font-semibold text-brand-700 hover:underline" to={`/records/${focused.out_of_service_record_id}`}>Open the pre-start that tagged it out</Link>
          )}
          <h3 className="mb-1 mt-5 text-sm font-bold uppercase tracking-wider text-steel-500">Pre-starts, last 30 days</h3>
          <ul className="divide-y divide-steel-100">
            {data.prestarts.filter((r) => r.vehicle_id === focused.id).slice(0, 10).map((r) => (
              <li key={r.id}><Link to={`/records/${r.id}`} className="flex min-h-[48px] items-center justify-between gap-2 py-2 hover:bg-steel-50">
                <span><span className="font-mono text-xs text-brand-700">{r.reference}</span> · {formatDate(r.record_date)} · {personName(r.submitted_by) ?? ''}</span>
                {Number(r.summary?.failed_items) > 0 ? <Badge color="red">{String(r.summary?.failed_items)} failed</Badge> : <Badge color="green">All passed</Badge>}
              </Link></li>
            ))}
            {!data.prestarts.some((r) => r.vehicle_id === focused.id) && <li className="py-3 text-sm text-steel-500">None.</li>}
          </ul>
        </Modal>
      )}

      {tagging && <TagOutModal v={tagging} onClose={() => setTagging(null)} onSave={(reason) => setOut(tagging, true, reason)} />}
      {editing && <VehicleModal v={editing} data={data} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
    </div>
  );
}

const Item = ({ k, v }: { k: string; v: string | null | undefined }) => (
  <div><dt className="text-xs font-bold uppercase tracking-wider text-steel-500">{k}</dt><dd className="font-semibold text-steel-900">{v || '—'}</dd></div>
);

function TagOutModal({ v, onClose, onSave }: { v: Vehicle; onClose: () => void; onSave: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title={`Tag out ${v.fleet_number}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={async () => { setBusy(true); await onSave(reason.trim()); setBusy(false); }}>Tag out of service</Button></>}>
      <Field label="Reason" required hint="Crews see this when they pick the vehicle for a pre-start.">
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Brake warning light on, booked in for service" />
      </Field>
    </Modal>
  );
}

function VehicleModal({ v, data, onClose, onSaved }: {
  v: Partial<Vehicle>; data: { projects: { id: string; name: string; code: string | null }[]; people: { id: string; full_name: string }[]; types: { label: string }[] };
  onClose: () => void; onSaved: () => void;
}) {
  const { isLeader } = useAuth();
  const toast = useToast();
  const [f, setF] = useState<Partial<Vehicle>>(v);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<Vehicle>) => setF((x) => ({ ...x, ...p }));
  const save = async () => {
    if (!f.fleet_number?.trim()) { toast('Fleet number is required', 'error'); return; }
    setBusy(true);
    try {
      await api.saveVehicle({
        ...(f.id ? { id: f.id } : {}), fleet_number: f.fleet_number.trim(), rego: f.rego?.trim() || null, vehicle_type: f.vehicle_type || null,
        ...(isLeader || !f.id ? { project_id: f.project_id || null } : {}), operator_id: f.operator_id || null,
        is_active: f.is_active ?? true, daily_prestart_required: f.daily_prestart_required ?? true, notes: f.notes || null,
      });
      toast(f.id ? 'Vehicle updated' : 'Vehicle added');
      onSaved();
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={f.id ? `Edit ${v.fleet_number}` : 'Add vehicle'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Fleet number" required><Input value={f.fleet_number ?? ''} onChange={(e) => set({ fleet_number: e.target.value })} placeholder="UTE-07" /></Field>
        <Field label="Rego"><Input value={f.rego ?? ''} onChange={(e) => set({ rego: e.target.value.toUpperCase() })} placeholder="1ABC234" /></Field>
        <Field label="Type">
          <Select value={f.vehicle_type ?? ''} onChange={(e) => set({ vehicle_type: e.target.value })}>
            <option value="">Select…</option>
            {data.types.map((t) => <option key={t.label} value={t.label}>{t.label}</option>)}
            {f.vehicle_type && !data.types.some((t) => t.label === f.vehicle_type) && <option value={f.vehicle_type}>{f.vehicle_type}</option>}
          </Select>
        </Field>
        <Field label="Project / site">
          <Select value={f.project_id ?? ''} disabled={!isLeader && !!f.id} onChange={(e) => set({ project_id: e.target.value })}>
            <option value="">No project (yard)</option>
            {data.projects.map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code} – ` : ''}{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Usual operator">
          <Select value={f.operator_id ?? ''} onChange={(e) => set({ operator_id: e.target.value })}>
            <option value="">Anyone</option>
            {data.people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </Select>
        </Field>
      </div>
      <div className="mt-2 space-y-1">
        <Checkbox label="Daily pre-start required" description="Counts on the dashboard when not done on a weekday" checked={f.daily_prestart_required ?? true} onChange={(x) => set({ daily_prestart_required: x })} />
        <Checkbox label="Active" description="Inactive vehicles can't be picked for pre-starts" checked={f.is_active ?? true} onChange={(x) => set({ is_active: x })} />
      </div>
      <Field label="Notes"><Textarea className="min-h-[64px]" value={f.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} /></Field>
    </Modal>
  );
}
