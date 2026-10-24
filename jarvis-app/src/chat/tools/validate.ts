// THE INPUT CHECK EVERY TOOL CALL PASSES BEFORE IT RUNS (chat box order, 2026-10-24).
//
// The provider is given each tool's schema, and a model usually keeps to it, but "usually" is not a gate. The dispatcher checks every
// call's input against the same schema itself, so a call with a missing field, an extra field, a number where a word belongs or a ref
// that is not shaped like one is refused with the reason, and the model is told why and asks again. It understands only the handful of
// JSON Schema keywords the registry uses, and an unknown keyword is IGNORED (the registry is ours, so a keyword this does not read
// is a bug in a test, never an opening: laws/chatTools.test.ts holds the registry to the subset).
//
// Pure. Returns null when the input is fine and one short sentence when it is not.

import type { ToolSchema } from "./registry";

const MAX_DEPTH = 6;

type S = Record<string, unknown>;

export function validateInput(schema: ToolSchema, input: unknown): string | null {
  return check(schema as S, input, "input", 0);
}

function check(schema: S, v: unknown, path: string, depth: number): string | null {
  if (depth > MAX_DEPTH) return `${path} is nested too deeply`;
  const type = schema.type;

  if (type === "object") {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return `${path} must be an object`;
    const o = v as Record<string, unknown>;
    const props = (schema.properties ?? {}) as Record<string, S>;
    for (const req of (schema.required ?? []) as string[]) {
      if (o[req] === undefined) return `${path}.${req} is required`;
    }
    if (schema.additionalProperties === false) {
      for (const k of Object.keys(o)) if (!(k in props)) return `${path}.${k} is not a field of this tool`;
    }
    for (const [k, sub] of Object.entries(props)) {
      if (o[k] === undefined) continue;
      const bad = check(sub, o[k], `${path}.${k}`, depth + 1);
      if (bad) return bad;
    }
    return null;
  }

  if (type === "array") {
    if (!Array.isArray(v)) return `${path} must be a list`;
    if (typeof schema.maxItems === "number" && v.length > schema.maxItems) return `${path} has too many items`;
    if (typeof schema.minItems === "number" && v.length < schema.minItems) return `${path} has too few items`;
    const item = schema.items as S | undefined;
    if (item) {
      for (let i = 0; i < v.length; i++) {
        const bad = check(item, v[i], `${path}[${i}]`, depth + 1);
        if (bad) return bad;
      }
    }
    return null;
  }

  if (type === "string") {
    if (typeof v !== "string") return `${path} must be text`;
    if (typeof schema.minLength === "number" && v.length < schema.minLength) return `${path} is too short`;
    if (typeof schema.maxLength === "number" && v.length > schema.maxLength) return `${path} is too long`;
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(v)) return `${path} is not the shape this tool takes`;
    if (Array.isArray(schema.enum) && !schema.enum.includes(v)) return `${path} is not one of the allowed values`;
    return null;
  }

  if (type === "integer" || type === "number") {
    if (typeof v !== "number" || !Number.isFinite(v)) return `${path} must be a number`;
    if (type === "integer" && !Number.isInteger(v)) return `${path} must be a whole number`;
    if (typeof schema.minimum === "number" && v < schema.minimum) return `${path} is too small`;
    if (typeof schema.maximum === "number" && v > schema.maximum) return `${path} is too large`;
    return null;
  }

  if (type === "boolean") return typeof v === "boolean" ? null : `${path} must be true or false`;

  // A schema with no type this reads accepts nothing: the registry never writes one, so reaching here is a bug that must not pass quietly.
  return `${path} has a type this check does not know`;
}
