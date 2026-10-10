// THE AGENT GATEWAY (docs/jarvis-unified, slice 02; IMPLEMENTATION-SPEC.md
// section 05). One POST, one JSON body `{ protocol_version, method, params }`,
// one bearer token that belongs to a connection JARVIS verified. The whole
// path lives in src/substrate/gateway/handler.ts, where the tests are; this
// file only hands it the environment: a service-role RPC, SHA-256, and the
// cipher for context snapshots.
//
// What this door cannot do, by construction: execute anything, approve
// anything, send anything, read an item outside a granted manifest, or see a
// Gmail token. The functions it calls take the owner from the token's
// connection row and nothing from the request.
export const config = { runtime: "edge" };

import { handleAgentRequest, type RpcResult } from "../src/substrate/gateway/handler";
// The pure flag parser, never src/substrate/flags.ts: that module reads import.meta.env at load, which
// throws under Node and would take every agent method down at cold start (PHASE0-DESIGN.md refutation 2.1).
import { parseFlags } from "../src/substrate/flagList";
import { encrypt } from "./_google";

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default async function handler(req: Request): Promise<Response> {
  const supaUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  // SECRET, 32 random bytes base64: encrypts every stored context snapshot.
  // Without it context.issue answers 503 rather than storing plaintext.
  const contextKey = process.env.JARVIS_CONTEXT_KEY || "";
  if (!supaUrl || !service) {
    return json({ code: "UNAVAILABLE", safe_message: "Not available yet.", retryable: true, correlation_id: crypto.randomUUID() }, 503);
  }

  const rpc = async (fn: string, args: Record<string, unknown>): Promise<RpcResult> => {
    try {
      const res = await fetch(`${supaUrl}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: { apikey: service, Authorization: `Bearer ${service}`, "content-type": "application/json" },
        body: JSON.stringify(args),
      });
      if (!res.ok) return { data: null, error: { code: String(res.status) } };
      const text = await res.text();
      return { data: text ? (JSON.parse(text) as unknown) : null, error: null };
    } catch {
      return { data: null, error: { code: "network" } };
    }
  };

  const out = await handleAgentRequest(
    { method: req.method, authorization: req.headers.get("authorization"), bodyText: req.method === "POST" ? await req.text() : "" },
    {
      rpc,
      sha256: sha256Hex,
      ...(contextKey ? { encrypt: (plain: string) => encrypt(plain, contextKey) } : {}),
      correlationId: () => crypto.randomUUID(),
      // The same build string the app reads; record.push is on only when vyzn_sync_v1 is in it.
      flags: parseFlags(process.env.VITE_JARVIS_FLAGS),
    },
  );
  // Observability, minimal: the status, the code and the correlation id.
  // Never the body, a title, an address or a token.
  const code = (out.body as { code?: string } | null)?.code;
  console.log("[agent]", out.status, code ?? "ok", (out.body as { correlation_id?: string } | null)?.correlation_id ?? "");
  return json(out.body, out.status, out.headers ?? {});
}
