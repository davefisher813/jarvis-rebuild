// THE PERSON'S SIDE OF SCOPED CONTEXT (IMPLEMENTATION-SPEC.md 05.2, 09 H4
// and H5). Preview exactly what would be shared, grant exactly that, export
// it as a file, import what comes back, revoke an assistant. Every call is a
// database function that takes the actor from the session; this module only
// shapes the arguments and the answers. The screens that call it arrive with
// the AI Hub (slice 04).

import { buildExport, parseImport, type IssuedPackage } from "./context/exportImport";
import { isErrorCode, type ErrorCode } from "./gateway/protocol";

export interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

export type ClientResult<T> = { ok: true; value: T } | { ok: false; code: ErrorCode; detail?: string };

async function call<T>(client: RpcClient, fn: string, args: Record<string, unknown>): Promise<ClientResult<T>> {
  const { data, error } = await client.rpc(fn, args);
  if (error) return { ok: false, code: "UNAVAILABLE" };
  const e = (data as { error?: unknown; detail?: unknown } | null)?.error;
  if (e) return { ok: false, code: isErrorCode(e) ? e : "UNAVAILABLE", ...(typeof (data as { detail?: unknown }).detail === "string" ? { detail: (data as { detail: string }).detail } : {}) };
  return { ok: true, value: data as T };
}

export interface ContextRequest { resourceIds?: string[]; fields?: string[]; purpose?: string }

export interface ManifestEntry { resource_id: string; revision: number; fields: string[]; redactions: string[]; evidence_refs: string[] }

export interface PreviewResult {
  manifest: ManifestEntry[];
  redactions: string[];
  record_count: number;
  content_bytes: number;
  omitted_counts: { unauthorized: number; over_limit: number };
  manifest_hash: string;
  requires_user_grant: boolean;
  job_id: string;
  project_id: string | null;
  purpose: string;
}

const args = (jobId: string, r: ContextRequest): Record<string, unknown> => ({
  p_job: jobId, p_resources: r.resourceIds ?? [], p_fields: r.fields ?? [], p_purpose: r.purpose ?? null,
});

/** H5: exactly what would be shared, before anything is. */
export function previewContext(client: RpcClient, jobId: string, r: ContextRequest = {}): Promise<ClientResult<PreviewResult>> {
  return call<PreviewResult>(client, "context_preview", args(jobId, r));
}

export type GrantDuration = "once" | "project";

/** Share context: the grant is the exact preview, by its hash. */
export function grantScope(client: RpcClient, jobId: string, manifestHash: string, duration: GrantDuration, r: ContextRequest = {}): Promise<ClientResult<{ grant_id: string; expires_at: string | null; record_count: number }>> {
  return call(client, "scope_grant_create", { ...args(jobId, r), p_manifest_hash: manifestHash, p_duration: duration });
}

/** Manual export: a package issued to the person, as a file, with its disclosure. The receipt is written by the function. */
export async function exportContext(client: RpcClient, jobId: string, manifestHash: string, r: ContextRequest = {}, now: () => string = () => new Date().toISOString()): Promise<ClientResult<{ fileName: string; text: string; package: IssuedPackage }>> {
  const issued = await call<IssuedPackage>(client, "context_issue", { ...args(jobId, r), p_manifest_hash: manifestHash });
  if (!issued.ok) return issued;
  const at = now();
  return { ok: true, value: { fileName: `jarvis-context-${at.slice(0, 10)}.json`, text: buildExport(issued.value, at), package: issued.value } };
}

/** Manual import: a JSON response or pasted prose. Validated here first, then by the function; nothing partial. */
export async function importProposals(client: RpcClient, jobId: string, text: string): Promise<ClientResult<{ count: number; proposal_ids: string[]; source: "json" | "prose" }>> {
  const parsed = parseImport(text);
  if (!parsed.ok) return { ok: false, code: "IMPORT_INVALID", detail: parsed.reason };
  const r = await call<{ count: number; proposal_ids: string[] }>(client, "proposals_import", { p_job: jobId, p_items: parsed.items, p_source: parsed.source });
  if (!r.ok) return r;
  return { ok: true, value: { ...r.value, source: parsed.source } };
}

/** One tap, immediate, server side. */
export function revokeAgent(client: RpcClient, connectionId: string): Promise<ClientResult<{ status: "revoked"; auth_epoch: number; already?: boolean }>> {
  return call(client, "connection_revoke", { p_connection: connectionId });
}
