import { Lock } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '../../contexts/ToastContext';
import { api } from '../../lib/api';
import type { JobRole, JobRoleRate, Organization, OrgType } from '../../lib/types';
import { errMsg } from '../../lib/useAsync';
import { Button, Checkbox, ErrorBanner, Field, Input, Modal, Textarea, Toggle } from '../ui';

// ---------------------------------------------------------------------------
export function CompanyModal({ initial, onClose, onSaved }: { initial: Partial<Organization>; onClose: () => void; onSaved: () => void }) {
  const [o, setO] = useState<Partial<Organization>>({ type: 'contractor', is_active: true, ...initial });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const set = <K extends keyof Organization>(k: K, v: Organization[K]) => setO((x) => ({ ...x, [k]: v }));
  const save = async () => {
    if (!o.name?.trim()) return setError('Company name is required');
    setBusy(true);
    try {
      await api.saveOrganization(o);
      toast(o.id ? 'Company updated' : 'Contractor company added');
      onSaved();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={o.id ? 'Edit company' : 'Add contractor company'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
      <div className="space-y-4">
        {error && <ErrorBanner message={error} />}
        <Field label="Company name" required><Input value={o.name ?? ''} onChange={(e) => set('name', e.target.value)} autoFocus /></Field>
        <Field label="ABN"><Input value={o.abn ?? ''} onChange={(e) => set('abn', e.target.value)} inputMode="numeric" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact name"><Input value={o.contact_name ?? ''} onChange={(e) => set('contact_name', e.target.value)} /></Field>
          <Field label="Contact phone"><Input type="tel" value={o.contact_phone ?? ''} onChange={(e) => set('contact_phone', e.target.value)} /></Field>
        </div>
        <Field label="Contact email"><Input type="email" value={o.contact_email ?? ''} onChange={(e) => set('contact_email', e.target.value)} /></Field>
        <Field label="Notes"><Textarea value={o.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
        {o.type === 'contractor' && (
          <div className="flex items-center justify-between rounded-xl border-2 border-steel-200 p-3">
            <div><p className="font-bold">Active</p><p className="text-xs text-steel-500">Inactive companies can't be assigned to new users or projects.</p></div>
            <Toggle checked={!!o.is_active} onChange={(v) => set('is_active', v)} label="Active" />
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
export function JobRoleModal({ initial, rate, onClose, onSaved }: { initial: Partial<JobRole>; rate?: JobRoleRate; onClose: () => void; onSaved: () => void }) {
  const [j, setJ] = useState<Partial<JobRole>>({ applies_to: ['internal', 'contractor'], is_active: true, ...initial });
  const [cost, setCost] = useState(rate?.cost_rate?.toString() ?? '');
  const [charge, setCharge] = useState(rate?.charge_rate?.toString() ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const toggleApplies = (t: OrgType, v: boolean) => setJ((x) => ({ ...x, applies_to: v ? [...(x.applies_to ?? []), t] : (x.applies_to ?? []).filter((y) => y !== t) }));
  const save = async () => {
    if (!j.name?.trim()) return setError('Name is required');
    setBusy(true);
    try {
      const saved = await api.saveJobRole({ ...j, name: j.name.trim() });
      await api.saveJobRoleRate({ job_role_id: saved.id, cost_rate: cost ? Number(cost) : null, charge_rate: charge ? Number(charge) : null, currency: 'AUD' });
      toast('Position saved');
      onSaved();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={j.id ? 'Edit position' : 'New position'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
      <div className="space-y-4">
        {error && <ErrorBanner message={error} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Position" required><Input value={j.name ?? ''} onChange={(e) => setJ({ ...j, name: e.target.value })} autoFocus /></Field>
          <Field label="Classification" hint="Award level, grade, etc."><Input value={j.classification ?? ''} onChange={(e) => setJ({ ...j, classification: e.target.value })} /></Field>
        </div>
        <div>
          <span className="label">Available to</span>
          <Checkbox label="Internal staff" checked={!!j.applies_to?.includes('internal')} onChange={(v) => toggleApplies('internal', v)} />
          <Checkbox label="Contractors" checked={!!j.applies_to?.includes('contractor')} onChange={(v) => toggleApplies('contractor', v)} />
        </div>
        <div className="rounded-xl border-2 border-amber-200 bg-amber-50/60 p-3">
          <p className="mb-3 flex items-center gap-2 text-sm font-bold text-amber-900"><Lock className="h-4 w-4" /> Commercial rates — visible to Leaders only</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Cost rate (AUD/hr)"><Input type="number" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
            <Field label="Charge-out rate (AUD/hr)"><Input type="number" inputMode="decimal" value={charge} onChange={(e) => setCharge(e.target.value)} /></Field>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-semibold">Active</span>
          <Toggle checked={!!j.is_active} onChange={(v) => setJ({ ...j, is_active: v })} label="Active" />
        </div>
      </div>
    </Modal>
  );
}

