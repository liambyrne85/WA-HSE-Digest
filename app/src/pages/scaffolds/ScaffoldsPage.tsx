import { clsx } from 'clsx';
import { AlertTriangle, ArrowRight, CloudUpload, Plus, Search, Wrench } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CloseDefectModal, dueText, ScaffoldFormModal, StatusPill, typeLabel } from '../../components/scaffolds/shared';
import { Badge, Button, EmptyState, ErrorBanner, Input, PageHeader, Select, Spinner, Tabs } from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../lib/api';
import { DUTY_CLASS, SCAFFOLD_STATUS, daysUntil, formatDate } from '../../lib/labels';
import { useOutbox } from '../../lib/offline/outbox';
import { dueSoon, liveStatus } from '../../lib/scaffoldLogic';
import type { ScaffoldDefect } from '../../lib/types';
import { useAsync } from '../../lib/useAsync';

type Tab = 'all' | 'attention' | 'defects' | 'dismantled';

/** Scaffold register. Everyone on a project sees its scaffolds (enforced by the database). */
export default function ScaffoldsPage() {
  const { profile, isLeader, isProjectLead } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'all';
  const [q, setQ] = useState('');
  const [projectId, setProjectId] = useState('');
  const [adding, setAdding] = useState(params.get('new') === '1');
  const [closing, setClosing] = useState<ScaffoldDefect | null>(null);
  const outbox = useOutbox();

  const { data, loading, error, reload } = useAsync(async () => {
    const [scaffolds, defects, projects, people] = await Promise.all([
      api.listScaffolds(), api.listScaffoldDefects(), api.listProjects(), api.listDirectory(),
    ]);
    return { scaffolds, defects, projects, people };
  }, []);
  useEffect(() => api.subscribeChanges(() => { void reload(); }), [reload]);

  const canRegister = isLeader || isProjectLead;
  const projName = (id: string | null) => { const p = data?.projects.find((x) => x.id === id); return p ? p.code || p.name : ''; };
  const person = (id: string | null) => data?.people.find((p) => p.id === id)?.full_name ?? 'Unassigned';
  const openDefects = (data?.defects ?? []).filter((d) => d.status === 'open' && (!projectId || d.project_id === projectId));
  const pending = (id: string) => outbox.items.filter((i) => i.scaffold_id === id).length;

  const list = useMemo(() => (data?.scaffolds ?? []).filter((s) => {
    if (projectId && s.project_id !== projectId) return false;
    const live = liveStatus(s);
    if (tab === 'dismantled') { if (live !== 'dismantled') return false; } else if (live === 'dismantled') return false;
    if (tab === 'attention' && !(['overdue', 'unsafe', 'awaiting'].includes(live) || dueSoon(s))) return false;
    const t = q.trim().toLowerCase();
    return !t || [s.scaffold_number, s.location, projName(s.project_id)].some((x) => x?.toLowerCase().includes(t));
  }).sort((a, b) => {
    const order = { overdue: 0, unsafe: 1, awaiting: 2, restricted: 3, safe: 4, dismantled: 5 } as Record<string, number>;
    return order[liveStatus(a)]! - order[liveStatus(b)]! || (a.next_inspection_due ?? '9').localeCompare(b.next_inspection_due ?? '9');
  }), [data, tab, q, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorBanner message={error ?? 'Could not load scaffolds'} onRetry={reload} />;
  const active = data.scaffolds.filter((s) => s.status !== 'dismantled' && (!projectId || s.project_id === projectId));
  const count = (live: string) => active.filter((s) => liveStatus(s) === live).length;
  const attention = active.filter((s) => ['overdue', 'unsafe', 'awaiting'].includes(liveStatus(s)) || dueSoon(s)).length;

  return (
    <div>
      <PageHeader eyebrow="Scaffolds" title="Scaffold Register"
        subtitle={`${active.length} in service${count('overdue') ? ` · ${count('overdue')} overdue` : ''}${count('unsafe') + count('awaiting') ? ` · ${count('unsafe') + count('awaiting')} unsafe` : ''}`}
        actions={canRegister && <Button icon={<Plus className="h-5 w-5" />} onClick={() => setAdding(true)}>Register scaffold</Button>} />

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: 'Overdue', n: count('overdue'), tone: 'bg-red-600 text-white' },
          { label: 'Due in 7 days', n: active.filter((s) => dueSoon(s)).length, tone: 'bg-amber-400 text-steel-900' },
          { label: 'Unsafe', n: count('unsafe') + count('awaiting'), tone: 'bg-red-100 text-red-900' },
          { label: 'Open defects', n: openDefects.length, tone: 'bg-steel-800 text-white' },
        ].map((c) => (
          <button key={c.label} type="button" onClick={() => setParams(c.label === 'Open defects' ? { tab: 'defects' } : { tab: 'attention' }, { replace: true })}
            className={clsx('flex min-h-[72px] flex-col justify-center rounded-xl px-4 text-left shadow-card', c.n ? c.tone : 'bg-white text-steel-500')}>
            <span className="font-display text-3xl font-bold leading-none">{c.n}</span>
            <span className="text-xs font-bold uppercase tracking-wider">{c.label}</span>
          </button>
        ))}
      </div>

      <Tabs value={tab} onChange={(k) => setParams(k === 'all' ? {} : { tab: k }, { replace: true })} tabs={[
        { key: 'all', label: 'In service', count: active.length },
        { key: 'attention', label: 'Needs attention', count: attention },
        { key: 'defects', label: 'Defects', count: openDefects.length },
        { key: 'dismantled', label: 'Dismantled', count: data.scaffolds.filter((s) => s.status === 'dismantled').length },
      ]} />

      <div className="my-4 grid gap-3 sm:grid-cols-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-steel-400" />
          <Input aria-label="Search scaffolds" placeholder="Scaffold ID or location…" className="pl-10" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select aria-label="Project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">All my projects</option>
          {data.projects.map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code} – ` : ''}{p.name}</option>)}
        </Select>
      </div>

      {tab === 'defects' ? (
        !openDefects.length ? <EmptyState icon={<Wrench className="h-10 w-10" />} title="No open defects" /> : (
          <ul className="card divide-y divide-steel-100 overflow-hidden">
            {openDefects.map((d) => {
              const s = data.scaffolds.find((x) => x.id === d.scaffold_id);
              const left = daysUntil(d.due_date);
              const overdue = left !== null && left < 0;
              const canClose = isLeader || d.owner_id === profile?.id || isProjectLead;
              return (
                <li key={d.id} className={clsx('flex flex-wrap items-center gap-3 px-4 py-3', overdue && 'bg-red-50')}>
                  <Link to={`/scaffolds/${d.scaffold_id}`} className="min-w-0 flex-1">
                    <p className={clsx('font-bold', overdue ? 'text-red-800' : 'text-steel-900')}><span className="mr-2 font-mono text-sm">{d.reference}</span>{d.item_label}</p>
                    <p className="truncate text-xs text-steel-500">{[s?.scaffold_number, s?.location, person(d.owner_id), `due ${formatDate(d.due_date)}`].filter(Boolean).join(' · ')}</p>
                    {d.description && <p className="mt-0.5 line-clamp-2 text-sm text-steel-700">{d.description}</p>}
                  </Link>
                  {overdue && <Badge color="red">{-left!}d overdue</Badge>}
                  {canClose && <Button size="sm" variant="secondary" onClick={() => setClosing(d)}>Close</Button>}
                </li>
              );
            })}
          </ul>
        )
      ) : !list.length ? (
        <EmptyState icon={<AlertTriangle className="h-10 w-10" />} title={data.scaffolds.length ? 'Nothing here' : 'No scaffolds yet'}
          body={data.scaffolds.length ? 'Try another tab or clear the search.' : canRegister ? 'Register each scaffold so it can be inspected and tagged.' : 'Scaffolds on your project will show here.'} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((s) => {
            const live = liveStatus(s);
            const defects = data.defects.filter((d) => d.scaffold_id === s.id && d.status === 'open').length;
            return (
              <li key={s.id}>
                <button type="button" onClick={() => nav(`/scaffolds/${s.id}`)} className="card relative flex h-full w-full flex-col overflow-hidden p-4 pl-6 text-left active:scale-[0.99]">
                  <span className={clsx('absolute inset-y-0 left-0 w-2.5', SCAFFOLD_STATUS[live]!.banner.split(' ')[0])} />
                  <span className="flex items-start justify-between gap-2">
                    <span className="font-display text-2xl font-bold leading-tight">{s.scaffold_number}</span>
                    <StatusPill s={s} />
                  </span>
                  <span className="mt-1 line-clamp-2 font-semibold text-steel-800">{s.location}</span>
                  <span className="mt-1 text-xs text-steel-500">{[projName(s.project_id), typeLabel(s), DUTY_CLASS[s.duty_class], s.max_load_kg ? `${s.max_load_kg} kg/bay` : null].filter(Boolean).join(' · ')}</span>
                  {s.status === 'restricted' && s.restriction && <span className="mt-2 text-sm font-semibold text-amber-800">{s.restriction}</span>}
                  <span className={clsx('mt-2 text-sm font-semibold', live === 'overdue' ? 'text-red-700' : dueSoon(s) ? 'text-amber-700' : 'text-steel-600')}>{dueText(s)}</span>
                  <span className="mt-auto flex flex-wrap gap-2 pt-2">
                    {defects > 0 && <Badge color="orange">{defects} open defect{defects === 1 ? '' : 's'}</Badge>}
                    {pending(s.id) > 0 && <Badge color="blue"><CloudUpload className="mr-1 inline h-3.5 w-3.5" />Inspection waiting to sync</Badge>}
                  </span>
                  <ArrowRight className="absolute bottom-4 right-4 h-5 w-5 text-steel-300" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {adding && (
        <ScaffoldFormModal initial={{ project_id: projectId || (data.projects.filter((p) => p.is_active).length === 1 ? data.projects[0]!.id : undefined), photos: [] }}
          projects={data.projects} people={data.people} onClose={() => { setAdding(false); if (params.get('new')) setParams({}, { replace: true }); }}
          onSaved={(s) => { setAdding(false); nav(`/scaffolds/${s.id}`); }} />
      )}
      {closing && <CloseDefectModal d={closing} onClose={() => setClosing(null)} onSaved={() => { setClosing(null); void reload(); }} />}
    </div>
  );
}
