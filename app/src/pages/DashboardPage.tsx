import { clsx } from 'clsx';
import {
  AlertTriangle, ArrowRight, CheckSquare, ClipboardList, FileText, GraduationCap, HardHat, LayoutTemplate,
  MapPin, ShieldAlert, Truck, Users, Workflow,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { quickActionsFor } from '../components/layout/quickActions';
import { Badge, Card, StatCard } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import { PROJECT_STATUS, daysUntil, formatDate, ticketState } from '../lib/labels';
import { useAsync } from '../lib/useAsync';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function DashboardPage() {
  const { profile, role, isLeader, isContractor } = useAuth();

  const { data } = useAsync(async () => {
    const [projects, tickets, profiles, templates, rules, invitations, orgs] = await Promise.all([
      api.listProjects(),
      api.listTickets(),
      api.listProfiles(),
      api.listTemplates(),
      api.listRules(),
      api.listInvitations(),
      api.listOrganizations(),
    ]);
    return { projects, tickets, profiles, templates, rules, invitations, orgs };
  }, []);

  const activeProjects = data?.projects.filter((p) => p.is_active && p.status === 'active') ?? [];
  const myTickets = data?.tickets.filter((t) => t.profile_id === profile?.id) ?? [];
  const relevantTickets = isLeader || isContractor ? data?.tickets ?? [] : myTickets;
  const expiring = relevantTickets.filter((t) => { const d = daysUntil(t.expires_on); return d !== null && d <= 30; });
  const myOrg = data?.orgs.find((o) => o.id === profile?.organization_id);
  const actions = quickActionsFor(role!);
  const nameOf = (id: string) => data?.profiles.find((p) => p.id === id)?.full_name ?? 'You';

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
            {role === 'employee' && 'Log your records, check your tickets and stay safe out there.'}
            {isContractor && <>Signed in for <span className="font-bold text-white">{myOrg?.name}</span> — you only see your own company's data.</>}
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

      {/* Summary cards */}
      <section aria-labelledby="summary" className="mb-7">
        <h2 id="summary" className="mb-3 text-xl font-bold uppercase text-steel-800">At a glance</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {isLeader && <>
            <StatCard label="Open safety events" value="—" tone="red" icon={<ShieldAlert className="h-5 w-5" />} hint="Safety Events module · Phase 2" placeholder />
            <StatCard label="Pending approvals" value="—" tone="amber" icon={<CheckSquare className="h-5 w-5" />} hint="DFRs, hours & events · Phase 2" placeholder />
            <StatCard label="Active projects" value={activeProjects.length} tone="green" icon={<MapPin className="h-5 w-5" />} hint={`${data?.projects.length ?? 0} in register`} />
            <StatCard label="Tickets expiring ≤30d" value={expiring.length} tone={expiring.length ? 'amber' : 'green'} icon={<GraduationCap className="h-5 w-5" />} hint="Across all workers" />
            <StatCard label="Active users" value={data?.profiles.filter((p) => p.is_active).length ?? '–'} tone="blue" icon={<Users className="h-5 w-5" />}
              hint={`${data?.invitations.filter((i) => i.status === 'pending').length ?? 0} invitations pending`} />
            <StatCard label="Contractor companies" value={data?.orgs.filter((o) => o.type === 'contractor' && o.is_active).length ?? '–'} tone="orange" icon={<HardHat className="h-5 w-5" />} />
            <StatCard label="Published templates" value={data?.templates.filter((t) => t.status === 'published').length ?? '–'} tone="purple" icon={<LayoutTemplate className="h-5 w-5" />}
              hint={`${data?.templates.filter((t) => t.has_unpublished_changes).length ?? 0} with unpublished changes`} />
            <StatCard label="Active workflow rules" value={data?.rules.filter((r) => r.is_enabled).length ?? '–'} tone="slate" icon={<Workflow className="h-5 w-5" />} hint={`${data?.rules.length ?? 0} configured`} />
          </>}
          {role === 'employee' && <>
            <StatCard label="My open actions" value="—" tone="amber" icon={<ClipboardList className="h-5 w-5" />} hint="Corrective actions · Phase 2" placeholder />
            <StatCard label="My pre-starts today" value="—" tone="orange" icon={<Truck className="h-5 w-5" />} hint="Plant module · Phase 2" placeholder />
            <StatCard label="My tickets" value={myTickets.length} tone="green" icon={<GraduationCap className="h-5 w-5" />} hint={expiring.length ? `${expiring.length} expiring soon` : 'All current'} />
            <StatCard label="Active projects" value={activeProjects.length} tone="blue" icon={<MapPin className="h-5 w-5" />} />
          </>}
          {isContractor && <>
            <StatCard label="Crew members" value={data?.profiles.filter((p) => p.is_active).length ?? '–'} tone="blue" icon={<Users className="h-5 w-5" />} hint={myOrg?.name} />
            <StatCard label="Crew tickets expiring" value={expiring.length} tone={expiring.length ? 'red' : 'green'} icon={<GraduationCap className="h-5 w-5" />} hint="Expired or ≤30 days" />
            <StatCard label="DFRs this week" value="—" tone="orange" icon={<FileText className="h-5 w-5" />} hint="DFR module · Phase 2" placeholder />
            <StatCard label="Assigned projects" value={activeProjects.length} tone="green" icon={<MapPin className="h-5 w-5" />} />
          </>}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={isContractor ? 'Your sites' : 'Active projects'} padded={false}
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
            {data && !activeProjects.length && <li className="px-4 py-8 text-center text-sm text-steel-500">No active projects{isContractor ? ' assigned to your company yet' : ''}.</li>}
          </ul>
        </Card>

        <Card title={isLeader ? 'Tickets needing attention' : isContractor ? 'Crew tickets needing attention' : 'My tickets'} padded={false}
          actions={<Link to="/training" className="flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">Open <ArrowRight className="h-4 w-4" /></Link>}>
          <ul className="divide-y divide-steel-100">
            {(isLeader || isContractor ? expiring : myTickets).slice(0, 6).map((t) => {
              const st = ticketState(t.expires_on);
              return (
                <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-steel-900">{t.ticket_type}</p>
                    <p className="truncate text-xs text-steel-500">
                      {(isLeader || isContractor) && <>{nameOf(t.profile_id)} · </>}Expires {formatDate(t.expires_on)}
                    </p>
                  </div>
                  <Badge color={st.color}>{st.label}</Badge>
                </li>
              );
            })}
            {data && (isLeader || isContractor ? expiring : myTickets).length === 0 && (
              <li className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-steel-500">
                {isLeader || isContractor ? 'Nothing expiring in the next 30 days.' : <>No tickets recorded. <Link className="font-semibold text-brand-700" to="/training">Add one</Link></>}
              </li>
            )}
          </ul>
        </Card>
      </div>

      {isLeader && data && data.profiles.some((p) => !p.is_active) && (
        <Link to="/admin/users" className="mt-5 flex items-center gap-3 rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span className="flex-1 text-sm font-semibold">
            {data.profiles.filter((p) => !p.is_active).length} account(s) awaiting activation — review in Users & Contractors.
          </span>
          <ArrowRight className="h-5 w-5" />
        </Link>
      )}
    </div>
  );
}
