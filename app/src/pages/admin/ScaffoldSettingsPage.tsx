import { ArrowDown, ArrowUp, Plus, Printer, Rocket, Trash2 } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { LABEL_PRESETS, labelSizeFor } from '../../lib/printing/labels';
import { downloadTagPdf } from '../../lib/printing/printers';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, ErrorBanner, Field, Input, Modal, PageHeader, Select, Spinner, Toggle } from '../../components/ui';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useToast } from '../../contexts/ToastContext';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/labels';
import { LICENCE_CLASSES } from '../../lib/scaffoldLogic';
import type { AppSettings, ChecklistSection, LabelSizeKey, LicenceClass } from '../../lib/types';
import { errMsg, useAsync } from '../../lib/useAsync';

const slug = (t: string, taken: string[]) => {
  const base = t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'item';
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
};
const move = <T,>(a: T[], i: number, d: number) => { const b = [...a]; const [x] = b.splice(i, 1); b.splice(i + d, 0, x!); return b; };

/** Admin: scaffold inspection settings and the checklist template. Publishing makes a new
 *  version; inspections already signed keep the version they were done on. */
export default function ScaffoldSettingsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const theme = useTheme();
  const saveSetting = async (patch: Partial<AppSettings>) => {
    try { await api.saveSettings(patch); await Promise.all([theme.reload(), reload()]); toast('Saved'); } catch (err) { toast(errMsg(err), 'error'); }
  };
  const [sections, setSections] = useState<ChecklistSection[]>([]);
  const [dirty, setDirty] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [note, setNote] = useState('');
  const { data, loading, error, reload } = useAsync(async () => {
    const [settings, versions] = await Promise.all([api.getSettings(), api.listScaffoldChecklists()]);
    return { settings, versions };
  }, []);
  useEffect(() => { if (data?.versions[0]) { setSections(structuredClone(data.versions[0].sections)); setDirty(false); } }, [data]);

  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorBanner message={error ?? 'Could not load'} onRetry={reload} />;
  const current = data.versions[0];
  const allIds = sections.flatMap((s) => [s.id, ...s.items.map((i) => i.id)]);
  const update = (next: ChecklistSection[]) => { setSections(next); setDirty(true); };
  const setSection = (i: number, p: Partial<ChecklistSection>) => update(sections.map((s, j) => (j === i ? { ...s, ...p } : s)));

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="Settings" title="Scaffold Inspections" subtitle="Who can sign off inspections, and the checklist inspectors fill in." />

      <Card title="Sign-off" className="mb-5">
        <Field label="Minimum scaffolding licence to sign off an inspection"
          hint="People also need “Competent scaffold inspector” ticked on their profile, and a current (not expired) scaffolding licence.">
          <Select value={data.settings.scaffold_min_licence ?? 'Basic'} onChange={async (e) => {
            try { await api.saveSettings({ scaffold_min_licence: e.target.value as LicenceClass }); toast('Saved'); void reload(); } catch (err) { toast(errMsg(err), 'error'); }
          }}>
            {LICENCE_CLASSES.map((c) => <option key={c} value={c}>{c} or higher</option>)}
          </Select>
        </Field>
        <p className="text-sm text-steel-600">The periodic inspection interval (default 30 days) is set on each project in <b>Projects &amp; Sites</b>.</p>
      </Card>

      <Card title="QR pages and printed tags" className="mb-5">
        <div className="flex min-h-[48px] items-center gap-3">
          <Toggle checked={!!data.settings.qr_requires_login} onChange={(v) => void saveSetting({ qr_requires_login: v })} label="Require sign-in for QR pages" />
          <div>
            <p className="font-semibold">Require sign-in to view a scanned tag</p>
            <p className="text-sm text-steel-600">{data.settings.qr_requires_login ? 'Only people with an active login can see the QR page.' : 'Anyone who scans a tag can see its live status (no phone numbers, emails or licence numbers are shown).'}</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Tag label size" hint="Used by default when printing tags. The PDF is made at exactly this size.">
            <Select value={data.settings.tag_label_size ?? '100x150'} onChange={(e) => void saveSetting({ tag_label_size: e.target.value as LabelSizeKey })}>
              {Object.values(LABEL_PRESETS).map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
              <option value="custom">Custom size</option>
            </Select>
          </Field>
          {data.settings.tag_label_size === 'custom' && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Width (mm)"><Input type="number" inputMode="decimal" min={25} max={300} defaultValue={data.settings.tag_custom_width_mm ?? 100}
                onBlur={(e) => void saveSetting({ tag_custom_width_mm: Number(e.target.value) || null })} /></Field>
              <Field label="Height (mm)"><Input type="number" inputMode="decimal" min={25} max={400} defaultValue={data.settings.tag_custom_height_mm ?? 150}
                onBlur={(e) => void saveSetting({ tag_custom_height_mm: Number(e.target.value) || null })} /></Field>
            </div>
          )}
        </div>
        <Button variant="secondary" className="mt-3" icon={<Printer className="h-4 w-4" />} onClick={async () => {
          const size = labelSizeFor(data.settings);
          await downloadTagPdf({ size, copies: 1, tag: {
            company: data.settings.company_name, scaffoldNumber: 'SCF-TEST-0001', project: 'Test project', location: 'Test tag — check the size and QR scan',
            status: 'restricted', restriction: 'Light duty only, max 2 persons', dutyClass: 'Light duty', maxLoad: '225 kg',
            inspectedBy: 'Test Inspector (Intermediate)', inspectedAt: '01/01/2027 07:30', nextDue: '31/01/2027', qrUrl: `${window.location.origin}${import.meta.env.BASE_URL}`,
          } }, `test-tag-${size.key}.pdf`);
        }}>Download a test tag</Button>
      </Card>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-bold uppercase text-steel-800">Checklist {current && <Badge color="slate" dot={false}>v{current.version} in use</Badge>}</h2>
        <div className="flex gap-2">
          {dirty && <Button variant="secondary" onClick={() => { setSections(structuredClone(current!.sections)); setDirty(false); }}>Undo changes</Button>}
          <Button icon={<Rocket className="h-5 w-5" />} disabled={!dirty} onClick={() => { setNote(''); setPublishing(true); }}>Publish v{(current?.version ?? 0) + 1}</Button>
        </div>
      </div>

      <div className="space-y-4">
        {sections.map((sec, i) => (
          <Card key={sec.id} padded={false}>
            <div className="flex items-center gap-2 border-b border-steel-100 p-3">
              <Input aria-label="Section title" className="font-bold" value={sec.title} onChange={(e) => setSection(i, { title: e.target.value })} />
              <IconBtn label="Move section up" disabled={i === 0} onClick={() => update(move(sections, i, -1))}><ArrowUp className="h-4 w-4" /></IconBtn>
              <IconBtn label="Move section down" disabled={i === sections.length - 1} onClick={() => update(move(sections, i, 1))}><ArrowDown className="h-4 w-4" /></IconBtn>
              <IconBtn label="Delete section" onClick={async () => {
                if (await confirm({ title: 'Remove section', message: `Remove “${sec.title}” and its ${sec.items.length} items from the next version?`, confirmLabel: 'Remove', danger: true })) update(sections.filter((_, j) => j !== i));
              }}><Trash2 className="h-4 w-4 text-red-600" /></IconBtn>
            </div>
            <ul className="divide-y divide-steel-100">
              {sec.items.map((it, k) => (
                <li key={it.id} className="flex items-center gap-2 px-3 py-2">
                  <Input aria-label="Checklist item" value={it.label} onChange={(e) => setSection(i, { items: sec.items.map((x, j) => (j === k ? { ...x, label: e.target.value } : x)) })} />
                  <IconBtn label="Move item up" disabled={k === 0} onClick={() => setSection(i, { items: move(sec.items, k, -1) })}><ArrowUp className="h-4 w-4" /></IconBtn>
                  <IconBtn label="Move item down" disabled={k === sec.items.length - 1} onClick={() => setSection(i, { items: move(sec.items, k, 1) })}><ArrowDown className="h-4 w-4" /></IconBtn>
                  <IconBtn label="Remove item" onClick={() => setSection(i, { items: sec.items.filter((_, j) => j !== k) })}><Trash2 className="h-4 w-4 text-red-600" /></IconBtn>
                </li>
              ))}
            </ul>
            <div className="p-3">
              <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />}
                onClick={() => setSection(i, { items: [...sec.items, { id: slug(`${sec.id}-item`, allIds), label: 'New item' }] })}>Add item</Button>
            </div>
          </Card>
        ))}
        <Button variant="secondary" icon={<Plus className="h-5 w-5" />} onClick={() => update([...sections, { id: slug('section', allIds), title: 'New section', items: [{ id: slug('new-item', allIds), label: 'New item' }] }])}>Add section</Button>
      </div>

      <Card title="Versions" className="mt-6" padded={false}>
        <ul className="divide-y divide-steel-100">
          {data.versions.map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
              <span><b>v{v.version}</b> · {v.sections.reduce((n, s) => n + s.items.length, 0)} items{v.change_note ? ` · ${v.change_note}` : ''}</span>
              <span className="text-xs text-steel-500">{formatDateTime(v.created_at)}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Modal open={publishing} onClose={() => setPublishing(false)} title={`Publish checklist v${(current?.version ?? 0) + 1}`}
        footer={<><Button variant="secondary" onClick={() => setPublishing(false)}>Cancel</Button>
          <Button onClick={async () => {
            const clean = sections.map((s) => ({ ...s, title: s.title.trim(), items: s.items.map((i) => ({ ...i, label: i.label.trim() })).filter((i) => i.label) })).filter((s) => s.title);
            if (clean.some((s) => !s.items.length)) { toast('Every section needs at least one item', 'error'); return; }
            try { await api.publishScaffoldChecklist(clean, note.trim() || undefined); toast('Checklist published'); setPublishing(false); void reload(); }
            catch (e) { toast(errMsg(e), 'error'); }
          }}>Publish</Button></>}>
        <p className="mb-3 text-sm text-steel-600">New inspections use this version straight away. Inspections already signed keep the checklist they were done on.</p>
        <Field label="What changed (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Added edge protection check for hung scaffolds" /></Field>
      </Modal>
    </div>
  );
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border-2 border-steel-200 bg-white text-steel-600 hover:bg-steel-50 disabled:opacity-30">
      {children}
    </button>
  );
}
