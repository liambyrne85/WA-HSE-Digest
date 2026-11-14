-- Archive, never delete: Supabase gives new tables DELETE and TRUNCATE for signed-in
-- users by default. Row-level security already blocks deletes (no delete policies),
-- and TRUNCATE isn't reachable through the data API, but remove both outright.
-- The one intended exception stays: project <-> contractor company links.
do $$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r', 'p') loop
    execute format('revoke truncate on public.%I from authenticated, anon', t);
    if t <> 'project_organizations' then
      execute format('revoke delete on public.%I from authenticated, anon', t);
    end if;
  end loop;
end $$;
