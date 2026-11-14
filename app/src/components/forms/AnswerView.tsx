import { clsx } from 'clsx';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { formatAnswerDate } from '../../lib/labels';
import type { Question, TemplateSchema } from '../../lib/types';
import { Badge } from '../ui';

/** Shows a stored file reference (storage path or data URL) as an image. */
export function StoredImage({ value, alt, className }: { value: string; alt: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(value.startsWith('storage:') ? null : value);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!value.startsWith('storage:')) return;
    let alive = true;
    api.fileUrl(value).then((u) => alive && setSrc(u)).catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, [value]);
  if (failed) return <span className="text-xs text-red-600">Couldn't load file</span>;
  if (!src) return <span className={clsx('block animate-pulse rounded-lg bg-steel-200', className)} />;
  return (
    <a href={src} target="_blank" rel="noreferrer" className="block">
      <img src={src} alt={alt} className={clsx('rounded-lg border-2 border-steel-200 object-cover', className)} />
    </a>
  );
}

function Value({ q, v }: { q: Question; v: unknown }) {
  const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
  if (empty) return <span className="text-sm italic text-steel-400">Not answered</span>;
  switch (q.type) {
    case 'pass_fail_na':
      return <Badge color={v === 'pass' ? 'green' : v === 'fail' ? 'red' : 'slate'}>{v === 'na' ? 'N/A' : String(v)}</Badge>;
    case 'yes_no':
      return <Badge color={v === 'yes' ? 'green' : 'red'}>{String(v)}</Badge>;
    case 'date':
    case 'datetime':
      return <span className="font-semibold tabular-nums">{formatAnswerDate(String(v))}</span>;
    case 'number':
      return <span className="font-semibold tabular-nums">{String(v)}{q.unit ? ` ${q.unit}` : ''}</span>;
    case 'photo':
      return (
        <div className="flex flex-wrap gap-2">
          {(v as string[]).map((p, i) => <StoredImage key={i} value={p} alt={`${q.label} ${i + 1}`} className="h-24 w-24" />)}
        </div>
      );
    case 'signature':
      return <StoredImage value={v as string} alt="Signature" className="h-24 w-full max-w-xs bg-white object-contain" />;
    case 'table': {
      const rows = (v as Record<string, string>[]).filter((r) => Object.values(r ?? {}).some((x) => String(x ?? '').trim()));
      const cols = q.columns ?? [];
      const numeric = cols.filter((c) => c.type === 'number');
      return (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[320px] text-left text-sm">
            <thead className="text-xs font-bold uppercase text-steel-500">
              <tr>{cols.map((c) => <th key={c.id} className={clsx('py-1 pr-3', c.type === 'number' && 'text-right')}>{c.label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-steel-100">
              {rows.map((r, i) => (
                <tr key={i}>{cols.map((c) => <td key={c.id} className={clsx('py-1.5 pr-3', c.type === 'number' && 'text-right tabular-nums')}>{r[c.id] || '—'}</td>)}</tr>
              ))}
            </tbody>
            {numeric.length > 0 && (
              <tfoot className="border-t-2 border-steel-200 font-bold">
                <tr>{cols.map((c, i) => (
                  <td key={c.id} className={clsx('py-1.5 pr-3', c.type === 'number' && 'text-right tabular-nums')}>
                    {c.type === 'number' ? Math.round(rows.reduce((n, r) => n + (Number(r[c.id]) || 0), 0) * 100) / 100 : i === 0 ? 'Total' : ''}
                  </td>
                ))}</tr>
              </tfoot>
            )}
          </table>
        </div>
      );
    }
    default:
      return <span className="whitespace-pre-wrap text-[15px] text-steel-900">{String(v)}</span>;
  }
}

/** Read-only rendering of a submitted record against the exact template version it was filled in on. */
export function AnswerView({ schema, answers }: { schema: TemplateSchema; answers: Record<string, unknown> }) {
  return (
    <div className="space-y-5">
      {schema.sections.map((s, i) => (
        <section key={s.id}>
          <h3 className="mb-2 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded bg-steel-900 font-display text-xs font-bold text-white">{i + 1}</span>
            <span className="font-display text-lg font-bold uppercase tracking-wide">{s.title}</span>
          </h3>
          <dl className="divide-y divide-steel-100 rounded-xl border border-steel-200 bg-white">
            {s.questions.map((q) => {
              const v = answers[q.id];
              const failedCritical = q.critical && (v === 'fail' || v === 'no');
              const extraPhotos = answers[`${q.id}__photo`] as string[] | undefined;
              return (
                <div key={q.id} className={clsx('grid gap-1 px-4 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-4', failedCritical && 'bg-red-50')}>
                  <dt className="text-sm font-semibold text-steel-700">
                    {q.label}
                    {failedCritical && <Badge color="red" className="ml-2">Critical</Badge>}
                  </dt>
                  <dd className="min-w-0 space-y-2">
                    <Value q={q} v={v} />
                    {!!extraPhotos?.length && (
                      <div className="flex flex-wrap gap-2">
                        {extraPhotos.map((p, j) => <StoredImage key={j} value={p} alt={`${q.label} evidence ${j + 1}`} className="h-20 w-20" />)}
                      </div>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      ))}
    </div>
  );
}
