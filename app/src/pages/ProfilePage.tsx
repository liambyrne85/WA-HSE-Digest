import { Lock, LogOut, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Avatar, Badge, Button, Card, ErrorBanner, Field, Input, PageHeader } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { api } from '../lib/api';
import { ROLE_COLOR, ROLE_DESCRIPTION, ROLE_LABEL } from '../lib/labels';
import type { Profile } from '../lib/types';
import { errMsg, useAsync } from '../lib/useAsync';

export default function ProfilePage() {
  const { profile, refreshProfile, signOut } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState<Partial<Profile>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data } = useAsync(() => Promise.all([api.listOrganizations(), api.listJobRoles()]), []);
  useEffect(() => { if (profile) setForm(profile); }, [profile]);
  if (!profile) return null;
  const org = data?.[0].find((o) => o.id === profile.organization_id);
  const job = data?.[1].find((j) => j.id === profile.job_role_id);
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.updateProfile(profile.id, {
        full_name: form.full_name?.trim() || profile.full_name,
        phone: form.phone || null,
        emergency_contact_name: form.emergency_contact_name || null,
        emergency_contact_phone: form.emergency_contact_phone || null,
      });
      await refreshProfile();
      toast('Profile updated');
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="Account" title="My Profile" />
      <div className="card mb-5 flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center">
        <Avatar name={profile.full_name} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-2xl font-bold">{profile.full_name}</p>
          <p className="text-steel-600">{profile.email}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge color={ROLE_COLOR[profile.role]}>{ROLE_LABEL[profile.role]}</Badge>
            {job && <Badge color="slate" dot={false}>{job.name}{job.classification ? ` · ${job.classification}` : ''}</Badge>}
          </div>
        </div>
      </div>

      <div className="grid gap-5">
        <Card title="Contact details">
          {error && <ErrorBanner message={error} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name"><Input value={form.full_name ?? ''} onChange={(e) => set('full_name', e.target.value)} /></Field>
            <Field label="Mobile"><Input type="tel" inputMode="tel" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field>
            <Field label="Emergency contact"><Input value={form.emergency_contact_name ?? ''} onChange={(e) => set('emergency_contact_name', e.target.value)} /></Field>
            <Field label="Emergency contact phone"><Input type="tel" inputMode="tel" value={form.emergency_contact_phone ?? ''} onChange={(e) => set('emergency_contact_phone', e.target.value)} /></Field>
          </div>
          <Button className="mt-4" icon={<Save className="h-5 w-5" />} loading={busy} onClick={save}>Save changes</Button>
        </Card>

        <Card title="Access">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-xs font-bold uppercase text-steel-500">Company</dt><dd className="font-semibold">{org?.name ?? '—'}</dd></div>
            <div><dt className="text-xs font-bold uppercase text-steel-500">Worker number</dt><dd className="font-semibold">{profile.employee_number ?? '—'}</dd></div>
            <div className="sm:col-span-2"><dt className="text-xs font-bold uppercase text-steel-500">What your role can do</dt><dd>{ROLE_DESCRIPTION[profile.role]}</dd></div>
          </dl>
          <p className="mt-4 flex items-center gap-2 rounded-lg bg-steel-50 p-3 text-xs text-steel-600">
            <Lock className="h-4 w-4 shrink-0" /> Role, company, job role and worker number are managed by Leaders and can't be changed here.
          </p>
        </Card>

        <Button variant="secondary" size="lg" icon={<LogOut className="h-5 w-5" />} onClick={() => void signOut()} className="lg:hidden">Sign out</Button>
      </div>
    </div>
  );
}
