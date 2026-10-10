// LAW: THE LINK REGISTRY IN SQL AND ITS TYPESCRIPT MIRROR ARE ONE LIST.
//
// Phase 0 (PHASE0-DESIGN.md D2, 2026-10-10) makes item_link a projection: the
// JSONB fields stay the one write path, and a trigger on item projects every
// path in a closed registry, `jarvis_link_paths()` in migration 0060, into
// the table. The app needs the same list to draw links before the server
// answers and to keep REFERENCE_FIELDS honest on restore, so
// src/substrate/links/paths.ts mirrors it. Two copies of one registry drift
// the way BackupService's KNOWN_TYPES drifted from the ENTITY_* constants
// (S3-Q15: eleven of thirty-odd types restored), which is why this law reads
// both and fails on any difference, in either direction.
//
// Three things are pinned. The `values` rows of jarvis_link_paths() equal
// LINK_PATHS as (entity_type, path, kind) triples. The kind vocabulary in
// item_link's check constraint equals LINK_KINDS, sixteen words. Every path
// in backup/references.ts REFERENCE_FIELDS is a link, or is rostered here
// with the reason it is not: categories are a classification with 192
// readers and not a relationship (Dave 2026-08-21); external identities
// (fromThread, gcalId, sourceUid...) point outside item; note.found[] is a
// suggestion not taken; evidence ids point at source_evidence, not item.
//
// While both files are absent the comparisons skip, saying so. The mirror
// cannot exist before the registry it mirrors, and that check always runs.

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { REFERENCE_FIELDS } from "../backup/references";

const SRC = join(__dirname, "..");
const MIG_0060 = resolve(__dirname, "../../../jarvis-core/supabase/migrations/0060_memory.sql");
const PATHS_TS = join(SRC, "substrate/links/paths.ts");
const haveSql = existsSync(MIG_0060);
const havePaths = existsSync(PATHS_TS);

type Row = { entityType: string; path: string; kind: string };
const keyOf = (r: Row) => `${r.entityType} · ${r.path} · ${r.kind}`;
const pairOf = (r: Row) => `${r.entityType} · ${r.path}`;

/** The `values` rows of jarvis_link_paths(): (entity_type, path, jsonpath, kind). */
function sqlRows(sql: string): Row[] {
  const at = sql.indexOf("function jarvis_link_paths(");
  if (at === -1) return [];
  const open = sql.indexOf("$$", at);
  const close = sql.indexOf("$$", open + 2);
  if (open === -1 || close === -1) return [];
  const body = sql.slice(open + 2, close);
  return [...body.matchAll(/\(\s*'([a-z_]+)'\s*,\s*'([^']+)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'([a-z_]+)'\s*\)/g)]
    .map((m) => ({ entityType: m[1]!, path: m[2]!, kind: m[4]! }));
}

