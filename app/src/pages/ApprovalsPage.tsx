import { clsx } from 'clsx';
import { ArrowRight, CheckSquare } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorBanner, PageHeader, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { MODULE_LABEL, ROLE_LABEL, formatDateTime } from '../lib/labels';
import { useAsync } from '../lib/useAsync';
import { RecordChips, StatusBadge } from './ModulePage';

export default function ApprovalsPage() {
  const { data, loading, error, reload } = useAsync(async () => {
    const [items, pipelines, projects] = await Promise.all([api.listMyPendingApprovals(), api.listPipelines(), api.listProjects()]);
    return { items, pipelines, projects };
  }, []);
  const now = Date.now();
  return (
    <div>
      <PageHeader eyebrow="Workflow" title="Approvals" subtitle="Records waiting for your decision, oldest due date first." />
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data ? <Spinner /> : !data?.items.length ? (
        <EmptyState icon={<CheckSquare className="h-10 w-10" />} title="All caught up" body="Nothing is waiting for your approval." />
      ) : (
        <ul className="card divide-y divide-steel-100">
          {data.items.map((a) => {
            const overdue = a.due_at && new Date(a.due_at).getTime() < now;
            const statuses = data.pipelines.find((p) => p.module === a.record.module)?.statuses;
            return (
              <li key={a.id}>
                <Link to={`/records/${a.record.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-steel-50">
                  <span className={clsx('h-10 w-1.5 shrink-0 rounded-full', overdue ? 'bg-red-500' : 'bg-amber-400')} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-brand-700">{a.record.reference}</span>
                      <StatusBadge status={a.record.status} statuses={statuses} />
                      <RecordChips r={a.record} />
                    </div>
                    <p className="mt-1 truncate font-bold">{a.record.title}</p>
                    <p className="truncate text-xs text-steel-500">
                      {MODULE_LABEL[a.record.module]} · {data.projects.find((p) => p.id === a.record.project_id)?.name ?? 'No project'} · Step {a.step} ({ROLE_LABEL[a.approver_role]})
                      {a.due_at && <span className={clsx(overdue && 'font-bold text-red-600')}> · {overdue ? 'Overdue since' : 'Due'} {formatDateTime(a.due_at)}</span>}
                    </p>
                  </div>
                  <ArrowRight className="h-5 w-5 shrink-0 text-steel-400" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
