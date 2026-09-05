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
// ADDING A FIELD THAT HOLDS ANOTHER RECORD'S ID? Add its path below. Nothing
// else needs to change for a restore to keep the link.
//
// Paths are dotted, with "[]" meaning "descend into this array":
//   "category"                    data.category is one id
//   "extraCategories[]"           data.extraCategories is an array of ids
//   "connections[].targetId"      one id inside each element of an array
//   "blocks[].items[].taskId"     two arrays deep
//   "dropped.decisionId"          one id inside a nested object
import { ENTITY_TASK, ENTITY_NOTE } from "../notes/types";
import { ENTITY_EVENT } from "../schedule/types";
import { ENTITY_PROJECT } from "../projects/types";
import { ENTITY_AREA, ENTITY_GOAL } from "../life/types";
import { ENTITY_PERSON } from "../people/types";
import { ENTITY_DECISION } from "../decisions/types";
import { ENTITY_PROGRAM, ENTITY_WORKOUT } from "../gym/types";
import { ENTITY_METRIC_LOG } from "../gym/metrics";
import { ENTITY_ATE_BEFORE, ENTITY_CALL_IT, ENTITY_BAG_CHECK } from "../health/types";

export const REFERENCE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  // The category id every list, dot and colour reads, plus the tags, the
  // note a checklist task was promoted from, and the project it sits under.
  [ENTITY_TASK]: ["category", "extraCategories[]", "fromNote", "projectId"],
  // An event's category, the task Plan My Day generated it from, and the
  // tasks attached to it.
  [ENTITY_EVENT]: ["category", "sourceTaskId", "taskIds[]"],
  // A note's category, its Connections rows (which point at an event or a
  // task), and the task each promoted checklist line became.
  [ENTITY_NOTE]: ["category", "connections[].targetId", "blocks[].items[].taskId"],
  [ENTITY_PROJECT]: ["category", "goalId"],
  // tags are category ids the goal watches; dropped.decisionId is the
  // decision that says why it was put down.
  [ENTITY_GOAL]: ["areaId", "tags[]", "dropped.decisionId"],
  [ENTITY_PERSON]: ["categoryIds[]"],
  // A decision attaches to one record of some other kind, and a reversal
  // links to the decision it replaces in both directions.
  [ENTITY_DECISION]: ["linkedId", "supersedesId", "supersededById"],
  [ENTITY_PROGRAM]: ["gameCategoryId"],
  [ENTITY_WORKOUT]: ["programId"],
  [ENTITY_METRIC_LOG]: ["metricId"],
  // The three health rows that answer a specific calendar event.
  [ENTITY_ATE_BEFORE]: ["eventId"],
  [ENTITY_CALL_IT]: ["eventId"],
  [ENTITY_BAG_CHECK]: ["eventId"],
};

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
