import {
  ArrowDown, ArrowLeft, ArrowUp, CheckSquare, ChevronDown, ChevronRight, Copy, Eye, Hash, History, Image, List,
  PenLine, Plus, Rocket, Save, ToggleLeft, Trash2, Type,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useBlocker, useParams } from 'react-router-dom';
import { FormRenderer } from '../../components/forms/FormRenderer';
import {
  Badge, Button, Checkbox, EmptyState, ErrorBanner, Field, Input, Modal, Select, Spinner, Tabs, Textarea, Toggle,
} from '../../components/ui';
import { useToast } from '../../contexts/ToastContext';
import { api } from '../../lib/api';
import { QUESTION_TYPE, TEMPLATE_CATEGORY, TEMPLATE_STATUS, formatDate } from '../../lib/labels';
import type { FormTemplate, FormTemplateVersion, LookupList, Question, QuestionType, Section, TemplateCategory, TemplateSchema } from '../../lib/types';
import { errMsg } from '../../lib/useAsync';
import { useIsDesktop } from '../../lib/useMediaQuery';

const rid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;

const TYPE_ICON: Record<QuestionType, typeof Type> = {
  pass_fail_na: CheckSquare, yes_no: ToggleLeft, text: Type, number: Hash, dropdown: List, photo: Image, signature: PenLine,
};

