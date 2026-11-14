-- Stage 1: new app roles. Added alongside the old values (leader/employee/contractor)
-- so nothing is dropped; the next migration converts any existing data and then
-- stops the old values being used. Enum values must be committed before use,
-- so this lives in its own migration.
alter type public.app_role add value if not exists 'admin';
alter type public.app_role add value if not exists 'hset';
alter type public.app_role add value if not exists 'project_manager';
alter type public.app_role add value if not exists 'supervisor';
alter type public.app_role add value if not exists 'worker';
