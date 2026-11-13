import { clsx } from 'clsx';
import {
  ArrowDown, ArrowRight, ArrowUp, Bell, FlaskConical, GitBranch, List, Lock, Mail, MessageSquare, Pencil, Plus, Save, Trash2, Workflow, X, Zap,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  Badge, Button, Card, Checkbox, EmptyState, ErrorBanner, Field, Input, Modal, PageHeader, Select, Spinner, Tabs, Textarea, Toggle,
} from '../../components/ui';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useToast } from '../../contexts/ToastContext';
import { api } from '../../lib/api';
import { MODULE_FIELDS, MODULE_LABEL, OPERATOR_LABEL, ROLE_LABEL, TRIGGER_LABEL } from '../../lib/labels';
import type {
  ActionType, AppRole, BadgeColor, FormTemplate, JobRole, LookupList, LookupValue, PipelineStatus, RuleAction, WorkflowModule, WorkflowPipeline, WorkflowRule, WorkflowTrigger,
} from '../../lib/types';
import { errMsg, useAsync } from '../../lib/useAsync';

type Tab = 'rules' | 'pipelines' | 'lists' | 'test';
const MODULES = Object.keys(MODULE_LABEL) as WorkflowModule[];
const TRIGGERS = Object.keys(TRIGGER_LABEL) as WorkflowTrigger[];
const ROLES: AppRole[] = ['leader', 'employee', 'contractor'];
const COLORS: BadgeColor[] = ['slate', 'blue', 'amber', 'orange', 'green', 'red', 'purple'];
const ACTION_META: Record<ActionType, { label: string; icon: typeof Bell }> = {
  in_app: { label: 'In-app alert', icon: Bell },
  email: { label: 'Email', icon: Mail },
  sms: { label: 'SMS', icon: MessageSquare },
};

function recipientLabel(r: string) {
  if (r.startsWith('role:')) return `All ${ROLE_LABEL[r.slice(5) as AppRole] ?? r.slice(5)}s`;
  if (r === 'submitter') return 'Record submitter';
  if (r.startsWith('email:')) return r.slice(6);
  return r;
}

const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** Questions on a module's forms that rules can test, with their possible answers. */
function questionFields(templates: FormTemplate[], module: WorkflowModule, values: LookupValue[]) {
  const out: { key: string; label: string; options: { value: string; label: string }[] }[] = [];
  for (const t of templates.filter((x) => x.category === module && x.status !== 'archived')) {
    for (const q of t.draft_schema.sections.flatMap((sec) => sec.questions)) {
      if (!['pass_fail_na', 'yes_no', 'dropdown', 'number', 'text'].includes(q.type) || out.some((o) => o.key === q.id)) continue;
      const options = q.type === 'pass_fail_na' ? [{ value: 'pass', label: 'Pass' }, { value: 'fail', label: 'Fail' }, { value: 'na', label: 'N/A' }]
        : q.type === 'yes_no' ? [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]
        : q.type === 'dropdown' ? (q.lookupKey ? values.filter((v) => v.list_key === q.lookupKey && v.is_active).map((v) => v.label) : q.options ?? []).map((o) => ({ value: o, label: o }))
        : [];
      out.push({ key: q.id, label: `${t.name} › ${q.label || q.id}`, options });
    }
  }
  return out;
}

let QUESTION_LABELS: Record<string, string> = {};

function describeTrigger(r: Pick<WorkflowRule, 'module' | 'trigger_event' | 'trigger_config'>, pipelines: WorkflowPipeline[]) {
  const c = r.trigger_config ?? {};
  const statusLabel = (k?: string) => pipelines.find((p) => p.module === r.module)?.statuses.find((s) => s.key === k)?.label ?? k;
  switch (r.trigger_event) {
    case 'status_changed':
      return `Status changes${c.from_status ? ` from “${statusLabel(c.from_status)}”` : ''}${c.to_status ? ` to “${statusLabel(c.to_status)}”` : ''}`;
    case 'field_condition': {
      const f = MODULE_FIELDS[r.module].find((x) => x.key === c.field)?.label ?? QUESTION_LABELS[c.field ?? ''] ?? c.field ?? '?';
      const v = c.operator === 'in' ? (c.value ?? '').split(',').map((x) => x.trim()).filter(Boolean).join(', ') : c.value ?? '';
      return `${f} ${OPERATOR_LABEL[c.operator ?? 'eq']} “${v}”`;
    }
    case 'record_overdue':
      return `Still “${statusLabel(c.status) ?? 'open'}” after ${c.after_hours ?? '?'}h`;
    case 'ticket_expiring':
      return `Ticket expires within ${c.days_before ?? 30} days`;
    default:
      return 'A new record is created';
  }
}

