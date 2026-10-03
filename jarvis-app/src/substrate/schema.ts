// A SMALL, STRICT VALIDATOR (API-AND-VALIDATION.md: "Runtime validation must
// reject unknown properties and enforce all constraints"). Dependency free,
// because it runs in an edge function and in the browser alike. An object
// schema never accepts a key it does not name, which is how a payload that
// smuggles `execute: true` or `approved_by` is refused as a shape before any
// rule has to think about it.

export type Schema =
  | { type: "string"; min?: number; max?: number; pattern?: RegExp; enum?: readonly string[] }
  | { type: "integer"; min?: number; max?: number }
  | { type: "boolean" }
  | { type: "null" }
  | { type: "uuid" }
  | { type: "array"; items: Schema; max?: number }
  | { type: "object"; fields: Record<string, Schema>; optional?: readonly string[] }
  | { type: "union"; of: Schema[] }
  | { type: "json"; maxBytes?: number };

export type Validation = { ok: true } | { ok: false; path: string; reason: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bad = (path: string, reason: string): Validation => ({ ok: false, path, reason });

export function validate(value: unknown, schema: Schema, path = "$"): Validation {
  switch (schema.type) {
    case "null":
      return value === null ? { ok: true } : bad(path, "expected null");
    case "boolean":
      return typeof value === "boolean" ? { ok: true } : bad(path, "expected a boolean");
    case "integer":
      if (typeof value !== "number" || !Number.isSafeInteger(value)) return bad(path, "expected an integer");
      if (schema.min !== undefined && value < schema.min) return bad(path, `below ${schema.min}`);
      if (schema.max !== undefined && value > schema.max) return bad(path, `above ${schema.max}`);
      return { ok: true };
    case "string":
      if (typeof value !== "string") return bad(path, "expected a string");
      if (schema.min !== undefined && value.length < schema.min) return bad(path, `shorter than ${schema.min}`);
      if (schema.max !== undefined && value.length > schema.max) return bad(path, `longer than ${schema.max}`);
      if (schema.pattern && !schema.pattern.test(value)) return bad(path, "does not match");
      if (schema.enum && !schema.enum.includes(value)) return bad(path, "not one of the allowed values");
      return { ok: true };
    case "uuid":
      return typeof value === "string" && UUID.test(value) ? { ok: true } : bad(path, "expected a uuid");
    case "array": {
      if (!Array.isArray(value)) return bad(path, "expected a list");
      if (schema.max !== undefined && value.length > schema.max) return bad(path, `more than ${schema.max} items`);
      for (let i = 0; i < value.length; i++) {
        const v = validate(value[i], schema.items, `${path}[${i}]`);
        if (!v.ok) return v;
      }
      return { ok: true };
    }
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return bad(path, "expected an object");
      const obj = value as Record<string, unknown>;
      for (const key of Object.keys(obj)) {
        if (!(key in schema.fields)) return bad(`${path}.${key}`, "unknown property");
      }
      for (const [key, sub] of Object.entries(schema.fields)) {
        if (!(key in obj) || obj[key] === undefined) {
          if (schema.optional?.includes(key)) continue;
          return bad(`${path}.${key}`, "missing");
        }
        const v = validate(obj[key], sub, `${path}.${key}`);
        if (!v.ok) return v;
      }
      return { ok: true };
    }
    case "union": {
      let last: Validation = bad(path, "no branch matched");
      for (const branch of schema.of) {
        const v = validate(value, branch, path);
        if (v.ok) return v;
        last = v;
      }
      return last;
    }
    case "json": {
      if (value === undefined || typeof value === "function") return bad(path, "not JSON");
      const text = JSON.stringify(value);
      if (text === undefined) return bad(path, "not JSON");
      if (schema.maxBytes !== undefined && new TextEncoder().encode(text).length > schema.maxBytes) return bad(path, `larger than ${schema.maxBytes} bytes`);
      return { ok: true };
    }
  }
}

/** Keys that would carry authority if a server believed them. Any payload with one, at any depth, is refused whole. */
export const AUTHORITY_KEYS: readonly string[] = ["approved", "approved_by", "approval", "status", "execute", "executed", "owner_id", "user_id", "actor", "capabilities", "mode", "confirmed"];

export function carriesAuthority(value: unknown, depth = 0): string | null {
  if (depth > 8 || typeof value !== "object" || value === null) return null;
  if (Array.isArray(value)) {
    for (const v of value) { const hit = carriesAuthority(v, depth + 1); if (hit) return hit; }
    return null;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (AUTHORITY_KEYS.includes(k)) return k;
    const hit = carriesAuthority(v, depth + 1);
    if (hit) return hit;
  }
  return null;
}
