import { ArrowRight, Construction, Eye } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FormRenderer } from '../components/forms/FormRenderer';
import { Badge, Button, Card, Field, Modal, PageHeader, Select, Spinner } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { api } from '../lib/api';
import { MODULE_LABEL, TEMPLATE_CATEGORY } from '../lib/labels';
import type { FormTemplate, TemplateCategory, WorkflowModule } from '../lib/types';
import { useAsync } from '../lib/useAsync';

const MODULE_CATEGORY: Partial<Record<WorkflowModule, TemplateCategory>> = {
  safety_event: 'safety_event',
  plant_prestart: 'plant_prestart',
  audit: 'audit',
  risk_assessment: 'risk_assessment',
};

const COPY: Partial<Record<WorkflowModule, string>> = {
  safety_event: 'Report incidents, near misses and hazards from the field, then investigate, assign corrective actions and close out.',
  daily_field_report: 'Crew, hours, plant, weather, progress and delays for each shift — submitted by supervisors and contractors, approved by Leaders.',
  plant_prestart: 'Operators complete a pre-start on their phone before using plant. Critical failures automatically tag out the asset and alert Leaders.',
  audit: 'Scheduled and ad-hoc site inspections scored against configurable checklists, with findings tracked to close-out.',
};

export default function ModulePlaceholderPage({ module }: { module: WorkflowModule }) {
  const { isLeader } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [filling, setFilling] = useState<FormTemplate | null>(null);
  const [projectId, setProjectId] = useState('');
  const category = MODULE_CATEGORY[module];

  const { data, loading } = useAsync(async () => {
    const [pipelines, templates, projects] = await Promise.all([api.listPipelines(), api.listTemplates(), api.listProjects()]);
    return {
      pipeline: pipelines.find((p) => p.module === module),
      templates: templates.filter((t) => t.status === 'published' && t.category === category),
      projects: projects.filter((p) => p.is_active),
    };
  }, [module]);

  // Always fill against the PUBLISHED version, never the leader's working draft.
  const openTemplate = async (t: FormTemplate) => {
    const versions = await api.listTemplateVersions(t.id);
    const live = versions.find((v) => v.id === t.current_version_id) ?? versions[0];
    setFilling({ ...t, draft_schema: live?.schema ?? t.draft_schema });
  };

  useEffect(() => {
    if (params.get('new') === '1' && data?.templates.length === 1) void openTemplate(data.templates[0]!);
    if (params.get('new') && data) { params.delete('new'); setParams(params, { replace: true }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return (
    <div>
      <PageHeader eyebrow="Field module" title={MODULE_LABEL[module]} subtitle={COPY[module]} />
      <div className="mb-6 flex items-start gap-3 rounded-xl border-2 border-dashed border-brand-300 bg-brand-50 p-4">
        <Construction className="h-6 w-6 shrink-0 text-brand-600" />
        <div>
          <p className="font-bold text-brand-900">Record capture arrives in Phase 2</p>
          <p className="text-sm text-brand-900/80">
            The foundations are live: this module already uses your configured status pipeline{category ? ', form templates' : ''} and workflow rules,
            and records will link to the project register.
          </p>
        </div>
      </div>
      {loading || !data ? <Spinner /> : (
        <div className="grid gap-5 lg:grid-cols-2">
          {category && (
            <Card title={`${TEMPLATE_CATEGORY[category].label} forms`} padded={false}>
              <ul className="divide-y divide-steel-100">
                {data.templates.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold">{t.name}</p>
                      <p className="text-xs text-steel-500">v{t.current_version} · {t.draft_schema.sections.reduce((n, s) => n + s.questions.length, 0)} questions</p>
                    </div>
                    <Button size="md" variant="secondary" icon={<Eye className="h-4 w-4" />} onClick={() => openTemplate(t)}>Try it</Button>
                  </li>
                ))}
                {!data.templates.length && (
                  <li className="px-4 py-8 text-center text-sm text-steel-500">
                    No published {TEMPLATE_CATEGORY[category].label.toLowerCase()} templates{isLeader ? ' — create one in Form Templates.' : '.'}
                  </li>
                )}
              </ul>
            </Card>
          )}
          <Card title="Status pipeline">
            {data.pipeline ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {data.pipeline.statuses.map((s, i) => (
                  <span key={s.key} className="contents">
                    {i > 0 && <ArrowRight className="h-4 w-4 text-steel-400" />}
                    <Badge color={s.color}>{s.label}</Badge>
                  </span>
                ))}
              </div>
            ) : <p className="text-sm text-steel-500">No pipeline configured.</p>}
            {isLeader && <p className="mt-3 text-xs text-steel-500">Edit statuses and approval rules in Workflow Settings.</p>}
          </Card>
        </div>
      )}
      <Modal open={!!filling} onClose={() => setFilling(null)} title={filling?.name ?? ''} wide>
        {filling && (
          <div className="space-y-5">
            {filling.draft_schema.settings?.requireProject && (
              <Field label="Project / site" required>
                <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  <option value="">Select project…</option>
                  {data?.projects.map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code} – ` : ''}{p.name}</option>)}
                </Select>
              </Field>
            )}
            <div className="rounded-xl bg-steel-100 p-3">
              <FormRenderer schema={filling.draft_schema} submitLabel="Submit (practice)"
                onSubmit={() => { toast('Practice run complete — saving records arrives in Phase 2'); setFilling(null); }} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
