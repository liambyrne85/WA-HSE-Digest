import { Copy, LayoutTemplate, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Badge, Button, EmptyState, ErrorBanner, Field, Input, Modal, PageHeader, Spinner, Tabs, Textarea } from '../../components/ui';
import { useToast } from '../../contexts/ToastContext';
import { api } from '../../lib/api';
import { TEMPLATE_CATEGORY, TEMPLATE_STATUS, formatDate } from '../../lib/labels';
import type { TemplateCategory } from '../../lib/types';
import { errMsg, useAsync } from '../../lib/useAsync';

type Filter = TemplateCategory | 'all';

function NewTemplateModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<TemplateCategory>('plant_prestart');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nav = useNavigate();
  const create = async () => {
    if (!name.trim()) return setError('Give the template a name');
    setBusy(true);
    try {
      const t = await api.createTemplate({ name: name.trim(), category, description: description || undefined });
      nav(`/admin/templates/${t.id}`);
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="New form template"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={create} loading={busy}>Create & open builder</Button></>}>
      <div className="space-y-4">
        {error && <ErrorBanner message={error} />}
        <Field label="Template name" required><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Excavator Pre-Start" /></Field>
        <div>
          <span className="label">Category</span>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(TEMPLATE_CATEGORY) as TemplateCategory[]).map((c) => (
              <button key={c} type="button" onClick={() => setCategory(c)} aria-pressed={category === c}
                className={`min-h-[52px] rounded-xl border-2 px-3 text-left text-sm font-bold ${category === c ? 'border-brand-500 bg-brand-50' : 'border-steel-200 bg-white'}`}>
                {TEMPLATE_CATEGORY[c].label}
              </button>
            ))}
          </div>
        </div>
        <Field label="Description"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

export default function TemplatesPage() {
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>('all');
  const [creating, setCreating] = useState(params.get('new') === '1');
  const { data, loading, error, reload } = useAsync(() => api.listTemplates(), []);
  const toast = useToast();
  const nav = useNavigate();
  const templates = data ?? [];
  const shown = templates.filter((t) => filter === 'all' || t.category === filter);

  const duplicate = async (id: string) => {
    try {
      const t = await api.duplicateTemplate(id);
      toast('Template duplicated as a new draft');
      nav(`/admin/templates/${t.id}`);
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  return (
    <div>
      <PageHeader eyebrow="Administration" title="Form Templates"
        subtitle="Configurable checklists and forms. Publishing creates a new immutable version — records already submitted keep the version they were filled against."
        actions={<Button icon={<Plus className="h-5 w-5" />} onClick={() => setCreating(true)}>New template</Button>} />

      <Tabs value={filter} onChange={setFilter} tabs={[
        { key: 'all', label: 'All', count: templates.length },
        ...(Object.keys(TEMPLATE_CATEGORY) as TemplateCategory[]).map((c) => ({
          key: c, label: TEMPLATE_CATEGORY[c].label, count: templates.filter((t) => t.category === c).length,
        })),
      ]} />

      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data ? <Spinner /> : shown.length === 0 ? (
        <EmptyState icon={<LayoutTemplate className="h-10 w-10" />} title="No templates" body="Create your first checklist or form."
          action={<Button onClick={() => setCreating(true)}>New template</Button>} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((t) => {
            const questions = t.draft_schema.sections.reduce((n, s) => n + s.questions.length, 0);
            return (
              <div key={t.id} className="card flex flex-col p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge color={TEMPLATE_CATEGORY[t.category].color}>{TEMPLATE_CATEGORY[t.category].label}</Badge>
                  <Badge color={TEMPLATE_STATUS[t.status].color}>{TEMPLATE_STATUS[t.status].label}</Badge>
                  {t.has_unpublished_changes && t.current_version > 0 && <Badge color="amber">Unpublished edits</Badge>}
                </div>
                <Link to={`/admin/templates/${t.id}`} className="mt-3 text-lg font-bold leading-snug text-steel-900 hover:text-brand-700">{t.name}</Link>
                {t.description && <p className="mt-1 line-clamp-2 text-sm text-steel-600">{t.description}</p>}
                <div className="mt-auto pt-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-steel-500">
                    {t.current_version ? `v${t.current_version}` : 'Never published'} · {t.draft_schema.sections.length} sections · {questions} questions · {formatDate(t.updated_at)}
                  </p>
                  <div className="flex gap-2">
                    <Link to={`/admin/templates/${t.id}`} className="flex-1"><Button block variant="dark" icon={<Pencil className="h-4 w-4" />}>Open builder</Button></Link>
                    <Button variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={() => duplicate(t.id)} aria-label="Duplicate">Copy</Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {creating && <NewTemplateModal onClose={() => { setCreating(false); if (params.get('new')) { params.delete('new'); setParams(params, { replace: true }); } }} />}
    </div>
  );
}
