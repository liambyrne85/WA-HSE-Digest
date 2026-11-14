// Supabase Edge Function: send-emails
//
// Sends the emails queued in public.notification_outbox (action assigned / closed /
// reopened, investigation review, workflow rule emails). It's woken by a database
// trigger the moment an email is queued, and every 5 minutes by pg_cron for retries.
//
// Setup (once):
//   * Edge Function secret RESEND_API_KEY  – an API key from resend.com
//   * Admin → Branding: "Send emails from" (an address on a domain verified in Resend)
//     and the app address used for links in emails.
// Callers must send the x-outbox-secret header (checked against Supabase Vault).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

interface Row { id: string; channel: string; recipient: string; subject: string | null; body: string | null; payload: Record<string, unknown> }

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const { data: allowed } = await sb.rpc("email_sender_secret_ok", { p_secret: req.headers.get("x-outbox-secret") ?? "" });
  if (allowed !== true) return json(401, { error: "Not allowed" });

  const key = Deno.env.get("RESEND_API_KEY");
  const { data: settings } = await sb.from("app_settings").select("company_name, email_from, app_url, primary_color").eq("id", 1).single();
  const from = (settings?.email_from as string | null) || Deno.env.get("EMAIL_FROM");
  // Not set up yet: leave everything queued so nothing is lost.
  if (!key || !from) return json(503, { error: "Email not configured (RESEND_API_KEY and the sender address)" });

  const company = (settings?.company_name as string | null) || "Safety";
  const colour = (settings?.primary_color as string | null) || "#2047c6";
  const appUrl = ((settings?.app_url as string | null) || "").replace(/\/$/, "");

  const { data: rows, error } = await sb.rpc("claim_queued_emails", { p_limit: 25 });
  if (error) return json(500, { error: error.message });

  let sent = 0, failed = 0;
  for (const r of (rows ?? []) as Row[]) {
    if (r.channel !== "email") {
      await sb.from("notification_outbox").update({ status: "failed", payload: { ...r.payload, last_error: "SMS is not enabled" } }).eq("id", r.id);
      failed++;
      continue;
    }
    const link = typeof r.payload?.link === "string" && appUrl ? `${appUrl}${r.payload.link}` : null;
    const subject = r.subject || `${company} notification`;
    const text = `${r.body ?? ""}${link ? `\n\nOpen in the app: ${link}` : ""}\n\n— ${company}`;
    const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#111;max-width:560px">
      <p style="font-size:18px;font-weight:bold;margin:0 0 12px">${esc(subject)}</p>
      <p style="margin:0 0 20px;white-space:pre-wrap">${esc(r.body ?? "")}</p>
      ${link ? `<p><a href="${esc(link)}" style="display:inline-block;background:${esc(colour)};color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold">Open in the app</a></p>` : ""}
      <p style="color:#666;font-size:12px;margin-top:28px">${esc(company)} · sent automatically, please don't reply.</p></div>`;
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [r.recipient], subject, text, html }),
      });
      if (res.ok) { await sb.rpc("mark_email", { p_id: r.id, p_ok: true }); sent++; }
      else { await sb.rpc("mark_email", { p_id: r.id, p_ok: false, p_error: `${res.status} ${(await res.text()).slice(0, 300)}` }); failed++; }
    } catch (e) {
      await sb.rpc("mark_email", { p_id: r.id, p_ok: false, p_error: String(e).slice(0, 300) });
      failed++;
    }
  }
  return json(200, { sent, failed });
});
