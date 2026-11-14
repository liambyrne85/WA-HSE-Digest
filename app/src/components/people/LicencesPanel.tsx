import { BadgeCheck, Camera, Pencil, Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useToast } from '../../contexts/ToastContext';
import { api } from '../../lib/api';
import { compressImage } from '../../lib/image';
import { daysUntil, formatDate, ticketState } from '../../lib/labels';
import type { LookupValue, WorkerTicket } from '../../lib/types';
import { errMsg } from '../../lib/useAsync';
import { StoredImage } from '../forms/AnswerView';
import { Badge, Button, Card, ErrorBanner, Field, Input, Modal, Select } from '../ui';

export const isScaffoldLicence = (t: Pick<WorkerTicket, 'ticket_type'>) => /scaffold/i.test(t.ticket_type);

/** Current scaffolding HRW licence (not expired), if any. */
export function currentScaffoldLicence(tickets: WorkerTicket[]) {
  return tickets.find((t) => isScaffoldLicence(t) && !t.archived_at && (daysUntil(t.expires_on) ?? 0) >= 0);
}

function LicenceModal({ initial, types, onClose, onSaved }: {
  initial: Partial<WorkerTicket>; types: LookupValue[]; onClose: () => void; onSaved: () => void;
}) {
  const [t, setT] = useState<Partial<WorkerTicket>>(initial);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const set = <K extends keyof WorkerTicket>(k: K, v: WorkerTicket[K]) => setT((x) => ({ ...x, [k]: v }));
  const type = types.find((x) => x.label === t.ticket_type);
  const classes = (type?.metadata?.classes as string[] | undefined) ?? [];

  const save = async () => {
    if (!t.ticket_type) return setError('Choose the licence or ticket type');
    if (classes.length && !t.licence_class) return setError('Choose the class');
    setBusy(true);
    setError(null);
    try {
      let file_path = t.file_path ?? null;
      if (photo) file_path = await api.uploadPersonFile(t.profile_id!, photo, 'licence');
      await api.saveTicket({ ...t, file_path, issued_on: t.issued_on || null, expires_on: t.expires_on || null,
        licence_class: classes.length ? t.licence_class ?? null : t.licence_class || null });
      toast('Licence saved');
      onSaved();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={t.id ? 'Edit licence or ticket' : 'Add licence or ticket'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button size="lg" onClick={save} loading={busy}>Save</Button></>}>
      <div className="space-y-4">
        {error && <ErrorBanner message={error} />}
        <Field label="Type" required>
          <Select value={t.ticket_type ?? ''} onChange={(e) => setT({ ...t, ticket_type: e.target.value, licence_class: null })}>
            <option value="">Select…</option>
            {types.map((x) => <option key={x.id} value={x.label}>{x.label}</option>)}
            {t.ticket_type && !type && <option value={t.ticket_type}>{t.ticket_type}</option>}
          </Select>
        </Field>
        {classes.length > 0 && (
          <div>
            <span className="label">Class <span className="text-brand-600">*</span></span>
            <div className="grid grid-cols-3 gap-2">
              {classes.map((c) => (
                <button key={c} type="button" aria-pressed={t.licence_class === c} onClick={() => set('licence_class', c)}
                  className={`min-h-[52px] rounded-lg border-2 font-bold ${t.licence_class === c ? 'border-brand-500 bg-brand-500 text-white' : 'border-steel-200 bg-white text-steel-700'}`}>
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Licence / card number"><Input value={t.ticket_number ?? ''} onChange={(e) => set('ticket_number', e.target.value || null)} /></Field>
          <Field label="Issued by"><Input value={t.issuer ?? ''} onChange={(e) => set('issuer', e.target.value || null)} placeholder="e.g. WorkSafe WA" /></Field>
          <Field label="Issue date"><Input type="date" value={t.issued_on ?? ''} onChange={(e) => set('issued_on', e.target.value)} /></Field>
          <Field label="Expiry date" hint="Leave blank if it doesn't expire"><Input type="date" value={t.expires_on ?? ''} onChange={(e) => set('expires_on', e.target.value)} /></Field>
        </div>
        <div>
          <span className="label">Photo of the card</span>
          <div className="flex flex-wrap items-center gap-3">
            {photo ? <img src={URL.createObjectURL(photo)} alt="New licence photo" className="h-24 w-36 rounded-lg border-2 border-steel-200 object-cover" />
              : t.file_path ? <StoredImage value={t.file_path} alt="Licence photo" className="h-24 w-36" /> : null}
            <Button variant="secondary" size="lg" icon={<Camera className="h-5 w-5" />} onClick={() => fileRef.current?.click()}>
              {photo || t.file_path ? 'Retake photo' : 'Take photo'}
            </Button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) setPhoto(await compressImage(f, { maxDim: 1400 }));
            }} />
        </div>
      </div>
    </Modal>
  );
}

/** Licences & tickets for one person. canEdit = the person themselves, Admin or HSET. */
export function LicencesPanel({ profileId, tickets, types, canEdit, canVerify, onChanged }: {
  profileId: string; tickets: WorkerTicket[]; types: LookupValue[]; canEdit: boolean; canVerify: boolean; onChanged: () => void;
}) {
  const [editing, setEditing] = useState<Partial<WorkerTicket> | null>(null);
  const confirm = useConfirm();
  const toast = useToast();
  const list = tickets.filter((t) => t.profile_id === profileId && !t.archived_at)
    .sort((a, b) => Number(isScaffoldLicence(b)) - Number(isScaffoldLicence(a)) || (a.expires_on ?? '9999').localeCompare(b.expires_on ?? '9999'));
  const attention = list.filter((t) => (daysUntil(t.expires_on) ?? 999) <= 30).length;

  return (
    <Card title={`Licences & tickets${attention ? ` · ${attention} need attention` : ''}`} padded={false}
      actions={canEdit && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ profile_id: profileId })}>Add</Button>}>
      {!list.length && <p className="px-4 py-6 text-center text-sm text-steel-500">No licences or tickets recorded.</p>}
      <ul className="divide-y divide-steel-100">
        {list.map((t) => {
          const st = ticketState(t.expires_on);
          return (
            <li key={t.id} className={`flex gap-3 px-4 py-3 ${st.color === 'red' ? 'bg-red-50' : st.color === 'amber' ? 'bg-amber-50/60' : ''}`}>
              {t.file_path ? <StoredImage value={t.file_path} alt={`${t.ticket_type} card`} className="h-14 w-20 shrink-0" />
                : <span className="flex h-14 w-20 shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-steel-200 text-[10px] font-bold uppercase text-steel-400">No photo</span>}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-bold leading-snug">{t.ticket_type}{t.licence_class ? ` – ${t.licence_class}` : ''}</p>
                  <Badge color={st.color}>{st.label}</Badge>
                  {t.verified_at && <span className="inline-flex items-center gap-1 text-xs font-bold uppercase text-emerald-700"><BadgeCheck className="h-4 w-4" />Verified</span>}
                </div>
                <p className="text-sm text-steel-600">
                  {[t.ticket_number && `No. ${t.ticket_number}`, t.issuer, t.expires_on ? `Expires ${formatDate(t.expires_on)}` : 'No expiry'].filter(Boolean).join(' · ')}
                </p>
                {(canEdit || canVerify) && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {canEdit && <Button size="sm" variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(t)}>Edit</Button>}
                    {canVerify && !t.verified_at && (
                      <Button size="sm" variant="secondary" icon={<BadgeCheck className="h-4 w-4" />}
                        onClick={async () => {
                          try { await api.saveTicket({ id: t.id, profile_id: t.profile_id, verified_at: new Date().toISOString() }); toast('Marked as verified'); onChanged(); }
                          catch (e) { toast(errMsg(e), 'error'); }
                        }}>Verify</Button>
                    )}
                    {canEdit && (
                      <Button size="sm" variant="ghost"
                        onClick={async () => {
                          if (!(await confirm({ title: 'Archive licence', message: `Archive ${t.ticket_type}? It's kept in the history but no longer shown.`, confirmLabel: 'Archive' }))) return;
                          try { await api.archiveTicket(t.id); toast('Archived'); onChanged(); } catch (e) { toast(errMsg(e), 'error'); }
                        }}>Archive</Button>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {editing && <LicenceModal initial={editing} types={types.filter((x) => x.is_active)} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />}
    </Card>
  );
}