/** The words item_link.kind may hold, from its check constraint. */
function sqlKinds(sql: string): string[] {
  const m = /\bkind\s+text\s+not\s+null\s+check\s*\(\s*kind\s+in\s*\(([^)]*)\)/i.exec(sql);
  return m ? [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((k) => k[1]!) : [];
}

/** LINK_PATHS as rows: an array of {entityType, path, kind}, or a record of entity type to [{path, kind}]. */
function tsRows(linkPaths: unknown): Row[] {
  if (Array.isArray(linkPaths)) {
    return linkPaths.map((r: Record<string, string>) => ({ entityType: r.entityType ?? r.type ?? r.entity ?? "", path: r.path!, kind: r.kind! }));
  }
  const out: Row[] = [];
  for (const [entityType, rows] of Object.entries(linkPaths as Record<string, { path: string; kind: string }[]>)) {
    for (const r of rows) out.push({ entityType, path: r.path, kind: r.kind });
  }
  return out;
}

async function loadPaths(): Promise<{ LINK_PATHS: unknown; LINK_KINDS: readonly string[] }> {
  // The specifier is a variable so tsc does not resolve it while the module is still unbuilt (step 5).
  const spec = "../substrate/links/paths";
  return (await import(/* @vite-ignore */ spec)) as { LINK_PATHS: unknown; LINK_KINDS: readonly string[] };
}

// REFERENCE_FIELDS paths that are deliberately not links. Exact: every
// REFERENCE_FIELDS path outside LINK_PATHS is here, and nothing here is in
// LINK_PATHS or the SQL registry.
const NOT_LINKS: Record<string, string> = {
  "task · category": "category is a classification with 192 readers, not a relationship (Dave 2026-08-21)",
  "task · extraCategories[]": "categories, the same",
  "event · category": "categories, the same",
  "note · category": "categories, the same",
  "project · category": "categories, the same",
  "goal · tags[]": "tags are category ids the goal watches; a classification",
  "person · categoryIds[]": "categories, the same",
  "program · gameCategoryId": "a category id; the sport the program is for",
};

// Paths that must never become links, whether or not a restore rewrites
// them. Checked against LINK_PATHS and the SQL registry; the ones a future
// REFERENCE_FIELDS carries are also counted as its non link paths.
const NEVER_LINKS: Record<string, string> = {
  "task · fromThread": "an external identity: a Gmail thread id, not an item",
  "event · gcalId": "an external identity: Google Calendar's id",
  "event · bookingId": "an external identity: the booking link's id",
  "event · clientId": "an external identity: the booking client's id",
  "event · emailIds[]": "external identities: Gmail message ids",
  "person · sourceUid": "an external identity: the vCard import's uid",
  "waiting · threadId": "an external identity: a Gmail thread id",
  "task · source.ref": "Source.ref is an external record id for most SourceTypes; the 'from' half rides on the stamp (D2 rule 4)",
  "event · source.ref": "Source.ref, the same",
  "note · source.ref": "Source.ref, the same",
  "workout · source.ref": "Source.ref, the same",
  "waiting · source.ref": "Source.ref, the same",
  "note · found[].targetId": "a suggestion not taken; Connections rows are the links a person accepted",
  "exploration_note · evidenceIds[]": "points at source_evidence, not item",
  "exploration_note · proposalId": "points at proposal, a control plane table, not item",
  "waiting · sourceEvidenceId": "points at source_evidence, not item",
};

const refPairs = Object.entries(REFERENCE_FIELDS).flatMap(([t, paths]) => paths.map((p) => `${t} · ${p}`));

describe("LAW: the link registry in SQL and its TypeScript mirror are one list", () => {
  it("the mirror cannot exist before the registry it mirrors", () => {
    // Step 5 (paths.ts) depends on step 2 (0060). The other order is a copy
    // of a list that does not exist yet, which is how two lists drift.
    if (havePaths) expect(haveSql, "src/substrate/links/paths.ts exists but 0060_memory.sql does not").toBe(true);
  });

  it("the two rosters do not overlap, and the NOT_LINKS roster names real REFERENCE_FIELDS paths", () => {
    for (const k of Object.keys(NOT_LINKS)) expect(NEVER_LINKS, k).not.toHaveProperty(k);
    const stale = Object.keys(NOT_LINKS).filter((k) => !refPairs.includes(k));
    expect(stale, "a NOT_LINKS entry that REFERENCE_FIELDS no longer carries").toEqual([]);
  });

  // Skipped, with this note, while jarvis-core/supabase/migrations/0060_memory.sql is absent (Phase 0 step 2 writes it).
  const whenSql = haveSql ? it : it.skip;
  whenSql("the SQL registry has rows, sixteen kinds, and excludes what the rosters exclude", () => {
    const sql = readFileSync(MIG_0060, "utf8");
    const rows = sqlRows(sql);
    expect(rows.length, "jarvis_link_paths() must hold one values row per path").toBeGreaterThan(30);
    const kinds = sqlKinds(sql);
    expect(kinds.length, "item_link.kind must carry a check constraint over the closed vocabulary").toBe(16);
    expect(rows.filter((r) => !kinds.includes(r.kind)).map(keyOf), "a registry row whose kind is outside the check").toEqual([]);
    expect(kinds.filter((k) => !rows.some((r) => r.kind === k)), "a kind word no path derives").toEqual([]);
    const excluded = new Set([...Object.keys(NOT_LINKS), ...Object.keys(NEVER_LINKS)]);
    expect(rows.filter((r) => excluded.has(pairOf(r))).map(pairOf), "a category, external identity, found[] or evidence id projected as a link").toEqual([]);
  });

  // Skipped, with this note, while src/substrate/links/paths.ts is absent (Phase 0 step 5 writes it).
  const whenPaths = havePaths ? it : it.skip;
  whenPaths("every REFERENCE_FIELDS path is a link, or is rostered as not one", async () => {
    const { LINK_PATHS, LINK_KINDS } = await loadPaths();
    const rows = tsRows(LINK_PATHS);
    expect(rows.length).toBeGreaterThan(30);
    expect(LINK_KINDS.length).toBe(16);
    expect(rows.filter((r) => !LINK_KINDS.includes(r.kind)).map(keyOf)).toEqual([]);
    const linked = new Set(rows.map(pairOf));
    const outside = refPairs.filter((p) => !linked.has(p)).sort();
    const rostered = [...Object.keys(NOT_LINKS), ...Object.keys(NEVER_LINKS).filter((k) => refPairs.includes(k))].sort();
    expect(outside, "a REFERENCE_FIELDS path that is neither a link nor rostered as not one").toEqual(rostered);
    const excluded = new Set([...Object.keys(NOT_LINKS), ...Object.keys(NEVER_LINKS)]);
    expect(rows.filter((r) => excluded.has(pairOf(r))).map(pairOf), "a rostered non link in LINK_PATHS").toEqual([]);
  });

  // Skipped, with this note, while either side is absent; red the moment both exist and differ.
  const whenBoth = haveSql && havePaths ? it : it.skip;
  whenBoth("jarvis_link_paths() and LINK_PATHS are the same rows, and the kind vocabularies match", async () => {
    const sql = readFileSync(MIG_0060, "utf8");
    const { LINK_PATHS, LINK_KINDS } = await loadPaths();
    expect(sqlRows(sql).map(keyOf).sort(), "0060's jarvis_link_paths() and substrate/links/paths.ts LINK_PATHS differ")
      .toEqual(tsRows(LINK_PATHS).map(keyOf).sort());
    expect(sqlKinds(sql).sort(), "item_link's kind check and LINK_KINDS differ").toEqual([...LINK_KINDS].sort());
  });
});
