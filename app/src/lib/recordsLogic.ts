// Mirrors the database trigger logic in supabase/migrations/*_records_engine.sql
// so the demo backend behaves like production. The database is the source of truth.
import { LOOKUP_FIELD } from './labels';
import type { Question, TemplateSchema, WorkflowModule, WorkflowPipeline } from './types';

export const MODULE_PREFIX: Record<WorkflowModule, string> = {
  safety_event: 'SE', daily_field_report: 'DFR', plant_prestart: 'PS', audit: 'AUD',
  risk_assessment: 'RA', timesheet: 'TS', training: 'TR', field_leadership: 'FL',
};

export const allQuestions = (schema: TemplateSchema): Question[] => schema.sections.flatMap((s) => s.questions);

export function computeSummary(schema: TemplateSchema, answers: Record<string, unknown>, eventCategories: Record<string, string> = {}) {
  const qs = allQuestions(schema);
  const out: Record<string, unknown> = {};
  let crit = 0;
  let failed = 0;
  let hours: number | null = null;
  for (const q of qs) {
    const v = answers[q.id];
    if (q.critical && (v === 'fail' || v === 'no')) crit++;
    if ((q.type === 'pass_fail_na' && v === 'fail') || (q.type === 'yes_no' && q.critical && v === 'no')) failed++;
    const key = q.fieldKey || (q.lookupKey ? LOOKUP_FIELD[q.lookupKey] ?? q.lookupKey : undefined);
    if (key && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) out[key] = v;
    if (q.type === 'table' && Array.isArray(v)) {
      for (const row of v as Record<string, unknown>[]) {
        const h = Number(row?.hours);
        if (row?.hours !== undefined && row?.hours !== '' && !Number.isNaN(h)) hours = (hours ?? 0) + h;
      }
    }
  }
  out.critical_failures = crit;
  out.failed_items = failed;
  const ev = typeof out.event_type === 'string' ? eventCategories[out.event_type.toLowerCase()] : undefined;
  if (ev) out.incident_category = ev;
  if (hours !== null && out.total_hours === undefined) out.total_hours = hours;
  return out;
}

export function pipelineKeys(pipelines: WorkflowPipeline[], module: WorkflowModule) {
  return pipelines.find((p) => p.module === module)?.statuses.map((s) => s.key) ?? [];
}

/** Which status a record lands in when submitted. */
export function resolveSubmitStatus(pipelines: WorkflowPipeline[], module: WorkflowModule, schema: TemplateSchema, criticalFailures: number) {
  const keys = pipelineKeys(pipelines, module);
  if (criticalFailures > 0) {
    const t = schema.settings?.criticalFailStatus || 'defect_reported';
    if (keys.includes(t)) return t;
  }
  if (keys.includes('submitted')) return 'submitted';
  return keys.find((k) => k !== 'draft') ?? 'submitted';
}

export function nextStatus(pipelines: WorkflowPipeline[], module: WorkflowModule, current: string) {
  const keys = pipelineKeys(pipelines, module);
  const i = keys.indexOf(current);
  return keys.slice(i + 1).find((k) => !['draft', 'rejected', 'returned'].includes(k)) ?? null;
}

export function isTerminal(pipelines: WorkflowPipeline[], module: WorkflowModule, status: string) {
  return !!pipelines.find((p) => p.module === module)?.statuses.find((s) => s.key === status)?.is_terminal;
}

/** Flat record view used by rule matching: columns + scalar answers + summary. */
export function ruleRecord(rec: { id: string; answers: Record<string, unknown>; summary: Record<string, unknown> } & Record<string, unknown>) {
  const scalars = Object.fromEntries(Object.entries(rec.answers).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v)));
  const { answers: _a, ...cols } = rec;
  return { ...cols, ...scalars, ...rec.summary, link: `/records/${rec.id}` } as Record<string, unknown>;
}

/** Day a record is about: a record_date answer (date or date-time), else the Perth day submitted/created. */
export function recordDateFor(summary: Record<string, unknown>, submittedAt: string | null, createdAt: string, perthDay: (d: Date) => string) {
  const d = summary.record_date;
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  return perthDay(new Date(submittedAt ?? createdAt));
}
