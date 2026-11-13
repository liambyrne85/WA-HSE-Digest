import { clsx } from 'clsx';
import { AlertTriangle, Camera, Eraser, ImagePlus, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import type { LookupValue, Question, TableColumn, TemplateSchema } from '../../lib/types';
import { Button, Input, Select, Textarea } from '../ui';

export type Answers = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Signature pad (pointer events — works with finger, stylus and mouse)
// ---------------------------------------------------------------------------
export function SignaturePad({ value, onChange, disabled }: { value?: string; onChange: (dataUrl: string | undefined) => void; disabled?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(!!value);

  useEffect(() => {
    const c = ref.current!;
    const ratio = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = rect.width * ratio;
    c.height = rect.height * ratio;
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111419';
    if (value) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
      img.src = value;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <div>
      <div className={clsx('relative overflow-hidden rounded-lg border-2 border-dashed bg-white', hasInk ? 'border-steel-400' : 'border-steel-300')}>
        <canvas
          ref={ref}
          className="block h-40 w-full touch-none"
          aria-label="Signature pad"
          onPointerDown={(e) => {
            if (disabled) return;
            drawing.current = true;
            ref.current!.setPointerCapture(e.pointerId);
            const ctx = ref.current!.getContext('2d')!;
            const p = pos(e);
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const ctx = ref.current!.getContext('2d')!;
            const p = pos(e);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
          }}
          onPointerUp={() => {
            if (!drawing.current) return;
            drawing.current = false;
            setHasInk(true);
            onChange(ref.current!.toDataURL('image/png'));
          }}
        />
        {!hasInk && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-semibold uppercase tracking-wider text-steel-300">
            Sign here
          </span>
        )}
        <span className="pointer-events-none absolute inset-x-6 bottom-8 border-b border-steel-300" />
      </div>
      <div className="mt-2 flex justify-end">
        <Button size="sm" variant="ghost" icon={<Eraser className="h-4 w-4" />} disabled={disabled || !hasInk}
          onClick={() => {
            const c = ref.current!;
            c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
            setHasInk(false);
            onChange(undefined);
          }}>
          Clear
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Photo capture (opens rear camera on mobile). Preview-only in Phase 1;
// Phase 2 modules upload to the `form-uploads/{organization_id}/…` bucket.
// ---------------------------------------------------------------------------
function PhotoInput({ value, onChange, required }: { value?: string[]; onChange: (v: string[]) => void; required?: boolean }) {
  const photos = value ?? [];
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {photos.map((src, i) => (
          <div key={i} className="relative h-24 w-24 overflow-hidden rounded-lg border-2 border-steel-200">
            <img src={src} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
            <button type="button" aria-label="Remove photo" onClick={() => onChange(photos.filter((_, j) => j !== i))}
              className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-steel-900/80 text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
        <button type="button" onClick={() => inputRef.current?.click()}
          className={clsx('flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed text-xs font-bold uppercase',
            required && photos.length === 0 ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-steel-300 text-steel-500 hover:bg-steel-50')}>
          {photos.length ? <ImagePlus className="h-6 w-6" /> : <Camera className="h-6 w-6" />}
          {photos.length ? 'Add' : 'Photo'}
        </button>
      </div>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" multiple className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          Promise.all(files.map((f) => new Promise<string>((res) => {
            const r = new FileReader();
            r.onload = () => res(r.result as string);
            r.readAsDataURL(f);
          }))).then((urls) => onChange([...photos, ...urls]));
          e.target.value = '';
        }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Segmented choice buttons (Pass/Fail/NA, Yes/No) — large tap targets
// ---------------------------------------------------------------------------
function Choice({ options, value, onChange }: { options: { v: string; label: string; tone: string }[]; value?: string; onChange: (v: string) => void }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button key={o.v} type="button" aria-pressed={value === o.v} onClick={() => onChange(o.v)}
          className={clsx('min-h-[52px] rounded-lg border-2 text-base font-bold uppercase tracking-wide transition-colors',
            value === o.v ? o.tone : 'border-steel-200 bg-white text-steel-600 hover:border-steel-300')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const PFN = [
  { v: 'pass', label: 'Pass', tone: 'border-emerald-600 bg-emerald-600 text-white' },
  { v: 'fail', label: 'Fail', tone: 'border-red-600 bg-red-600 text-white' },
  { v: 'na', label: 'N/A', tone: 'border-steel-600 bg-steel-600 text-white' },
];
const YN = [
  { v: 'yes', label: 'Yes', tone: 'border-emerald-600 bg-emerald-600 text-white' },
  { v: 'no', label: 'No', tone: 'border-red-600 bg-red-600 text-white' },
];

// ---------------------------------------------------------------------------
// Table (repeating rows): crew, plant, timesheet lines
// ---------------------------------------------------------------------------
type Row = Record<string, string>;
function TableInput({ columns, value, onChange }: { columns: TableColumn[]; value?: Row[]; onChange: (v: Row[]) => void }) {
  const rows = value ?? [];
  const setCell = (i: number, col: string, v: string) => onChange(rows.map((r, j) => (j === i ? { ...r, [col]: v } : r)));
  const totals = columns.filter((c) => c.type === 'number').map((c) => ({
    c, sum: rows.reduce((n, r) => n + (Number(r[c.id]) || 0), 0),
  }));
  if (!columns.length) return <p className="text-sm text-steel-400">No columns set up for this table.</p>;
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex items-end gap-2 rounded-lg border-2 border-steel-200 bg-steel-50 p-2">
          <div className="grid flex-1 gap-2" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${columns.length > 2 ? 110 : 140}px, 1fr))` }}>
            {columns.map((c) => (
              <label key={c.id} className="block min-w-0">
                <span className="mb-0.5 block text-[11px] font-bold uppercase tracking-wide text-steel-500">{c.label}</span>
                <Input value={r[c.id] ?? ''} inputMode={c.type === 'number' ? 'decimal' : undefined} type={c.type === 'number' ? 'number' : 'text'}
                  onChange={(e) => setCell(i, c.id, e.target.value)} className="!py-2" />
              </label>
            ))}
          </div>
          <button type="button" aria-label={`Remove row ${i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-red-600 hover:bg-red-50">
            <Trash2 className="h-5 w-5" />
          </button>
        </div>
      ))}
      <Button variant="secondary" block icon={<Plus className="h-5 w-5" />} onClick={() => onChange([...rows, {}])}>Add row</Button>
      {rows.length > 0 && totals.length > 0 && (
        <p className="text-right text-sm font-semibold text-steel-700">
          {totals.map((t) => `Total ${t.c.label.toLowerCase()}: ${Math.round(t.sum * 100) / 100}`).join(' · ')}
        </p>
      )}
    </div>
  );
}

export function isNegative(q: Question, v: unknown) {
  return (q.type === 'pass_fail_na' && v === 'fail') || (q.type === 'yes_no' && v === 'no');
}

export function validateAnswers(schema: TemplateSchema, answers: Answers) {
  const errors: Record<string, string> = {};
  for (const s of schema.sections) {
    for (const q of s.questions) {
      const v = answers[q.id];
      const filledRows = q.type === 'table' && Array.isArray(v)
        ? (v as Row[]).filter((r) => Object.values(r ?? {}).some((x) => String(x ?? '').trim() !== '')) : null;
      const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0) || (filledRows !== null && filledRows.length === 0);
      if (q.required && empty) errors[q.id] = 'Required';
      if (q.type === 'number' && !empty) {
        const n = Number(v);
        if (Number.isNaN(n)) errors[q.id] = 'Must be a number';
        else if (q.min !== undefined && n < q.min) errors[q.id] = `Minimum ${q.min}`;
        else if (q.max !== undefined && n > q.max) errors[q.id] = `Maximum ${q.max}`;
      }
      if (q.photoOnFail && isNegative(q, v)) {
        const ph = answers[`${q.id}__photo`] as string[] | undefined;
        if (!ph?.length) errors[`${q.id}__photo`] = 'Photo required for a failed item';
      }
    }
  }
  return errors;
}

function useLookupOptions(schema: TemplateSchema) {
  const keys = useMemo(
    () => Array.from(new Set(schema.sections.flatMap((s) => s.questions).map((q) => q.lookupKey).filter(Boolean) as string[])),
    [schema],
  );
  const [values, setValues] = useState<LookupValue[]>([]);
  useEffect(() => {
    if (!keys.length) return;
    api.listLookupValues().then((v) => setValues(v.filter((x) => keys.includes(x.list_key) && x.is_active))).catch(() => undefined);
  }, [keys.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  return (key?: string) => values.filter((v) => v.list_key === key).map((v) => v.label);
}

export function QuestionInput({ q, answers, setAnswer, errors }: { q: Question; answers: Answers; setAnswer: (id: string, v: unknown) => void; errors: Record<string, string>; }) {
  const lookupOptions = useLookupOptions({ sections: [{ id: 'x', title: '', questions: [q] }] });
  const v = answers[q.id];
  const err = errors[q.id];
  const options = q.lookupKey ? lookupOptions(q.lookupKey) : q.options ?? [];

  return (
    <div className={clsx('rounded-xl border-2 bg-white p-4', err ? 'border-red-300' : 'border-steel-200', q.critical && isNegative(q, v) && 'border-red-500 bg-red-50/40')}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <label className="text-[15px] font-bold leading-snug text-steel-900" htmlFor={`q-${q.id}`}>
          {q.label || <span className="italic text-steel-400">Untitled question</span>}
          {q.required && <span className="ml-1 text-brand-600">*</span>}
        </label>
        {q.critical && <span className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-700">Critical</span>}
      </div>
      {q.helpText && <p className="-mt-2 mb-3 text-sm text-steel-500">{q.helpText}</p>}

      {q.type === 'pass_fail_na' && <Choice options={PFN} value={v as string} onChange={(x) => setAnswer(q.id, x)} />}
      {q.type === 'yes_no' && <Choice options={YN} value={v as string} onChange={(x) => setAnswer(q.id, x)} />}
      {q.type === 'text' && (q.multiline
        ? <Textarea id={`q-${q.id}`} value={(v as string) ?? ''} onChange={(e) => setAnswer(q.id, e.target.value)} />
        : <Input id={`q-${q.id}`} value={(v as string) ?? ''} onChange={(e) => setAnswer(q.id, e.target.value)} />)}
      {q.type === 'number' && (
        <div className="flex items-center gap-2">
          <Input id={`q-${q.id}`} type="number" inputMode="decimal" min={q.min} max={q.max} value={(v as string) ?? ''}
            onChange={(e) => setAnswer(q.id, e.target.value)} className="max-w-[200px]" />
          {q.unit && <span className="text-sm font-semibold text-steel-500">{q.unit}</span>}
        </div>
      )}
      {q.type === 'dropdown' && (
        <Select id={`q-${q.id}`} value={(v as string) ?? ''} onChange={(e) => setAnswer(q.id, e.target.value)}>
          <option value="">Select…</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </Select>
      )}
      {q.type === 'photo' && <PhotoInput value={v as string[]} onChange={(x) => setAnswer(q.id, x)} required={q.required} />}
      {q.type === 'signature' && <SignaturePad value={v as string} onChange={(x) => setAnswer(q.id, x)} />}
      {q.type === 'table' && <TableInput columns={q.columns ?? []} value={v as Row[]} onChange={(x) => setAnswer(q.id, x)} />}

      {q.photoOnFail && isNegative(q, v) && (
        <div className="mt-3 rounded-lg bg-red-50 p-3">
          <p className="mb-2 flex items-center gap-2 text-sm font-bold text-red-800">
            <AlertTriangle className="h-4 w-4" /> Photo evidence required
          </p>
          <PhotoInput value={answers[`${q.id}__photo`] as string[]} onChange={(x) => setAnswer(`${q.id}__photo`, x)} required />
          {errors[`${q.id}__photo`] && <p className="mt-1 text-xs font-semibold text-red-600">{errors[`${q.id}__photo`]}</p>}
        </div>
      )}
      {err && <p className="mt-2 text-xs font-bold uppercase text-red-600">{err}</p>}
    </div>
  );
}

/** Renders a template schema as a fillable, validated form. */
export function FormRenderer({ schema, onSubmit, onSaveDraft, submitLabel = 'Submit', initialAnswers, busy, header }: {
  schema: TemplateSchema;
  onSubmit?: (answers: Answers) => void;
  /** when given, shows a "Save draft" button that skips validation */
  onSaveDraft?: (answers: Answers) => void;
  submitLabel?: string;
  initialAnswers?: Answers;
  busy?: boolean;
  /** rendered above the first section (e.g. project picker) */
  header?: React.ReactNode;
}) {
  const [answers, setAnswers] = useState<Answers>(initialAnswers ?? {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const setAnswer = (id: string, v: unknown) => {
    setAnswers((a) => ({ ...a, [id]: v }));
    if (submitted) setErrors((e) => { const n = { ...e }; delete n[id]; return n; });
  };
  const total = schema.sections.reduce((n, s) => n + s.questions.length, 0);
  const answered = schema.sections.flatMap((s) => s.questions).filter((q) => {
    const v = answers[q.id];
    return !(v === undefined || v === '' || v === null || (Array.isArray(v) && !v.length));
  }).length;
  const criticalFails = schema.sections.flatMap((s) => s.questions).filter((q) => q.critical && isNegative(q, answers[q.id]));

  if (!schema.sections.length) {
    return <p className="py-10 text-center text-sm text-steel-500">Add a section and some questions to see the preview.</p>;
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitted(true);
        const errs = validateAnswers(schema, answers);
        setErrors(errs);
        if (!Object.keys(errs).length) onSubmit?.(answers);
      }}
      className="space-y-6"
    >
      <div className="sticky top-0 z-10 -mx-1 rounded-lg bg-steel-100/95 px-1 py-2 backdrop-blur">
        <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-steel-600">
          <span>{answered} / {total} answered</span>
          {criticalFails.length > 0 && <span className="text-red-600">{criticalFails.length} critical fail{criticalFails.length > 1 ? 's' : ''}</span>}
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-steel-200">
          <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${total ? (answered / total) * 100 : 0}%` }} />
        </div>
      </div>
      {header}
      {schema.sections.map((s, i) => (
        <fieldset key={s.id} className="space-y-3">
          <legend className="mb-2 flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-steel-900 font-display text-sm font-bold text-white">{i + 1}</span>
            <span className="font-display text-xl font-bold uppercase tracking-wide text-steel-900">{s.title || 'Untitled section'}</span>
          </legend>
          {s.description && <p className="text-sm text-steel-600">{s.description}</p>}
          {s.questions.map((q) => <QuestionInput key={q.id} q={q} answers={answers} setAnswer={setAnswer} errors={errors} />)}
          {!s.questions.length && <p className="rounded-lg border-2 border-dashed border-steel-200 p-4 text-center text-sm text-steel-400">No questions in this section yet.</p>}
        </fieldset>
      ))}
      {submitted && Object.keys(errors).length > 0 && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {Object.keys(errors).length} item{Object.keys(errors).length > 1 ? 's need' : ' needs'} attention.
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <Button type="submit" size="lg" block loading={busy}>{submitLabel}</Button>
        {onSaveDraft && (
          <Button type="button" size="lg" variant="secondary" block disabled={busy} onClick={() => onSaveDraft(answers)}>Save draft</Button>
        )}
      </div>
    </form>
  );
}
