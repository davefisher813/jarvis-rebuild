import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { handleAgentRequest, type GatewayDeps, type RpcResult } from "./handler";
import { sha256Hex } from "../canonical";
import { parseFlags } from "../flagList";

const TOKEN = "jarvis_agent_" + "a".repeat(43);
const CONN = "50000000-0000-0000-0000-00000000000a";
const OWNER = "00000000-0000-0000-0000-00000000000a";
const PKG = "c0000000-0000-0000-0000-00000000000a";
const JOB = "a0000000-0000-0000-0000-00000000000a";

function rig(over: Partial<Record<string, (args: Record<string, unknown>) => RpcResult | Promise<RpcResult>>> = {}, status = "connected", mode = "help_me", caps: string[] = ["read_context", "propose"]) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const table: Record<string, (args: Record<string, unknown>) => RpcResult | Promise<RpcResult>> = {
    agent_resolve_token: async (a) => ({ data: a.p_token_hash === await sha256Hex(TOKEN) ? { connection_id: CONN, owner_id: OWNER, status, mode, verified_capabilities: caps, auth_epoch: 1, display_name: "Claude" } : null, error: null }),
    agent_rate_take: () => ({ data: true, error: null }),
    agent_capabilities: () => ({ data: { protocol_version: 1, mode: "help_me", capabilities: ["read_context", "propose"], unavailable: [] }, error: null }),
    context_preview: () => ({ data: { manifest: [], record_count: 0, requires_user_grant: true, manifest_hash: "f".repeat(64) }, error: null }),
    context_issue: () => ({ data: { package_id: PKG, manifest: [{ resource_id: JOB }], data: { [JOB]: { title: "Summer travel" } }, expires_at: "2026-10-03T12:15:00Z" }, error: null }),
    context_snapshot_store: () => ({ data: true, error: null }),
    proposal_submit: () => ({ data: { proposal_id: "d0000000-0000-0000-0000-00000000000a", status: "proposed" }, error: null }),
    draft_submit: () => ({ data: { draft_id: "f2000000-0000-0000-0000-00000000000a", revision: 1 }, error: null }),
    review_link: () => ({ data: { path: "/hub/review/x" }, error: null }),
    action_status: () => ({ data: { state: "confirmed", exact_verb: "Read 1 record in Summer travel" }, error: null }),
    record_push: () => ({ data: { received: 1, written: 1, results: [{ source_record_id: "inbox_1", revision: 1, outcome: "proposed", proposal_id: "d0000000-0000-0000-0000-00000000000b", superseded: 0 }], receipt_id: "f0000000-0000-0000-0000-00000000000c", replay: false }, error: null }),
    ...over,
  };
  const deps: GatewayDeps = {
    rpc: async (fn, args) => { calls.push({ fn, args }); const f = table[fn]; return f ? f(args) : { data: null, error: { code: "404" } }; },
    sha256: sha256Hex,
    encrypt: async (plain) => "enc:" + plain.length,
    correlationId: () => "corr-1",
  };
  return { deps, calls };
}

const post = (body: unknown, authorization: string | null = `Bearer ${TOKEN}`) => ({ method: "POST", authorization, bodyText: typeof body === "string" ? body : JSON.stringify(body) });

