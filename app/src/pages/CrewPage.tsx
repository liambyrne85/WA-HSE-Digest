import { Building2, ShieldCheck } from 'lucide-react';
import { Avatar, Badge, Card, PageHeader, Spinner } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import { daysUntil } from '../lib/labels';
import { useAsync } from '../lib/useAsync';

export default function CrewPage() {
  const { profile } = useAuth();
  const { data, loading } = useAsync(async () => {
    const [orgs, crew, jobRoles, tickets, projects] = await Promise.all([
      api.listOrganizations(), api.listProfiles(), api.listJobRoles(), api.listTickets(), api.listProjects(),
    ]);
    return { org: orgs.find((o) => o.id === profile?.organization_id), crew, jobRoles, tickets, projects };
  }, []);
  if (loading || !data) return <Spinner />;
  const { org, crew, jobRoles, tickets, projects } = data;

  return (
    <div>
      <PageHeader eyebrow="Contractor" title="My Company" subtitle="Your company details, crew and the projects you're engaged on." />
      <div className="mb-5 flex items-start gap-3 rounded-xl border-2 border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <ShieldCheck className="h-5 w-5 shrink-0" />
        <p>Everything you and your crew record is visible only to your company and the principal contractor's Leaders — never to other contractors.</p>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Company" className="lg:col-span-1">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100 text-amber-800"><Building2 className="h-6 w-6" /></span>
            <div><p className="text-lg font-bold">{org?.name}</p>{org?.abn && <p className="text-xs text-steel-500">ABN {org.abn}</p>}</div>
          </div>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between gap-2"><dt className="text-steel-500">Contact</dt><dd className="font-semibold">{org?.contact_name ?? '—'}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-steel-500">Phone</dt><dd className="font-semibold">{org?.contact_phone ?? '—'}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-steel-500">Engaged projects</dt><dd className="font-semibold">{projects.length}</dd></div>
          </dl>
          <p className="mt-4 text-xs text-steel-500">Need a crew member added? Ask your principal contractor's site Leader to send them an invitation.</p>
        </Card>
        <Card title={`Crew (${crew.length})`} padded={false} className="lg:col-span-2">
          <ul className="divide-y divide-steel-100">
            {crew.map((p) => {
              const mine = tickets.filter((t) => t.profile_id === p.id);
              const bad = mine.filter((t) => (daysUntil(t.expires_on) ?? 999) <= 30).length;
              return (
                <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                  <Avatar name={p.full_name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{p.full_name}{p.id === profile?.id && <span className="ml-1 text-xs text-steel-400">(you)</span>}</p>
                    <p className="truncate text-sm text-steel-500">{jobRoles.find((j) => j.id === p.job_role_id)?.name ?? 'No job role'}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-xs font-semibold text-steel-500">{mine.length} ticket{mine.length === 1 ? '' : 's'}</span>
                    {bad > 0 && <Badge color="red">{bad} need attention</Badge>}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </div>
  );
}
