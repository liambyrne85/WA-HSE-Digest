// Supabase Edge Function: scaffold-public
//
// The page a scaff tag's QR code opens: /s/{token}. Read-only, no login needed
// unless an Admin turns on "Require sign-in for QR pages". Returns the scaffold's
// live status, details, the latest inspection in full and the inspection history
// (from public.scaffold_public_view — no phone numbers, emails, licence numbers,
// signatures or GPS). Photos come back as signed links that expire after an hour.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

const PREFIX = "storage:form-uploads/";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let token = new URL(req.url).searchParams.get("t") ?? "";
  if (req.method === "POST") {
    try { token = (await req.json())?.token ?? token; } catch { /* keep query token */ }
  }
  if (!/^[0-9a-f]{32,128}$/.test(token)) return json(404, { error: "not_found" });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const { data: settings } = await sb.from("app_settings").select("qr_requires_login").eq("id", 1).single();
  if (settings?.qr_requires_login) {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u } = jwt ? await sb.auth.getUser(jwt) : { data: { user: null } };
    if (!u?.user) return json(401, { login_required: true });
    const { data: prof } = await sb.from("profiles").select("is_active").eq("id", u.user.id).maybeSingle();
    if (!prof?.is_active) return json(403, { login_required: true, error: "Your account is not active" });
  }

  const { data, error } = await sb.rpc("scaffold_public_view", { p_token: token });
  if (error) return json(500, { error: "Could not load this scaffold" });
  if (!data) return json(404, { error: "not_found" });

  // Sign photo links (private bucket).
  const view = data as { scaffold: { photos?: string[] }; latest?: { photos?: string[]; items?: Record<string, { photos?: string[] }> } | null };
  const all: string[] = [...(view.scaffold.photos ?? []), ...(view.latest?.photos ?? []),
    ...Object.values(view.latest?.items ?? {}).flatMap((i) => i?.photos ?? [])];
  const paths = [...new Set(all.filter((r) => typeof r === "string" && r.startsWith(PREFIX)).map((r) => r.slice(PREFIX.length)))];
  const signed = new Map<string, string>();
  if (paths.length) {
    const { data: urls } = await sb.storage.from("form-uploads").createSignedUrls(paths, 3600);
    for (const u of urls ?? []) if (u.path && u.signedUrl) signed.set(PREFIX + u.path, u.signedUrl);
  }
  const sign = (list?: string[]) => (list ?? []).map((r) => signed.get(r)).filter((x): x is string => !!x);
  view.scaffold.photos = sign(view.scaffold.photos);
  if (view.latest) {
    view.latest.photos = sign(view.latest.photos);
    for (const item of Object.values(view.latest.items ?? {})) if (item) item.photos = sign(item.photos);
  }
  return json(200, view);
});
