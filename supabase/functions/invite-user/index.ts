// Supabase Edge Function: invite-user (people service)
//
// Admin-only actions:
//   create       create one person (profile + login). Optionally email them a
//                "set your password" link, or give them a temporary password.
//   import       create many people from CSV rows (max 300 per call).
//   send_invite  (re)send the "set your password" email to an existing person.
//   set_active   deactivate / reactivate a person (also blocks / unblocks sign-in).
//
// Role, company, position, project and inspector status come from the
// user_invitations row written here, which handle_new_user() copies onto the
// profile — so they are decided server-side, never by the person signing up.
//
// Emails use Supabase Auth's "Reset password" template. Customise its wording to
// "Set up your account" in Supabase → Authentication → Emails, and configure
// custom SMTP there so emails reach people outside your Supabase organisation.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const ROLES = ["admin", "hset", "project_manager", "supervisor", "worker"] as const;
type Role = typeof ROLES[number];

interface PersonInput {
  email?: string;
  full_name?: string;
  role?: Role;
  organization_id?: string;
  job_role_id?: string | null;
  phone?: string | null;
  employee_number?: string | null;
  start_date?: string | null;
  primary_project_id?: string | null;
  is_scaffold_inspector?: boolean;
  temp_password?: string | null;
}

interface Body extends PersonInput {
  action?: "create" | "import" | "send_invite" | "set_active" | "invite" | "resend" | "revoke";
  redirect_to?: string;
  send_invite?: boolean;
  rows?: PersonInput[];
  profile_id?: string;
  active?: boolean;
  invitation_id?: string;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function createPerson(admin: SupabaseClient, anon: SupabaseClient, p: PersonInput, invitedBy: string | null,
  sendInvite: boolean, redirectTo: string | undefined): Promise<{ ok: true; profile_id: string; invited: boolean } | { ok: false; error: string }> {
  const email = p.email?.trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) return { ok: false, error: "Valid email required" };
  if (!p.full_name?.trim()) return { ok: false, error: "Full name required" };
  if (!p.role || !ROLES.includes(p.role)) return { ok: false, error: `Role must be one of: ${ROLES.join(", ")}` };
  if (!p.organization_id) return { ok: false, error: "Company required" };
  if (p.start_date && !DATE_RE.test(p.start_date)) return { ok: false, error: "Start date must be YYYY-MM-DD" };
  if (p.temp_password && p.temp_password.length < 8) return { ok: false, error: "Temporary password must be at least 8 characters" };

  const { data: existing } = await admin.from("profiles").select("id").ilike("email", email).maybeSingle();
  if (existing) return { ok: false, error: "A person with this email already exists" };

  await admin.from("user_invitations").update({ status: "revoked" }).ilike("email", email).eq("status", "pending");
  const { data: inv, error: invErr } = await admin.from("user_invitations").insert({
    email,
    full_name: p.full_name.trim(),
    role: p.role,
    organization_id: p.organization_id,
    job_role_id: p.job_role_id || null,
    phone: p.phone?.trim() || null,
    employee_number: p.employee_number?.trim() || null,
    start_date: p.start_date || null,
    primary_project_id: p.primary_project_id || null,
    is_scaffold_inspector: !!p.is_scaffold_inspector,
    invited_by: invitedBy,
  }).select().single();
  if (invErr) return { ok: false, error: invErr.message };

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    ...(p.temp_password ? { password: p.temp_password } : {}),
    user_metadata: { full_name: p.full_name.trim(), ...(p.temp_password ? { must_change_password: true } : {}) },
  });
  if (createErr || !created.user) {
    await admin.from("user_invitations").update({ status: "revoked" }).eq("id", inv.id);
    return { ok: false, error: createErr?.message ?? "Could not create the account" };
  }

  let invited = false;
  if (sendInvite && !p.temp_password) {
    const { error } = await anon.auth.resetPasswordForEmail(email, { redirectTo });
    invited = !error;
  }
  return { ok: true, profile_id: created.user.id, invited };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const caller = createClient(url, anonKey, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: isAdmin, error: adminErr } = await caller.rpc("is_admin");
  if (adminErr || !isAdmin) return json(403, { error: "Only admins can manage people" });
  const { data: { user } } = await caller.auth.getUser();

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON" });
  }
  const redirectTo = body.redirect_to && /^https?:\/\//.test(body.redirect_to) ? body.redirect_to : (Deno.env.get("APP_URL") ?? undefined);
  const action = body.action === "invite" ? "create" : body.action ?? "create";

  if (action === "create") {
    const r = await createPerson(admin, anon, body, user?.id ?? null, body.send_invite ?? !body.temp_password, redirectTo);
    return r.ok ? json(200, r) : json(400, { error: r.error });
  }

  if (action === "import") {
    const rows = body.rows ?? [];
    if (!rows.length) return json(400, { error: "No rows to import" });
    if (rows.length > 300) return json(400, { error: "Import at most 300 people at a time" });
    const results = [];
    for (const [i, row] of rows.entries()) {
      const r = await createPerson(admin, anon, row, user?.id ?? null, !!body.send_invite, redirectTo);
      results.push({ row: i + 1, email: row.email ?? "", ...r });
    }
    return json(200, { results });
  }

  if (action === "send_invite" || action === "resend") {
    let email: string | undefined;
    if (body.profile_id) {
      const { data } = await admin.from("profiles").select("email, is_active").eq("id", body.profile_id).single();
      if (!data) return json(404, { error: "Person not found" });
      if (!data.is_active) return json(400, { error: "Reactivate this person before sending an invite" });
      email = data.email;
    } else if (body.invitation_id) {
      const { data } = await admin.from("user_invitations").select("email").eq("id", body.invitation_id).single();
      email = data?.email;
    }
    if (!email) return json(400, { error: "profile_id required" });
    const { error } = await anon.auth.resetPasswordForEmail(email, { redirectTo });
    return error ? json(400, { error: `Email not sent: ${error.message}` }) : json(200, { ok: true });
  }

  if (action === "set_active") {
    if (!body.profile_id || typeof body.active !== "boolean") return json(400, { error: "profile_id and active required" });
    if (body.profile_id === user?.id && !body.active) return json(400, { error: "You can't deactivate yourself" });
    const { error } = await admin.from("profiles").update({ is_active: body.active }).eq("id", body.profile_id);
    if (error) return json(400, { error: error.message });
    await admin.auth.admin.updateUserById(body.profile_id, { ban_duration: body.active ? "none" : "876000h" });
    return json(200, { ok: true });
  }

  if (action === "revoke") {
    if (!body.invitation_id) return json(400, { error: "invitation_id required" });
    const { error } = await admin.from("user_invitations").update({ status: "revoked" }).eq("id", body.invitation_id).eq("status", "pending");
    return error ? json(400, { error: error.message }) : json(200, { ok: true });
  }

  return json(400, { error: "Unknown action" });
});
