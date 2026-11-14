import { clsx } from 'clsx';
import { AlertTriangle, Download, Printer } from 'lucide-react';
import { useState } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { useToast } from '../../contexts/ToastContext';
import { api } from '../../lib/api';
import { blobToDataUrl } from '../../lib/image';
import { DUTY_CLASS, formatDate, formatDateTime } from '../../lib/labels';
import { LABEL_PRESETS, labelSizeFor } from '../../lib/printing/labels';
import { PRINTERS, downloadTagPdf } from '../../lib/printing/printers';
import { TAG_STATUS_TEXT, type TagData } from '../../lib/printing/tag';
import { liveStatus } from '../../lib/scaffoldLogic';
import type { AppSettings, LabelSizeKey, Scaffold, ScaffoldInspection } from '../../lib/types';
import { errMsg } from '../../lib/useAsync';
import { Button, Field, Modal, Select } from '../ui';

/** The scaffold's permanent QR link (random token, never a sequential ID). */
export function qrUrlFor(token: string, settings: Pick<AppSettings, 'app_url'>) {
  // The public demo build has no page addresses of its own, so it opens ?s={token}.
  if (import.meta.env.VITE_MEMORY_ROUTER === '1') return `${window.location.origin}${import.meta.env.BASE_URL}?s=${token}`;
  const base = (api.mode === 'demo' ? '' : settings.app_url || '') || `${window.location.origin}${import.meta.env.BASE_URL}`;
  return `${base.replace(/\/$/, '')}/s/${token}`;
}

/** Company logo as a PNG/JPEG data URL for the PDF (SVGs are rasterised). */
async function loadLogo(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const blob = await (await fetch(url)).blob();
    if (!blob.type.includes('svg')) return await blobToDataUrl(blob);
    const src = URL.createObjectURL(blob);
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    const c = document.createElement('canvas');
    c.width = 600; c.height = Math.round(600 * (img.naturalHeight || 1) / (img.naturalWidth || 1));
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(src);
    return c.toDataURL('image/png');
  } catch { return null; }
}

export async function buildTag(s: Scaffold, ins: ScaffoldInspection | null, projectName: string, settings: AppSettings): Promise<TagData> {
  const live = liveStatus(s);
  return {
    company: settings.company_name,
    logo: await loadLogo(settings.logo_url),
    scaffoldNumber: s.scaffold_number ?? '',
    project: projectName,
    location: s.location,
    status: live,
    restriction: s.restriction,
    dutyClass: DUTY_CLASS[s.duty_class] ?? s.duty_class,
    maxLoad: s.max_load_kg != null ? `${s.max_load_kg} kg` : null,
    inspectedBy: ins ? `${ins.inspector_name ?? ''}${ins.inspector_licence_class ? ` (${ins.inspector_licence_class})` : ''}` : null,
    inspectedAt: ins ? formatDateTime(ins.signed_at) : null,
    nextDue: s.status === 'dismantled' ? null : s.next_inspection_due ? formatDate(s.next_inspection_due) : null,
    qrUrl: qrUrlFor(s.qr_token, settings),
  };
}

export function PrintTagModal({ scaffold, inspection, projectName, onClose, onPrinted }: {
  scaffold: Scaffold; inspection: ScaffoldInspection | null; projectName: string; onClose: () => void; onPrinted?: () => void;
}) {
  const { settings } = useTheme();
  const toast = useToast();
  const [sizeKey, setSizeKey] = useState<LabelSizeKey>(settings.tag_label_size ?? '100x150');
  const [copies, setCopies] = useState(1);
  const [printerId, setPrinterId] = useState(PRINTERS[0]!.id);
  const [busy, setBusy] = useState<'print' | 'pdf' | null>(null);
  const live = liveStatus(scaffold);
  const size = labelSizeFor(settings, sizeKey);
  const printer = PRINTERS.find((p) => p.id === printerId) ?? PRINTERS[0]!;

  const go = async (how: 'print' | 'pdf') => {
    setBusy(how);
    try {
      const tag = await buildTag(scaffold, inspection, projectName, settings);
      const job = { tag, size, copies };
      if (how === 'print') await printer.print(job);
      else await downloadTagPdf(job, `${scaffold.scaffold_number}-tag.pdf`);
      await api.recordTagPrint({ scaffold_id: scaffold.id, inspection_id: inspection?.id ?? null, label_size: size.label,
        method: printer.kind === 'direct' && how === 'print' ? 'direct' : 'pdf', printer: how === 'print' ? printer.name : 'Downloaded PDF', copies });
      toast(how === 'print' ? 'Tag sent to the print dialog' : 'Tag PDF downloaded');
      onPrinted?.();
      onClose();
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(null); }
  };

  return (
    <Modal open onClose={onClose} title={`Print tag · ${scaffold.scaffold_number}`}
      footer={<>
        <Button variant="secondary" icon={<Download className="h-4 w-4" />} loading={busy === 'pdf'} onClick={() => go('pdf')}>PDF</Button>
        <Button size="lg" icon={<Printer className="h-5 w-5" />} loading={busy === 'print'} onClick={() => go('print')}>Print</Button>
      </>}>
      <div className={clsx('mb-4 rounded-lg border-4 px-3 py-3 text-center font-display text-2xl font-bold uppercase',
        live === 'safe' ? 'border-steel-900' : live === 'restricted' ? 'border-double border-steel-900' : 'border-steel-900 bg-steel-900 text-white')}>
        {TAG_STATUS_TEXT[live]}
      </div>
      {!['safe', 'restricted'].includes(live) && (
        <p className="mb-3 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />This tag will say “{TAG_STATUS_TEXT[live]}”. Only hang it to keep people off the scaffold.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Label size">
          <Select value={sizeKey} onChange={(e) => setSizeKey(e.target.value as LabelSizeKey)}>
            {Object.values(LABEL_PRESETS).map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
            <option value="custom">{labelSizeFor(settings, 'custom').label}</option>
          </Select>
        </Field>
        <Field label="Printer">
          <Select value={printerId} onChange={(e) => setPrinterId(e.target.value)}>
            {PRINTERS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
      </div>
      <div className="mt-3">
        <span className="label">Copies</span>
        <div className="grid grid-cols-4 gap-2">
          {[1, 2, 3, 4].map((n) => (
            <button key={n} type="button" aria-pressed={copies === n} onClick={() => setCopies(n)}
              className={clsx('min-h-[48px] rounded-lg border-2 font-bold', copies === n ? 'border-steel-900 bg-steel-900 text-white' : 'border-steel-200 bg-white text-steel-700')}>{n}</button>
          ))}
        </div>
      </div>
      <p className="mt-3 text-xs text-steel-500">
        {inspection ? `Shows ${inspection.reference} by ${inspection.inspector_name}, ${formatDateTime(inspection.signed_at)}. ` : 'No inspection yet. '}
        The QR code always opens the live status, so an old tag can't show a scaffold as safe when it isn't. Every print is recorded.
      </p>
    </Modal>
  );
}
