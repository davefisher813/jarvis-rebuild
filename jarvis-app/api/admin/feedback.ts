import { requireAdmin, svcHeaders, json } from "../_admin";
import { mapFeedback, type RawFeedback } from "../../src/admin/adminCompute";

// UP-LAUNCH-16 (2026-09-05): the newest fifty messages from Settings >
// Support > Send Feedback. Read only: nothing in the panel edits or deletes
// them, because the point of the table is that a message cannot be lost by a
// stray tap on the screen that reads it.
//
// feedback is service-role only (migration 0033), so this endpoint is the
// only way the rows are readable at all, and requireAdmin is the gate.
export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;
  const { ctx } = gate;

  const r = await fetch(
    `${ctx.url}/rest/v1/feedback?select=id,text,build,device,template,last_error,created_at&order=created_at.desc&limit=50`,
    { headers: svcHeaders(ctx) },
  );
  if (!r.ok) return json({ error: "Could not load feedback" }, 502);
  const rows = (await r.json()) as RawFeedback[];
  return json({ feedback: mapFeedback(rows) });
}
