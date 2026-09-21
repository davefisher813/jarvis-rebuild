// Vercel Edge function: the web push proxy. The thin half: reads the server
// variables, hands the request to src/push/proxy.ts, which is where the rules
// live and where the tests are. See that file for the routes.
//
// Every variable read here has a line in .env.example (src/laws/env.test.ts).
export const config = { runtime: "edge" };

import { handlePush } from "../src/push/proxy";

// The native build posts from capacitor://localhost, a different origin, so
// the browser sends a preflight first. Web push itself is web only, but a
// preflight that is not answered is a 404 nobody can read on a phone.
const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-max-age": "86400",
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const res = await handlePush(req, {
    env: {
      JARVIS_SECRET: process.env.JARVIS_SECRET,
      JARVIS_BACKEND_URL: process.env.JARVIS_BACKEND_URL,
      SUPABASE_URL: process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
      SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY,
    },
    fetchImpl: (url, init) => fetch(url, init),
  });
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
  return res;
}
