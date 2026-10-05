import { requireAdmin, svcHeaders, json } from "../_admin";
import { groupErrors, ERROR_WINDOW, type RawClientError } from "../../src/admin/adminErrors";

// 2026-10-05: where to LOOK at crashes. The newest 200 rows of client_error
// (migration 0053, written by api/client-error.ts), grouped by fingerprint so
// one bug on many phones is one line with a count. Read only: nothing in the
// panel edits or deletes a report, and retention is the receiver's job.
//
// client_error is service-role only, so this endpoint is the only way the rows
// are readable at all, and requireAdmin is the gate, exactly as for
// /api/admin/feedback. The stack and context columns are not selected: the
// panel does not draw them, and the SQL editor has them for the deep look.
export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;
  const { ctx } = gate;

  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const r = await fetch(
    `${ctx.url}/rest/v1/client_error?select=created_at,fingerprint,name,message,build,platform&order=created_at.desc&limit=${ERROR_WINDOW}`,
    { headers: svcHeaders(ctx) },
  );
  if (!r.ok) return json({ error: "Could not load errors" }, 502);
  const rows = (await r.json()) as RawClientError[];
  return json({ errors: groupErrors(rows), window: ERROR_WINDOW, rows: rows.length });
}
