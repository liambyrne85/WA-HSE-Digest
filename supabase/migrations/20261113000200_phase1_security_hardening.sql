-- Tighten function/table privileges flagged by the Supabase security advisor.

-- Trigger-only functions: nobody needs to call these directly (triggers fire regardless of EXECUTE).
revoke execute on function public.enforce_role_org_match() from public, anon, authenticated;
revoke execute on function public.guard_profile_update() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.worker_ticket_set_org() from public, anon, authenticated;

-- RLS helpers + RPCs: signed-in users only (policies evaluate the helpers as the caller).
revoke execute on function public.current_role_name() from public, anon;
revoke execute on function public.current_org_id() from public, anon;
revoke execute on function public.is_leader() from public, anon;
revoke execute on function public.is_internal_user() from public, anon;
revoke execute on function public.is_contractor() from public, anon;
revoke execute on function public.can_access_project(uuid) from public, anon;
revoke execute on function public.publish_form_template(uuid, text) from public, anon;
revoke execute on function public.test_workflow_rules(public.workflow_module, public.workflow_trigger, jsonb, jsonb) from public, anon;
grant execute on function public.current_role_name(), public.current_org_id(), public.is_leader(),
  public.is_internal_user(), public.is_contractor(), public.can_access_project(uuid) to authenticated;

-- Nothing in the API is reachable signed-out.
revoke all on all tables in schema public from anon;
