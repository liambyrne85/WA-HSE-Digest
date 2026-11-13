import { ImagePlus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { BrandLockup } from '../../components/layout/BrandMark';
import { Badge, Button, Card, ErrorBanner, Field, Input, PageHeader } from '../../components/ui';
import { useTheme } from '../../contexts/ThemeContext';
import { useToast } from '../../contexts/ToastContext';
import { api } from '../../lib/api';
import { DEFAULT_SETTINGS, isHex } from '../../lib/theme';
import type { AppSettings } from '../../lib/types';
import { errMsg } from '../../lib/useAsync';

function ColourField({ label, hint, value, onChange }: { label: string; hint: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <Field label={label} hint={hint} error={isHex(text) ? null : 'Use a 6-digit hex colour, e.g. #2047C6'}>
      <div className="flex gap-2">
        <input type="color" aria-label={`${label} picker`} value={isHex(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)}
          className="h-12 w-14 shrink-0 cursor-pointer rounded-lg border-2 border-steel-200 bg-white p-1" />
        <Input value={text} className="font-mono uppercase" onChange={(e) => { setText(e.target.value); if (isHex(e.target.value)) onChange(e.target.value.toLowerCase()); }} />
      </div>
    </Field>
  );
}

export default function BrandingPage() {
  const { settings, reload, preview } = useTheme();
  const toast = useToast();
  const [form, setForm] = useState<AppSettings>(settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => setForm(settings), [settings]);
  // Live preview across the whole app while editing; restore on leave.
  useEffect(() => { preview(form); }, [form]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => preview(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = JSON.stringify(form) !== JSON.stringify(settings);
  const save = async () => {
    if (!form.company_name.trim()) return setError('Company name is required');
    setBusy(true);
    setError(null);
    try {
      await api.saveSettings({ ...form, company_name: form.company_name.trim() });
      await reload();
      toast('Branding saved for everyone');
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader eyebrow="Administration" title="Branding" subtitle="Your company name, colours and logo. Changes apply to everyone, including the sign-in page." />
      {error && <ErrorBanner message={error} />}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <Card title="Company">
            <Field label="Company name" required><Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} /></Field>
          </Card>
          <Card title="Colours">
            <div className="grid gap-4 sm:grid-cols-3">
              <ColourField label="Primary" hint="Buttons, links, active menu" value={form.primary_color} onChange={(v) => setForm({ ...form, primary_color: v })} />
              <ColourField label="Accent" hint="Highlights, quick-log button" value={form.accent_color} onChange={(v) => setForm({ ...form, accent_color: v })} />
              <ColourField label="Dark" hint="Sidebar, headings, text" value={form.dark_color} onChange={(v) => setForm({ ...form, dark_color: v })} />
            </div>
            <Button className="mt-4" size="sm" variant="ghost" icon={<RotateCcw className="h-4 w-4" />}
              onClick={() => setForm({ ...form, primary_color: DEFAULT_SETTINGS.primary_color, accent_color: DEFAULT_SETTINGS.accent_color, dark_color: DEFAULT_SETTINGS.dark_color })}>
              Reset to Access &amp; Site Services colours
            </Button>
          </Card>
          <Card title="Logo">
            <p className="mb-3 text-sm text-steel-600">Optional. Without a logo, the app shows the platform mark with your company name. PNG or SVG with a transparent background works best.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" icon={<ImagePlus className="h-5 w-5" />} onClick={() => fileRef.current?.click()} disabled={busy}>Upload logo</Button>
              {form.logo_url && <Button variant="ghost" className="!text-red-600" icon={<Trash2 className="h-4 w-4" />} onClick={() => setForm({ ...form, logo_url: null })}>Remove logo</Button>}
            </div>
            <input ref={fileRef} type="file" accept="image/png,image/svg+xml,image/jpeg,image/webp" className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                if (f.size > 2 * 1024 * 1024) return setError('Logo must be under 2 MB');
                setBusy(true);
                try { setForm({ ...form, logo_url: await api.uploadLogo(f) }); } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
              }} />
          </Card>
        </div>
        <div className="space-y-3 lg:sticky lg:top-24 lg:self-start">
          <p className="text-xs font-bold uppercase tracking-wider text-steel-500">Preview</p>
          <div className="rounded-xl bg-steel-900 p-4"><BrandLockup /></div>
          <div className="rounded-xl border border-steel-200 bg-white p-4"><BrandLockup dark={false} /></div>
          <div className="card space-y-3 p-4">
            <div className="flex flex-wrap gap-2"><Button size="sm">Primary</Button><Button size="sm" variant="dark">Dark</Button><Button size="sm" className="!bg-hivis-500 !text-steel-900">Accent</Button></div>
            <div className="flex flex-wrap gap-2"><Badge color="blue">Submitted</Badge><Badge color="green">Approved</Badge><Badge color="red">Defect</Badge></div>
          </div>
          <Button block size="lg" icon={<Save className="h-5 w-5" />} disabled={!dirty} loading={busy} onClick={save}>Save branding</Button>
          {dirty && <p className="text-center text-xs text-steel-500">You're previewing unsaved changes.</p>}
        </div>
      </div>
    </div>
  );
}
