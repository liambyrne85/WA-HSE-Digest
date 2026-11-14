import { clsx } from 'clsx';
import {
  AlertTriangle, ArrowRight, ChevronDown, Construction, Download, FileDown, Radio, Search, ShieldAlert, Target, Truck, X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useToast } from '../../contexts/ToastContext';
import { api } from '../../lib/api';
import {
  LEADER_ROLES, thisWeek, tileIncidents, tileInvestigations, tileLeadership, tilePrestarts, tileScaffolds,
  type DashData, type DashFilters, type Rag,
} from '../../lib/dashboard';
import { buildTables, exportCsv, exportPdf, filterSummary, type TileKey } from '../../lib/dashboardExport';
import {
  INCIDENT_CATEGORY, INVESTIGATION_STATUS, ROLE_LABEL, addDays, daysUntil, formatDate, perthToday,
} from '../../lib/labels';
import type { LeadershipTarget } from '../../lib/types';
import { errMsg, useAsync } from '../../lib/useAsync';
import { Badge, Button, ErrorBanner, Field, Input, Modal, Select, Spinner } from '../ui';

type Preset = 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'last_30' | 'custom';
function presetRange(p: Preset, today = perthToday()) {
  const wk = thisWeek(today);
  const month = (offset: number) => {
    const [y, m] = today.split('-').map(Number);
    const first = new Date(Date.UTC(y!, m! - 1 + offset, 1));
    const last = new Date(Date.UTC(y!, m! + offset, 0));
    return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
  };
  switch (p) {
    case 'last_week': return { from: addDays(wk.from, -7), to: addDays(wk.from, -1) };
    case 'this_month': return month(0);
    case 'last_month': return month(-1);
    case 'last_30': return { from: addDays(today, -29), to: today };
    default: return wk;
  }
}
const PRESETS: { key: Preset; label: string }[] = [
  { key: 'this_week', label: 'This week' }, { key: 'last_week', label: 'Last week' },
  { key: 'this_month', label: 'This month' }, { key: 'last_month', label: 'Last month' },
  { key: 'last_30', label: 'Last 30 days' }, { key: 'custom', label: 'Custom dates' },
];

const RAG_STYLE: Record<Rag, string> = {
  green: 'bg-emerald-600 text-white', amber: 'bg-amber-400 text-steel-900', red: 'bg-red-600 text-white', none: 'bg-steel-200 text-steel-600',
};
const RAG_LABEL: Record<Rag, string> = { green: 'Green', amber: 'Amber', red: 'Red', none: 'No target' };

