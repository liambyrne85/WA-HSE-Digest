-- Pipeline helpers are only used inside SECURITY DEFINER triggers/functions.
revoke execute on function public.pipeline_has_status(public.workflow_module, text) from authenticated;
revoke execute on function public.pipeline_first_open_status(public.workflow_module) from authenticated;
revoke execute on function public.pipeline_next_status(public.workflow_module, text) from authenticated;
