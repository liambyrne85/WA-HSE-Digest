import { Copy, ExternalLink, Printer, QrCode } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { useToast } from '../../contexts/ToastContext';
import { formatDateTime } from '../../lib/labels';
import { qrDataUrl } from '../../lib/printing/tag';
import type { DirectoryEntry, Scaffold, ScaffoldInspection, TagPrint } from '../../lib/types';
import { Button, Card } from '../ui';
import { qrUrlFor } from './PrintTag';

/** The scaffold's permanent QR code, tag printing and the print log. */
export function QrCard({ s, inspections, prints, people, onPrint }: {
  s: Scaffold; inspections: ScaffoldInspection[]; prints: TagPrint[]; people: DirectoryEntry[]; onPrint: () => void;
}) {
  const { settings } = useTheme();
  const toast = useToast();
  const url = qrUrlFor(s.qr_token, settings);
  const [img, setImg] = useState<string | null>(null);
  useEffect(() => { void qrDataUrl(url).then(setImg).catch(() => setImg(null)); }, [url]);
  const who = (id: string) => people.find((p) => p.id === id)?.full_name ?? 'Team member';
  return (
    <Card title={<span className="flex items-center gap-2"><QrCode className="h-5 w-5" />QR code &amp; tag</span>}>
      <div className="flex items-start gap-3">
        {img ? <img src={img} alt={`QR code for ${s.scaffold_number}`} className="h-28 w-28 shrink-0 rounded border border-steel-200" /> : <div className="h-28 w-28 shrink-0 animate-pulse rounded bg-steel-100" />}
        <div className="min-w-0 space-y-2">
          <p className="text-xs text-steel-500">Permanent link — anyone who scans it sees the live status{settings.qr_requires_login ? ' after signing in' : ''}.</p>
          <a href={url} target="_blank" rel="noreferrer" className="flex min-h-[40px] items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline"><ExternalLink className="h-4 w-4" />Open QR page</a>
          <button type="button" className="flex min-h-[40px] items-center gap-1.5 text-sm font-semibold text-brand-700"
            onClick={async () => { try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { toast(url); } }}><Copy className="h-4 w-4" />Copy link</button>
        </div>
      </div>
      <Button block size="lg" className="mt-3" icon={<Printer className="h-5 w-5" />} onClick={onPrint}>{prints.length ? 'Reprint tag' : 'Print tag'}</Button>
      {prints.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-xs font-bold uppercase tracking-wider text-steel-500">Printed</p>
          <ul className="max-h-48 space-y-1.5 overflow-y-auto text-xs text-steel-700">
            {prints.map((p) => (
              <li key={p.id}>{formatDateTime(p.printed_at)} · {who(p.printed_by)} · {inspections.find((i) => i.id === p.inspection_id)?.reference ?? 'no inspection'} · {p.label_size}{p.copies > 1 ? ` × ${p.copies}` : ''}</li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
