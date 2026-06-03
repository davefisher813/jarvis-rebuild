import { requireAdmin, svcHeaders, json } from "../_admin";
import { mapUsers, type RawUser, type ProfileRow } from "../../src/admin/adminCompute";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;
  const { ctx } = gate;

  if (req.method === "GET") {
    const ur = await fetch(`${ctx.url}/auth/v1/admin/users?per_page=200`, { headers: svcHeaders(ctx) });
    if (!ur.ok) return json({ error: "Could not list users" }, 502);
    const raw = (((await ur.json()) as { users?: RawUser[] }).users) || [];
    const pr = await fetch(`${ctx.url}/rest/v1/item?entity_type=eq.profile&select=owner_id,data`, { headers: svcHeaders(ctx) });
    const profiles = pr.ok ? ((await pr.json()) as ProfileRow[]) : [];
    return json({ users: mapUsers(raw, profiles) });
  }

  if (req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as { id?: string; status?: string };
    if (!body.id || (body.status !== "active" && body.status !== "disabled")) return json({ error: "Bad request" }, 400);
    const ban = body.status === "disabled" ? "876000h" : "none";
    const r = await fetch(`${ctx.url}/auth/v1/admin/users/${body.id}`, {
      method: "PUT",
      headers: { ...svcHeaders(ctx), "content-type": "application/json" },
      body: JSON.stringify({ ban_duration: ban }),
    });
    if (!r.ok) return json({ error: "Could not update user" }, 502);
    return json({ ok: true });
  }

  return json({ error: "Method not allowed" }, 405);
}
