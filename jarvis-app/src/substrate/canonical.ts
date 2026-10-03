// ONE CANONICAL FORM, ONE HASH (API-AND-VALIDATION.md, "Canonical hashes").
//
// Every approval binds to a hash of exactly what the person saw. Client and
// server must derive the same bytes from the same payload, so there is one
// documented canonicalisation and nothing else: UTF-8, Unicode NFC, object
// keys sorted, arrays in their meaningful order, no undefined, finite numbers
// only. The hash is SHA-256 over the schema version and the canonical text.

import type { Json } from "./contracts";

export function canonicalJson(value: Json): string {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical: a number must be finite");
    // -0 and 0 are one value; a hash must not see two.
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value === "string") return JSON.stringify(value.normalize("NFC"));
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k.normalize("NFC")) + ":" + canonicalJson(value[k] as Json)).join(",") + "}";
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The hash an approval is bound to: the schema version, a newline, the canonical payload. */
export function hashPayload(schemaVersion: number, value: Json): Promise<string> {
  return sha256Hex(`${schemaVersion}\n${canonicalJson(value)}`);
}
