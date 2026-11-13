-- Every workflow module can have its own form templates.
-- (Enum values must be committed before use, so this lives in its own migration.)
alter type public.template_category add value if not exists 'daily_field_report';
alter type public.template_category add value if not exists 'timesheet';
alter type public.template_category add value if not exists 'training';
