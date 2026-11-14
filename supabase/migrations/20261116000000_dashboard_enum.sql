-- Stage 2: field leadership is a records module like the others.
-- (Enum values must be committed before use, so this lives in its own migration.)
alter type public.workflow_module add value if not exists 'field_leadership';
alter type public.template_category add value if not exists 'field_leadership';
