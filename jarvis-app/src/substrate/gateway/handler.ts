// THE GATEWAY, AS A PURE HANDLER (IMPLEMENTATION-SPEC.md section 05).
// api/agent.ts is a thin edge wrapper around this so the whole request path
// can be tested here with a fake database. The order of checks is the order
// of section 04, and the database functions ask every question again: this
// layer refuses early and cheaply; it never grants anything the functions
// would not.
//
//   1. the body is JSON, under the cap, and matches the request schema
//   2. a bearer token resolves (by hash) to a connected agent
//   3. the connection's bucket has a token
//   4. the method's params match their schema, and no payload carries an
//      authority key
//   5. the matching database function runs; its {error} becomes the
//      protocol's error with a status, a safe line and a correlation id
//
// Nothing here logs a body, a title or a token. The correlation id is the
// only thing that reaches a log beside the method name and the code.

import { AUTHORITY_KEYS, carriesAuthority, validate } from "../schema";
import { authorize, type Operation } from "../authz/engine";
import type { AgentCapability, AgentMode } from "../contracts";
import {
  LIMITS, PARAM_SCHEMAS, PROTOCOL_ERRORS, PROTOCOL_VERSION, REQUEST_SCHEMA, isErrorCode, protocolError,
  type AgentMethod, type ErrorCode, type ProtocolError,
} from "./protocol";

export interface RpcResult { data: unknown; error: { code?: string; message?: string } | null }
export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<RpcResult>;

export interface GatewayDeps {
  rpc: Rpc;
  /** SHA-256 hex of a string; the token is stored and looked up only as this. */
  sha256: (text: string) => Promise<string>;
  /** Encrypts a snapshot for jarvis_private.context_snapshot. Absent means context.issue is unavailable on this deploy. */
  encrypt?: (plain: string) => Promise<string>;
  correlationId: () => string;
  now?: () => Date;
}

export interface GatewayRequest {
  method: string;
  authorization: string | null;
  bodyText: string;
}

export interface GatewayResponse { status: number; body: unknown; headers?: Record<string, string> }

const AGENT_TOKEN_PREFIX = "jarvis_agent_";

function fail(code: ErrorCode, correlationId: string, extra?: Record<string, string>): GatewayResponse {
  const err: ProtocolError = protocolError(code, correlationId);
  return { status: PROTOCOL_ERRORS[code].status, body: err, ...(extra ? { headers: extra } : {}) };
}

function errorOf(data: unknown): ErrorCode | null {
  const e = (data as { error?: unknown } | null)?.error;
  if (!e) return null;
  return isErrorCode(e) ? e : "UNAVAILABLE";
}

/** The agent-side resolution of a token: who, with what, under which epoch. */
interface ResolvedAgent {
  connection_id: string; owner_id: string; status: string; mode: string; verified_capabilities: string[]; auth_epoch: number; display_name: string;
}

