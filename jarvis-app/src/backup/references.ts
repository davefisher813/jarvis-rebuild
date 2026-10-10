// WHERE ONE RECORD POINTS AT ANOTHER (PLUMB-F-12, 2026-09-05).
//
// A backup used to drop every id on export, so a restore into a fresh
// account brought back every task, note and event with its links pointing at
// ids that no longer existed anywhere: everything uncategorized, projects
// with no goal, goals with no area, checklist tasks with no note. The bundle
// now carries ids and BackupService rewrites them, and this file is the one
// place that says WHICH fields hold an id, so a new reference field is one
// line here instead of a silent hole in every future restore.
//
// ADDING A FIELD THAT HOLDS ANOTHER RECORD'S ID? A relationship goes into
// 0060's jarvis_link_paths() and substrate/links/paths.ts (one row, both
// sides; linkLaw holds them equal) and arrives here through LINK_PATHS. A
// filing id (a category) goes into FILING_FIELDS below. Nothing else needs
// to change for a restore to keep the link.
//
// Paths are dotted, with "[]" meaning "descend into this array":
//   "category"                    data.category is one id
//   "extraCategories[]"           data.extraCategories is an array of ids
//   "connections[].targetId"      one id inside each element of an array
//   "blocks[].items[].taskId"     two arrays deep
//   "dropped.decisionId"          one id inside a nested object
//
// Phase 0 D2 (PHASE0-DESIGN.md, 2026-10-10): the paths that are RELATIONSHIPS
// now come from one registry, substrate/links/paths.ts, the TypeScript mirror
// of 0060's jarvis_link_paths() (item_link is a projection of these fields;
// write the field, never the table). What stays written by hand here is the
// FILING: category ids, tags, the sport a program is for. Those are a
// classification with 192 readers and not a relationship (Dave 2026-08-21),
// so they are not links, but a restore still has to rewrite them.
// laws/linkLaw.test.ts holds the two halves exact: every path below is a
// LINK_PATHS row or sits in its NOT_LINKS roster with the reason.
import { ENTITY_TASK, ENTITY_NOTE } from "../notes/types";
import { ENTITY_EVENT } from "../schedule/types";
import { ENTITY_PROJECT } from "../projects/types";
import { ENTITY_AREA, ENTITY_GOAL } from "../life/types";
import { ENTITY_PERSON } from "../people/types";
import { ENTITY_PROGRAM } from "../gym/types";
import { LINK_PATHS } from "../substrate/links/paths";

// The filing paths, kept by hand. Not links; still ids a restore rewrites.
const FILING_FIELDS: Readonly<Record<string, readonly string[]>> = {
  // The category id every list, dot and colour reads, plus the extra tags.
  [ENTITY_TASK]: ["category", "extraCategories[]"],
  [ENTITY_EVENT]: ["category"],
  [ENTITY_NOTE]: ["category"],
  [ENTITY_PROJECT]: ["category"],
  // tags are category ids the goal watches.
  [ENTITY_GOAL]: ["tags[]"],
  [ENTITY_PERSON]: ["categoryIds[]"],
  // The sport the program is for: a category id.
  [ENTITY_PROGRAM]: ["gameCategoryId"],
};

/** The filing paths plus every registry link path, grouped by entity type,
 *  each path once. Order inside a type: the filing paths first, then the
 *  registry's own order. */
function referenceFields(): Readonly<Record<string, readonly string[]>> {
  const out: Record<string, string[]> = {};
  for (const [type, paths] of Object.entries(FILING_FIELDS)) out[type] = [...paths];
  for (const r of LINK_PATHS) {
    const list = (out[r.entityType] ??= []);
    // note.connections[].targetId is two registry rows (about, mentions) and one path.
    if (!list.includes(r.path)) list.push(r.path);
  }
  return out;
}

export const REFERENCE_FIELDS: Readonly<Record<string, readonly string[]>> = referenceFields();

// life_area has no outbound reference of its own; named here so the list
// above reads as deliberate rather than as an oversight.
export const NO_REFERENCES: readonly string[] = [ENTITY_AREA];

type Node = Record<string, unknown>;

function rewritePath(node: Node, segments: readonly string[], map: ReadonlyMap<string, string>): void {
  const seg = segments[0];
  if (seg === undefined) return;
  const rest = segments.slice(1);
  const isArray = seg.endsWith("[]");
  const key = isArray ? seg.slice(0, -2) : seg;
  const cur = node[key];
  if (cur === undefined || cur === null) return;

  if (isArray) {
    if (!Array.isArray(cur)) return;
    if (rest.length === 0) {
      // The array itself holds ids.
      node[key] = cur.map((v) => (typeof v === "string" ? map.get(v) ?? v : v));
      return;
    }
    for (const el of cur) {
      if (el && typeof el === "object" && !Array.isArray(el)) rewritePath(el as Node, rest, map);
    }
    return;
  }

  if (rest.length === 0) {
    // An id we have no new home for is LEFT ALONE, never blanked: the
    // record it points at may already be in this account (re-importing a
    // backup into the account it came from maps every id to itself), and a
    // dangling id reads exactly as it did before this fix.
    if (typeof cur === "string") {
      const next = map.get(cur);
      if (next !== undefined) node[key] = next;
    }
    return;
  }
  if (cur && typeof cur === "object" && !Array.isArray(cur)) rewritePath(cur as Node, rest, map);
}

// Returns a copy of `data` with every id this build knows about swapped for
// the id it is being restored under. Returns the input untouched when the
// entity type carries no references or there is nothing to swap, so a v1
// bundle (no ids at all) behaves exactly as it always did.
export function remapReferences<T>(entityType: string, data: T, map: ReadonlyMap<string, string>): T {
  const paths = REFERENCE_FIELDS[entityType];
  if (!paths || map.size === 0 || !data || typeof data !== "object") return data;
  const copy = JSON.parse(JSON.stringify(data)) as Node;
  for (const path of paths) rewritePath(copy, path.split("."), map);
  return copy as T;
}