/** Dashboard tiles 1–4 for Admin, HSET, Project Managers and Supervisors. */
export function SafetyDashboard() {
  const { isAdmin } = useAuth();
  const { settings } = useTheme();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const def = thisWeek();
  const f: DashFilters = {
    projectId: params.get('project') ?? '', leaderId: params.get('leader') ?? '',
    from: params.get('from') ?? def.from, to: params.get('to') ?? def.to,
  };
  const preset = (PRESETS.find((p) => p.key !== 'custom' && (() => { const r = presetRange(p.key); return r.from === f.from && r.to === f.to; })())?.key
    ?? (params.get('range') === 'custom' || params.get('from') ? 'custom' : 'this_week')) as Preset;
  const open = params.get('tile') as TileKey | null;
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    setParams(next, { replace: true });
  };
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const { data, error, reload } = useAsync(async (): Promise<DashData> => {
    // Load a little either side so the date filter can change without a refetch.
    // Safety events are loaded in full so open investigations can show their incident.
    const [ranged, events, vehicles, investigations, targets, profiles, projects, members, scaffolds, scaffoldDefects] = await Promise.all([
      api.listRecords(undefined, { from: addDays(f.from, -1), to: addDays(f.to, 1) }), api.listRecords('safety_event'),
      api.listVehicles(), api.listInvestigations(), api.listTargets(), api.listProfiles(), api.listProjects(), api.listProjectMembers(),
      api.listScaffolds().catch(() => []), api.listScaffoldDefects().catch(() => []),
    ]);
    setUpdatedAt(new Date());
    const records = [...ranged.filter((r) => ['plant_prestart', 'field_leadership'].includes(r.module)), ...events];
    return { records, vehicles, investigations, targets, profiles, projects, members, scaffolds, scaffoldDefects };
  }, [f.from, f.to]);

  // Live: refresh when records, vehicles, investigations or targets change.
  useEffect(() => api.subscribeChanges(() => { void reload(); }), [reload]);

  useEffect(() => {
    if (open && panelRef.current) panelRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [open]);

  const t = useMemo(() => data && {
    pre: tilePrestarts(f, data), inv: tileInvestigations(f, data), inc: tileIncidents(f, data), fl: tileLeadership(f, data), sc: tileScaffolds(f, data),
  }, [data, f.projectId, f.leaderId, f.from, f.to]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !data) return <ErrorBanner message={error} onRetry={reload} />;

  const leaders = (data?.profiles ?? []).filter((p) => p.is_active && LEADER_ROLES.includes(p.role)).sort((a, b) => a.full_name.localeCompare(b.full_name));
  const projects = (data?.projects ?? []).filter((p) => p.is_active).sort((a, b) => (a.code ?? a.name).localeCompare(b.code ?? b.name));
  const projName = (id: string | null) => { const p = data?.projects.find((x) => x.id === id); return p ? p.code || p.name : 'No project'; };
  const person = (id: string | null) => data?.profiles.find((p) => p.id === id)?.full_name ?? 'Unassigned';

  const doPdf = async () => {
    if (!data || !t) return;
    const tables = buildTables(f, data);
    try {
      await exportPdf(Object.values(tables), [
        { label: 'Pre-starts not done', value: String(t.pre.missed.length) },
        { label: 'Pre-starts with failed items', value: String(t.pre.failed.length) },
        { label: 'Vehicles out of service', value: String(t.pre.outOfService.length) },
        { label: 'Open investigations', value: `${t.inv.open.length} (${t.inv.overdue.length} overdue)` },
        { label: 'Incidents', value: String(t.inc.incidents.length) },
        { label: 'Scaffolds overdue / unsafe', value: `${t.sc.overdue.length} / ${t.sc.unsafe.length}` },
        { label: 'Field leadership', value: `${t.fl.completed} of ${t.fl.target || '—'}${t.fl.pct !== null ? ` (${t.fl.pct}%)` : ''}` },
      ], `${settings.company_name || 'Safety'} – safety dashboard`, filterSummary(f, data), f);
    } catch (e) { toast(errMsg(e), 'error'); }
  };

  return (
    <section aria-labelledby="dash" className="mb-7">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="dash" className="text-xl font-bold uppercase text-steel-800">Safety dashboard</h2>
          <p className="flex items-center gap-1.5 text-xs text-steel-500">
            <Radio className="h-3.5 w-3.5 text-emerald-600" /> Live{updatedAt && ` · updated ${updatedAt.toLocaleTimeString('en-AU', { timeZone: 'Australia/Perth', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}`}
          </p>
        </div>
        <Button variant="secondary" icon={<FileDown className="h-5 w-5" />} onClick={doPdf} disabled={!data}>PDF</Button>
      </div>

      {/* Filters */}
      <div className="card mb-4 grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Project">
          <Select value={f.projectId} onChange={(e) => set({ project: e.target.value })}>
            <option value="">All my projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code} – ` : ''}{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Leader">
          <Select value={f.leaderId} onChange={(e) => set({ leader: e.target.value })}>
            <option value="">All leaders</option>
            {leaders.map((p) => <option key={p.id} value={p.id}>{p.full_name} ({ROLE_LABEL[p.role]})</option>)}
          </Select>
        </Field>
        <Field label="Date range">
          <Select value={preset} onChange={(e) => {
            const k = e.target.value as Preset;
            if (k === 'custom') set({ range: 'custom', from: f.from, to: f.to });
            else if (k === 'this_week') set({ range: null, from: null, to: null });
            else { const r = presetRange(k); set({ range: null, from: r.from, to: r.to }); }
          }}>
            {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </Select>
        </Field>
        {preset === 'custom' ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label="From"><Input type="date" value={f.from} max={f.to} onChange={(e) => e.target.value && set({ range: 'custom', from: e.target.value })} /></Field>
            <Field label="To"><Input type="date" value={f.to} min={f.from} onChange={(e) => e.target.value && set({ range: 'custom', to: e.target.value })} /></Field>
          </div>
        ) : (
          <div className="flex items-end pb-3 text-sm font-semibold text-steel-600">{formatDate(f.from)} – {formatDate(f.to)}</div>
        )}
      </div>

      {!t ? <Spinner /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
            <Tile active={open === 'prestarts'} onClick={() => set({ tile: open === 'prestarts' ? null : 'prestarts' })}
              icon={<Truck className="h-6 w-6" />} label="Vehicle pre-starts not done" value={t.pre.missed.length}
              tone={t.pre.missed.length ? 'red' : 'green'}
              sub={<>
                <SubCount n={t.pre.failed.length} label="with failed items" bad />
                <SubCount n={t.pre.outOfService.length} label="out of service" bad />
              </>} />
            <Tile active={open === 'investigations'} onClick={() => set({ tile: open === 'investigations' ? null : 'investigations' })}
              icon={<Search className="h-6 w-6" />} label="Open investigations" value={t.inv.open.length}
              tone={t.inv.overdue.length ? 'red' : t.inv.open.length ? 'amber' : 'green'}
              sub={<SubCount n={t.inv.overdue.length} label="overdue" bad />} />
            <Tile active={open === 'incidents'} onClick={() => set({ tile: open === 'incidents' ? null : 'incidents' })}
              icon={<ShieldAlert className="h-6 w-6" />} label="Incidents" value={t.inc.incidents.length}
              tone={t.inc.byType.find((x) => x.key === 'injury')?.count ? 'red' : t.inc.incidents.length ? 'amber' : 'green'}
              sub={<span className="flex flex-wrap gap-1">
                {t.inc.byType.filter((x) => x.count).map((x) => <Badge key={x.key} color={INCIDENT_CATEGORY[x.key]!.color} dot={false}>{x.count} {INCIDENT_CATEGORY[x.key]!.label.toLowerCase()}</Badge>)}
                {!t.inc.incidents.length && <span className="text-xs text-steel-500">None in this period</span>}
              </span>} />
            <Tile active={open === 'leadership'} onClick={() => set({ tile: open === 'leadership' ? null : 'leadership' })}
              icon={<Target className="h-6 w-6" />} label="Field leadership vs target"
              value={t.fl.pct === null ? t.fl.completed : `${t.fl.pct}%`}
              tone={t.fl.pct === null ? 'slate' : t.fl.pct >= 100 ? 'green' : t.fl.pct >= 80 ? 'amber' : 'red'}
              sub={<>
                <span className="text-xs font-semibold text-steel-600">{t.fl.completed} done of {t.fl.target || 'no'} target</span>
                <SubCount n={t.fl.rows.filter((r) => r.rag === 'red').length} label="leaders in red" bad />
              </>} />
            <Tile active={open === 'scaffolds'} onClick={() => set({ tile: open === 'scaffolds' ? null : 'scaffolds' })}
              icon={<Construction className="h-6 w-6" />} label="Scaffolds overdue for inspection" value={t.sc.overdue.length}
              tone={t.sc.overdue.length || t.sc.unsafe.length ? 'red' : t.sc.dueWeek.length ? 'amber' : 'green'}
              sub={<>
                <SubCount n={t.sc.dueWeek.length} label="due in 7 days" />
                <SubCount n={t.sc.unsafe.length} label="tagged Unsafe" bad />
                <SubCount n={t.sc.defects.length} label="open defects" bad />
              </>} />
          </div>

          {open && data && (
            <div ref={panelRef} className="card mt-4 scroll-mt-20 overflow-hidden">
              <DrillDown tile={open} f={f} data={data} onClose={() => set({ tile: null })}
                actions={open === 'leadership' && isAdmin ? <Button size="sm" variant="secondary" icon={<Target className="h-4 w-4" />} onClick={() => setTargetsOpen(true)}>Set targets</Button> : undefined}>
                {open === 'prestarts' && (
                  <div className="divide-y divide-steel-100">
                    <Group title="Not done (Mon–Fri, up to today)" count={t.pre.missed.length}>
                      {t.pre.missed.map((m) => (
                        <Row key={`${m.vehicle.id}${m.date}`} to={`/vehicles?focus=${m.vehicle.id}`} title={m.vehicle.fleet_number}
                          meta={[formatDate(m.date), m.vehicle.vehicle_type, projName(m.vehicle.project_id)]} badge={<Badge color="red">Not done</Badge>} />
                      ))}
                    </Group>
                    <Group title="Pre-starts with failed items" count={t.pre.failed.length}>
                      {t.pre.failed.map((r) => (
                        <Row key={r.id} to={`/records/${r.id}`} title={`${r.reference} · ${data.vehicles.find((v) => v.id === r.vehicle_id)?.fleet_number ?? r.title}`}
                          meta={[formatDate(r.record_date), person(r.submitted_by), projName(r.project_id)]}
                          badge={<Badge color={Number(r.summary?.critical_failures) ? 'red' : 'amber'}>{String(r.summary?.failed_items)} failed{Number(r.summary?.critical_failures) ? ` · ${r.summary?.critical_failures} critical` : ''}</Badge>} />
                      ))}
                    </Group>
                    <Group title="Vehicles out of service" count={t.pre.outOfService.length}>
                      {t.pre.outOfService.map((v) => (
                        <Row key={v.id} to={`/vehicles?focus=${v.id}`} title={`${v.fleet_number}${v.rego ? ` (${v.rego})` : ''}`}
                          meta={[v.out_of_service_reason, `since ${formatDate(v.out_of_service_at)}`, projName(v.project_id)]} badge={<Badge color="red">Out of service</Badge>} />
                      ))}
                    </Group>
                  </div>
                )}
                {open === 'investigations' && (
                  <ul className="divide-y divide-steel-100">
                    {t.inv.open.map((i) => {
                      const left = daysUntil(i.due_date);
                      const overdue = left !== null && left < 0;
                      return (
                        <Row key={i.id} to={`/investigations/${i.id}`} danger={overdue}
                          title={`${i.reference} · ${data.records.find((r) => r.id === i.incident_id)?.reference ?? 'Incident'}`}
                          meta={[person(i.lead_id), projName(i.project_id), `due ${formatDate(i.due_date)}`]}
                          badge={overdue ? <Badge color="red">{-left!} day{left === -1 ? '' : 's'} overdue</Badge> : <Badge color={INVESTIGATION_STATUS[i.status]!.color}>{INVESTIGATION_STATUS[i.status]!.label}</Badge>} />
                      );
                    })}
                    {!t.inv.open.length && <Empty>No open investigations.</Empty>}
                  </ul>
                )}
                {open === 'incidents' && (
                  <div>
                    <div className="grid gap-4 border-b border-steel-100 p-4 md:grid-cols-2">
                      <Bars title="By type" rows={t.inc.byType.map((x) => ({ label: INCIDENT_CATEGORY[x.key]!.label, count: x.count }))} />
                      <Bars title="By project" rows={t.inc.byProject.map((x) => ({ label: x.name, count: x.count }))} />
                    </div>
                    <ul className="divide-y divide-steel-100">
                      {t.inc.incidents.map((r) => (
                        <Row key={r.id} to={`/records/${r.id}`} title={`${r.reference} · ${String(r.summary?.event_type ?? r.title)}`}
                          meta={[formatDate(r.record_date), projName(r.project_id), String(r.summary?.severity ?? '')]}
                          badge={<Badge color={INCIDENT_CATEGORY[String(r.summary?.incident_category)]?.color ?? 'slate'}>{INCIDENT_CATEGORY[String(r.summary?.incident_category)]?.label}</Badge>} />
                      ))}
                      {!t.inc.incidents.length && <Empty>No incidents in this period.</Empty>}
                    </ul>
                  </div>
                )}
                {open === 'scaffolds' && (
                  <div className="divide-y divide-steel-100">
                    <Group title="Inspection overdue — do not use" count={t.sc.overdue.length}>
                      {t.sc.overdue.map((s) => <Row key={s.id} danger to={`/scaffolds/${s.id}`} title={`${s.scaffold_number} · ${s.location}`}
                        meta={[projName(s.project_id), `was due ${formatDate(s.next_inspection_due)}`]} badge={<Badge color="red">Overdue</Badge>} />)}
                    </Group>
                    <Group title="Tagged Unsafe" count={t.sc.unsafe.length}>
                      {t.sc.unsafe.map((s) => <Row key={s.id} to={`/scaffolds/${s.id}`} title={`${s.scaffold_number} · ${s.location}`}
                        meta={[projName(s.project_id), s.status_reason]} badge={<Badge color="red">Unsafe</Badge>} />)}
                    </Group>
                    <Group title="Inspection due in the next 7 days" count={t.sc.dueWeek.length}>
                      {t.sc.dueWeek.map((s) => <Row key={s.id} to={`/scaffolds/${s.id}`} title={`${s.scaffold_number} · ${s.location}`}
                        meta={[projName(s.project_id), `due ${formatDate(s.next_inspection_due)}`]} badge={<Badge color="amber">Due soon</Badge>} />)}
                    </Group>
                    <Group title="Open scaffold defects" count={t.sc.defects.length}>
                      {t.sc.defects.map((x) => {
                        const late = (daysUntil(x.due_date) ?? 0) < 0;
                        return <Row key={x.id} danger={late} to={`/scaffolds/${x.scaffold_id}`} title={`${x.reference} · ${x.item_label}`}
                          meta={[data.scaffolds?.find((s) => s.id === x.scaffold_id)?.scaffold_number, person(x.owner_id), `due ${formatDate(x.due_date)}`]}
                          badge={<Badge color={late ? 'red' : 'orange'}>{late ? 'Overdue' : 'Open'}</Badge>} />;
                      })}
                    </Group>
                  </div>
                )}
                {open === 'leadership' && (
                  <div>
                    <ul className="divide-y divide-steel-100 sm:hidden">
                      {t.fl.rows.map((r) => (
                        <li key={r.profile.id}>
                          <Link to={r.completed ? `/leadership?by=${r.profile.id}&from=${f.from}&to=${f.to}` : `/people/${r.profile.id}`} className="flex min-h-[64px] items-center gap-3 px-4 py-3">
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-bold text-steel-900">{r.profile.full_name}</span>
                              <span className="block truncate text-xs text-steel-500">{ROLE_LABEL[r.profile.role]}{r.projects.length ? ` · ${r.projects.join(', ')}` : ''}</span>
                              <span className="block text-sm font-semibold tabular-nums text-steel-700">{r.completed} of {r.target ?? '—'}{r.pct !== null ? ` · ${r.pct}%` : ''}</span>
                            </span>
                            <span className={clsx('min-w-[72px] rounded-md px-2 py-1 text-center text-xs font-bold uppercase', RAG_STYLE[r.rag])}>{RAG_LABEL[r.rag]}</span>
                          </Link>
                        </li>
                      ))}
                      {!t.fl.rows.length && <Empty>No leaders with targets or field leadership in this period.</Empty>}
                    </ul>
                  <div className="hidden overflow-x-auto sm:block">
                    <table className="w-full min-w-[620px] text-sm">
                      <thead className="bg-steel-50 text-left text-xs font-bold uppercase tracking-wider text-steel-500">
                        <tr><th className="px-4 py-2">Leader</th><th className="px-3 py-2">Project</th><th className="px-3 py-2 text-right">Completed</th>
                          <th className="px-3 py-2 text-right">Target</th><th className="px-3 py-2 text-right">% of target</th><th className="px-4 py-2">RAG</th></tr>
                      </thead>
                      <tbody className="divide-y divide-steel-100">
                        {t.fl.rows.map((r) => (
                          <tr key={r.profile.id}>
                            <td className="px-4 py-3"><Link to={`/people/${r.profile.id}`} className="font-bold text-steel-900 hover:underline">{r.profile.full_name}</Link>
                              <span className="block text-xs text-steel-500">{ROLE_LABEL[r.profile.role]}</span></td>
                            <td className="px-3 py-3 text-steel-700">{r.projects.join(', ') || '—'}</td>
                            <td className="px-3 py-3 text-right font-bold tabular-nums">
                              {r.completed ? <Link className="text-brand-700 hover:underline" to={`/leadership?by=${r.profile.id}&from=${f.from}&to=${f.to}`}>{r.completed}</Link> : 0}
                            </td>
                            <td className="px-3 py-3 text-right tabular-nums">{r.target ?? '—'}</td>
                            <td className="px-3 py-3 text-right font-bold tabular-nums">{r.pct === null ? '—' : `${r.pct}%`}</td>
                            <td className="px-4 py-3"><span className={clsx('inline-block min-w-[72px] rounded-md px-2 py-1 text-center text-xs font-bold uppercase', RAG_STYLE[r.rag])}>{RAG_LABEL[r.rag]}</span></td>
                          </tr>
                        ))}
                        {!t.fl.rows.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-steel-500">No leaders with targets or field leadership in this period.{isAdmin && ' Use “Set targets” to add weekly or monthly targets.'}</td></tr>}
                      </tbody>
                    </table>
                  </div>
                    <p className="px-4 pb-3 pt-1 text-xs text-steel-500">Targets are pro rata for the selected dates. Green ≥ 100%, amber 80–99%, red under 80%.</p>
                  </div>
                )}
              </DrillDown>
            </div>
          )}
        </>
      )}
      {targetsOpen && data && <TargetsModal data={data} onClose={() => setTargetsOpen(false)} onSaved={reload} />}
    </section>
  );
}

function Tile({ label, value, sub, icon, tone, active, onClick }: {
  label: string; value: ReactNode; sub?: ReactNode; icon: ReactNode; tone: 'red' | 'amber' | 'green' | 'slate'; active: boolean; onClick: () => void;
}) {
  const bar = { red: 'bg-red-600', amber: 'bg-amber-500', green: 'bg-emerald-600', slate: 'bg-steel-400' }[tone];
  const num = { red: 'text-red-700', amber: 'text-steel-900', green: 'text-steel-900', slate: 'text-steel-900' }[tone];
  return (
    <button type="button" onClick={onClick} aria-expanded={active}
      className={clsx('card relative flex min-h-[148px] flex-col overflow-hidden p-4 pl-5 text-left transition active:scale-[0.99]',
        active ? 'ring-4 ring-brand-500/40' : 'hover:shadow-lg')}>
      <span className={clsx('absolute inset-y-0 left-0 w-2', bar)} />
      <span className="flex items-start justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wider text-steel-500">{label}</span>
        <span className="text-steel-400">{icon}</span>
      </span>
      <span className={clsx('mt-2 font-display text-5xl font-bold leading-none', num)}>{value}</span>
      <span className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-3">{sub}</span>
      <span className="absolute bottom-3 right-3 text-steel-400"><ChevronDown className={clsx('h-5 w-5 transition', active && 'rotate-180')} /></span>
    </button>
  );
}

function SubCount({ n, label, bad }: { n: number; label: string; bad?: boolean }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 text-xs font-bold', n && bad ? 'text-red-700' : 'text-steel-500')}>
      {n > 0 && bad && <AlertTriangle className="h-3.5 w-3.5" />}{n} {label}
    </span>
  );
}

function DrillDown({ tile, f, data, onClose, actions, children }: { tile: TileKey; f: DashFilters; data: DashData; onClose: () => void; actions?: ReactNode; children: ReactNode }) {
  const table = buildTables(f, data)[tile];
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-steel-200 bg-steel-50 px-4 py-2">
        <h3 className="text-lg font-bold uppercase text-steel-800">{table.title} <span className="text-steel-500">({table.body.length})</span></h3>
        <div className="flex items-center gap-2">
          {actions}
          <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => exportCsv(table, f)}>CSV</Button>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-lg text-steel-500 hover:bg-steel-200"><X className="h-5 w-5" /></button>
        </div>
      </div>
      {children}
    </>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const [all, setAll] = useState(false);
  const items = Array.isArray(children) ? children : [children];
  return (
    <div>
      <p className="bg-white px-4 pt-3 text-xs font-bold uppercase tracking-wider text-steel-500">{title} ({count})</p>
      <ul className="divide-y divide-steel-100">
        {(all ? items : items.slice(0, 8))}
        {!count && <Empty>None.</Empty>}
      </ul>
      {items.length > 8 && !all && <button type="button" className="min-h-[44px] w-full text-sm font-semibold text-brand-700" onClick={() => setAll(true)}>Show all {items.length}</button>}
    </div>
  );
}

function Row({ to, title, meta, badge, danger }: { to: string; title: string; meta: (string | null | undefined)[]; badge?: ReactNode; danger?: boolean }) {
  return (
    <li>
      <Link to={to} className={clsx('flex min-h-[60px] items-center justify-between gap-3 px-4 py-3 hover:bg-steel-50', danger && 'bg-red-50 hover:bg-red-100')}>
        <span className="min-w-0">
          <span className={clsx('block truncate font-bold', danger ? 'text-red-800' : 'text-steel-900')}>{title}</span>
          <span className="block truncate text-xs text-steel-500">{meta.filter(Boolean).join(' · ')}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">{badge}<ArrowRight className="h-4 w-4 text-steel-400" /></span>
      </Link>
    </li>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <li className="list-none px-4 py-6 text-center text-sm text-steel-500">{children}</li>;

function Bars({ title, rows }: { title: string; rows: { label: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div>
      <p className="mb-2 text-xs font-bold uppercase tracking-wider text-steel-500">{title}</p>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.label} className="grid grid-cols-[minmax(0,9rem)_1fr_2rem] items-center gap-2 text-sm">
            <span className="truncate text-steel-700">{r.label}</span>
            <span className="h-3 overflow-hidden rounded bg-steel-100"><span className="block h-full rounded bg-brand-500" style={{ width: `${(r.count / max) * 100}%` }} /></span>
            <span className="text-right font-bold tabular-nums">{r.count}</span>
          </li>
        ))}
        {!rows.length && <li className="text-sm text-steel-500">None</li>}
      </ul>
    </div>
  );
}

/** Admin: weekly or monthly field leadership targets per leader. */
function TargetsModal({ data, onClose, onSaved }: { data: DashData; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const leaders = data.profiles.filter((p) => p.is_active && LEADER_ROLES.includes(p.role)).sort((a, b) => a.full_name.localeCompare(b.full_name));
  const [rows, setRows] = useState<Record<string, LeadershipTarget>>(() => Object.fromEntries(leaders.map((p) => [p.id,
    data.targets.find((t) => t.profile_id === p.id) ?? { profile_id: p.id, period: 'week' as const, target: 0 }])));
  const [busy, setBusy] = useState(false);
  const changed = Object.values(rows).filter((r) => {
    const o = data.targets.find((t) => t.profile_id === r.profile_id);
    return o ? o.period !== r.period || o.target !== r.target : r.target > 0;
  });
  const save = async () => {
    setBusy(true);
    try {
      for (const r of changed) await api.saveTarget({ ...r, target: Math.max(0, Math.round(r.target)) });
      toast(`${changed.length} target${changed.length === 1 ? '' : 's'} saved`);
      onSaved(); onClose();
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Field leadership targets" wide
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!changed.length}>Save {changed.length || ''}</Button></>}>
      <p className="mb-3 text-sm text-steel-600">How many field leadership activities each leader should complete per week or per month. 0 = no target.</p>
      <ul className="divide-y divide-steel-100">
        {leaders.map((p) => (
          <li key={p.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 py-2">
            <span className="min-w-0"><span className="block truncate font-bold">{p.full_name}</span><span className="text-xs text-steel-500">{ROLE_LABEL[p.role]}</span></span>
            <Input type="number" inputMode="numeric" min={0} aria-label={`Target for ${p.full_name}`} className="w-20 text-center" value={rows[p.id]!.target}
              onChange={(e) => setRows({ ...rows, [p.id]: { ...rows[p.id]!, target: Number(e.target.value) || 0 } })} />
            <Select aria-label={`Period for ${p.full_name}`} className="w-40" value={rows[p.id]!.period}
              onChange={(e) => setRows({ ...rows, [p.id]: { ...rows[p.id]!, period: e.target.value as 'week' | 'month' } })}>
              <option value="week">per week</option><option value="month">per month</option>
            </Select>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