export async function handleAgentRequest(req: GatewayRequest, deps: GatewayDeps): Promise<GatewayResponse> {
  const cid = deps.correlationId();
  if (req.method !== "POST") return { status: 405, body: protocolError("INVALID_PAYLOAD", cid) };
  if (new TextEncoder().encode(req.bodyText).length > LIMITS.requestBytes) return fail("INVALID_PAYLOAD", cid);

  let body: unknown;
  try { body = JSON.parse(req.bodyText); } catch { return fail("INVALID_PAYLOAD", cid); }
  const shape = validate(body, REQUEST_SCHEMA);
  if (!shape.ok) return fail("INVALID_PAYLOAD", cid);
  const { method, params = {} } = body as { method: AgentMethod; params?: unknown };

  // 2. The token. Only its hash ever touches the database.
  const auth = req.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token.startsWith(AGENT_TOKEN_PREFIX) || token.length < AGENT_TOKEN_PREFIX.length + 32) return fail("AUTH_REQUIRED", cid);
  const hash = await deps.sha256(token);
  const who = await deps.rpc("agent_resolve_token", { p_token_hash: hash });
  if (who.error) return fail("UNAVAILABLE", cid);
  const agent = who.data as ResolvedAgent | null;
  if (!agent || typeof agent.connection_id !== "string") return fail("AUTH_REQUIRED", cid);
  if (agent.status === "revoked") return fail("CONNECTION_REVOKED", cid);
  if (agent.status !== "connected") return fail("SCOPE_DENIED", cid);

  // 3. The bucket.
  const rate = await deps.rpc("agent_rate_take", { p_connection: agent.connection_id, p_cost: 1 });
  if (rate.error) return fail("UNAVAILABLE", cid);
  if (rate.data !== true) return fail("RATE_LIMITED", cid, { "retry-after": "5" });

  // 4. The params, strictly, and no authority anywhere in a payload.
  const pv = validate(params, PARAM_SCHEMAS[method]);
  if (!pv.ok) return fail("INVALID_PAYLOAD", cid);
  const smuggled = carriesAuthority((params as { payload?: unknown }).payload) ?? carriesAuthority((params as { draft?: unknown }).draft);
  if (smuggled) return fail("INVALID_PAYLOAD", cid);

  // 4b. The ceiling, from what the token resolved to. The database asks the
  // same questions again with the switches and the grant in hand; this
  // refuses the plainly refused (a read-only agent proposing, an unverified
  // capability) without a round trip and without a receipt of a denied call.
  const op = operationOf(method, (params as { surface?: unknown }).surface);
  if (op) {
    const verdict = authorize({
      actor: {
        kind: "agent",
        connection: {
          status: agent.status as "connected", verifiedCapabilities: agent.verified_capabilities as AgentCapability[],
          mode: agent.mode as AgentMode, authEpoch: agent.auth_epoch,
        },
      },
      aiSwitch: "ok",
      operation: op,
    });
    if (!verdict.allow) return fail(verdict.code === "USER_ONLY" ? "SCOPE_DENIED" : verdict.code, cid);
  }

  const owner = agent.owner_id;
  const conn = agent.connection_id;
  const p = params as Record<string, unknown>;

  // 5. The function.
  switch (method) {
    case "capabilities": {
      const r = await deps.rpc("agent_capabilities", { p_owner: owner, p_connection: conn });
      return answer(r, cid);
    }
    case "context.preview": {
      const r = await deps.rpc("context_preview", {
        p_job: p.job_id, p_resources: p.requested_resource_ids ?? [], p_fields: p.requested_fields ?? [], p_purpose: p.purpose ?? null,
        p_owner: owner, p_connection: conn,
      });
      return answer(r, cid);
    }
    case "context.issue": {
      if (!deps.encrypt) return fail("UNAVAILABLE", cid);
      const r = await deps.rpc("context_issue", {
        p_job: p.job_id, p_manifest_hash: p.manifest_hash, p_resources: p.requested_resource_ids ?? [], p_fields: p.requested_fields ?? [],
        p_purpose: p.purpose ?? null, p_owner: owner, p_connection: conn,
      });
      const code = r.error ? "UNAVAILABLE" : errorOf(r.data);
      if (code) return fail(code, cid);
      const pkg = r.data as { package_id: string; data: unknown };
      // The receipt is already committed. The snapshot is kept encrypted for
      // the package's life so a later question can be answered from what was
      // actually shared.
      const stored = await deps.rpc("context_snapshot_store", { p_owner: owner, p_package: pkg.package_id, p_cipher: await deps.encrypt(JSON.stringify(pkg.data)) });
      if (stored.error || stored.data !== true) return fail("UNAVAILABLE", cid);
      return { status: 200, body: r.data };
    }
    case "proposal.submit": {
      const r = await deps.rpc("proposal_submit", {
        p_owner: owner, p_connection: conn, p_package: p.package_id, p_surface: p.surface, p_type: p.type,
        p_payload: p.payload, p_evidence: p.evidence_refs ?? [], p_idempotency: p.idempotency_key,
      });
      return answer(r, cid, 201);
    }
    case "draft.submit": {
      const r = await deps.rpc("draft_submit", { p_owner: owner, p_connection: conn, p_package: p.package_id, p_draft: p.draft });
      return answer(r, cid, 201);
    }
    case "review.link": {
      const r = await deps.rpc("review_link", { p_owner: owner, p_connection: conn, p_proposal: p.proposal_id });
      return answer(r, cid);
    }
    case "action.status": {
      const r = await deps.rpc("action_status", { p_owner: owner, p_connection: conn, p_action: p.action_id });
      return answer(r, cid);
    }
    case "connection.revoke":
      // A person revokes, from JARVIS, signed in as themselves. An agent
      // cannot revoke itself or anyone else through this door.
      return fail("SCOPE_DENIED", cid);
  }
}

function operationOf(method: AgentMethod, surface: unknown): Operation | null {
  switch (method) {
    case "context.preview":
    case "context.issue": return "read_context";
    case "proposal.submit": return surface === "email" ? "suggest_candidate" : "propose";
    case "draft.submit": return "write_inert_draft";
    default: return null;
  }
}

function answer(r: RpcResult, cid: string, okStatus = 200): GatewayResponse {
  if (r.error) return fail("UNAVAILABLE", cid);
  const code = errorOf(r.data);
  if (code) return fail(code, cid);
  const replay = (r.data as { replay?: unknown } | null)?.replay === true;
  return { status: replay ? 200 : okStatus, body: { protocol_version: PROTOCOL_VERSION, ...(r.data as Record<string, unknown>) } };
}

export { AGENT_TOKEN_PREFIX, AUTHORITY_KEYS };
