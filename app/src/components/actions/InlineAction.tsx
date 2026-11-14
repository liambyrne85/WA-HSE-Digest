import { clsx } from 'clsx';
import { ListPlus } from 'lucide-react';
import { addDays, perthToday } from '../../lib/labels';
import { newId } from '../../lib/id';
import type { ActionPriority, DirectoryEntry, Question } from '../../lib/types';
import { Field, Input, Select } from '../ui';
import { PRIORITY } from './ActionsPanel';

/** An action raised from a No / Fail answer, kept with the answers until the form is submitted. */
export interface InlineAction {
  id: string;
  enabled: boolean;
  title: string;
  assignee_id: string;
  due_date: string;
  priority: ActionPriority;
}
export const ACTION_KEY = (qid: string) => `${qid}__action`;
export const isInlineActionKey = (k: string) => k.endsWith('__action');

/** Optional — never required. Shown under a question answered No / Fail. */
export function InlineActionEditor({ q, value, onChange, people, meId }: {
  q: Question; value?: InlineAction; onChange: (v: InlineAction | undefined) => void; people: DirectoryEntry[]; meId?: string;
}) {
  const v = value;
  if (!v?.enabled) {
    return (
      <button type="button" onClick={() => onChange({ id: v?.id ?? newId(), enabled: true, title: v?.title ?? `Fix: ${q.label}`, assignee_id: v?.assignee_id ?? '',
        due_date: v?.due_date ?? addDays(perthToday(), 7), priority: v?.priority ?? 'medium' })}
        className="mt-3 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-brand-300 bg-brand-50 font-bold text-brand-700">
        <ListPlus className="h-5 w-5" />Raise an action for this (optional)
      </button>
    );
  }
  const set = (p: Partial<InlineAction>) => onChange({ ...v, ...p });
  return (
    <div className="mt-3 space-y-3 rounded-lg border-2 border-brand-300 bg-brand-50/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-bold text-brand-800"><ListPlus className="h-4 w-4" />Action — raised when you submit</p>
        <button type="button" className="min-h-[40px] px-2 text-sm font-semibold text-steel-600 underline" onClick={() => onChange({ ...v, enabled: false })}>Remove</button>
      </div>
      <Field label="Action"><Input value={v.title} onChange={(e) => set({ title: e.target.value })} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Assigned to">
          <Select value={v.assignee_id} onChange={(e) => set({ assignee_id: e.target.value })} className={clsx(!v.assignee_id && 'border-brand-400')}>
            <option value="">Choose a person…</option>
            {meId && <option value={meId}>Me</option>}
            {people.filter((p) => p.id !== meId).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </Select>
        </Field>
        <Field label="Close out by"><Input type="date" min={perthToday()} value={v.due_date} onChange={(e) => set({ due_date: e.target.value })} /></Field>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {(['low', 'medium', 'high'] as ActionPriority[]).map((k) => (
          <button key={k} type="button" aria-pressed={v.priority === k} onClick={() => set({ priority: k })}
            className={clsx('min-h-[44px] rounded-lg border-2 text-sm font-bold uppercase', v.priority === k ? PRIORITY[k].on : 'border-steel-200 bg-white text-steel-600')}>
            {PRIORITY[k].label}
          </button>
        ))}
      </div>
    </div>
  );
}
