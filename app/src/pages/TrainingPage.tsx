import { BadgeCheck, GraduationCap, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Avatar, Badge, Button, EmptyState, ErrorBanner, Field, Input, Modal, PageHeader, Select, Spinner, Tabs } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { api } from '../lib/api';
import { daysUntil, formatDate, ticketState } from '../lib/labels';
import type { Profile, WorkerTicket } from '../lib/types';
import { errMsg, useAsync } from '../lib/useAsync';

type Filter = 'all' | 'attention';

function TicketModal({ initial, workers, ticketTypes, onClose, onSaved }: {
  initial: Partial<WorkerTicket>; workers: Profile[]; ticketTypes: string[]; onClose: () => void; onSaved: () => void;
}) {
  const [t, setT] = useState<Partial<WorkerTicket>>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const set = <K extends keyof WorkerTicket>(k: K, v: WorkerTicket[K]) => setT((x) => ({ ...x, [k]: v }));
  const save = async () => {
    if (!t.profile_id) return setError('Choose a worker');
    if (!t.ticket_type?.trim()) return setError('Choose a ticket type');
    setBusy(true);
    try {
      await api.saveTicket({ ...t, issued_on: t.issued_on || null, expires_on: t.expires_on || null });
      toast('Ticket saved');
      onSaved();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={t.id ? 'Edit ticket' : 'Add ticket / licence'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
      <div className="space-y-4">
        {error && <ErrorBanner message={error} />}
        {workers.length > 1 && (
          <Field label="Worker" required>
            <Select value={t.profile_id ?? ''} onChange={(e) => set('profile_id', e.target.value)} disabled={!!t.id}>
              <option value="">Select…</option>
              {workers.map((w) => <option key={w.id} value={w.id}>{w.full_name}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Ticket type" required>
          <Select value={t.ticket_type ?? ''} onChange={(e) => set('ticket_type', e.target.value)}>
            <option value="">Select…</option>
            {[...new Set([...ticketTypes, ...(t.ticket_type ? [t.ticket_type] : [])])].map((x) => <option key={x} value={x}>{x}</option>)}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Licence / card number"><Input value={t.ticket_number ?? ''} onChange={(e) => set('ticket_number', e.target.value || null)} /></Field>
          <Field label="Issuer / RTO"><Input value={t.issuer ?? ''} onChange={(e) => set('issuer', e.target.value || null)} /></Field>
          <Field label="Issued"><Input type="date" value={t.issued_on ?? ''} onChange={(e) => set('issued_on', e.target.value)} /></Field>
          <Field label="Expires" hint="Leave blank if it doesn't expire"><Input type="date" value={t.expires_on ?? ''} onChange={(e) => set('expires_on', e.target.value)} /></Field>
        </div>
        <p className="text-xs text-steel-500">Upload of card scans arrives with the Training module (Phase 2) — storage bucket and access policies are already in place.</p>
      </div>
    </Modal>
  );
}

export default function TrainingPage() {
  const { profile, isLeader, isContractor } = useAuth();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<Partial<WorkerTicket> | null>(null);
  const { data, loading, error, reload } = useAsync(async () => {
    const [tickets, profiles, types] = await Promise.all([api.listTickets(), api.listProfiles(), api.listLookupValues('ticket_types')]);
    return { tickets, profiles, types: types.filter((t) => t.is_active).map((t) => t.label) };
  }, []);

  const scope = isLeader ? 'all' : isContractor ? 'crew' : 'me';
  const workers = useMemo(() => (data?.profiles ?? []).filter((p) => p.is_active && (scope !== 'me' || p.id === profile?.id)), [data, scope, profile]);
  const tickets = (data?.tickets ?? []).filter((t) => filter === 'all' || (daysUntil(t.expires_on) ?? 999) <= 30);
  const attention = (data?.tickets ?? []).filter((t) => (daysUntil(t.expires_on) ?? 999) <= 30).length;
  const nameOf = (id: string) => data?.profiles.find((p) => p.id === id)?.full_name ?? 'Unknown';

  const grouped = useMemo(() => {
    const m = new Map<string, WorkerTicket[]>();
    tickets.forEach((t) => m.set(t.profile_id, [...(m.get(t.profile_id) ?? []), t]));
    return [...m.entries()].sort((a, b) => nameOf(a[0]).localeCompare(nameOf(b[0])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickets, data]);

  const del = async (t: WorkerTicket) => {
    if (!window.confirm(`Remove ${t.ticket_type}?`)) return;
    try { await api.deleteTicket(t.id); toast('Ticket removed'); void reload(); } catch (e) { toast(errMsg(e), 'error'); }
  };

  const title = scope === 'me' ? 'My Training' : scope === 'crew' ? 'Crew & Tickets' : 'Training & Tickets';
  const subtitle = scope === 'me' ? 'Your tickets, licences and inductions. Only you and Leaders can see these.'
    : scope === 'crew' ? "Your crew's tickets. Other companies can't see these." : 'Every worker\'s tickets across the internal team and contractors.';

  return (
    <div>
      <PageHeader eyebrow="Workforce" title={title} subtitle={subtitle}
        actions={<Button icon={<Plus className="h-5 w-5" />} onClick={() => setEditing({ profile_id: scope === 'me' ? profile!.id : undefined })}>Add ticket</Button>} />
      <Tabs value={filter} onChange={setFilter} tabs={[
        { key: 'all', label: 'All', count: data?.tickets.length },
        { key: 'attention', label: 'Expired / expiring', count: attention },
      ]} />
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data ? <Spinner /> : !tickets.length ? (
        <EmptyState icon={<GraduationCap className="h-10 w-10" />} title={filter === 'attention' ? 'Nothing needs attention' : 'No tickets recorded'}
          action={filter === 'all' && <Button onClick={() => setEditing({ profile_id: scope === 'me' ? profile!.id : undefined })}>Add ticket</Button>} />
      ) : (
        <div className="space-y-5">
          {grouped.map(([pid, list]) => (
            <section key={pid}>
              {scope !== 'me' && (
                <div className="mb-2 flex items-center gap-2"><Avatar name={nameOf(pid)} size="sm" /><h2 className="text-lg font-bold uppercase">{nameOf(pid)}</h2></div>
              )}
              <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {list.map((t) => {
                  const st = ticketState(t.expires_on);
                  return (
                    <li key={t.id} className={`card border-l-4 p-4 ${st.color === 'red' ? 'border-l-red-500' : st.color === 'amber' ? 'border-l-amber-500' : 'border-l-emerald-500'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-bold leading-snug">{t.ticket_type}</p>
                        <Badge color={st.color}>{st.label}</Badge>
                      </div>
                      <dl className="mt-2 grid grid-cols-2 gap-1 text-sm">
                        <dt className="text-steel-500">Number</dt><dd className="font-mono">{t.ticket_number ?? '—'}</dd>
                        <dt className="text-steel-500">Issuer</dt><dd>{t.issuer ?? '—'}</dd>
                        <dt className="text-steel-500">Expires</dt><dd className="font-semibold">{t.expires_on ? formatDate(t.expires_on) : 'Never'}</dd>
                      </dl>
                      <div className="mt-3 flex items-center gap-2 border-t border-steel-100 pt-3">
                        {t.verified_at ? <span className="flex items-center gap-1 text-xs font-bold uppercase text-emerald-700"><BadgeCheck className="h-4 w-4" />Verified</span>
                          : <span className="text-xs font-bold uppercase text-steel-400">Unverified</span>}
                        <Button className="ml-auto" size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(t)}>Edit</Button>
                        <Button size="sm" variant="ghost" aria-label="Remove" icon={<Trash2 className="h-4 w-4 text-red-600" />} onClick={() => del(t)} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
      {editing && data && <TicketModal initial={editing} workers={workers} ticketTypes={data.types}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
    </div>
  );
}
