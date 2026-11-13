import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { FormRenderer, type Answers } from '../components/forms/FormRenderer';
import { Badge, ErrorBanner, Field, Select, Spinner } from '../components/ui';
import { useToast } from '../contexts/ToastContext';
import { api } from '../lib/api';
import { MODULE_LABEL, MODULE_ROUTE } from '../lib/labels';
import { errMsg, useAsync } from '../lib/useAsync';

const newId = () => (crypto as Crypto & { randomUUID?: () => string }).randomUUID?.()
  ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

/** Fill in a new record (/records/new?template=…) or edit a draft / returned record (/records/:id/edit). */
export default function RecordFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const templateId = params.get('template');
  const nav = useNavigate();
  const toast = useToast();
  const [projectId, setProjectId] = useState<string>('');
  const [projectError, setProjectError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recordId] = useState(() => id ?? newId());

  const { data, loading, error } = useAsync(async () => {
    const projects = (await api.listProjects()).filter((p) => p.is_active);
    if (id) {
      const d = await api.getRecord(id);
      if (!d) throw new Error('Record not found');
      setProjectId(d.record.project_id ?? '');
      return { version: d.version, answers: d.record.answers as Answers, record: d.record, projects };
    }
    const t = await api.getTemplate(templateId ?? '');
    if (!t?.current_version_id) throw new Error('That form is not published');
    const version = await api.getTemplateVersion(t.current_version_id);
    if (!version) throw new Error('That form is not published');
    if (projects.length === 1) setProjectId(projects[0]!.id);
    return { version, answers: {} as Answers, record: null, projects };
  }, [id, templateId]);

  const save = async (answers: Answers, requested: 'draft' | 'submitted') => {
    if (!data) return;
    // A leader correcting a record that's already in progress keeps its current status.
    const inProgress = data.record && !['draft', 'rejected', 'returned'].includes(data.record.status);
    const status = inProgress ? data.record!.status : requested;
    if (requested === 'submitted' && data.version.schema.settings?.requireProject && !projectId) {
      setProjectError('Choose the project or site');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setBusy(true);
    try {
      const row = await api.saveRecord({
        id: recordId, template_version_id: data.version.id, project_id: projectId || null, answers, status, isNew: !id,
      });
      toast(inProgress ? `${row.reference} updated` : status === 'draft' ? `Draft saved (${row.reference})` : `${row.reference} submitted`);
      nav(`/records/${row.id}`, { replace: true });
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorBanner message={error ?? 'Not found'} />;
  const module = data.version.category as keyof typeof MODULE_LABEL;
  const back = data.record ? `/records/${data.record.id}` : MODULE_ROUTE[module] ?? '/';

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-start gap-3">
        <Link to={back} aria-label="Back" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white text-steel-600 shadow-card hover:text-steel-900">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-widest text-brand-600">{MODULE_LABEL[module]}{data.record?.reference ? ` · ${data.record.reference}` : ''}</p>
          <h1 className="text-3xl font-bold uppercase leading-tight">{data.version.name}</h1>
          <div className="mt-1 flex flex-wrap gap-2">
            <Badge color="slate" dot={false}>Form v{data.version.version}</Badge>
            {data.record?.submitted_at && ['draft', 'rejected', 'returned'].includes(data.record.status) && <Badge color="amber">Returned for changes</Badge>}
          </div>
        </div>
      </div>
      <FormRenderer
        schema={data.version.schema}
        initialAnswers={data.answers}
        busy={busy}
        submitLabel={data.record && !['draft', 'rejected', 'returned'].includes(data.record.status) ? 'Save changes'
          : data.record?.submitted_at ? 'Resubmit' : 'Submit'}
        onSubmit={(a) => save(a, 'submitted')}
        onSaveDraft={!data.record || data.record.status === 'draft' ? (a) => save(a, 'draft') : undefined}
        header={
          <div className="rounded-xl border-2 border-steel-200 bg-white p-4">
            <Field label="Project / site" required={!!data.version.schema.settings?.requireProject} error={projectError}>
              <Select value={projectId} onChange={(e) => { setProjectId(e.target.value); setProjectError(null); }}>
                <option value="">Select project…</option>
                {data.projects.map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code} – ` : ''}{p.name}</option>)}
              </Select>
            </Field>
            {!data.projects.length && <p className="mt-2 text-xs text-steel-500">No active projects available to you yet.</p>}
          </div>
        }
      />
    </div>
  );
}
