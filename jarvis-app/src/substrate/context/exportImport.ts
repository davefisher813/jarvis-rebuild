// MANUAL EXCHANGE (IMPLEMENTATION-SPEC.md section 05.2). The route every
// assistant has, connector or not: the person exports exactly the manifest
// they previewed as a file, hands it to whatever they like, and pastes or
// imports what comes back. Export is a disclosure and says so; import is
// untrusted and says so. Both use the same manifest validation as the
// gateway, because a file is just a transport.

import { validate, carriesAuthority, type Schema } from "../schema";
import { LIMITS } from "../gateway/protocol";
import type { Json } from "../contracts";

export const EXPORT_DISCLOSURE = "Imported suggestions are unverified until reviewed.";
export const EXPORT_REVOCATION_NOTE = "A copy outside JARVIS cannot be recalled. Revoking an assistant does not reach it.";

export interface IssuedPackage {
  package_id: string;
  job_id: string;
  project_id: string | null;
  purpose: string;
  manifest: Json[];
  data: Record<string, Json>;
  expires_at: string;
  package_hash: string;
}

export interface ExportFile {
  app: "jarvis";
  kind: "context";
  protocol_version: 1;
  package_id: string;
  job_id: string;
  project_id: string | null;
  purpose: string;
  exported_at: string;
  /** Advisory: the package's own expiry. A copy outside JARVIS cannot be made to honour it. */
  expires_at: string;
  package_hash: string;
  manifest: Json[];
  data: Record<string, Json>;
  disclosure: string;
  revocation_note: string;
  /** How to answer: the shape parseImport accepts. */
  respond_with: { app: "jarvis"; kind: "context_response"; protocol_version: 1; items: string };
}

export function buildExport(pkg: IssuedPackage, now: string): string {
  const file: ExportFile = {
    app: "jarvis",
    kind: "context",
    protocol_version: 1,
    package_id: pkg.package_id,
    job_id: pkg.job_id,
    project_id: pkg.project_id,
    purpose: pkg.purpose,
    exported_at: now,
    expires_at: pkg.expires_at,
    package_hash: pkg.package_hash,
    manifest: pkg.manifest,
    data: pkg.data,
    disclosure: EXPORT_DISCLOSURE,
    revocation_note: EXPORT_REVOCATION_NOTE,
    respond_with: { app: "jarvis", kind: "context_response", protocol_version: 1, items: "[{ type, statement, rationale, classification }]" },
  };
  return JSON.stringify(file, null, 2);
}

export interface ImportItem {
  type: "decision" | "constraint_change";
  statement: string;
  rationale?: string;
  classification?: "decided" | "mentioned";
}

export type ImportResult =
  | { ok: true; source: "json" | "prose"; items: ImportItem[] }
  | { ok: false; code: "IMPORT_INVALID"; reason: string };

const ITEM: Schema = {
  type: "object",
  fields: {
    type: { type: "string", enum: ["decision", "constraint_change"] },
    statement: { type: "string", min: 1, max: 500 },
    rationale: { type: "string", max: 4000 },
    classification: { type: "string", enum: ["decided", "mentioned"] },
    evidence_refs: { type: "array", items: { type: "uuid" }, max: 20 },
  },
  optional: ["type", "rationale", "classification", "evidence_refs"],
};

const RESPONSE: Schema = {
  type: "object",
  fields: {
    app: { type: "string", enum: ["jarvis"] },
    kind: { type: "string", enum: ["context_response"] },
    protocol_version: { type: "integer", min: 1, max: 1 },
    package_id: { type: "uuid" },
    items: { type: "array", items: ITEM, max: 100 },
  },
  optional: ["package_id"],
};

/** A JSON response from an assistant, or pasted prose. Size and schema checked; nothing partial. */
export function parseImport(text: string, maxBytes: number = LIMITS.importBytes): ImportResult {
  if (new TextEncoder().encode(text).length > maxBytes) return { ok: false, code: "IMPORT_INVALID", reason: "The file is larger than 256 KB." };
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, code: "IMPORT_INVALID", reason: "Nothing to import." };
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    let parsed: unknown;
    try { parsed = JSON.parse(trimmed); } catch { return { ok: false, code: "IMPORT_INVALID", reason: "Not valid JSON." }; }
    // Authority in any item refuses the whole file, before the shape check
    // names a friendlier reason.
    const smuggled = carriesAuthority(parsed);
    if (smuggled) return { ok: false, code: "IMPORT_INVALID", reason: `The file carries a field JARVIS never accepts: ${smuggled}.` };
    const v = validate(parsed, RESPONSE);
    if (!v.ok) return { ok: false, code: "IMPORT_INVALID", reason: `${v.path}: ${v.reason}` };
    const items = ((parsed as { items: ImportItem[] }).items).map((it) => ({
      type: it.type ?? "decision",
      statement: it.statement.trim(),
      ...(it.rationale?.trim() ? { rationale: it.rationale.trim() } : {}),
      classification: it.classification ?? "mentioned",
    })) as ImportItem[];
    if (items.length === 0) return { ok: false, code: "IMPORT_INVALID", reason: "The file holds no items." };
    return { ok: true, source: "json", items };
  }
  // Prose: one Mentioned item per line or sentence. Never Decided.
  const parts = trimmed
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.replace(/^[\s*\-•\d.)]+/, "").trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) return { ok: false, code: "IMPORT_INVALID", reason: "Nothing to import." };
  if (parts.length > 100) return { ok: false, code: "IMPORT_INVALID", reason: "More than 100 lines. Paste fewer at a time." };
  if (parts.some((s) => s.length > 500)) return { ok: false, code: "IMPORT_INVALID", reason: "A line is longer than 500 characters." };
  return { ok: true, source: "prose", items: parts.map((statement) => ({ type: "decision", statement, classification: "mentioned" })) };
}
