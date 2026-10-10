// Client error receiver (PLUMB-F-11, 2026-09-05; stored 2026-10-05). The app's
// monitor seam POSTs one JSON report per caught error here when VITE_ERROR_SINK
// points at it. This is the thin half: it reads the server variables and hands
// the request to src/monitoring/receiver.ts, where the rules and the tests
// live. See that file for why there is no auth, what is stored, and why a
// failed insert never changes the answer.
//
// 2026-10-05: reports used to be a log line and nothing else, and the host
// keeps logs for a very short time. They are now rows in client_error
// (migration 0053), read back in Settings > Admin > Errors.
//
// Every variable read here has a line in .env.example (src/laws/env.test.ts).
export const config = { runtime: "edge" };

import { handleClientError } from "../src/monitoring/receiver";

export default async function handler(req: Request): Promise<Response> {
  // TEMPORARY PROBE on a preview branch only (never merged): can this runtime's fetch reach APNs over HTTP/2?
  if (new URL(req.url).searchParams.get("apnsprobe") === "1") {
    const out: Record<string, unknown> = {};
    for (const host of ["api.push.apple.com", "api.sandbox.push.apple.com"]) {
      try {
        const r = await fetch(`https://${host}/3/device/0000`, { method: "POST", headers: { "apns-topic": "probe" }, body: "{}" });
        out[host] = { status: r.status, body: (await r.text()).slice(0, 200) };
      } catch (e) {
        out[host] = { error: String(e).slice(0, 300) };
      }
    }
    return Response.json(out);
  }
  return handleClientError(req, {
    env: {
      SUPABASE_URL: process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
    fetchImpl: (url, init) => fetch(url, init),
    now: () => Date.now(),
    random: () => Math.random(),
  });
}
