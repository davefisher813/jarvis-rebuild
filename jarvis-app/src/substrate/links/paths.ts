// THE LINK REGISTRY, MIRRORED (Phase 0 D2, PHASE0-DESIGN.md, 2026-10-10).
//
// item_link is a PROJECTION. The JSONB field on the record is the one write
// path: a task's personId, a note's connections[].targetId, a decision's
// supersedesId. A trigger on item reads every path in the closed registry
// jarvis_link_paths() (jarvis-core/supabase/migrations/0060_memory.sql) and
// keeps one item_link row per pointer. Nothing in the app writes item_link,
// ever; write the field and the row follows, offline too, because the field
// rides in jarvis.store.queue and the table does not.
//
// This file is that registry's TypeScript mirror, row for row, so the app
// can draw a record's links before the server answers and so
// backup/references.ts knows which paths hold an id on restore. Two copies
// of one list drift (BackupService's KNOWN_TYPES drifted from the ENTITY_*
// constants, S3-Q15), which is why laws/linkLaw.test.ts parses 0060's
// `values` list and fails on any difference, in either direction, and holds
// the kind vocabulary to item_link's check constraint. Change the SQL first,
// then this file, in the same change.
//
// Not links, on purpose (the SQL registry comment says the same):
//   category, extraCategories[], categoryIds[], tags[], gameCategoryId: a
//     classification with 192 readers, not a relationship (Dave 2026-08-21).
//   fromThread, gcalId, bookingId, clientId, emailIds[], sourceUid, and
//     source.ref of a non item type: external identities, not rows of item.
//   note.found[].targetId: a suggestion not taken.
//   exploration_note.evidenceIds[], waiting.sourceEvidenceId: source_evidence.
//
// Pure: no React, no Store, no flag, no environment. references.ts imports
// it, and api/ must be able to reach it without import.meta.env in the way.

/** The closed kind vocabulary: item_link.kind's check constraint, same order. */
export const LINK_KINDS = [
  "about", "in", "under", "for", "from", "became", "has", "mentions",
  "replaces", "replaced_by", "because_of", "pays", "matches", "attached", "reminds", "triggers",
] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/** One registry row. `path` is the REFERENCE_FIELDS spelling: dotted, with
 *  "[]" meaning "each element of this array". `only` narrows an array
 *  element by one of its own fields, the way the SQL jsonpath filter does
 *  (note.connections[] splits into `about` when kind is person and
 *  `mentions` otherwise, a missing kind counting as otherwise). */
export interface LinkPath {
  entityType: string;
  path: string;
  kind: LinkKind;
  only?: { key: string; is: string } | { key: string; isNot: string };
}

