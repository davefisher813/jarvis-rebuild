import { requireAdmin, svcHeaders, json } from "../_admin";
import { computeMetrics, type OpenRow, type FunnelCounts } from "../../src/admin/adminMetrics";

// UP-LAUNCH-17 (2026-09-05), fork option A. The launch numbers, computed from
// rows this app already writes: no vendor, no SDK, no identifier leaving the
// stack, and nothing here that is not already text-free by construction.
//
// Everything privileged happens with the service key behind requireAdmin, the
// same as the other three admin endpoints. event_log has no client policies at
// all, so this is the only way these rows are readable.
export const config = { runtime: "edge" };

const DAY = 86400000;
// The ceiling on rows fetched for the retention walk. Past it the numbers
// would be computed from a partial history, so they are withheld rather than
// guessed: computeMetrics takes `truncated` and answers null for D1 and D7.
const ROW_CAP = 20000;

function localDay(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

async function countOf(url: string, headers: Record<string, string>): Promise<number> {
  const r = await fetch(url, { headers: { ...headers, Prefer: "count=exact", Range: "0-0" } });
  if (!r.ok) return 0;
  return parseInt((r.headers.get("content-range") || "*/0").split("/")[1] || "0", 10) || 0;
}

export default async function handler(req: Request): Promise<Response> {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;
  const { ctx } = gate;
  const h = svcHeaders(ctx);
  const now = Date.now();
  const since7 = new Date(now - 7 * DAY).toISOString();

  const ur = await fetch(`${ctx.url}/auth/v1/admin/users?per_page=200`, { headers: h });
  if (!ur.ok) return json({ error: "Could not load metrics" }, 502);
  const users = (((await ur.json()) as { users?: { created_at?: string }[] }).users) || [];

  // The retention walk needs one row per user per day they opened the app.
  // Ninety days is the window every number here is about, and it is also the
  // window the 0015 header promised the table would eventually be pruned to.
  const or = await fetch(
    `${ctx.url}/rest/v1/event_log?type=eq.app.opened&day=gte.${localDay(now - 90 * DAY)}&select=owner_id,day&limit=${ROW_CAP}`,
    { headers: h },
  );
  const opens = (or.ok ? ((await or.json()) as OpenRow[]) : []) || [];

  const [started, finished, skipped, aiCalls7d] = await Promise.all([
    countOf(`${ctx.url}/rest/v1/event_log?type=eq.onboarding.step&n=eq.0&select=id`, h),
    countOf(`${ctx.url}/rest/v1/event_log?type=eq.onboarding.finished&flag=is.true&select=id`, h),
    countOf(`${ctx.url}/rest/v1/event_log?type=eq.onboarding.finished&flag=is.false&select=id`, h),
    countOf(`${ctx.url}/rest/v1/ai_usage?created_at=gte.${since7}&select=id`, h),
  ]);
  const funnel: FunnelCounts = { started, finished, skipped };

  return json(computeMetrics({
    users,
    opens,
    funnel,
    aiCalls7d,
    truncated: opens.length >= ROW_CAP,
    today: localDay(now),
    now,
  }));
}
