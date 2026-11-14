-- =============================================================================
-- Stage 4: scaffold QR page and printed tags
--   * scaffold_public_view(token): what the QR page shows — live status, scaffold
--     details, the latest inspection in full and the inspection history. No phone
--     numbers, emails, licence numbers, signatures or GPS. Called by the
--     scaffold-public function (service role); never directly by browsers.
--   * Admin settings: require sign-in for QR pages; tag label size
--   * scaffold_tag_prints: every tag print (who, when, which inspection)
-- Nothing is dropped.
-- =============================================================================

alter table public.app_settings
  add column if not exists qr_requires_login boolean not null default false,
  add column if not exists tag_label_size text not null default '100x150'
    check (tag_label_size in ('100x150', '4x6', '62mm', 'custom')),
  add column if not exists tag_custom_width_mm numeric check (tag_custom_width_mm between 25 and 300),
  add column if not exists tag_custom_height_mm numeric check (tag_custom_height_mm between 25 and 400);

-- Live status: an overdue inspection overrides the last result.
create or replace function public.scaffold_live_status(s public.scaffolds)
returns text language sql stable set search_path = public as $$
  select case
    when s.status = 'dismantled' then 'dismantled'
    when s.status = 'unsafe' and s.last_inspection_id is null then 'awaiting'
    when s.status in ('safe', 'restricted') and s.next_inspection_due is not null and s.next_inspection_due < public.perth_today() then 'overdue'
    else s.status end
$$;

create or replace function public.scaffold_public_view(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'as_of', now(),
    'company', jsonb_build_object('name', st.company_name, 'logo_url', st.logo_url),
    'scaffold', jsonb_build_object(
      'scaffold_number', s.scaffold_number, 'project_name', p.name, 'project_code', p.code, 'location', s.location,
      'scaffold_type', s.scaffold_type, 'scaffold_type_other', s.scaffold_type_other, 'duty_class', s.duty_class,
      'max_load_kg', s.max_load_kg, 'height_m', s.height_m, 'lifts', s.lifts, 'bays', s.bays, 'erected_on', s.erected_on,
      'status', s.status, 'live_status', public.scaffold_live_status(s), 'restriction', s.restriction,
      'status_reason', s.status_reason, 'next_inspection_due', s.next_inspection_due, 'last_inspected_at', s.last_inspected_at,
      'dismantled_on', s.dismantled_on, 'photos', to_jsonb(s.photos),
      'open_defects', (select count(*) from public.scaffold_defects d where d.scaffold_id = s.id and d.status = 'open' and d.archived_at is null)),
    'latest', (
      select jsonb_build_object(
        'reference', i.reference, 'inspection_type', i.inspection_type, 'inspector_name', i.inspector_name,
        'inspector_licence_class', i.inspector_licence_class, 'signed_at', i.signed_at, 'next_due', i.next_due,
        'outcome', i.outcome, 'restriction', i.restriction, 'notes', i.notes, 'failed_count', i.failed_count,
        'photos', to_jsonb(i.photos), 'checklist_version', c.version, 'sections', c.sections,
        'items', coalesce((select jsonb_object_agg(e.key, jsonb_build_object('result', e.value->'result', 'comment', e.value->'comment', 'photos', e.value->'photos'))
                             from jsonb_each(i.items) e), '{}'::jsonb))
        from public.scaffold_inspections i join public.scaffold_checklists c on c.id = i.checklist_id
       where i.id = s.last_inspection_id and i.archived_at is null),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('reference', h.reference, 'inspection_type', h.inspection_type, 'signed_at', h.signed_at,
                                          'outcome', h.outcome, 'inspector_name', h.inspector_name, 'failed_count', h.failed_count)
                       order by h.signed_at desc)
        from (select * from public.scaffold_inspections where scaffold_id = s.id and archived_at is null order by signed_at desc limit 30) h), '[]'::jsonb))
    from public.scaffolds s
    join public.projects p on p.id = s.project_id
    cross join public.app_settings st
   where s.qr_token = p_token and s.archived_at is null and st.id = 1 and length(p_token) >= 32
$$;
revoke execute on function public.scaffold_public_view(text) from public, anon, authenticated;
revoke execute on function public.scaffold_live_status(public.scaffolds) from public, anon;
grant execute on function public.scaffold_live_status(public.scaffolds) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.scaffold_public_view(text) to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Tag prints
-- ---------------------------------------------------------------------------
create table public.scaffold_tag_prints (
  id            uuid primary key default gen_random_uuid(),
  scaffold_id   uuid not null references public.scaffolds(id),
  inspection_id uuid references public.scaffold_inspections(id),
  label_size    text not null,
  method        text not null default 'pdf' check (method in ('pdf', 'direct')),
  printer       text,
  copies        int not null default 1 check (copies between 1 and 20),
  printed_by    uuid not null references public.profiles(id) default auth.uid(),
  printed_at    timestamptz not null default now()
);
create index scaffold_tag_prints_scaffold_idx on public.scaffold_tag_prints (scaffold_id, printed_at desc);

create or replace function public.scaffold_tag_print_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_service_context() then new.printed_by := auth.uid(); end if;
  new.printed_at := now();
  if new.inspection_id is not null and not exists (
       select 1 from public.scaffold_inspections where id = new.inspection_id and scaffold_id = new.scaffold_id) then
    raise exception 'That inspection is for a different scaffold';
  end if;
  return new;
end $$;
create trigger scaffold_tag_prints_before_insert before insert on public.scaffold_tag_prints
  for each row execute function public.scaffold_tag_print_before_insert();

alter table public.scaffold_tag_prints enable row level security;
create policy scaffold_tag_prints_select on public.scaffold_tag_prints for select to authenticated
  using (exists (select 1 from public.scaffolds s where s.id = scaffold_id));
create policy scaffold_tag_prints_insert on public.scaffold_tag_prints for insert to authenticated
  with check (exists (select 1 from public.scaffolds s where s.id = scaffold_id));
grant select, insert on public.scaffold_tag_prints to authenticated;
revoke all on public.scaffold_tag_prints from anon;
revoke update, delete, truncate on public.scaffold_tag_prints from authenticated;
revoke execute on function public.scaffold_tag_print_before_insert() from public, anon, authenticated;

create trigger scaffold_tag_prints_audit after insert or update or delete on public.scaffold_tag_prints
  for each row execute function public.audit_row();
