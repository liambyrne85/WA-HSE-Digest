import { clsx } from 'clsx';
import { AlertTriangle, ArrowRight, ClipboardList, Clock, Plus, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Badge, Button, EmptyState, ErrorBanner, Input, Modal, PageHeader, Select, Spinner } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import { MODULE_LABEL, TEMPLATE_CATEGORY, formatDate } from '../lib/labels';
import type { FormTemplate, PipelineStatus, RecordRow, WorkflowModule } from '../lib/types';
import { useAsync } from '../lib/useAsync';

const COPY: Partial<Record<WorkflowModule, string>> = {
  safety_event: 'Report incidents, near misses and hazards. High-severity events are escalated automatically.',
  daily_field_report: 'Shift reports: crew, hours, plant, progress and issues. Submitted reports go to a Leader for approval.',
  timesheet: 'Hours worked by each person, approved by a Leader before payroll.',
  plant_prestart: 'Operators check plant before use. A failed critical item reports a defect and alerts Leaders.',
  risk_assessment: 'Take 5 / step-back assessments before starting a task.',
  audit: 'Site inspections scored against your checklists.',
  field_leadership: 'Toolbox talks, safety walks, critical control checks and other field leadership. Counts towards your target on the dashboard.',
};

export const NOUN: Partial<Record<WorkflowModule, string>> = {
  safety_event: 'safety event', daily_field_report: 'daily field report', timesheet: 'timesheet',
  plant_prestart: 'pre-start', risk_assessment: 'risk assessment', audit: 'audit', field_leadership: 'field leadership activity',
};

export function StatusBadge({ status, statuses }: { status: string; statuses?: PipelineStatus[] }) {
  if (status === 'draft') return <Badge color="slate">Draft</Badge>;
  const s = statuses?.find((x) => x.key === status);
  return <Badge color={s?.color ?? 'slate'}>{s?.label ?? status.replace(/_/g, ' ')}</Badge>;
}

export function RecordChips({ r }: { r: RecordRow }) {
  const crit = Number(r.summary?.critical_failures) || 0;
  const sev = r.summary?.severity as string | undefined;
  const hours = r.summary?.total_hours as number | undefined;
  return (
    <>
      {crit > 0 && <span className="inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-xs font-bold text-red-800"><AlertTriangle className="h-3.5 w-3.5" />{crit} critical</span>}
      {sev && <span className={clsx('rounded px-1.5 py-0.5 text-xs font-bold', /high|critical/i.test(sev) ? 'bg-red-100 text-red-800' : 'bg-steel-100 text-steel-700')}>{sev}</span>}
      {hours !== undefined && <span className="inline-flex items-center gap-1 rounded bg-steel-100 px-1.5 py-0.5 text-xs font-bold text-steel-700"><Clock className="h-3.5 w-3.5" />{Math.round(Number(hours) * 100) / 100} h</span>}
    </>
  );
}

type Filter = 'open' | 'all' | 'draft' | string;

