import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// LAW: EVERY ENTITY TYPE THE CODE WRITES IS REGISTERED (2026-09-02).
//
// item.entity_type references the entity_type registry in Supabase; an
// unregistered type rejects every insert, and the app swallows the rejection
// as a dead button. Routine (2026-07-30) and the metrics (found 2026-09-02,
// six weeks after D10-B shipped) both died this way. The rule "new entity
// type => registry migration in the same commit" lived in START_HERE and was
// missed twice; now it is a test. Every ENTITY_* constant in the app must
// appear in an `insert into entity_type` in jarvis-core's migrations.

const SRC = resolve(__dirname, "..");
const MIG = resolve(__dirname, "../../../jarvis-core/supabase/migrations");

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== "node_modules") walk(p, out); }
    else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) out.push(p);
  }
  return out;
}

describe("LAW: every entity type the code writes is registered", () => {
  it("each ENTITY_* constant has a registry migration", () => {
    const used = new Set<string>();
    for (const f of walk(SRC)) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/export const ENTITY_[A-Z_]+\s*=\s*"([a-z_]+)"/g)) used.add(m[1]!);
    }
    const registered = new Set<string>();
    for (const f of readdirSync(MIG).filter((x) => x.endsWith(".sql"))) {
      const sql = readFileSync(join(MIG, f), "utf8");
      for (const stmt of sql.matchAll(/insert\s+into\s+entity_type\s*\(key\)\s*values\s*([^;]+);/gi)) {
        for (const k of stmt[1]!.matchAll(/'([a-z_]+)'/g)) registered.add(k[1]!);
      }
    }
    // "item" is the registry's own seed row; the app never writes it.
    const missing = [...used].filter((k) => !registered.has(k)).sort();
    expect(missing, "add a migration: insert into entity_type (key) values ('...') on conflict (key) do nothing").toEqual([]);
    expect(used.size).toBeGreaterThan(10);
  });
});
