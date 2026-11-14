import { Camera, FileText, Paperclip, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useToast } from '../../contexts/ToastContext';
import { api } from '../../lib/api';
import { blobToDataUrl, compressImage } from '../../lib/image';
import { StoredImage } from '../forms/AnswerView';

const MAX_FILE = 10 * 1024 * 1024;
export const isImageRef = (v: string) => v.startsWith('data:image') || /\.(jpe?g|png|webp|gif|heic)$/i.test(v);
const fileName = (v: string) => (v.startsWith('data:') ? (/^data:([^;,]+)/.exec(v)?.[1] === 'application/pdf' ? 'PDF document' : 'File') : decodeURIComponent(v.split('/').pop() ?? 'File'));

/** Photos (camera, compressed and time-stamped) or files such as PDFs, as evidence. */
export function EvidenceInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const toast = useToast();
  const cam = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const add = async (files: File[]) => {
    const out: string[] = [];
    for (const f of files) {
      if (f.type.startsWith('image/')) out.push(await blobToDataUrl(await compressImage(f, { stamp: true })));
      else if (f.size > MAX_FILE) toast(`${f.name} is over 10 MB`, 'error');
      else out.push(await blobToDataUrl(f));
    }
    onChange([...value, ...out]);
  };
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {value.map((v, i) => (
          <div key={i} className="relative h-24 w-24 overflow-hidden rounded-lg border-2 border-steel-200 bg-steel-50">
            {isImageRef(v) ? <img src={v} alt={`Evidence ${i + 1}`} className="h-full w-full object-cover" />
              : <span className="flex h-full flex-col items-center justify-center gap-1 p-1 text-center text-[11px] font-semibold text-steel-600"><FileText className="h-7 w-7" />{fileName(v)}</span>}
            <button type="button" aria-label="Remove" onClick={() => onChange(value.filter((_, j) => j !== i))}
              className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-steel-900/80 text-white"><X className="h-4 w-4" /></button>
          </div>
        ))}
        <button type="button" onClick={() => cam.current?.click()}
          className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-brand-400 bg-brand-50 text-xs font-bold uppercase text-brand-700">
          <Camera className="h-6 w-6" />Photo
        </button>
        <button type="button" onClick={() => file.current?.click()}
          className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-steel-300 text-xs font-bold uppercase text-steel-600">
          <Paperclip className="h-6 w-6" />File
        </button>
      </div>
      <input ref={cam} type="file" accept="image/*" capture="environment" multiple className="hidden" aria-label="Take photo"
        onChange={(e) => { void add(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
      <input ref={file} type="file" accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx" multiple className="hidden" aria-label="Attach file"
        onChange={(e) => { void add(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
    </div>
  );
}

function FileLink({ value }: { value: string }) {
  const [href, setHref] = useState<string | null>(value.startsWith('storage:') ? null : value);
  useEffect(() => { if (value.startsWith('storage:')) void api.fileUrl(value).then(setHref).catch(() => setHref(null)); }, [value]);
  return (
    <a href={href ?? undefined} target="_blank" rel="noreferrer" download={value.startsWith('data:') ? 'evidence' : undefined}
      className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-lg border-2 border-steel-200 bg-white p-1 text-center text-[11px] font-semibold text-brand-700 hover:bg-steel-50">
      <FileText className="h-7 w-7" />{fileName(value)}
    </a>
  );
}

export function EvidenceView({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((v, i) => (isImageRef(v) ? <StoredImage key={i} value={v} alt={`Evidence ${i + 1}`} className="h-24 w-24" /> : <FileLink key={i} value={v} />))}
    </div>
  );
}
