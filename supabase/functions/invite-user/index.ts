// Supabase Edge Function: invite-user
// Leaders invite a user by email with a role, company and job role. The
// invitation row is what handle_new_user() reads when the invitee accepts, so
// the role/company assignment is decided server-side, never by the client.
//
// Deploy:  supabase functions deploy invite-user
// Env:     SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (provided by Supabase)
//          APP_URL (optional) – where the invite email should redirect
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Body = {
  action?: "invite" | "resend" | "revoke";
  /** Where the email link should land (must be in Auth > URL Configuration > Redirect URLs). */
  redirect_to?: string;
  /** Create the account immediately with this password instead of emailing an invite. */
  temp_password?: string;
  invitation_id?: string;
  email?: string;
  full_name?: string;
  role?: "leader" | "employee" | "contractor";
  organization_id?: string;
  job_role_id?: string | null;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const envAppUrl = Deno.env.get("APP_URL") ?? undefined;

  // Caller's own client — RLS applies, so this proves they are an active leader.
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: isLeader, error: leaderErr } = await caller.rpc("is_leader");
  if (leaderErr || !isLeader) return json(403, { error: "Only leaders can manage invitations" });
  const { data: { user } } = await caller.auth.getUser();

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON" });
  }
  const action = body.action ?? "invite";
  const appUrl = body.redirect_to && /^https?:\/\//.test(body.redirect_to) ? body.redirect_to : envAppUrl;

  if (action === "revoke") {
    if (!body.invitation_id) return json(400, { error: "invitation_id required" });
    const { error } = await admin.from("user_invitations").update({ status: "revoked" })
      .eq("id", body.invitation_id).eq("status", "pending");
    return error ? json(400, { error: error.message }) : json(200, { ok: true });
  }

  if (action === "resend") {
    if (!body.invitation_id) return json(400, { error: "invitation_id required" });
    const { data: inv, error } = await admin.from("user_invitations").select("*")
      .eq("id", body.invitation_id).single();
    if (error || !inv) return json(404, { error: "Invitation not found" });
    await admin.from("user_invitations")
      .update({ expires_at: new Date(Date.now() + 14 * 864e5).toISOString(), status: "pending" })
      .eq("id", inv.id);
    const { error: mailErr } = await admin.auth.admin.inviteUserByEmail(inv.email, {
      redirectTo: appUrl, data: { full_name: inv.full_name },
    });
    return mailErr ? json(400, { error: mailErr.message }) : json(200, { ok: true });
  }

  // invite
  const email = body.email?.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: "Valid email required" });
  if (!body.role || !["leader", "employee", "contractor"].includes(body.role)) return json(400, { error: "Invalid role" });
  if (!body.organization_id) return json(400, { error: "organization_id required" });

  const { data: existing } = await admin.from("profiles").select("id").ilike("email", email).maybeSingle();
  if (existing) return json(409, { error: "A user with this email already exists" });

  // Replace any earlier pending invitation for this address.
  await admin.from("user_invitations").update({ status: "revoked" }).ilike("email", email).eq("status", "pending");

  const { data: inv, error: invErr } = await admin.from("user_invitations").insert({
    email,
    full_name: body.full_name ?? null,
    role: body.role,
    organization_id: body.organization_id,
    job_role_id: body.job_role_id ?? null,
    invited_by: user?.id ?? null,
  }).select().single();
  // enforce_role_org_match() rejects e.g. an employee attached to a contractor company.
  if (invErr) return json(400, { error: invErr.message });

  if (body.temp_password) {
    if (body.temp_password.length < 8) {
      await admin.from("user_invitations").delete().eq("id", inv.id);
      return json(400, { error: "Temporary password must be at least 8 characters" });
    }
    // handle_new_user() picks up the invitation row created above.
    const { error: createErr } = await admin.auth.admin.createUser({
      email, password: body.temp_password, email_confirm: true,
      user_metadata: { full_name: body.full_name ?? "", must_change_password: true },
    });
    if (createErr) {
      await admin.from("user_invitations").delete().eq("id", inv.id);
      return json(400, { error: createErr.message });
    }
    return json(200, { invitation: { ...inv, status: "accepted" }, created: true });
  }

  const { error: mailErr } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: appUrl, data: { full_name: body.full_name ?? "" },
  });
  if (mailErr) {
    await admin.from("user_invitations").delete().eq("id", inv.id);
    return json(400, { error: mailErr.message });
  }
  return json(200, { invitation: inv });
});
