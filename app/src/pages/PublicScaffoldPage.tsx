import { clsx } from 'clsx';
import { AlertTriangle, Ban, CheckCircle2, Clock, Hammer, LogIn, PackageX, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { DUTY_CLASS, INSPECTION_TYPE, SCAFFOLD_STATUS, SCAFFOLD_TYPE, formatDate, formatDateTime } from '../lib/labels';
import type { PublicScaffoldResult, PublicScaffoldView, ScaffoldChecklist, ScaffoldInspection } from '../lib/types';
import { isNetworkError } from '../lib/offline/net';
import { errMsg } from '../lib/useAsync';
import { InspectionReport } from './scaffolds/ScaffoldInspectionPage';

export const AFTER_LOGIN_KEY = 'fieldops-after-login';

const BANNER: Record<PublicScaffoldView['scaffold']['live_status'], { text: string; cls: string; icon: typeof CheckCircle2 }> = {
  safe: { text: 'Safe for Use', cls: 'bg-emerald-600 text-white', icon: CheckCircle2 },
  restricted: { text: 'Restricted Use', cls: 'bg-amber-400 text-steel-900', icon: AlertTriangle },
  unsafe: { text: 'Unsafe – Do Not Use', cls: 'bg-red-600 text-white', icon: Ban },
  awaiting: { text: 'Unsafe – Do Not Use', cls: 'bg-red-600 text-white', icon: Hammer },
  overdue: { text: 'Inspection Overdue – Do Not Use', cls: 'bg-red-600 text-white', icon: Clock },
  dismantled: { text: 'Dismantled – Not in Service', cls: 'bg-steel-700 text-white', icon: PackageX },
};

/** What a scaff tag's QR code opens. Read-only, no sign-in (unless an Admin requires it), always live. */
export default function PublicScaffoldPage({ token }: { token: string }) {
  const [res, setRes] = useState<PublicScaffoldResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setRes(await api.getPublicScaffold(token)); setError(null); } catch (e) {
      setError(isNetworkError(e) ? "No coverage — can't check this scaffold's live status. Treat it as unsafe until you can." : errMsg(e));
    }
  }, [token]);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60000); // keep the status live while the page is open
    return () => clearInterval(t);
  }, [load]);

  if (!res && !error) return <div className="flex min-h-screen items-center justify-center bg-steel-100"><Spinner label="Checking scaffold status…" /></div>;
  if (!res) return <Shell><p className="rounded-xl bg-red-50 p-4 font-semibold text-red-800">{error} <Button size="sm" variant="secondary" onClick={load}>Try again</Button></p></Shell>;
  if (res.status === 'not_found') return <Shell><Card><p className="text-lg font-bold">This QR code isn't linked to a scaffold.</p><p className="mt-1 text-steel-600">Treat the scaffold as unsafe and check with the site supervisor.</p></Card></Shell>;
  if (res.status === 'login_required') {
    return (
      <Shell>
        <Card>
          <p className="text-lg font-bold">Sign in to see this scaffold's status</p>
          <p className="mt-1 text-steel-600">Your company requires a sign-in to view scaffold tags. Until you can check it, treat the scaffold as unsafe.</p>
          <Button size="lg" className="mt-4" icon={<LogIn className="h-5 w-5" />} onClick={() => {
            try { sessionStorage.setItem(AFTER_LOGIN_KEY, `/s/${token}`); } catch { /* ignore */ }
            window.location.assign(`${import.meta.env.BASE_URL}`);
          }}>Sign in</Button>
        </Card>
      </Shell>
    );
  }

  const v = res.view;
  const s = v.scaffold;
  const b = BANNER[s.live_status];
  const Icon = b.icon;
  const latest = v.latest;
  const checklist = latest ? ({ id: 'public', version: latest.checklist_version, sections: latest.sections, change_note: null, created_at: '' } as ScaffoldChecklist) : null;
  const inspection = latest ? ({ ...latest, items: latest.items, photos: latest.photos } as unknown as ScaffoldInspection) : null;

  return (
    <Shell company={v.company}>
      <div className={clsx('rounded-2xl px-5 py-6 text-center shadow-lg', b.cls)} role="status" aria-live="polite">
        <Icon className="mx-auto h-14 w-14" />
        <p className="mt-2 font-display text-4xl font-bold uppercase leading-none sm:text-5xl">{b.text}</p>
        {s.live_status === 'restricted' && s.restriction && <p className="mt-3 text-xl font-bold">{s.restriction}</p>}
        {s.live_status === 'overdue' && <p className="mt-3 text-lg font-semibold">Inspection was due {formatDate(s.next_inspection_due)}</p>}
        {s.live_status === 'awaiting' && <p className="mt-3 text-lg font-semibold">Not yet handed over — awaiting inspection</p>}
        {s.live_status === 'unsafe' && s.status_reason && <p className="mt-3 text-lg font-semibold">{s.status_reason}</p>}
        {s.live_status === 'dismantled' && s.dismantled_on && <p className="mt-3 text-lg font-semibold">Dismantled {formatDate(s.dismantled_on)}</p>}
      </div>

      <Card className="mt-4">
        <p className="font-display text-3xl font-bold">{s.scaffold_number}</p>
        <p className="mt-1 text-lg font-semibold text-steel-800">{s.location}</p>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <Item k="Project" v={s.project_code ? `${s.project_code} – ${s.project_name}` : s.project_name} />
          <Item k="Duty class" v={DUTY_CLASS[s.duty_class]} />
          <Item k="Max load per bay" v={s.max_load_kg != null ? `${s.max_load_kg} kg` : null} />
          <Item k="Type" v={s.scaffold_type === 'other' && s.scaffold_type_other ? s.scaffold_type_other : SCAFFOLD_TYPE[s.scaffold_type]} />
          <Item k="Height / lifts / bays" v={[s.height_m != null ? `${s.height_m} m` : null, s.lifts != null ? `${s.lifts} lifts` : null, s.bays != null ? `${s.bays} bays` : null].filter(Boolean).join(' · ') || null} />
          <Item k="Next inspection due" v={s.status === 'dismantled' ? '—' : s.next_inspection_due ? formatDate(s.next_inspection_due) : 'Before use'} />
        </dl>
        {s.open_defects > 0 && <p className="mt-3 rounded-lg bg-orange-50 px-3 py-2 text-sm font-semibold text-orange-900">{s.open_defects} defect{s.open_defects === 1 ? '' : 's'} still open</p>}
      </Card>

      {latest && checklist && inspection ? (
        <>
          <Card className="mt-4" title="Latest inspection">
            <div className="flex flex-wrap items-center gap-2">
              <Badge color={SCAFFOLD_STATUS[latest.outcome]!.color}>{SCAFFOLD_STATUS[latest.outcome]!.label}</Badge>
              <span className="text-sm text-steel-600">{latest.reference} · {INSPECTION_TYPE[latest.inspection_type]}</span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <Item k="Inspected by" v={`${latest.inspector_name ?? '—'}${latest.inspector_licence_class ? ` (${latest.inspector_licence_class} scaffolder)` : ''}`} />
              <Item k="Date and time" v={formatDateTime(latest.signed_at)} />
              <Item k="Next due" v={latest.next_due ? formatDate(latest.next_due) : 'Before use'} />
              <Item k="Items failed" v={String(latest.failed_count)} />
            </dl>
            {latest.restriction && <p className="mt-3 font-semibold text-amber-800">Restriction: {latest.restriction}</p>}
            {latest.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-steel-700">{latest.notes}</p>}
          </Card>
          <div className="mt-4"><InspectionReport ins={inspection} checklist={checklist} /></div>
        </>
      ) : <Card className="mt-4"><p className="text-steel-600">No inspection has been signed off for this scaffold yet.</p></Card>}

      {v.history.length > 0 && (
        <Card className="mt-4" title="Inspection history" padded={false}>
          <ul className="divide-y divide-steel-100">
            {v.history.map((h) => (
              <li key={h.reference} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="min-w-0"><span className="block font-semibold">{formatDateTime(h.signed_at)} · {INSPECTION_TYPE[h.inspection_type]}</span>
                  <span className="text-xs text-steel-500">{h.reference} · {h.inspector_name}{h.failed_count ? ` · ${h.failed_count} failed` : ''}</span></span>
                <Badge color={SCAFFOLD_STATUS[h.outcome]!.color}>{SCAFFOLD_STATUS[h.outcome]!.short}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mt-6 flex flex-col items-center gap-2 pb-8 text-center text-xs text-steel-500">
        <p>Live status checked {formatDateTime(v.as_of)} (Perth). This page always shows the current status — a printed tag can be out of date.</p>
        <button type="button" onClick={load} className="flex min-h-[44px] items-center gap-1.5 font-semibold text-brand-700"><RefreshCw className="h-4 w-4" />Refresh</button>
      </div>
    </Shell>
  );
}

function Shell({ children, company }: { children: React.ReactNode; company?: PublicScaffoldView['company'] }) {
  return (
    <div className="min-h-screen bg-steel-100">
      <header className="flex items-center gap-3 bg-steel-900 px-4 py-3 text-white">
        {company?.logo_url ? <img src={company.logo_url} alt="" className="h-9 w-auto rounded bg-white p-1" /> : null}
        <span className="font-display text-lg font-bold uppercase tracking-wide">{company?.name ?? 'Scaffold status'}</span>
        <span className="ml-auto text-xs font-semibold uppercase tracking-wider text-steel-300">Scaff tag</span>
      </header>
      <main className="mx-auto max-w-2xl px-4 pt-4">{children}</main>
    </div>
  );
}

const Item = ({ k, v }: { k: string; v: string | null | undefined }) => (
  <div><dt className="text-xs font-bold uppercase tracking-wider text-steel-500">{k}</dt><dd className="font-semibold text-steel-900">{v || '—'}</dd></div>
);
