-- Records read policy: check the row's own columns instead of looking the row up by id.
-- can_see_submission(id) is STABLE, so it can't see a row inserted in the same statement;
-- "insert … returning" (what the app does when saving) was therefore refused.
-- Same rule as can_see_submission(): Admin/HSET, the submitter, or a PM/Supervisor on the
-- record's project (subcontractor leads only for their own company's records).
alter policy submissions_select on public.form_submissions
  using (
    public.is_leader()
    or submitted_by = auth.uid()
    or (public.is_project_lead()
        and project_id in (select public.my_project_ids())
        and (public.is_internal_user() or organization_id = public.current_org_id()))
  );
