import { CheckCircle2, ListChecks, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ActionRow, isOverdue } from '../components/actions/ActionsPanel';
import { EmptyState, ErrorBanner, Input, PageHeader, Select, Spinner, Tabs } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import { MODULE_LABEL } from '../lib/labels';
import { useAsync } from '../lib/useAsync';

type Tab = 'mine' | 'raised' | 'open' | 'overdue' | 'closed';
const SOURCE: Record<string, string> = { ...MODULE_LABEL, investigation: 'Investigations' };

/** Actions: assigned to me, raised by me, and (for leads) everything visible on their projects. */
export default function ActionsPage() {
  const { profile, isLeader, isProjectLead } = useAuth();
  const lead = isLeader || isProjectLead;
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'mine';
  const [q, setQ] = useState('');
  const [source, setSource] = useState('');
  const { data, loading, error, reload } = useAsync(async () => {
    const [actions, people] = await Promise.all([api.listActions(), api.listDirectory()]);
    return { actions, people };
  }, []);
  useEffect(() => api.subscribeChanges(() => { void reload(); }), [reload]);

  const me = profile?.id;
  const list = useMemo(() => (data?.actions ?? []).filter((a) => {
    if (tab === 'mine' && !(a.assignee_id === me && a.status === 'open')) return false;
    if (tab === 'raised' && a.raised_by !== me) return false;
    if (tab === 'open' && a.status !== 'open') return false;
    if (tab === 'overdue' && !isOverdue(a)) return false;
    if (tab === 'closed' && a.status === 'open') return false;
    if (source && a.source_module !== source) return false;
    const t = q.trim().toLowerCase();
    const who = data!.people.find((p) => p.id === a.assignee_id)?.full_name ?? '';
    return !t || [a.reference, a.title, a.source_reference, who].some((x) => x?.toLowerCase().includes(t));
  }).sort((a, b) => Number(isOverdue(b)) - Number(isOverdue(a)) || a.due_date.localeCompare(b.due_date)), [data, tab, q, source, me]);

  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorBanner message={error ?? 'Could not load actions'} onRetry={reload} />;
  const all = data.actions;
  const mine = all.filter((a) => a.assignee_id === me && a.status === 'open');

  return (
    <div>
      <PageHeader eyebrow="Follow-up" title="Actions"
        subtitle={`${mine.length} assigned to you${mine.filter(isOverdue).length ? ` · ${mine.filter(isOverdue).length} overdue` : ''}. Raise actions from incidents, audits, field leadership and investigations.`} />
      <Tabs value={tab} onChange={(k) => setParams(k === 'mine' ? {} : { tab: k }, { replace: true })} tabs={[
        { key: 'mine', label: 'My actions', count: mine.length },
        { key: 'raised', label: 'Raised by me', count: all.filter((a) => a.raised_by === me).length },
        ...(lead ? [{ key: 'open' as Tab, label: 'All open', count: all.filter((a) => a.status === 'open').length }] : []),
        { key: 'overdue', label: 'Overdue', count: all.filter(isOverdue).length },
        { key: 'closed', label: 'Closed', count: all.filter((a) => a.status !== 'open').length },
      ]} />
      <div className="my-4 grid gap-3 sm:grid-cols-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-steel-400" />
          <Input aria-label="Search actions" placeholder="Reference, action, person…" className="pl-10" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select aria-label="Raised from" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">Raised from anything</option>
          {['safety_event', 'audit', 'field_leadership', 'investigation'].map((k) => <option key={k} value={k}>{SOURCE[k]}</option>)}
        </Select>
      </div>
      {!list.length ? (
        <EmptyState icon={tab === 'mine' ? <CheckCircle2 className="h-10 w-10" /> : <ListChecks className="h-10 w-10" />}
          title={tab === 'mine' ? 'Nothing assigned to you' : 'No actions here'}
          body={tab === 'mine' ? 'Actions assigned to you show here with their due date.' : 'Open an incident, audit, field leadership record or investigation to raise one.'} />
      ) : (
        <ul className="card divide-y divide-steel-100 overflow-hidden">
          {list.map((a) => <ActionRow key={a.id} a={a} people={data.people} showSource />)}
        </ul>
      )}
    </div>
  );
}
