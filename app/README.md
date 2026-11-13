# FieldOps — Operations, HSEQ, Asset & Workforce Management (Phase 1)

Mobile-first React + Tailwind + Supabase app. Phase 1 is the foundation the later modules
(Safety Events, DFRs, Plant, Audits) plug into.

## What's in Phase 1

| Deliverable | Where |
|---|---|
| Supabase auth, profiles linked to organisations (internal vs contractor), 3 roles with RLS | `supabase/migrations/…_phase1_foundation.sql`, `src/contexts/AuthContext.tsx` |
| User & Contractor Management (invite, roles, company linking, job roles + leader-only rates) | `src/pages/admin/UsersPage.tsx`, `supabase/functions/invite-user` |
| Projects / Sites master register (+ contractor engagement per project) | `src/pages/ProjectsPage.tsx`, `projects`, `project_organizations` |
| Dynamic form & checklist template builder (JSONB, 7 input types, live preview, immutable versions) | `src/pages/admin/TemplateBuilderPage.tsx`, `src/components/forms/FormRenderer.tsx` |
| Workflow & notification rules engine (rules, approval chains, alerts, status pipelines, dropdown lists, dry-run tester) | `src/pages/admin/WorkflowPage.tsx`, `run_workflow_rules()` / `test_workflow_rules()` |
| Role-aware dashboard with quick actions | `src/pages/DashboardPage.tsx`, `src/components/layout/quickActions.ts` |

## Running it

```bash
cd app
npm install
npm run dev          # http://localhost:5173
```

**Without Supabase configured, the app runs in demo mode.** Seeded data lives in localStorage
and the login screen has a picker for a Leader, an Employee, two Contractors from different
companies, and one inactive account. The demo backend copies the RLS rules so each role sees
what it would in production. It is not a security boundary.

### Connecting Supabase

1. Create a project, then apply the migrations: `supabase db push` (or paste both files in
   `supabase/migrations/` into the SQL editor, in order).
2. Deploy the invite function: `supabase functions deploy invite-user`. Optionally set the
   secret `APP_URL` to your site URL so invite emails redirect there.
3. Copy `app/.env.example` to `app/.env` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. Sign up with the first account. **The first user becomes the Leader** of the internal company.
   Everyone after that must be invited. A self sign-up without an invitation is created
   *inactive* and has no data access until a Leader activates it.

## Security model (enforced in Postgres)

- `leader`: everything, including invitations, rates, templates and workflow rules.
- `employee`: own profile and tickets only. Other staff appear by name only, through
  `profile_directory`. Cannot read `job_role_rates`, `workflow_rules`, invitations or
  internal-only lookup lists such as cost codes.
- `contractor`: rows scoped to their own `organization_id`. This covers their crew, crew
  tickets, submissions and storage files. They only see projects their company is engaged on,
  and have no visibility into internal data or other contractors.
- Triggers block privilege escalation: only leaders can change role, company, job role or
  active status, and the last active leader can't be removed. They also keep role and company
  type consistent, and derive ticket `organization_id` from the worker.
- Published template versions are immutable. `form_submissions` reference a
  `template_version_id`, so editing a template never changes historical records.
- Storage buckets `form-uploads` and `worker-tickets` are private and foldered by
  `{organization_id}/…`.

### Database tests

```bash
./scripts/test-db.sh   # needs local PostgreSQL 15+ binaries; runs 60 RLS/business-rule assertions
```

## Wiring Phase 2 modules into the rules engine

From a module's trigger:

```sql
perform public.run_workflow_rules('safety_event', 'status_changed', to_jsonb(new), to_jsonb(old));
```

Matching enabled rules write in-app `notifications` and queue email/SMS in `notification_outbox`.
A small Edge Function or cron job sends the queued messages.
