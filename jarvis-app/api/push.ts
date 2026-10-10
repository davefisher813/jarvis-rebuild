// Vercel Edge function: the web push proxy. The thin half: reads the server
// variables, hands the request to src/push/proxy.ts, which is where the rules
// live and where the tests are. See that file for the routes.
//
// Every variable read here has a line in .env.example (src/laws/env.test.ts).
export const config = { runtime: "nodejs" };

import { connect } from "node:http2";

function h2probe(host: string): Promise<unknown> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ error: "timeout" }), 8000);
    try {
      const c = connect(`https://${host}`);
      c.on("error", (e) => { clearTimeout(t); resolve({ error: String(e).slice(0, 200) }); });
      const r = c.request({ ":method": "POST", ":path": "/3/device/0000", "apns-topic": "probe", "content-type": "application/json" });
      let status = 0; let body = "";
      r.on("response", (h) => { status = Number(h[":status"]); });
      r.on("data", (d) => { body += d; });
      r.on("end", () => { clearTimeout(t); c.close(); resolve({ status, body: body.slice(0, 200) }); });
      r.on("error", (e) => { clearTimeout(t); c.close(); resolve({ error: String(e).slice(0, 200) }); });
      r.end("{}");
    } catch (e) { clearTimeout(t); resolve({ error: String(e).slice(0, 200) }); }
  });
}


// The native build posts from capacitor://localhost, a different origin, so
// the browser sends a preflight first. Web push itself is web only, but a
// preflight that is not answered is a 404 nobody can read on a phone.
const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-max-age": "86400",
};

async function handler(req: Request): Promise<Response> {
  if (new URL(req.url).searchParams.get("apnsprobe") === "1") {
    return Response.json({ runtime: "nodejs", prod: await h2probe("api.push.apple.com"), sandbox: await h2probe("api.sandbox.push.apple.com") });
  }
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  let handlePush: typeof import("../src/push/proxy").handlePush;
  try {
    ({ handlePush } = await import("../src/push/proxy"));
  } catch (e) {
    return Response.json({ importError: String(e).slice(0, 400) }, { status: 500 });
  }
  const res = await handlePush(req, {
    env: {
      JARVIS_SECRET: process.env.JARVIS_SECRET,
      JARVIS_BACKEND_URL: process.env.JARVIS_BACKEND_URL,
      SUPABASE_URL: process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
      SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY,
      // The build flags, for the backend inbox pull (POST /api/push?inbox=pull is 404 without vyzn_sync_v1).
      FLAGS: process.env.VITE_JARVIS_FLAGS,
    },
    fetchImpl: (url, init) => fetch(url, init),
  });
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
  return res;
}

export const GET = handler;
export const POST = handler;
export const DELETE = handler;
export const OPTIONS = handler;