describe("the agent gateway handler", () => {
  it("refuses a body that is not the protocol, before any token is looked at", async () => {
    const { deps, calls } = rig();
    expect((await handleAgentRequest(post("not json"), deps)).status).toBe(422);
    expect((await handleAgentRequest(post({ protocol_version: 2, method: "capabilities" }), deps)).status).toBe(422);
    expect((await handleAgentRequest(post({ protocol_version: 1, method: "execute" }), deps)).status).toBe(422);
    expect((await handleAgentRequest(post({ protocol_version: 1, method: "capabilities", extra: 1 }), deps)).status).toBe(422);
    expect((await handleAgentRequest({ method: "GET", authorization: null, bodyText: "" }, deps)).status).toBe(405);
    expect(calls).toEqual([]);
  });
  it("a missing, malformed or unknown token is 401 and nothing else runs", async () => {
    const { deps, calls } = rig();
    expect((await handleAgentRequest(post({ protocol_version: 1, method: "capabilities" }, null), deps)).status).toBe(401);
    expect((await handleAgentRequest(post({ protocol_version: 1, method: "capabilities" }, "Bearer short"), deps)).status).toBe(401);
    expect((await handleAgentRequest(post({ protocol_version: 1, method: "capabilities" }, "Bearer jarvis_agent_" + "b".repeat(43)), deps)).status).toBe(401);
    expect(calls.map((c) => c.fn)).toEqual(["agent_resolve_token"]);
  });
  it("the token reaches the database only as its hash", async () => {
    const { deps, calls } = rig();
    await handleAgentRequest(post({ protocol_version: 1, method: "capabilities" }), deps);
    expect(calls[0]!.args.p_token_hash).toBe(await sha256Hex(TOKEN));
    expect(JSON.stringify(calls)).not.toContain(TOKEN);
  });
  it("a revoked connection is 410; the bucket refuses with 429 and retry-after", async () => {
    expect((await handleAgentRequest(post({ protocol_version: 1, method: "capabilities" }), rig({}, "revoked").deps)).status).toBe(410);
    const r = await handleAgentRequest(post({ protocol_version: 1, method: "capabilities" }), rig({ agent_rate_take: () => ({ data: false, error: null }) }).deps);
    expect(r.status).toBe(429);
    expect(r.headers).toEqual({ "retry-after": "5" });
    expect((r.body as { retryable: boolean }).retryable).toBe(true);
  });
  it("capabilities answers from the function", async () => {
    const r = await handleAgentRequest(post({ protocol_version: 1, method: "capabilities" }), rig().deps);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ protocol_version: 1, capabilities: ["read_context", "propose"] });
  });
  it("S21: a payload carrying authority is refused as a shape and never reaches the function", async () => {
    const { deps, calls } = rig();
    const r = await handleAgentRequest(post({ protocol_version: 1, method: "proposal.submit", params: { package_id: PKG, surface: "project", type: "decision", payload: { statement: "x", meta: { execute: true } }, idempotency_key: "k1" } }), deps);
    expect(r.status).toBe(422);
    expect(calls.map((c) => c.fn)).not.toContain("proposal_submit");
    const extra = await handleAgentRequest(post({ protocol_version: 1, method: "proposal.submit", params: { package_id: PKG, surface: "project", type: "decision", payload: { statement: "x" }, idempotency_key: "k1", approved: true } }), deps);
    expect(extra.status).toBe(422);
  });
  it("S02: a read-only agent's proposal, and an unverified draft, are refused before the function runs", async () => {
    const ro = rig({}, "connected", "read_only");
    const r = await handleAgentRequest(post({ protocol_version: 1, method: "proposal.submit", params: { package_id: PKG, surface: "project", type: "decision", payload: { statement: "x" }, idempotency_key: "k" } }), ro.deps);
    expect(r.status).toBe(403);
    expect((r.body as { code: string }).code).toBe("MODE_CEILING");
    expect(ro.calls.map((c) => c.fn)).not.toContain("proposal_submit");
    // The safe denied receipt (S02): who, which method, which code. Never the params.
    const denied = ro.calls.find((c) => c.fn === "access_denied_record");
    expect(denied?.args).toEqual({ p_owner: OWNER, p_connection: CONN, p_method: "proposal.submit", p_code: "MODE_CEILING" });
    expect(JSON.stringify(denied)).not.toContain("statement");
    const nd = rig();
    const d = await handleAgentRequest(post({ protocol_version: 1, method: "draft.submit", params: { package_id: PKG, draft: { account_id: OWNER, to: ["a@example.test"] } } }), nd.deps);
    expect((d.body as { code: string }).code).toBe("CAPABILITY_UNVERIFIED");
    expect(nd.calls.map((c) => c.fn)).not.toContain("draft_submit");
    expect(nd.calls.find((c) => c.fn === "access_denied_record")?.args.p_code).toBe("CAPABILITY_UNVERIFIED");
    // A failing receipt write never turns a refusal into anything else.
    const broken = rig({ access_denied_record: () => ({ data: null, error: { code: "500" } }) }, "connected", "read_only");
    const still = await handleAgentRequest(post({ protocol_version: 1, method: "proposal.submit", params: { package_id: PKG, surface: "project", type: "decision", payload: { statement: "x" }, idempotency_key: "k" } }), broken.deps);
    expect(still.status).toBe(403);
  });
  it("a function's refusal becomes the protocol's error: code, safe line, correlation id, status", async () => {
    const r = await handleAgentRequest(post({ protocol_version: 1, method: "context.preview", params: { job_id: JOB } }), rig({ context_preview: () => ({ data: { error: "STALE_SCOPE" }, error: null }) }).deps);
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ code: "STALE_SCOPE", safe_message: "The shared context changed. Preview it again.", retryable: false, correlation_id: "corr-1" });
    const ai = await handleAgentRequest(post({ protocol_version: 1, method: "context.preview", params: { job_id: JOB } }), rig({ context_preview: () => ({ data: { error: "AI_DISABLED" }, error: null }) }).deps);
    expect(ai.status).toBe(403);
    const gone = await handleAgentRequest(post({ protocol_version: 1, method: "proposal.submit", params: { package_id: PKG, surface: "project", type: "decision", payload: { statement: "x" }, idempotency_key: "k" } }), rig({ proposal_submit: () => ({ data: { error: "PACKAGE_EXPIRED" }, error: null }) }).deps);
    expect(gone.status).toBe(410);
    const down = await handleAgentRequest(post({ protocol_version: 1, method: "context.preview", params: { job_id: JOB } }), rig({ context_preview: () => ({ data: null, error: { code: "500" } }) }).deps);
    expect(down.status).toBe(503);
  });
  it("context.issue stores the encrypted snapshot after the function's receipt, and is unavailable without a key", async () => {
    const { deps, calls } = rig();
    const r = await handleAgentRequest(post({ protocol_version: 1, method: "context.issue", params: { job_id: JOB, manifest_hash: "f".repeat(64) } }), deps);
    expect(r.status).toBe(200);
    expect(calls.map((c) => c.fn)).toEqual(["agent_resolve_token", "agent_rate_take", "context_issue", "context_snapshot_store"]);
    expect(calls[3]!.args.p_cipher).toMatch(/^enc:/);
    const noKey = rig(); delete noKey.deps.encrypt;
    const r2 = await handleAgentRequest(post({ protocol_version: 1, method: "context.issue", params: { job_id: JOB, manifest_hash: "f".repeat(64) } }), noKey.deps);
    expect(r2.status).toBe(503);
    expect(noKey.calls.map((c) => c.fn)).not.toContain("context_issue");
  });
  it("a new proposal is 201, a replay 200; a draft is 201; connection.revoke is never an agent's", async () => {
    expect((await handleAgentRequest(post({ protocol_version: 1, method: "proposal.submit", params: { package_id: PKG, surface: "project", type: "decision", payload: { statement: "x" }, idempotency_key: "k" } }), rig().deps)).status).toBe(201);
    expect((await handleAgentRequest(post({ protocol_version: 1, method: "proposal.submit", params: { package_id: PKG, surface: "project", type: "decision", payload: { statement: "x" }, idempotency_key: "k" } }), rig({ proposal_submit: () => ({ data: { proposal_id: "p", status: "proposed", replay: true }, error: null }) }).deps)).status).toBe(200);
    const drafter = () => rig({}, "connected", "help_me", ["read_context", "propose", "write_inert_draft"]).deps;
    expect((await handleAgentRequest(post({ protocol_version: 1, method: "draft.submit", params: { package_id: PKG, draft: { account_id: OWNER, to: ["a@example.test"], subject: "Re", body_text: "On it." } } }), drafter())).status).toBe(201);
    expect((await handleAgentRequest(post({ protocol_version: 1, method: "draft.submit", params: { package_id: PKG, draft: { account_id: OWNER, to: ["a@example.test"], html: "<b>" } } }), drafter())).status).toBe(422);
    expect((await handleAgentRequest(post({ protocol_version: 1, method: "connection.revoke", params: { connection_id: CONN } }), rig().deps)).status).toBe(403);
    expect((await handleAgentRequest(post({ protocol_version: 1, method: "action.status", params: { action_id: CONN } }), rig().deps)).body).toMatchObject({ state: "confirmed" });
  });

  // THE VYZN FEED (PHASE0-DESIGN.md D6; migration 0061). record.push is the one method an outside app has:
  // behind the vyzn_sync_v1 flag, propose only, every record and its data read for authority words first,
  // and the function asked with the connection the token resolved to and nothing from the request.
  describe("record.push", () => {
    const RECORD = { source_record_id: "inbox_11111111-1111-4111-8111-111111111111", revision: 1, kind: "task", data: { text: "Send the grant letter", due: "2026-10-01" }, source: { label: "Added by Michael Corleone" }, client_at: "2026-10-09T12:00:00.000Z" };
    const push = (records: unknown[] = [RECORD], source_app = "backend-inbox") => post({ protocol_version: 1, method: "record.push", params: { source_app, records } });
    const on = parseFlags("vyzn_sync_v1");

    it("answers 503 UNAVAILABLE with the flag off, and the function is never called", async () => {
      const off = rig();
      const r = await handleAgentRequest(push(), off.deps);
      expect(r.status).toBe(503);
      expect((r.body as { code: string }).code).toBe("UNAVAILABLE");
      expect(off.calls.map((c) => c.fn)).not.toContain("record_push");
      const other = rig(); other.deps.flags = parseFlags("memory_v1,trust_v1");
      expect((await handleAgentRequest(push(), other.deps)).status).toBe(503);
    });
    it("a smuggled status inside a record's data is INVALID_PAYLOAD before any function runs", async () => {
      const { deps, calls } = rig(); deps.flags = on;
      const r = await handleAgentRequest(push([RECORD, { ...RECORD, source_record_id: "inbox_2", data: { text: "x", status: "accepted" } }]), deps);
      expect(r.status).toBe(422);
      expect(calls.map((c) => c.fn)).not.toContain("record_push");
      // And at the record level, where the schema already refuses an unknown property.
      const top = await handleAgentRequest(push([{ ...RECORD, approved: true }]), deps);
      expect(top.status).toBe(422);
      const shape = await handleAgentRequest(push([{ ...RECORD, kind: "bill" }]), deps);
      expect(shape.status).toBe(422);
      const app = await handleAgentRequest(push([RECORD], "notion"), deps);
      expect(app.status).toBe(422);
      expect(calls.map((c) => c.fn)).not.toContain("record_push");
    });
    it("a read only connection is MODE_CEILING, refused before the function with the safe denied receipt", async () => {
      const ro = rig({}, "connected", "read_only"); ro.deps.flags = on;
      const r = await handleAgentRequest(push(), ro.deps);
      expect(r.status).toBe(403);
      expect((r.body as { code: string }).code).toBe("MODE_CEILING");
      expect(ro.calls.map((c) => c.fn)).not.toContain("record_push");
      expect(ro.calls.find((c) => c.fn === "access_denied_record")?.args).toEqual({ p_owner: OWNER, p_connection: CONN, p_method: "record.push", p_code: "MODE_CEILING" });
      expect(JSON.stringify(ro.calls)).not.toContain("grant letter");
      const unverified = rig({}, "connected", "help_me", ["read_context"]); unverified.deps.flags = on;
      expect((await handleAgentRequest(push(), unverified.deps)).body).toMatchObject({ code: "CAPABILITY_UNVERIFIED" });
    });
    it("a first push is 201 and calls record_push with the owner and connection the token resolved to", async () => {
      const { deps, calls } = rig(); deps.flags = on;
      const r = await handleAgentRequest(push(), deps);
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ protocol_version: 1, received: 1, results: [{ outcome: "proposed" }] });
      const call = calls.find((c) => c.fn === "record_push")!;
      expect(call.args).toEqual({ p_owner: OWNER, p_connection: CONN, p_source_app: "backend-inbox", p_records: [RECORD] });
      // Nothing from the request names the owner or the connection: a forged one is not even a field.
      expect((await handleAgentRequest(post({ protocol_version: 1, method: "record.push", params: { source_app: "backend-inbox", records: [RECORD], p_owner: "x" } }), deps)).status).toBe(422);
    });
    it("a whole batch replay is 200; a function refusal is the protocol's error", async () => {
      const replay = rig({ record_push: () => ({ data: { received: 1, written: 0, results: [{ source_record_id: "inbox_1", revision: 1, outcome: "replay", proposal_id: "p", status: "proposed" }], receipt_id: "r", replay: true }, error: null }) });
      replay.deps.flags = on;
      expect((await handleAgentRequest(push(), replay.deps)).status).toBe(200);
      const denied = rig({ record_push: () => ({ data: { error: "SCOPE_DENIED", detail: "read only" }, error: null }) }); denied.deps.flags = on;
      const d = await handleAgentRequest(push(), denied.deps);
      expect(d.status).toBe(403);
      expect(d.body).toEqual({ code: "SCOPE_DENIED", safe_message: "This context wasn't shared with this assistant.", retryable: false, correlation_id: "corr-1" });
      const conflict = rig({ record_push: () => ({ data: { error: "IDEMPOTENCY_CONFLICT", source_record_id: "inbox_1" }, error: null }) }); conflict.deps.flags = on;
      expect((await handleAgentRequest(push(), conflict.deps)).status).toBe(409);
    });
    it("handler.ts and everything it imports never load substrate/flags (import.meta.env would throw at the cold start of api/agent.ts)", () => {
      const here = dirname(new URL(import.meta.url).pathname);
      const resolve = (from: string, spec: string): string | null => {
        if (!spec.startsWith(".")) return null;
        const base = join(dirname(from), spec).replace(/\.(js|ts|tsx)$/, "");
        for (const c of [base + ".ts", base + ".tsx", base + "/index.ts"]) { try { if (statSync(c).isFile()) return c; } catch { /* next */ } }
        return null;
      };
      const seen = new Set<string>();
      const specs: string[] = [];
      const queue = [join(here, "handler.ts")];
      while (queue.length) {
        const f = queue.shift()!;
        if (seen.has(f)) continue;
        seen.add(f);
        const src = readFileSync(f, "utf8").replace(/\b(?:import|export)\s+type\s+[^;]*;/g, "");
        for (const m of src.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"'\n]+)["']/g)) {
          specs.push(m[1]!);
          const to = resolve(f, m[1]!);
          if (to) queue.push(to);
        }
      }
      expect(seen.size).toBeGreaterThan(3);
      expect(specs.filter((s) => /(^|\/)flags$/.test(s))).toEqual([]);
      const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
      expect([...seen].filter((f) => /import\.meta\.env/.test(code(readFileSync(f, "utf8"))))).toEqual([]);
    });
  });
});
