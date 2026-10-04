// THE CONTEXT SWEEP'S DOOR (slice 09 QA, 2026-10-04: context_packages_sweep had
// no way to be run). The database function expires every context package past
// its time and deletes the encrypted copies whose purge time has come; it is
// granted to the service role only, and nothing in this deployment runs on a
// schedule (the package's rule: no scheduled work, no background AI). So the
// one door is the person's own tap: AI Hub > Agents > Clear Expired Shares.
// It takes the person's session, runs the function with the service role, and
// answers with the two counts. It touches only what is already expired, so it
// is the same housekeeping whoever taps it, and it reads and returns no
// context.
export const config = { runtime: "edge" };

import { authedUser, failResponse, fail, json, readEnv, serviceRpc } from "../_email";

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const env = readEnv();
  if (!env) return failResponse(fail("UNAVAILABLE"));
  const who = await authedUser(req, env);
  if ("code" in who) return failResponse(who);
  const r = await serviceRpc(env, "context_packages_sweep", {});
  if (r.error) return failResponse(fail("UNAVAILABLE"));
  const d = (r.data ?? {}) as { expired?: unknown; purged?: unknown };
  return json({ ok: true, expired: typeof d.expired === "number" ? d.expired : 0, purged: typeof d.purged === "number" ? d.purged : 0 });
}