/** jarvis_link_paths() row for row: (entity_type, path, kind). */
export const LINK_PATHS: readonly LinkPath[] = [
  { entityType: "task", path: "personId", kind: "about" },
  { entityType: "task", path: "projectId", kind: "in" },
  { entityType: "task", path: "goalId", kind: "under" },
  { entityType: "task", path: "eventId", kind: "for" },
  { entityType: "task", path: "fromNote", kind: "from" },
  { entityType: "task", path: "reminder.linkedItem.id", kind: "reminds" },
  { entityType: "task", path: "plan.contextTrigger.targetId", kind: "triggers" },
  { entityType: "event", path: "sourceTaskId", kind: "from" },
  { entityType: "event", path: "taskIds[]", kind: "has" },
  { entityType: "event", path: "projectId", kind: "in" },
  { entityType: "note", path: "connections[].targetId", kind: "about", only: { key: "kind", is: "person" } },
  { entityType: "note", path: "connections[].targetId", kind: "mentions", only: { key: "kind", isNot: "person" } },
  { entityType: "note", path: "blocks[].items[].taskId", kind: "has" },
  { entityType: "project", path: "goalId", kind: "under" },
  { entityType: "goal", path: "areaId", kind: "under" },
  { entityType: "goal", path: "dropped.decisionId", kind: "because_of" },
  { entityType: "decision_record", path: "linkedId", kind: "mentions" },
  { entityType: "decision_record", path: "supersedesId", kind: "replaces" },
  { entityType: "decision_record", path: "supersededById", kind: "replaced_by" },
  { entityType: "decision_record", path: "links[].id", kind: "mentions" },
  { entityType: "decision_record", path: "ruleStrandId", kind: "because_of" },
  { entityType: "decision_record", path: "source.entityId", kind: "from" },
  { entityType: "strand", path: "link.entityId", kind: "mentions" },
  { entityType: "brain_memory", path: "linkedItemIds[]", kind: "mentions" },
  { entityType: "brain_memory", path: "supersedes", kind: "replaces" },
  { entityType: "brain_memory", path: "supersededBy", kind: "replaced_by" },
  { entityType: "waiting", path: "contactId", kind: "about" },
  { entityType: "exploration_note", path: "projectId", kind: "in" },
  { entityType: "exploration_note", path: "promotedToItemId", kind: "became" },
  { entityType: "money_tx", path: "paysBillId", kind: "pays" },
  { entityType: "money_tx", path: "matchedReceiptId", kind: "matches" },
  { entityType: "money_bill", path: "paidEvidence.transactionId", kind: "because_of" },
  { entityType: "money_receipt", path: "linkedTransactionId", kind: "matches" },
  { entityType: "money_receipt", path: "attachmentFileId", kind: "attached" },
  { entityType: "workout", path: "programId", kind: "in" },
  { entityType: "metric_log", path: "metricId", kind: "in" },
  { entityType: "health_ate_before", path: "eventId", kind: "for" },
  { entityType: "health_call_it", path: "eventId", kind: "for" },
  { entityType: "health_bag_check", path: "eventId", kind: "for" },
  { entityType: "health_took_it", path: "medId", kind: "for" },
  { entityType: "health_trusted_adult", path: "personId", kind: "about" },
  { entityType: "chat_message", path: "provenance.refs[].id", kind: "mentions" },
];

/** The registry paths of one kind of record, in registry order. */
export function linkPathsFor(entityType: string): LinkPath[] {
  return LINK_PATHS.filter((r) => r.entityType === entityType);
}

/** One pointer a record holds: the registry path it sits on, what the
 *  relationship reads as, and the id it points at. */
export interface Link { path: string; kind: LinkKind; toId: string }

type Node = Record<string, unknown>;

function isNode(v: unknown): v is Node {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function allowed(holder: Node, only: LinkPath["only"]): boolean {
  if (!only) return true;
  const v = holder[only.key];
  return "is" in only ? v === only.is : v !== only.isNot;
}

/** Every non empty string at `segments` under `node`, with the object that
 *  holds the leaf, so the row's `only` filter can read a sibling field. */
function leaves(node: Node, segments: readonly string[], out: { holder: Node; value: string }[]): void {
  const seg = segments[0];
  if (seg === undefined) return;
  const rest = segments.slice(1);
  const isArray = seg.endsWith("[]");
  const key = isArray ? seg.slice(0, -2) : seg;
  const cur = node[key];
  if (cur === undefined || cur === null) return;
  if (isArray) {
    if (!Array.isArray(cur)) return;
    for (const el of cur) {
      if (rest.length === 0) { if (typeof el === "string" && el) out.push({ holder: node, value: el }); }
      else if (isNode(el)) leaves(el, rest, out);
    }
    return;
  }
  if (rest.length === 0) { if (typeof cur === "string" && cur) out.push({ holder: node, value: cur }); return; }
  if (isNode(cur)) leaves(cur, rest, out);
}

/** The links one record holds: every registry path of its kind whose value
 *  is a non empty string id (each element, when the path addresses an
 *  array), minus a pointer at the record itself when `selfId` is given. The
 *  same answer jarvis_links_of() gives on the server, so a screen can draw a
 *  record's links before the projection row exists. Pure; reads only `data`. */
export function linksOf(entityType: string, data: unknown, selfId?: string): Link[] {
  if (!isNode(data)) return [];
  const out: Link[] = [];
  for (const row of linkPathsFor(entityType)) {
    const hits: { holder: Node; value: string }[] = [];
    leaves(data, row.path.split("."), hits);
    for (const h of hits) {
      if (selfId !== undefined && h.value === selfId) continue;
      if (!allowed(h.holder, row.only)) continue;
      out.push({ path: row.path, kind: row.kind, toId: h.value });
    }
  }
  return out;
}
