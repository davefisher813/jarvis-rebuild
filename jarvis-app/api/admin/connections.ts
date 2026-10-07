import { requireAdmin, svcHeaders, json } from "../_admin";
import { incidentId } from "../../src/connections/incident";
import { summarizeConnections, type RawGrant } from "../../src/admin/adminConnections";

// Foundation Fix Spec 3 (2026-10-07): the admin-visible connection-health line.
// Every stored Google sign-in, counted, with the ones that are not healthy
// listed (a lost grant first, then one that is only failing) and each lost
// grant's incident ID, so an admin can match it to the error-sink line and to
// the notification the person got. Read only. google_tokens is service-role
// only (migration 0055/0057), so this endpoint behind requireAdmin is the only
// way these rows are readable at all. Needs migration 0057 for the state and
// failure columns; without it the section says so instead of guessing.
export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;
  const { ctx } = gate;

  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const r = await fetch(
    `${ctx.url}/rest/v1/google_tokens?select=email,state,dead_at,last_refresh_ok_at,consecutive_failures,last_auth_error&limit=1000`,
    { headers: svcHeaders(ctx) },
  );
  if (!r.ok) return json({ error: "Could not load connections" }, 502);
  const grants = (await r.json()) as RawGrant[];
  // A DEAD row's incident anchor is the instant the first confirmed failure was recorded, the same one the status route uses.
  const withAnchor = grants.map((g) => ({ ...g, dead_at: (g.last_auth_error as { oauthRefreshFailedAt?: string } | null)?.oauthRefreshFailedAt ?? g.dead_at }));
  return json(summarizeConnections(withAnchor, (email, anchor) => incidentId(email, "auth", new Date(anchor).toISOString())));
}