function move<T>(arr: T[], i: number, d: -1 | 1) {
  const j = i + d;
  if (j < 0 || j >= arr.length) return arr;
  const next = [...arr];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

// ---------------------------------------------------------------------------
function QuestionEditor({ q, index, count, lists, onChange, onMove, onDuplicate, onDelete }: {
  q: Question; index: number; count: number; lists: LookupList[];
  onChange: (q: Question) => void; onMove: (d: -1 | 1) => void; onDuplicate: () => void; onDelete: () => void;
}) {
  const [open, setOpen] = useState(!q.label);
  const Icon = TYPE_ICON[q.type];
  const set = <K extends keyof Question>(k: K, v: Question[K]) => onChange({ ...q, [k]: v });
  const changeType = (t: QuestionType) => {
    const next: Question = { id: q.id, label: q.label, type: t, required: q.required, helpText: q.helpText };
    if (t === 'dropdown') next.options = q.options?.length ? q.options : ['Option 1', 'Option 2'];
    onChange(next);
  };

  return (
    <div className="rounded-xl border-2 border-steel-200 bg-white">
      <div className="flex items-start gap-2 p-3">
        <span className="mt-2.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-steel-100 text-steel-600" title={QUESTION_TYPE[q.type].label}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <Input aria-label="Question text" placeholder="Question text" value={q.label} onChange={(e) => set('label', e.target.value)} />
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="Input type" className="!w-auto !py-1.5 text-sm" value={q.type} onChange={(e) => changeType(e.target.value as QuestionType)}>
              {(Object.keys(QUESTION_TYPE) as QuestionType[]).map((t) => <option key={t} value={t}>{QUESTION_TYPE[t].label}</option>)}
            </Select>
            <label className="flex items-center gap-2 text-sm font-semibold text-steel-700">
              <Toggle size="sm" checked={q.required} onChange={(v) => set('required', v)} label="Required" /> Required
            </label>
            {q.critical && <Badge color="red">Critical</Badge>}
            {q.photoOnFail && <Badge color="orange">Photo on fail</Badge>}
            <button type="button" onClick={() => setOpen((o) => !o)} className="ml-auto flex min-h-[36px] items-center gap-1 rounded-lg px-2 text-sm font-semibold text-steel-600 hover:bg-steel-100">
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />} Settings
            </button>
          </div>
        </div>
        <div className="flex shrink-0 flex-col">
          <button type="button" aria-label="Move question up" disabled={index === 0} onClick={() => onMove(-1)} className="flex h-9 w-9 items-center justify-center rounded-lg text-steel-500 hover:bg-steel-100 disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
          <button type="button" aria-label="Move question down" disabled={index === count - 1} onClick={() => onMove(1)} className="flex h-9 w-9 items-center justify-center rounded-lg text-steel-500 hover:bg-steel-100 disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
        </div>
      </div>
      {open && (
        <div className="space-y-3 border-t border-steel-100 bg-steel-50/60 p-3">
          <Field label="Help text"><Input value={q.helpText ?? ''} onChange={(e) => set('helpText', e.target.value || undefined)} placeholder="Shown under the question" /></Field>
          {q.type === 'dropdown' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Options source">
                <Select value={q.lookupKey ?? ''} onChange={(e) => onChange({ ...q, lookupKey: e.target.value || undefined })}>
                  <option value="">Custom list (below)</option>
                  {lists.map((l) => <option key={l.key} value={l.key}>Lookup: {l.name}</option>)}
                </Select>
              </Field>
              {!q.lookupKey ? (
                <Field label="Options" hint="One per line">
                  <Textarea value={(q.options ?? []).join('\n')} onChange={(e) => set('options', e.target.value.split('\n'))}
                    onBlur={(e) => set('options', e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))} />
                </Field>
              ) : <p className="self-center text-xs text-steel-500">Options stay in sync with the lookup list managed in Workflow Settings.</p>}
            </div>
          )}
          {q.type === 'number' && (
            <div className="grid grid-cols-3 gap-3">
              <Field label="Unit"><Input value={q.unit ?? ''} onChange={(e) => set('unit', e.target.value || undefined)} placeholder="hrs, km, %" /></Field>
              <Field label="Min"><Input type="number" value={q.min ?? ''} onChange={(e) => set('min', e.target.value === '' ? undefined : Number(e.target.value))} /></Field>
              <Field label="Max"><Input type="number" value={q.max ?? ''} onChange={(e) => set('max', e.target.value === '' ? undefined : Number(e.target.value))} /></Field>
            </div>
          )}
          {q.type === 'text' && <Checkbox label="Multi-line answer" checked={!!q.multiline} onChange={(v) => set('multiline', v || undefined)} />}
          {(q.type === 'pass_fail_na' || q.type === 'yes_no') && (
            <>
              <Checkbox label={`Require a photo when answered ${q.type === 'yes_no' ? '“No”' : '“Fail”'}`} checked={!!q.photoOnFail} onChange={(v) => set('photoOnFail', v || undefined)} />
              <Checkbox label="Critical item" description="A fail is flagged as a critical defect and can trigger workflow rules (e.g. tag-out plant)."
                checked={!!q.critical} onChange={(v) => set('critical', v || undefined)} />
            </>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" icon={<Copy className="h-4 w-4" />} onClick={onDuplicate}>Duplicate</Button>
            <Button size="sm" variant="ghost" className="!text-red-600" icon={<Trash2 className="h-4 w-4" />} onClick={onDelete}>Delete</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddQuestionMenu({ onAdd }: { onAdd: (t: QuestionType) => void }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return <Button variant="secondary" block icon={<Plus className="h-5 w-5" />} onClick={() => setOpen(true)}>Add question</Button>;
  }
  return (
    <div className="rounded-xl border-2 border-brand-300 bg-brand-50/50 p-3">
      <p className="mb-2 text-xs font-bold uppercase tracking-wider text-steel-600">Choose input type</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(Object.keys(QUESTION_TYPE) as QuestionType[]).map((t) => {
          const Icon = TYPE_ICON[t];
          return (
            <button key={t} type="button" onClick={() => { onAdd(t); setOpen(false); }}
              className="flex min-h-[64px] flex-col items-start justify-center gap-1 rounded-lg border-2 border-steel-200 bg-white px-3 py-2 text-left hover:border-brand-400">
              <Icon className="h-5 w-5 text-brand-600" />
              <span className="text-sm font-bold leading-tight">{QUESTION_TYPE[t].label}</span>
            </button>
          );
        })}
      </div>
      <button type="button" onClick={() => setOpen(false)} className="mt-2 text-sm font-semibold text-steel-500 hover:underline">Cancel</button>
    </div>
  );
}

function SectionEditor({ s, index, count, lists, onChange, onMove, onDelete }: {
  s: Section; index: number; count: number; lists: LookupList[];
  onChange: (s: Section) => void; onMove: (d: -1 | 1) => void; onDelete: () => void;
}) {
  const setQ = (qs: Question[]) => onChange({ ...s, questions: qs });
  return (
    <section className="card overflow-hidden">
      <header className="flex items-start gap-2 bg-steel-900 p-3 text-white">
        <span className="mt-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-500 font-display text-lg font-bold">{index + 1}</span>
        <div className="min-w-0 flex-1 space-y-2">
          <input aria-label="Section title" value={s.title} onChange={(e) => onChange({ ...s, title: e.target.value })} placeholder="Section title"
            className="w-full rounded-lg border-2 border-steel-700 bg-steel-800 px-3 py-2 font-display text-lg font-bold uppercase tracking-wide text-white placeholder:text-steel-500 focus:border-brand-500 focus:outline-none" />
          <input aria-label="Section description" value={s.description ?? ''} onChange={(e) => onChange({ ...s, description: e.target.value || undefined })} placeholder="Description (optional)"
            className="w-full rounded-lg border-2 border-steel-700 bg-steel-800 px-3 py-1.5 text-sm text-steel-200 placeholder:text-steel-500 focus:border-brand-500 focus:outline-none" />
        </div>
        <div className="flex shrink-0 flex-col">
          <button type="button" aria-label="Move section up" disabled={index === 0} onClick={() => onMove(-1)} className="flex h-9 w-9 items-center justify-center rounded-lg text-steel-300 hover:bg-steel-800 disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
          <button type="button" aria-label="Move section down" disabled={index === count - 1} onClick={() => onMove(1)} className="flex h-9 w-9 items-center justify-center rounded-lg text-steel-300 hover:bg-steel-800 disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
          <button type="button" aria-label="Delete section" onClick={onDelete} className="flex h-9 w-9 items-center justify-center rounded-lg text-red-400 hover:bg-steel-800"><Trash2 className="h-4 w-4" /></button>
        </div>
      </header>
      <div className="space-y-3 p-3">
        {s.questions.map((q, i) => (
          <QuestionEditor key={q.id} q={q} index={i} count={s.questions.length} lists={lists}
            onChange={(nq) => setQ(s.questions.map((x) => (x.id === q.id ? nq : x)))}
            onMove={(d) => setQ(move(s.questions, i, d))}
            onDuplicate={() => { const c = [...s.questions]; c.splice(i + 1, 0, { ...structuredClone(q), id: rid('q'), label: `${q.label} (copy)` }); setQ(c); }}
            onDelete={() => setQ(s.questions.filter((x) => x.id !== q.id))} />
        ))}
        <AddQuestionMenu onAdd={(t) => setQ([...s.questions, {
          id: rid('q'), label: '', type: t, required: true, ...(t === 'dropdown' ? { options: ['Option 1', 'Option 2'] } : {}),
        }])} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
function PhoneFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[420px] rounded-[2rem] border-[10px] border-steel-900 bg-steel-100 shadow-xl">
      <div className="flex items-center justify-between rounded-t-[1.4rem] bg-steel-900 px-4 pb-2 pt-1 text-white">
        <span className="truncate font-display text-base font-bold uppercase">{title || 'Untitled'}</span>
        <Badge color="orange" dot={false}>Preview</Badge>
      </div>
      <div className="max-h-[70vh] overflow-y-auto p-3">{children}</div>
    </div>
  );
}

function VersionsPanel({ versions, current, onView, onRestore }: {
  versions: FormTemplateVersion[]; current: number; onView: (v: FormTemplateVersion) => void; onRestore: (v: FormTemplateVersion) => void;
}) {
  if (!versions.length) return <EmptyState icon={<History className="h-8 w-8" />} title="No versions yet" body="Publish the template to create version 1." />;
  return (
    <ol className="space-y-2">
      {versions.map((v) => (
        <li key={v.id} className="card p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="font-display text-xl font-bold">v{v.version}</p>
            {v.version === current && <Badge color="green">Live</Badge>}
          </div>
          <p className="text-sm text-steel-700">{v.change_note || <span className="italic text-steel-400">No change note</span>}</p>
          <p className="mt-1 text-xs text-steel-500">Published {formatDate(v.published_at)} · {v.schema.sections.reduce((n, s) => n + s.questions.length, 0)} questions</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="secondary" icon={<Eye className="h-4 w-4" />} onClick={() => onView(v)}>View</Button>
            <Button size="sm" variant="ghost" icon={<History className="h-4 w-4" />} onClick={() => onRestore(v)}>Restore to draft</Button>
          </div>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
export default function TemplateBuilderPage() {
  const { id } = useParams();
  const toast = useToast();
  const [tpl, setTpl] = useState<FormTemplate | null>(null);
  const [schema, setSchema] = useState<TemplateSchema>({ sections: [] });
  const [meta, setMeta] = useState({ name: '', description: '', category: 'audit' as TemplateCategory, available_to_contractors: true });
  const [versions, setVersions] = useState<FormTemplateVersion[]>([]);
  const [lists, setLists] = useState<LookupList[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [changeNote, setChangeNote] = useState('');
  const [viewVersion, setViewVersion] = useState<FormTemplateVersion | null>(null);
  const [mobileTab, setMobileTab] = useState<'edit' | 'preview' | 'versions'>('edit');
  const [sideTab, setSideTab] = useState<'preview' | 'versions'>('preview');
  const [previewKey, setPreviewKey] = useState(0);
  const isDesktop = useIsDesktop();

  const load = async () => {
    setLoading(true);
    try {
      const [t, v, l] = await Promise.all([api.getTemplate(id!), api.listTemplateVersions(id!), api.listLookupLists()]);
      if (!t) throw new Error('Template not found');
      setTpl(t);
      setSchema(structuredClone(t.draft_schema));
      setMeta({ name: t.name, description: t.description ?? '', category: t.category, available_to_contractors: t.available_to_contractors });
      setVersions(v);
      setLists(l);
      setDirty(false);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [id]);

  // Warn before leaving with unsaved edits.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state === 'blocked') {
      if (window.confirm('You have unsaved changes. Leave without saving?')) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker]);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const updateSchema = (s: TemplateSchema) => { setSchema(s); setDirty(true); };
  const updateMeta = (m: Partial<typeof meta>) => { setMeta((x) => ({ ...x, ...m })); setDirty(true); };
  const setSections = (sections: Section[]) => updateSchema({ ...schema, sections });

  const cleanSchema = (): TemplateSchema => ({
    ...schema,
    sections: schema.sections.map((s) => ({
      ...s,
      questions: s.questions.map((q) => (q.type === 'dropdown' && q.options ? { ...q, options: q.options.map((o) => o.trim()).filter(Boolean) } : q)),
    })),
  });

  const validate = () => {
    if (!meta.name.trim()) return 'Template name is required';
    for (const s of schema.sections) {
      if (!s.title.trim()) return 'Every section needs a title';
      for (const q of s.questions) {
        if (!q.label.trim()) return `A question in "${s.title}" has no text`;
        if (q.type === 'dropdown' && !q.lookupKey && !(q.options ?? []).filter((o) => o.trim()).length) return `Dropdown "${q.label}" needs options`;
      }
    }
    return null;
  };

  const save = async (silent = false) => {
    const v = validate();
    if (v) { toast(v, 'error'); return false; }
    setSaving(true);
    try {
      const t = await api.saveTemplateDraft(id!, {
        name: meta.name.trim(), description: meta.description || null, category: meta.category,
        available_to_contractors: meta.available_to_contractors, draft_schema: cleanSchema(),
      });
      setTpl(t);
      setSchema(structuredClone(t.draft_schema));
      setDirty(false);
      if (!silent) toast('Draft saved');
      return true;
    } catch (e) {
      toast(errMsg(e), 'error');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    if (!schema.sections.length) return toast('Add at least one section before publishing', 'error');
    if (dirty && !(await save(true))) return;
    setSaving(true);
    try {
      const v = await api.publishTemplate(id!, changeNote || undefined);
      toast(`Published version ${v.version}`);
      setPublishOpen(false);
      setChangeNote('');
      await load();
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !tpl) return <Spinner />;
  if (error || !tpl) return <ErrorBanner message={error ?? 'Template not found'} />;

  const questionCount = schema.sections.reduce((n, s) => n + s.questions.length, 0);
  const unpublished = dirty || tpl.has_unpublished_changes;

  const editor = (
    <div className="space-y-4">
      <div className="card space-y-4 p-4">
        <Field label="Template name" required><Input value={meta.name} onChange={(e) => updateMeta({ name: e.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category">
            <Select value={meta.category} onChange={(e) => updateMeta({ category: e.target.value as TemplateCategory })}>
              {(Object.keys(TEMPLATE_CATEGORY) as TemplateCategory[]).map((c) => <option key={c} value={c}>{TEMPLATE_CATEGORY[c].label}</option>)}
            </Select>
          </Field>
          <div>
            <span className="label">Available to contractors</span>
            <div className="flex min-h-[48px] items-center gap-3">
              <Toggle checked={meta.available_to_contractors} onChange={(v) => updateMeta({ available_to_contractors: v })} label="Available to contractors" />
              <span className="text-sm text-steel-600">{meta.available_to_contractors ? 'Contractors can use it' : 'Internal only'}</span>
            </div>
          </div>
        </div>
        <Field label="Description"><Textarea className="min-h-[64px]" value={meta.description} onChange={(e) => updateMeta({ description: e.target.value })} /></Field>
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <Checkbox label="Must be linked to a project / site" checked={!!schema.settings?.requireProject}
            onChange={(v) => updateSchema({ ...schema, settings: { ...schema.settings, requireProject: v } })} />
          <Checkbox label="Requires supervisor sign-off" checked={!!schema.settings?.requireSignOff}
            onChange={(v) => updateSchema({ ...schema, settings: { ...schema.settings, requireSignOff: v } })} />
        </div>
      </div>

      {schema.sections.map((s, i) => (
        <SectionEditor key={s.id} s={s} index={i} count={schema.sections.length} lists={lists}
          onChange={(ns) => setSections(schema.sections.map((x) => (x.id === s.id ? ns : x)))}
          onMove={(d) => setSections(move(schema.sections, i, d))}
          onDelete={() => {
            if (s.questions.length && !window.confirm(`Delete section "${s.title || 'Untitled'}" and its ${s.questions.length} question(s)?`)) return;
            setSections(schema.sections.filter((x) => x.id !== s.id));
          }} />
      ))}
      <Button variant="dark" size="lg" block icon={<Plus className="h-5 w-5" />}
        onClick={() => setSections([...schema.sections, { id: rid('s'), title: `Section ${schema.sections.length + 1}`, questions: [] }])}>
        Add section
      </Button>
    </div>
  );

  const preview = (
    <PhoneFrame title={meta.name}>
      <FormRenderer key={previewKey} schema={schema} submitLabel="Test submit"
        onSubmit={() => toast('Preview valid — all required items answered ✔')} />
    </PhoneFrame>
  );

  const versionsPanel = (
    <VersionsPanel versions={versions} current={tpl.current_version} onView={setViewVersion}
      onRestore={(v) => {
        if (!window.confirm(`Replace the current draft with v${v.version}? Publish afterwards to make it live as a new version.`)) return;
        updateSchema(structuredClone(v.schema));
        toast(`Draft restored from v${v.version} — save or publish to keep it`);
      }} />
  );

  return (
    <div>
      {/* Sticky header */}
      <div className="sticky top-16 z-10 -mx-4 mb-5 border-b border-steel-200 bg-steel-100/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Link to="/admin/templates" aria-label="Back to templates" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white text-steel-600 shadow-card hover:text-steel-900">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="min-w-0">
              <p className="truncate font-display text-2xl font-bold uppercase leading-tight">{meta.name || 'Untitled template'}</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                <Badge color={TEMPLATE_CATEGORY[meta.category].color}>{TEMPLATE_CATEGORY[meta.category].label}</Badge>
                <Badge color={TEMPLATE_STATUS[tpl.status].color}>{tpl.current_version ? `${TEMPLATE_STATUS[tpl.status].label} v${tpl.current_version}` : 'Draft'}</Badge>
                {unpublished && <Badge color="amber">{dirty ? 'Unsaved changes' : 'Draft ahead of live'}</Badge>}
                <span className="text-xs font-semibold text-steel-500">{schema.sections.length} sections · {questionCount} questions</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1 md:flex-none" icon={<Save className="h-5 w-5" />} loading={saving && !publishOpen} disabled={!dirty} onClick={() => void save()}>Save draft</Button>
            <Button className="flex-1 md:flex-none" icon={<Rocket className="h-5 w-5" />} disabled={!unpublished && tpl.current_version > 0} onClick={() => setPublishOpen(true)}>Publish</Button>
          </div>
        </div>
      </div>

      {/* Mobile: tabs */}
      {!isDesktop && <div>
        <Tabs value={mobileTab} onChange={(t) => { setMobileTab(t); if (t === 'preview') setPreviewKey((k) => k + 1); }} tabs={[
          { key: 'edit', label: 'Build' }, { key: 'preview', label: 'Preview' }, { key: 'versions', label: 'Versions', count: versions.length },
        ]} />
        {mobileTab === 'edit' && editor}
        {mobileTab === 'preview' && preview}
        {mobileTab === 'versions' && versionsPanel}
      </div>}

      {/* Desktop: side by side */}
      {isDesktop && <div className="grid grid-cols-[minmax(0,1fr)_420px] gap-6">
        <div>{editor}</div>
        <div className="sticky top-40 self-start">
          <Tabs value={sideTab} onChange={setSideTab} tabs={[{ key: 'preview', label: 'Live preview' }, { key: 'versions', label: 'Versions', count: versions.length }]} />
          {sideTab === 'preview' ? preview : <div className="max-h-[75vh] overflow-y-auto">{versionsPanel}</div>}
        </div>
      </div>}

      <Modal open={publishOpen} onClose={() => setPublishOpen(false)} title={`Publish v${tpl.current_version + 1}`}
        footer={<><Button variant="secondary" onClick={() => setPublishOpen(false)}>Cancel</Button><Button icon={<Rocket className="h-5 w-5" />} loading={saving} onClick={publish}>Publish</Button></>}>
        <div className="space-y-4">
          <p className="text-sm text-steel-700">
            Publishing snapshots this draft as <strong>version {tpl.current_version + 1}</strong>. New records will use it immediately.
            {tpl.current_version > 0 && <> Records already submitted against v{tpl.current_version} or earlier are unaffected and keep rendering with the questions they were answered against.</>}
          </p>
          <Field label="Change note" hint="What changed? Shown in version history."><Textarea value={changeNote} onChange={(e) => setChangeNote(e.target.value)} placeholder="e.g. Added fire extinguisher check" /></Field>
        </div>
      </Modal>

      <Modal open={!!viewVersion} onClose={() => setViewVersion(null)} title={viewVersion ? `v${viewVersion.version} (read-only)` : ''} wide>
        {viewVersion && (
          <div>
            <p className="mb-4 text-sm text-steel-600">{viewVersion.change_note} · published {formatDate(viewVersion.published_at)}</p>
            <div className="rounded-xl bg-steel-100 p-3"><FormRenderer schema={viewVersion.schema} submitLabel="Test submit" /></div>
          </div>
        )}
      </Modal>
    </div>
  );
}