export default function ModulePage({ module }: { module: WorkflowModule }) {
  const { profile, isLeader } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const by = params.get('by') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const [filter, setFilter] = useState<Filter>(by || from ? 'all' : 'open');
  const [mine, setMine] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [q, setQ] = useState('');
  const [picking, setPicking] = useState(false);

  const { data, loading, error, reload } = useAsync(async () => {
    const [pipelines, templates, records, projects, people] = await Promise.all([
      api.listPipelines(), api.listTemplates(), api.listRecords(module), api.listProjects(), api.listDirectory(),
    ]);
    return {
      statuses: pipelines.find((p) => p.module === module)?.statuses ?? [],
      templates: templates.filter((t) => t.status === 'published' && t.category === module && t.current_version_id),
      records, projects, people,
    };
  }, [module]);

  const start = (t: FormTemplate) => nav(`/records/new?template=${t.id}`);
  const startNew = () => {
    if (!data) return;
    if (data.templates.length === 1) start(data.templates[0]!);
    else setPicking(true);
  };

  useEffect(() => {
    if (params.get('new') === '1' && data) {
      params.delete('new');
      setParams(params, { replace: true });
      startNew();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const terminal = new Set(data?.statuses.filter((s) => s.is_terminal).map((s) => s.key));
  const shown = useMemo(() => (data?.records ?? []).filter((r) => {
    if (filter === 'open' && (terminal.has(r.status))) return false;
    if (filter !== 'open' && filter !== 'all' && r.status !== filter) return false;
    if (mine && r.submitted_by !== profile?.id) return false;
    if (projectId && r.project_id !== projectId) return false;
    if (by && r.submitted_by !== by) return false;
    if (from && (r.record_date ?? '') < from) return false;
    if (to && (r.record_date ?? '') > to) return false;
    const s = q.trim().toLowerCase();
    return !s || [r.reference, r.title, JSON.stringify(r.summary)].some((x) => x?.toLowerCase().includes(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [data, filter, mine, projectId, q, by, from, to]);

  const projectName = (id: string | null) => data?.projects.find((p) => p.id === id)?.name;
  const person = (id: string) => data?.people.find((p) => p.id === id)?.full_name ?? (id === profile?.id ? profile?.full_name : 'Team member');
  const count = (k: string) => (data?.records ?? []).filter((r) => r.status === k).length;
  const noun = NOUN[module] ?? 'record';

  return (
    <div>
      <PageHeader eyebrow="Field module" title={MODULE_LABEL[module]} subtitle={COPY[module]}
        actions={data?.templates.length ? <Button icon={<Plus className="h-5 w-5" />} onClick={startNew}>New {noun}</Button> : undefined} />

      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data ? <Spinner /> : data && (
        <>
          {!data.templates.length && (
            <div className="mb-5 rounded-xl border-2 border-dashed border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              There's no published {TEMPLATE_CATEGORY[module as keyof typeof TEMPLATE_CATEGORY]?.label.toLowerCase() ?? noun} form yet.
              {isLeader ? <> Create one in <Link className="font-bold underline" to="/admin/templates?new=1">Form Templates</Link>.</> : ' Ask a Leader to publish one.'}
            </div>
          )}

          {/* Status filter chips */}
          <div className="-mx-4 mb-3 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <div className="flex gap-2">
              {[
                { k: 'open', label: 'Open', n: data.records.filter((r) => !terminal.has(r.status)).length },
                ...data.statuses.map((s) => ({ k: s.key, label: s.label, n: count(s.key) })),
                ...(data.statuses.some((s) => s.key === 'draft') ? [] : [{ k: 'draft', label: 'Drafts', n: count('draft') }]),
                { k: 'all', label: 'All', n: data.records.length },
              ].map((c) => (
                <button key={c.k} onClick={() => setFilter(c.k)} aria-pressed={filter === c.k}
                  className={clsx('flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border-2 px-3.5 text-sm font-semibold',
                    filter === c.k ? 'border-steel-900 bg-steel-900 text-white' : 'border-steel-200 bg-white text-steel-700 hover:border-steel-300')}>
                  {c.label}<span className={clsx('rounded-full px-1.5 text-xs', filter === c.k ? 'bg-white/20' : 'bg-steel-100')}>{c.n}</span>
                </button>
              ))}
            </div>
          </div>
          {(by || from || to) && (
            <button type="button" onClick={() => { ['by', 'from', 'to'].forEach((k) => params.delete(k)); setParams(params, { replace: true }); }}
              className="mb-3 inline-flex min-h-[40px] items-center gap-2 rounded-full bg-brand-100 px-3.5 text-sm font-semibold text-brand-800">
              {[by && person(by), (from || to) && `${formatDate(from || null)} – ${formatDate(to || null)}`].filter(Boolean).join(' · ')}
              <X className="h-4 w-4" />
            </button>
          )}
          <div className="mb-4 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-steel-400" />
              <Input aria-label="Search records" className="pl-10" placeholder="Search reference or details" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Select aria-label="Project" className="sm:w-64" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">All projects</option>
              {data.projects.map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code} – ` : ''}{p.name}</option>)}
            </Select>
            <label className="flex min-h-[48px] items-center gap-2 rounded-lg border-2 border-steel-200 bg-white px-3 text-sm font-semibold">
              <input type="checkbox" className="h-5 w-5 accent-brand-500" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Mine only
            </label>
          </div>

          {shown.length === 0 ? (
            <EmptyState icon={<ClipboardList className="h-10 w-10" />} title={data.records.length ? 'Nothing matches' : `No ${noun}s yet`}
              body={data.records.length ? 'Try a different filter.' : undefined}
              action={!data.records.length && data.templates.length > 0 && <Button icon={<Plus className="h-5 w-5" />} onClick={startNew}>New {noun}</Button>} />
          ) : (
            <ul className="card divide-y divide-steel-100">
              {shown.map((r) => (
                <li key={r.id}>
                  <Link to={`/records/${r.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-steel-50">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-bold text-brand-700">{r.reference}</span>
                        <StatusBadge status={r.status} statuses={data.statuses} />
                        <RecordChips r={r} />
                      </div>
                      <p className="mt-1 truncate font-bold text-steel-900">{r.title}</p>
                      <p className="truncate text-xs text-steel-500">
                        {[projectName(r.project_id), person(r.submitted_by), formatDate(r.record_date ?? r.submitted_at ?? r.created_at)].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <ArrowRight className="h-5 w-5 shrink-0 text-steel-400" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <Modal open={picking} onClose={() => setPicking(false)} title={`New ${noun}`}>
        <p className="mb-3 text-sm text-steel-600">Choose a form:</p>
        <div className="space-y-2">
          {data?.templates.map((t) => (
            <button key={t.id} onClick={() => start(t)}
              className="flex min-h-[56px] w-full items-center justify-between gap-3 rounded-xl border-2 border-steel-200 bg-white px-4 py-2 text-left hover:border-brand-400 hover:bg-brand-50">
              <span><span className="block font-bold">{t.name}</span>{t.description && <span className="block text-xs text-steel-500">{t.description}</span>}</span>
              <ArrowRight className="h-5 w-5 text-steel-400" />
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}
