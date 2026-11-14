import { clsx } from 'clsx';
import { AlertTriangle, ArrowRight, ClipboardList, GraduationCap, MapPin, Truck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ActionRow } from '../components/actions/ActionsPanel';
import { SafetyDashboard } from '../components/dashboard/SafetyDashboard';
import { quickActionsFor } from '../components/layout/quickActions';
import { Badge, Card, StatCard } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import { PROJECT_STATUS, addDays, daysUntil, perthToday, formatDate, ticketState } from '../lib/labels';
import { useAsync } from '../lib/useAsync';
import { StatusBadge } from './ModulePage';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function DashboardPage() {
  const { profile, role, isLeader, isProjectLead, isWorker, isContractor } = useAuth();
  const isLead = isProjectLead;

  const { data } = useAsync(async () => {
    const [projects, tickets, profiles, orgs, records, approvals, pipelines, actions, people] = await Promise.all([
      api.listProjects(),
      api.listTickets(),
      api.listProfiles(),
      api.listOrganizations(),
      // Workers only need their own recent records here; leaders use the safety dashboard.
      isWorker ? api.listRecords(undefined, { from: addDays(perthToday(), -60) }) : Promise.resolve([]),
      api.listMyPendingApprovals(),
      api.listPipelines(),
      api.listActions().catch(() => []),
      api.listDirectory().catch(() => []),
    ]);
    return { projects, tickets, profiles, orgs, records, approvals, pipelines, actions, people };
  }, []);

  const activeProjects = data?.projects.filter((p) => p.is_active && p.status === 'active') ?? [];
  const myTickets = data?.tickets.filter((t) => t.profile_id === profile?.id) ?? [];
  const relevantTickets = isLeader || isLead ? data?.tickets ?? [] : myTickets;
  const expiring = relevantTickets.filter((t) => { const d = daysUntil(t.expires_on); return d !== null && d <= 30; });
  const myOrg = data?.orgs.find((o) => o.id === profile?.organization_id);
  const actions = quickActionsFor(role!);
  const nameOf = (id: string) => data?.profiles.find((p) => p.id === id)?.full_name ?? 'You';
  const terminal = (m: string, st: string) => !!data?.pipelines.find((p) => p.module === m)?.statuses.find((s) => s.key === st)?.is_terminal;
  const records = data?.records ?? [];
  const mine = records.filter((r) => r.submitted_by === profile?.id);
  const statusesFor = (m: string) => data?.pipelines.find((p) => p.module === m)?.statuses;

  return (
    <div>
      {/* Hero */}
      <div className="mb-6 overflow-hidden rounded-2xl bg-brand-500 text-white">
        <div className="relative px-5 py-6 sm:px-7">
          <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
          <p className="text-xs font-bold uppercase tracking-widest text-hivis-400">
            {new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <h1 className="mt-1 text-3xl font-bold uppercase sm:text-4xl">
            {greeting()}, {profile?.full_name.split(' ')[0]}
          </h1>
          <p className="mt-1 text-sm text-white/85">
            {isLeader && 'Here\'s what needs your attention across all sites and contractors.'}
            {isLead && 'Here’s what’s happening on your projects.'}
            {isWorker && 'Log your records, check your licences and stay safe out there.'}
            {isContractor && <> Signed in for <span className="font-bold text-white">{myOrg?.name}</span>.</>}
          </p>
        </div>
      </div>

      {/* Quick actions */}
      <section aria-labelledby="qa" className="mb-7">
        <h2 id="qa" className="mb-3 text-xl font-bold uppercase text-steel-800">Quick actions</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {actions.map((a) => (
            <Link key={a.label} to={a.to}
              className={clsx('group flex min-h-[112px] flex-col justify-between rounded-xl p-4 shadow-card transition-transform active:scale-[0.98]', a.className)}>
              <a.icon className="h-8 w-8" />
              <span>
                <span className="block text-base font-bold leading-tight">{a.label}</span>
                <span className="mt-0.5 hidden text-xs opacity-80 sm:block">{a.description}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      {data && data.actions.some((a) => a.assignee_id === profile?.id && a.status === 'open') && (
        <Card className="mb-7" title="My actions" padded={false}
          actions={<Link to="/actions" className="flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">All <ArrowRight className="h-4 w-4" /></Link>}>
          <ul className="divide-y divide-steel-100">
            {data.actions.filter((a) => a.assignee_id === profile?.id && a.status === 'open').slice(0, 5).map((a) => <ActionRow key={a.id} a={a} people={data.people} showSource />)}
          </ul>
        </Card>
      )}

      {(isLeader || isLead) && <SafetyDashboard />}

      {/* Summary cards */}
      {isWorker && <section aria-labelledby="summary" className="mb-7">
        <h2 id="summary" className="mb-3 text-xl font-bold uppercase text-steel-800">At a glance</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {isWorker && <>
            <StatCard label="My open records" value={data ? mine.filter((r) => r.status !== 'draft' && !terminal(r.module, r.status)).length : '–'} tone="amber" icon={<ClipboardList className="h-5 w-5" />}
              hint={`${mine.filter((r) => r.status === 'draft').length} drafts · ${mine.filter((r) => ['rejected', 'returned'].includes(r.status)).length} returned`} />
            <StatCard label="My pre-starts today" value={data ? mine.filter((r) => r.module === 'plant_prestart' && r.record_date === perthToday()).length : '–'} tone="orange" icon={<Truck className="h-5 w-5" />} />
            <StatCard label="My tickets" value={myTickets.length} tone="green" icon={<GraduationCap className="h-5 w-5" />} hint={expiring.length ? `${expiring.length} expiring soon` : 'All current'} />
            <StatCard label="Active projects" value={activeProjects.length} tone="blue" icon={<MapPin className="h-5 w-5" />} />
          </>}
        </div>
      </section>}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={isLeader ? 'Active projects' : 'Your projects'} padded={false}
          actions={<Link to="/projects" className="flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">All <ArrowRight className="h-4 w-4" /></Link>}>
          <ul className="divide-y divide-steel-100">
            {activeProjects.slice(0, 5).map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-bold text-steel-900">{p.name}</p>
                  <p className="truncate text-xs text-steel-500">{[p.code, p.client_name, p.site_location].filter(Boolean).join(' · ')}</p>
                </div>
                <Badge color={PROJECT_STATUS[p.status].color}>{PROJECT_STATUS[p.status].label}</Badge>
              </li>
            ))}
            {data && !activeProjects.length && <li className="px-4 py-8 text-center text-sm text-steel-500">No active projects{isLeader ? '' : ' assigned to you yet'}.</li>}
          </ul>
        </Card>

        <Card title={isLeader ? 'Licences needing attention' : isLead ? 'Team licences needing attention' : 'My licences'} padded={false}
          actions={<Link to="/training" className="flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">Open <ArrowRight className="h-4 w-4" /></Link>}>
          <ul className="divide-y divide-steel-100">
            {(isLeader || isLead ? expiring : myTickets).slice(0, 6).map((t) => {
              const st = ticketState(t.expires_on);
              return (
                <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-steel-900">{t.ticket_type}</p>
                    <p className="truncate text-xs text-steel-500">
                      {(isLeader || isLead) && <>{nameOf(t.profile_id)} · </>}Expires {formatDate(t.expires_on)}
                    </p>
                  </div>
                  <Badge color={st.color}>{st.label}</Badge>
                </li>
              );
            })}
            {data && (isLeader || isLead ? expiring : myTickets).length === 0 && (
              <li className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-steel-500">
                {isLeader || isLead ? 'Nothing expiring in the next 30 days.' : <>No tickets recorded. <Link className="font-semibold text-brand-700" to="/training">Add one</Link></>}
              </li>
            )}
          </ul>
        </Card>
      </div>

      <Card className="mt-5" title={isLeader ? 'Waiting for your approval' : 'My recent records'} padded={false}
        actions={<Link to={isLeader ? '/approvals' : '/safety'} className="flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">{isLeader ? 'All' : 'Safety events'} <ArrowRight className="h-4 w-4" /></Link>}>
        <ul className="divide-y divide-steel-100">
          {(isLeader ? (data?.approvals ?? []).map((a) => a.record) : mine).slice(0, 6).map((r) => (
            <li key={r.id}>
              <Link to={`/records/${r.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-steel-50">
                <div className="min-w-0">
                  <p className="truncate font-bold text-steel-900"><span className="mr-2 font-mono text-xs text-brand-700">{r.reference}</span>{r.title}</p>
                  <p className="truncate text-xs text-steel-500">{data?.projects.find((p) => p.id === r.project_id)?.name ?? 'No project'} · {formatDate(r.submitted_at ?? r.created_at)}</p>
                </div>
                <StatusBadge status={r.status} statuses={statusesFor(r.module)} />
              </Link>
            </li>
          ))}
          {data && (isLeader ? data.approvals.length === 0 : mine.length === 0) && (
            <li className="px-4 py-8 text-center text-sm text-steel-500">{isLeader ? 'Nothing is waiting for you.' : 'Nothing logged yet — use the quick actions above.'}</li>
          )}
        </ul>
      </Card>

      {isLeader && data && data.profiles.some((p) => !p.is_active) && (
        <Link to="/people" className="mt-5 flex items-center gap-3 rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span className="flex-1 text-sm font-semibold">
            {data.profiles.filter((p) => !p.is_active).length} account(s) awaiting activation — review in People.
          </span>
          <ArrowRight className="h-5 w-5" />
        </Link>
      )}
    </div>
  );
}
