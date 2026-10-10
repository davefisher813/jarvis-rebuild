import { requireAdmin, svcHeaders, json } from "../_admin";
import { mapUsers, type RawUser, type ProfileRow } from "../../src/admin/adminCompute";
import { wipeUserData, type FetchLike } from "../../src/account/deleteAccount";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;
  const { ctx } = gate;

  if (req.method === "GET") {
    // PLUMB-F-21 (2026-09-05): this asked for one page of 200 and called it
    // the user list, so at 201 accounts the panel would have shown 200 and
    // said nothing about the rest, and the Users count beside it would have
    // been wrong. It pages until a short page comes back. The cap is a real
    // limit, not a silent truncation point: past it this screen needs a
    // paginated list rather than one long card.
    const PER_PAGE = 200;
    const MAX_PAGES = 25;
    const raw: RawUser[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const ur = await fetch(`${ctx.url}/auth/v1/admin/users?per_page=${PER_PAGE}&page=${page}`, { headers: svcHeaders(ctx) });
      if (!ur.ok) return json({ error: "Could not list users" }, 502);
      const batch = (((await ur.json()) as { users?: RawUser[] }).users) || [];
      raw.push(...batch);
      if (batch.length < PER_PAGE) break;
    }
    const pr = await fetch(`${ctx.url}/rest/v1/item?entity_type=eq.profile&select=owner_id,data`, { headers: svcHeaders(ctx) });
    const profiles = pr.ok ? ((await pr.json()) as ProfileRow[]) : [];
    return json({ users: mapUsers(raw, profiles) });
  }

  if (req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as { id?: string; status?: string; aiAllowed?: unknown; wipe?: unknown };

    // DEMO TESTER WIPE (Dave, demo week prep, 2026-10-10). A third shape on
    // this same endpoint rather than a new file under api/: a 31st route
    // file is what failed the production build on 2026-10-08
    // (apiFunctionBudget.test.ts holds the count at 30, which api/ is
    // already at). Admin-only by the same requireAdmin gate every other
    // branch here uses, and it takes the target id explicitly, unlike
    // api/account/delete.ts, which deliberately can only act on the caller.
    // wipeUserData clears the account's files and owned rows and stops
    // there: the login and any Google connection are untouched, so the same
    // tester can sign back in to a clean account for the next run.
    if (body.status === undefined && body.aiAllowed === undefined && body.wipe === true) {
      if (typeof body.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id)) {
        return json({ error: "Bad request" }, 400);
      }
      try {
        const { files } = await wipeUserData({ url: ctx.url, serviceKey: ctx.serviceKey }, body.id, fetch as unknown as FetchLike);
        console.log("[jarvis-admin-wipe]", body.id, "files:", files);
        return json({ ok: true, files });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Could not wipe that account";
        console.error("[jarvis-admin-wipe-failed]", body.id, msg);
        return json({ error: msg }, 502);
      }
    }

    // THE ADMIN SWITCH FOR AI (Dave 2026-09-30). One account, one boolean, kept
    // in Supabase app_metadata: writable only with the service key this
    // endpoint holds (requireAdmin above already proved the caller is on the
    // server-side allowlist), never by the account's own user, which is the
    // reason it is not in the profile. GoTrue merges app_metadata, so this
    // touches nothing else stored there. The proxy reads it on the very call
    // that verifies the token, so a flip bites on the next request.
    if (body.status === undefined && typeof body.aiAllowed === "boolean") {
      if (typeof body.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id)) {
        return json({ error: "Bad request" }, 400);
      }
      const r = await fetch(`${ctx.url}/auth/v1/admin/users/${body.id}`, {
        method: "PUT",
        headers: { ...svcHeaders(ctx), "content-type": "application/json" },
        body: JSON.stringify({ app_metadata: { ai_allowed: body.aiAllowed } }),
      });
      if (!r.ok) return json({ error: "Could not update user" }, 502);
      return json({ ok: true, aiAllowed: body.aiAllowed });
    }

    if (!body.id || (body.status !== "active" && body.status !== "disabled")) return json({ error: "Bad request" }, 400);
    // 10 years, the maximum ban this endpoint will ever set. The old value
    // was 876000h (about 100 years), which the 2026-08-14 corrections pack
    // flagged as a DoS vector; a disable should be reversible on a human
    // timescale even if the admin account is compromised.
    const ban = body.status === "disabled" ? "87600h" : "none";
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