// ---------------------------------------------------------------------------
// Rule editor
// ---------------------------------------------------------------------------
function RuleEditor({ initial, pipelines, values, jobRoles, templates, onClose, onSaved }: {
  initial: Partial<WorkflowRule>; pipelines: WorkflowPipeline[]; values: LookupValue[]; jobRoles: JobRole[]; templates: FormTemplate[];
  onClose: () => void; onSaved: () => void;
}) {
  const [r, setR] = useState<Partial<WorkflowRule>>({
    module: 'safety_event', trigger_event: 'record_created', trigger_config: {}, approval_chain: [], actions: [],
    is_enabled: true, priority: 100, ...structuredClone(initial),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customEmail, setCustomEmail] = useState('');
  const toast = useToast();
  const cfg = r.trigger_config ?? {};
  const setCfg = (patch: Partial<typeof cfg>) => setR((x) => ({ ...x, trigger_config: { ...x.trigger_config, ...patch } }));
  const statuses = pipelines.find((p) => p.module === r.module)?.statuses ?? [];
  const fields = MODULE_FIELDS[r.module ?? 'safety_event'];
  const field = fields.find((f) => f.key === cfg.field);
  const qFields = questionFields(templates, r.module ?? 'safety_event', values);
  const qField = qFields.find((f) => f.key === cfg.field);
  const fieldValues: { id: string; label: string; value: string }[] = field?.lookup
    ? values.filter((v) => v.list_key === field.lookup && v.is_active).map((v) => ({ id: v.id, label: v.label, value: v.label }))
    : (qField?.options ?? []).map((o) => ({ id: o.value, label: o.label, value: o.value }));

  const setAction = (i: number, a: RuleAction) => setR((x) => ({ ...x, actions: x.actions!.map((y, j) => (j === i ? a : y)) }));

  const save = async () => {
    if (!r.name?.trim()) return setError('Give the rule a name');
    if (r.trigger_event === 'field_condition' && (!cfg.field || !cfg.value)) return setError('Choose a field and value for the condition');
    if (!r.approval_chain?.length && !r.actions?.length) return setError('Add at least one approval step or alert action');
    if (r.actions?.some((a) => !a.recipients.length)) return setError('Every alert action needs at least one recipient');
    setBusy(true);
    try {
      await api.saveRule({ ...r, name: r.name.trim() });
      toast('Workflow rule saved');
      onSaved();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open drawer onClose={onClose} title={r.id ? 'Edit workflow rule' : 'New workflow rule'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save rule</Button></>}>
      <div className="space-y-6">
        {error && <ErrorBanner message={error} />}
        <div className="space-y-4">
          <Field label="Rule name" required><Input value={r.name ?? ''} onChange={(e) => setR({ ...r, name: e.target.value })} autoFocus /></Field>
          <Field label="Description"><Textarea className="min-h-[64px]" value={r.description ?? ''} onChange={(e) => setR({ ...r, description: e.target.value })} /></Field>
        </div>

        {/* WHEN */}
        <fieldset className="space-y-4 rounded-xl border-2 border-blue-200 bg-blue-50/40 p-4">
          <legend className="px-1 font-display text-lg font-bold uppercase text-blue-900">1 · When</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Module">
              <Select value={r.module} onChange={(e) => setR({ ...r, module: e.target.value as WorkflowModule, trigger_config: {} })}>
                {MODULES.map((m) => <option key={m} value={m}>{MODULE_LABEL[m]}</option>)}
              </Select>
            </Field>
            <Field label="Trigger event">
              <Select value={r.trigger_event} onChange={(e) => setR({ ...r, trigger_event: e.target.value as WorkflowTrigger, trigger_config: {} })}>
                {TRIGGERS.map((t) => <option key={t} value={t}>{TRIGGER_LABEL[t]}</option>)}
              </Select>
            </Field>
          </div>
          {r.trigger_event === 'status_changed' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="From status">
                <Select value={cfg.from_status ?? ''} onChange={(e) => setCfg({ from_status: e.target.value || undefined })}>
                  <option value="">Any</option>
                  {statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </Select>
              </Field>
              <Field label="To status">
                <Select value={cfg.to_status ?? ''} onChange={(e) => setCfg({ to_status: e.target.value || undefined })}>
                  <option value="">Any</option>
                  {statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </Select>
              </Field>
            </div>
          )}
          {r.trigger_event === 'field_condition' && (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Field">
                <Select value={cfg.field ?? ''} onChange={(e) => setCfg({ field: e.target.value || undefined, value: undefined })}>
                  <option value="">Select…</option>
                  <optgroup label="Record fields">
                    {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </optgroup>
                  {qFields.length > 0 && (
                    <optgroup label="Form questions">
                      {qFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </optgroup>
                  )}
                </Select>
              </Field>
              <Field label="Operator">
                <Select value={cfg.operator ?? 'eq'} onChange={(e) => setCfg({ operator: e.target.value as typeof cfg.operator })}>
                  {Object.entries(OPERATOR_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              <Field label="Value" hint={cfg.operator === 'in' ? 'Pick one or more' : undefined}>
                {fieldValues.length && cfg.operator !== 'in' ? (
                  <Select value={cfg.value ?? ''} onChange={(e) => setCfg({ value: e.target.value })}>
                    <option value="">Select…</option>
                    {fieldValues.map((v) => <option key={v.id} value={v.value}>{v.label}</option>)}
                  </Select>
                ) : <Input value={cfg.value ?? ''} onChange={(e) => setCfg({ value: e.target.value })} placeholder={cfg.operator === 'in' ? 'High,Critical' : ''} />}
              </Field>
              {fieldValues.length > 0 && cfg.operator === 'in' && (
                <div className="flex flex-wrap gap-2 sm:col-span-3">
                  {fieldValues.map((v) => {
                    const sel = (cfg.value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
                    const on = sel.includes(v.value);
                    return (
                      <button key={v.id} type="button" aria-pressed={on}
                        onClick={() => setCfg({ value: (on ? sel.filter((x) => x !== v.value) : [...sel, v.value]).join(',') })}
                        className={clsx('min-h-[40px] rounded-lg border-2 px-3 text-sm font-semibold', on ? 'border-brand-500 bg-brand-500 text-white' : 'border-steel-200 bg-white')}>
                        {v.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {r.trigger_event === 'record_overdue' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="While in status">
                <Select value={cfg.status ?? ''} onChange={(e) => setCfg({ status: e.target.value || undefined })}>
                  <option value="">Any open status</option>
                  {statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </Select>
              </Field>
              <Field label="For more than (hours)"><Input type="number" min={1} value={cfg.after_hours ?? ''} onChange={(e) => setCfg({ after_hours: Number(e.target.value) || undefined })} /></Field>
            </div>
          )}
          {r.trigger_event === 'ticket_expiring' && (
            <Field label="Days before expiry"><Input type="number" min={1} value={cfg.days_before ?? 30} onChange={(e) => setCfg({ days_before: Number(e.target.value) || undefined })} /></Field>
          )}
        </fieldset>

        {/* APPROVAL */}
        <fieldset className="space-y-3 rounded-xl border-2 border-violet-200 bg-violet-50/40 p-4">
          <legend className="px-1 font-display text-lg font-bold uppercase text-violet-900">2 · Approval chain</legend>
          {!r.approval_chain?.length && <p className="text-sm text-steel-600">No approval required — alerts only.</p>}
          {r.approval_chain?.map((s, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2 rounded-lg bg-white p-3 ring-1 ring-violet-200">
              <span className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-violet-600 text-sm font-bold text-white">{i + 1}</span>
              <div className="min-w-[120px] flex-1">
                <Field label="Approver role">
                  <Select value={s.role} onChange={(e) => setR({ ...r, approval_chain: r.approval_chain!.map((x, j) => (j === i ? { ...x, role: e.target.value as AppRole } : x)) })}>
                    {ROLES.filter((x) => x !== 'contractor').map((x) => <option key={x} value={x}>{ROLE_LABEL[x]}</option>)}
                  </Select>
                </Field>
              </div>
              <div className="min-w-[140px] flex-1">
                <Field label="Job role (optional)">
                  <Select value={s.job_role_id ?? ''} onChange={(e) => setR({ ...r, approval_chain: r.approval_chain!.map((x, j) => (j === i ? { ...x, job_role_id: e.target.value || null } : x)) })}>
                    <option value="">Any</option>
                    {jobRoles.filter((j) => j.applies_to.includes('internal')).map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
                  </Select>
                </Field>
              </div>
              <div className="w-24">
                <Field label="SLA (hrs)">
                  <Input type="number" min={1} value={s.sla_hours ?? ''} onChange={(e) => setR({ ...r, approval_chain: r.approval_chain!.map((x, j) => (j === i ? { ...x, sla_hours: Number(e.target.value) || null } : x)) })} />
                </Field>
              </div>
              <Button variant="ghost" aria-label="Remove step" icon={<Trash2 className="h-4 w-4" />}
                onClick={() => setR({ ...r, approval_chain: r.approval_chain!.filter((_, j) => j !== i).map((x, j) => ({ ...x, step: j + 1 })) })} />
            </div>
          ))}
          <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />}
            onClick={() => setR({ ...r, approval_chain: [...(r.approval_chain ?? []), { step: (r.approval_chain?.length ?? 0) + 1, role: 'leader', sla_hours: 24 }] })}>
            Add approval step
          </Button>
        </fieldset>

        {/* ACTIONS */}
        <fieldset className="space-y-3 rounded-xl border-2 border-brand-200 bg-brand-50/40 p-4">
          <legend className="px-1 font-display text-lg font-bold uppercase text-brand-900">3 · Alerts</legend>
          {r.actions?.map((a, i) => {
            const Icon = ACTION_META[a.type].icon;
            return (
              <div key={i} className="space-y-3 rounded-lg bg-white p-3 ring-1 ring-brand-200">
                <div className="flex items-center gap-2">
                  <Icon className="h-5 w-5 text-brand-600" />
                  <Select aria-label="Alert type" className="!w-auto !py-1.5" value={a.type} onChange={(e) => setAction(i, { ...a, type: e.target.value as ActionType })}>
                    {(Object.keys(ACTION_META) as ActionType[]).map((t) => <option key={t} value={t}>{ACTION_META[t].label}</option>)}
                  </Select>
                  <Button className="ml-auto" variant="ghost" aria-label="Remove alert" icon={<Trash2 className="h-4 w-4" />}
                    onClick={() => setR({ ...r, actions: r.actions!.filter((_, j) => j !== i) })} />
                </div>
                <div>
                  <span className="label">Recipients</span>
                  <div className="flex flex-wrap gap-2">
                    {[...ROLES.map((x) => `role:${x}`), 'submitter'].map((rc) => {
                      const on = a.recipients.includes(rc);
                      return (
                        <button key={rc} type="button" aria-pressed={on}
                          onClick={() => setAction(i, { ...a, recipients: on ? a.recipients.filter((x) => x !== rc) : [...a.recipients, rc] })}
                          className={clsx('min-h-[40px] rounded-lg border-2 px-3 text-sm font-semibold', on ? 'border-brand-500 bg-brand-500 text-white' : 'border-steel-200 bg-white')}>
                          {recipientLabel(rc)}
                        </button>
                      );
                    })}
                    {a.recipients.filter((x) => x.startsWith('email:')).map((rc) => (
                      <span key={rc} className="inline-flex min-h-[40px] items-center gap-1 rounded-lg border-2 border-brand-500 bg-brand-500 px-3 text-sm font-semibold text-white">
                        {recipientLabel(rc)}
                        <button type="button" aria-label={`Remove ${rc}`} onClick={() => setAction(i, { ...a, recipients: a.recipients.filter((x) => x !== rc) })}><X className="h-4 w-4" /></button>
                      </span>
                    ))}
                  </div>
                  {a.type === 'email' && (
                    <div className="mt-2 flex gap-2">
                      <Input type="email" placeholder="Add external email (e.g. client rep)" value={customEmail} onChange={(e) => setCustomEmail(e.target.value)} />
                      <Button variant="secondary" disabled={!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(customEmail)}
                        onClick={() => { setAction(i, { ...a, recipients: [...a.recipients, `email:${customEmail.trim()}`] }); setCustomEmail(''); }}>Add</Button>
                    </div>
                  )}
                  {a.recipients.includes('role:contractor') && <p className="mt-1 text-xs text-steel-500">Contractors only receive alerts for their own company's records.</p>}
                </div>
                <Field label="Message"><Input value={a.message ?? ''} onChange={(e) => setAction(i, { ...a, message: e.target.value })} placeholder="Defaults to rule name" /></Field>
              </div>
            );
          })}
          <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />}
            onClick={() => setR({ ...r, actions: [...(r.actions ?? []), { type: 'in_app', recipients: ['role:leader'] }] })}>
            Add alert
          </Button>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Priority" hint="Lower runs first"><Input type="number" value={r.priority ?? 100} onChange={(e) => setR({ ...r, priority: Number(e.target.value) })} /></Field>
          <div>
            <span className="label">Enabled</span>
            <div className="flex min-h-[48px] items-center"><Toggle checked={!!r.is_enabled} onChange={(v) => setR({ ...r, is_enabled: v })} label="Enabled" /></div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
function RulesTab({ rules, pipelines, onEdit, onToggle, onDelete }: {
  rules: WorkflowRule[]; pipelines: WorkflowPipeline[]; onEdit: (r: Partial<WorkflowRule>) => void;
  onToggle: (r: WorkflowRule, v: boolean) => void; onDelete: (r: WorkflowRule) => void;
}) {
  const grouped = MODULES.map((m) => ({ m, rules: rules.filter((r) => r.module === m) })).filter((g) => g.rules.length);
  return (
    <div>
      <div className="mb-4 flex justify-end"><Button icon={<Plus className="h-5 w-5" />} onClick={() => onEdit({})}>New rule</Button></div>
      {!rules.length && <EmptyState icon={<Zap className="h-10 w-10" />} title="No workflow rules" body="Rules route approvals and send alerts when records change." />}
      <div className="space-y-6">
        {grouped.map(({ m, rules }) => (
          <section key={m}>
            <h3 className="mb-2 text-lg font-bold uppercase text-steel-700">{MODULE_LABEL[m]}</h3>
            <ul className="space-y-3">
              {rules.map((r) => (
                <li key={r.id} className={clsx('card p-4', !r.is_enabled && 'bg-steel-50')}>
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className={clsx('font-bold', r.is_enabled ? 'text-steel-900' : 'text-steel-500')}>{r.name}</p>
                      {r.description && <p className="text-sm text-steel-600">{r.description}</p>}
                    </div>
                    <Toggle checked={r.is_enabled} onChange={(v) => onToggle(r, v)} label={`Enable ${r.name}`} />
                  </div>
                  <div className={clsx('mt-3 flex flex-wrap items-center gap-2 text-sm', !r.is_enabled && 'opacity-60')}>
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-2.5 py-1.5 font-semibold text-blue-900 ring-1 ring-blue-200">
                      <Zap className="h-4 w-4" />{describeTrigger(r, pipelines)}
                    </span>
                    {r.approval_chain.map((s) => (
                      <span key={s.step} className="contents">
                        <ArrowRight className="h-4 w-4 text-steel-400" />
                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-violet-50 px-2.5 py-1.5 font-semibold text-violet-900 ring-1 ring-violet-200">
                          <GitBranch className="h-4 w-4" />Approve: {ROLE_LABEL[s.role]}{s.sla_hours ? ` · ${s.sla_hours}h` : ''}
                        </span>
                      </span>
                    ))}
                    {r.actions.map((a, i) => {
                      const Icon = ACTION_META[a.type].icon;
                      return (
                        <span key={i} className="contents">
                          <ArrowRight className="h-4 w-4 text-steel-400" />
                          <span className="inline-flex items-center gap-1.5 rounded-lg bg-brand-50 px-2.5 py-1.5 font-semibold text-brand-900 ring-1 ring-brand-200">
                            <Icon className="h-4 w-4" />{ACTION_META[a.type].label}: {a.recipients.map(recipientLabel).join(', ')}
                          </span>
                        </span>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex gap-2 border-t border-steel-100 pt-3">
                    <Button size="sm" variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => onEdit(r)}>Edit</Button>
                    <Button size="sm" variant="ghost" className="!text-red-600" icon={<Trash2 className="h-4 w-4" />} onClick={() => onDelete(r)}>Delete</Button>
                    <span className="ml-auto self-center text-xs font-semibold text-steel-400">Priority {r.priority}</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function PipelinesTab({ pipelines, onSaved }: { pipelines: WorkflowPipeline[]; onSaved: () => void }) {
  const [module, setModule] = useState<WorkflowModule>('safety_event');
  const [statuses, setStatuses] = useState<PipelineStatus[]>([]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    setStatuses(structuredClone(pipelines.find((p) => p.module === module)?.statuses ?? []));
  }, [module, pipelines]);
  const set = (i: number, patch: Partial<PipelineStatus>) => setStatuses((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const save = async () => {
    const keys = statuses.map((s) => s.key);
    if (statuses.some((s) => !s.label.trim() || !s.key)) return toast('Every status needs a label', 'error');
    if (new Set(keys).size !== keys.length) return toast('Status keys must be unique', 'error');
    if (!statuses.some((s) => s.is_terminal)) return toast('Mark at least one status as final', 'error');
    setBusy(true);
    try {
      await api.savePipeline({ module, statuses });
      toast(`${MODULE_LABEL[module]} pipeline saved`);
      onSaved();
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const original = pipelines.find((p) => p.module === module)?.statuses ?? [];
  const isNew = (k: string) => !original.some((o) => o.key === k);

  return (
    <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
      <div className="lg:hidden">
        <Select aria-label="Module" value={module} onChange={(e) => setModule(e.target.value as WorkflowModule)}>
          {MODULES.map((m) => <option key={m} value={m}>{MODULE_LABEL[m]}</option>)}
        </Select>
      </div>
      <ul className="hidden space-y-1 lg:block">
        {MODULES.map((m) => (
          <li key={m}>
            <button onClick={() => setModule(m)} className={clsx('flex min-h-[44px] w-full items-center justify-between rounded-lg px-3 text-left text-sm font-semibold',
              module === m ? 'bg-steel-900 text-white' : 'text-steel-700 hover:bg-white')}>
              {MODULE_LABEL[m]}
              <span className="text-xs opacity-70">{pipelines.find((p) => p.module === m)?.statuses.length ?? 0}</span>
            </button>
          </li>
        ))}
      </ul>
      <Card title={`${MODULE_LABEL[module]} — status pipeline`}
        actions={<Button size="sm" icon={<Save className="h-4 w-4" />} loading={busy} onClick={save}>Save</Button>}>
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          {statuses.map((s, i) => (
            <span key={i} className="contents">
              {i > 0 && <ArrowRight className="h-4 w-4 text-steel-400" />}
              <Badge color={s.color}>{s.label || '…'}</Badge>
            </span>
          ))}
        </div>
        <ul className="space-y-2">
          {statuses.map((s, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg border-2 border-steel-200 p-2">
              <Input aria-label="Status label" className="min-w-[160px] flex-1" value={s.label}
                onChange={(e) => set(i, { label: e.target.value, ...(isNew(s.key) ? { key: slug(e.target.value) } : {}) })} />
              <code className="hidden rounded bg-steel-100 px-2 py-1 text-xs text-steel-600 sm:block" title="Stored key">{s.key || '—'}</code>
              <Select aria-label="Colour" className="!w-32" value={s.color.startsWith('#') ? 'custom' : s.color}
                onChange={(e) => set(i, { color: e.target.value === 'custom' ? '#2047c6' : (e.target.value as BadgeColor) })}>
                {COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
                <option value="custom">Custom…</option>
              </Select>
              {s.color.startsWith('#') && (
                <input type="color" aria-label="Custom colour" value={s.color} onChange={(e) => set(i, { color: e.target.value })}
                  className="h-11 w-12 cursor-pointer rounded-lg border-2 border-steel-200 bg-white p-1" />
              )}
              <label className="flex items-center gap-1.5 text-sm font-semibold"><input type="checkbox" className="h-5 w-5 accent-brand-500" checked={s.is_terminal} onChange={(e) => set(i, { is_terminal: e.target.checked })} />Final</label>
              <div className="flex">
                <Button variant="ghost" size="sm" aria-label="Move up" disabled={i === 0} icon={<ArrowUp className="h-4 w-4" />} onClick={() => setStatuses((x) => { const n = [...x]; [n[i - 1], n[i]] = [n[i]!, n[i - 1]!]; return n; })} />
                <Button variant="ghost" size="sm" aria-label="Move down" disabled={i === statuses.length - 1} icon={<ArrowDown className="h-4 w-4" />} onClick={() => setStatuses((x) => { const n = [...x]; [n[i + 1], n[i]] = [n[i]!, n[i + 1]!]; return n; })} />
                <Button variant="ghost" size="sm" aria-label="Remove status" icon={<Trash2 className="h-4 w-4 text-red-600" />} onClick={() => setStatuses((x) => x.filter((_, j) => j !== i))} />
              </div>
            </li>
          ))}
        </ul>
        <Button className="mt-3" size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />}
          onClick={() => setStatuses((x) => [...x, { key: '', label: '', color: 'slate', is_terminal: false }])}>Add status</Button>
        <p className="mt-4 text-xs text-steel-500">Keys of existing statuses are locked so records and rules that reference them keep working. Rename the label freely.</p>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
function ListsTab({ lists, values, onChanged }: { lists: LookupList[]; values: LookupValue[]; onChanged: () => void }) {
  const [key, setKey] = useState(lists[0]?.key ?? '');
  const [newLabel, setNewLabel] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newList, setNewList] = useState<{ name: string; key: string; visible: boolean } | null>(null);
  const toast = useToast();
  const confirm = useConfirm();
  const list = lists.find((l) => l.key === key);
  const items = values.filter((v) => v.list_key === key).sort((a, b) => a.sort_order - b.sort_order);

  const run = async (fn: () => Promise<unknown>, msg?: string) => {
    try { await fn(); if (msg) toast(msg); onChanged(); } catch (e) { toast(errMsg(e), 'error'); }
  };
  const swap = (i: number, d: -1 | 1) => {
    const a = items[i]!, b = items[i + d];
    if (!b) return;
    void run(async () => {
      await api.saveLookupValue({ id: a.id, sort_order: b.sort_order });
      await api.saveLookupValue({ id: b.id, sort_order: a.sort_order });
    });
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
      <div>
        <div className="lg:hidden">
          <Select aria-label="List" value={key} onChange={(e) => setKey(e.target.value)}>
            {lists.map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}
          </Select>
        </div>
        <ul className="hidden space-y-1 lg:block">
          {lists.map((l) => (
            <li key={l.key}>
              <button onClick={() => setKey(l.key)} className={clsx('flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg px-3 text-left text-sm font-semibold',
                key === l.key ? 'bg-steel-900 text-white' : 'text-steel-700 hover:bg-white')}>
                <span className="flex items-center gap-1.5">{!l.visible_to_contractors && <Lock className="h-3.5 w-3.5 opacity-70" />}{l.name}</span>
                <span className="text-xs opacity-70">{values.filter((v) => v.list_key === l.key).length}</span>
              </button>
            </li>
          ))}
        </ul>
        <Button className="mt-3" block size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setNewList({ name: '', key: '', visible: true })}>New list</Button>
      </div>

      {list && (
        <Card title={list.name}>
          {list.description && <p className="mb-3 text-sm text-steel-600">{list.description}</p>}
          <div className="mb-4 flex items-center justify-between gap-3 rounded-lg bg-steel-50 p-3">
            <div>
              <p className="text-sm font-bold">Visible to contractors</p>
              <p className="text-xs text-steel-500">Off = internal only (e.g. cost codes). Enforced by RLS.</p>
            </div>
            <Toggle checked={list.visible_to_contractors} label="Visible to contractors"
              onChange={(v) => run(() => api.saveLookupList({ ...list, visible_to_contractors: v }), 'List updated')} />
          </div>
          <ul className="divide-y divide-steel-100 rounded-lg border-2 border-steel-200">
            {items.map((v, i) => (
              <li key={v.id} className={clsx('flex items-center gap-2 px-3 py-2', !v.is_active && 'opacity-50')}>
                <span className="w-16 shrink-0 font-mono text-xs text-steel-500">{v.code ?? ''}</span>
                <span className="flex-1 font-semibold">{v.label}</span>
                <Toggle size="sm" checked={v.is_active} label={`${v.label} active`} onChange={(a) => run(() => api.saveLookupValue({ id: v.id, is_active: a }))} />
                <Button variant="ghost" size="sm" aria-label="Move up" disabled={i === 0} icon={<ArrowUp className="h-4 w-4" />} onClick={() => swap(i, -1)} />
                <Button variant="ghost" size="sm" aria-label="Move down" disabled={i === items.length - 1} icon={<ArrowDown className="h-4 w-4" />} onClick={() => swap(i, 1)} />
                <Button variant="ghost" size="sm" aria-label={`Delete ${v.label}`} icon={<Trash2 className="h-4 w-4 text-red-600" />}
                  onClick={async () => (await confirm({ title: 'Delete value', message: `Delete “${v.label}”? If it's used on existing records, switch it off instead.`, confirmLabel: 'Delete', danger: true })) && run(() => api.deleteLookupValue(v.id), 'Value deleted')} />
              </li>
            ))}
            {!items.length && <li className="px-3 py-6 text-center text-sm text-steel-500">No values yet.</li>}
          </ul>
          <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => {
            e.preventDefault();
            if (!newLabel.trim()) return;
            void run(async () => {
              await api.saveLookupValue({ list_key: key, label: newLabel.trim(), code: newCode.trim() || null, sort_order: (items.at(-1)?.sort_order ?? 0) + 1 });
              setNewLabel(''); setNewCode('');
            }, 'Value added');
          }}>
            <Input aria-label="New value" placeholder="New value" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
            <Input aria-label="Code" placeholder="Code (optional)" className="sm:!w-40" value={newCode} onChange={(e) => setNewCode(e.target.value)} />
            <Button type="submit" icon={<Plus className="h-5 w-5" />}>Add</Button>
          </form>
        </Card>
      )}

      <Modal open={!!newList} onClose={() => setNewList(null)} title="New dropdown list"
        footer={<><Button variant="secondary" onClick={() => setNewList(null)}>Cancel</Button>
          <Button onClick={() => newList && run(async () => {
            const k = newList.key || slug(newList.name);
            await api.saveLookupList({ key: k, name: newList.name, visible_to_contractors: newList.visible });
            setKey(k); setNewList(null);
          }, 'List created')}>Create</Button></>}>
        {newList && (
          <div className="space-y-4">
            <Field label="List name" required><Input value={newList.name} autoFocus onChange={(e) => setNewList({ ...newList, name: e.target.value, key: slug(e.target.value) })} /></Field>
            <Field label="Key" hint="Used by templates and rules; can't be changed later."><Input value={newList.key} onChange={(e) => setNewList({ ...newList, key: slug(e.target.value) })} /></Field>
            <Checkbox label="Visible to contractors" checked={newList.visible} onChange={(v) => setNewList({ ...newList, visible: v })} />
          </div>
        )}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
function TestTab({ pipelines, values }: { pipelines: WorkflowPipeline[]; values: LookupValue[] }) {
  const [module, setModule] = useState<WorkflowModule>('safety_event');
  const [event, setEvent] = useState<WorkflowTrigger>('field_condition');
  const [record, setRecord] = useState<Record<string, string>>({});
  const [old, setOld] = useState<Record<string, string>>({});
  const [result, setResult] = useState<WorkflowRule[] | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const statuses = pipelines.find((p) => p.module === module)?.statuses ?? [];
  useEffect(() => { setRecord({}); setOld({}); setResult(null); }, [module, event]);

  const run = async () => {
    setBusy(true);
    try { setResult(await api.testRules(module, event, record, old)); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title="Sample record">
        <p className="mb-4 text-sm text-steel-600">Dry-run the rules engine against a pretend record. Nothing is saved and no alerts are sent.</p>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Module"><Select value={module} onChange={(e) => setModule(e.target.value as WorkflowModule)}>{MODULES.map((m) => <option key={m} value={m}>{MODULE_LABEL[m]}</option>)}</Select></Field>
            <Field label="Event"><Select value={event} onChange={(e) => setEvent(e.target.value as WorkflowTrigger)}>{TRIGGERS.map((t) => <option key={t} value={t}>{TRIGGER_LABEL[t]}</option>)}</Select></Field>
          </div>
          {event === 'status_changed' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Old status"><Select value={old.status ?? ''} onChange={(e) => setOld({ status: e.target.value })}><option value="">—</option>{statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</Select></Field>
              <Field label="New status"><Select value={record.status ?? ''} onChange={(e) => setRecord({ ...record, status: e.target.value })}><option value="">—</option>{statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</Select></Field>
            </div>
          )}
          {event === 'field_condition' && MODULE_FIELDS[module].map((f) => {
            const opts = f.lookup ? values.filter((v) => v.list_key === f.lookup) : [];
            return (
              <Field key={f.key} label={f.label}>
                {opts.length ? (
                  <Select value={record[f.key] ?? ''} onChange={(e) => setRecord({ ...record, [f.key]: e.target.value })}>
                    <option value="">—</option>{opts.map((o) => <option key={o.id} value={o.label}>{o.label}</option>)}
                  </Select>
                ) : <Input value={record[f.key] ?? ''} onChange={(e) => setRecord({ ...record, [f.key]: e.target.value })} />}
              </Field>
            );
          })}
          <Button block size="lg" icon={<FlaskConical className="h-5 w-5" />} loading={busy} onClick={run}>Run test</Button>
        </div>
      </Card>
      <Card title="Matching rules">
        {result === null ? <p className="py-8 text-center text-sm text-steel-500">Run a test to see which enabled rules would fire.</p>
          : result.length === 0 ? <p className="py-8 text-center text-sm font-semibold text-steel-600">No enabled rules match this record.</p> : (
            <ul className="space-y-2">
              {result.map((r) => (
                <li key={r.id} className="rounded-lg border-2 border-emerald-300 bg-emerald-50 p-3">
                  <p className="font-bold text-emerald-900">{r.name}</p>
                  <p className="text-sm text-emerald-800">{describeTrigger(r, pipelines)}</p>
                  <p className="mt-1 text-xs text-emerald-700">
                    {r.approval_chain.length ? `${r.approval_chain.length} approval step(s) · ` : ''}{r.actions.map((a) => ACTION_META[a.type].label).join(', ')}
                  </p>
                </li>
              ))}
            </ul>
          )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
export default function WorkflowPage() {
  const [tab, setTab] = useState<Tab>('rules');
  const [editing, setEditing] = useState<Partial<WorkflowRule> | null>(null);
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, error, reload, setData } = useAsync(async () => {
    const [rules, pipelines, lists, values, jobRoles, templates] = await Promise.all([
      api.listRules(), api.listPipelines(), api.listLookupLists(), api.listLookupValues(), api.listJobRoles(), api.listTemplates(),
    ]);
    QUESTION_LABELS = Object.fromEntries(templates.flatMap((t) => t.draft_schema.sections.flatMap((sec) => sec.questions.map((q) => [q.id, `${t.name} › ${q.label}`]))));
    return { rules, pipelines, lists, values, jobRoles, templates };
  }, []);
  const enabled = useMemo(() => data?.rules.filter((r) => r.is_enabled).length ?? 0, [data]);

  const toggle = async (r: WorkflowRule, v: boolean) => {
    setData((d) => d && { ...d, rules: d.rules.map((x) => (x.id === r.id ? { ...x, is_enabled: v } : x)) });
    try {
      await api.saveRule({ id: r.id, is_enabled: v });
      toast(`${r.name} ${v ? 'enabled' : 'disabled'}`);
    } catch (e) {
      toast(errMsg(e), 'error');
      void reload();
    }
  };
  const del = async (r: WorkflowRule) => {
    if (!(await confirm({ title: 'Delete rule', message: `Delete rule “${r.name}”? This can't be undone.`, confirmLabel: 'Delete', danger: true }))) return;
    try { await api.deleteRule(r.id); toast('Rule deleted'); void reload(); } catch (e) { toast(errMsg(e), 'error'); }
  };

  return (
    <div>
      <PageHeader eyebrow="Administration" title="Workflow Settings"
        subtitle="Configure approval chains, automated alerts, status pipelines and dropdown categories — no code changes required." />
      <Tabs value={tab} onChange={setTab} tabs={[
        { key: 'rules', label: 'Rules & Alerts', count: enabled },
        { key: 'pipelines', label: 'Status Pipelines' },
        { key: 'lists', label: 'Dropdown Lists', count: data?.lists.length },
        { key: 'test', label: 'Test Rules' },
      ]} />
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data ? <Spinner /> : data && (
        <>
          {tab === 'rules' && <RulesTab rules={data.rules} pipelines={data.pipelines} onEdit={setEditing} onToggle={toggle} onDelete={del} />}
          {tab === 'pipelines' && <PipelinesTab pipelines={data.pipelines} onSaved={reload} />}
          {tab === 'lists' && <ListsTab lists={data.lists} values={data.values} onChanged={reload} />}
          {tab === 'test' && <TestTab pipelines={data.pipelines} values={data.values} />}
        </>
      )}
      {editing && data && <RuleEditor initial={editing} pipelines={data.pipelines} values={data.values} jobRoles={data.jobRoles} templates={data.templates}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
      <p className="mt-8 flex items-center gap-2 text-xs text-steel-500"><Workflow className="h-4 w-4" />
        Rules are evaluated in the database by <code className="rounded bg-steel-200 px-1">run_workflow_rules()</code>, which Phase 2 module triggers call on insert/update. <List className="h-4 w-4" />
      </p>
    </div>
  );
}
