// REFERENCE_FIELDS after Phase 0 D2: the filing paths kept by hand plus every
// registry link path, and remapReferences rewriting through both.

import { describe, it, expect } from "vitest";
import { REFERENCE_FIELDS, NO_REFERENCES, remapReferences } from "./references";
import { LINK_PATHS } from "../substrate/links/paths";
import { ALL_ENTITY_TYPES } from "./entityRegistry";

describe("REFERENCE_FIELDS", () => {
  it("keeps the filing paths the restore has always rewritten", () => {
    expect(REFERENCE_FIELDS.task).toEqual(expect.arrayContaining(["category", "extraCategories[]", "fromNote", "projectId"]));
    expect(REFERENCE_FIELDS.event).toEqual(expect.arrayContaining(["category", "sourceTaskId", "taskIds[]"]));
    expect(REFERENCE_FIELDS.note).toEqual(expect.arrayContaining(["category", "connections[].targetId", "blocks[].items[].taskId"]));
    expect(REFERENCE_FIELDS.project).toEqual(expect.arrayContaining(["category", "goalId"]));
    expect(REFERENCE_FIELDS.goal).toEqual(expect.arrayContaining(["areaId", "tags[]", "dropped.decisionId"]));
    expect(REFERENCE_FIELDS.person).toEqual(["categoryIds[]"]);
    expect(REFERENCE_FIELDS.program).toEqual(["gameCategoryId"]);
  });

  it("carries every registry link path under its type, each once", () => {
    for (const r of LINK_PATHS) expect(REFERENCE_FIELDS[r.entityType], `${r.entityType} · ${r.path}`).toContain(r.path);
    for (const [type, paths] of Object.entries(REFERENCE_FIELDS)) {
      expect(new Set(paths).size, type).toBe(paths.length);
      expect(ALL_ENTITY_TYPES, type).toContain(type);
    }
    // The types the registry added to the restore (none of these were rewritten before Phase 0).
    expect(REFERENCE_FIELDS.waiting).toEqual(["contactId"]);
    expect(REFERENCE_FIELDS.health_trusted_adult).toEqual(["personId"]);
    expect(REFERENCE_FIELDS.money_tx).toEqual(["paysBillId", "matchedReceiptId"]);
    expect(REFERENCE_FIELDS.chat_message).toEqual(["provenance.refs[].id"]);
    expect(REFERENCE_FIELDS.task).toContain("reminder.linkedItem.id");
  });

  it("life_area is named as having none, and has none", () => {
    expect(NO_REFERENCES).toEqual(["life_area"]);
    expect(REFERENCE_FIELDS.life_area).toBeUndefined();
  });
});

describe("remapReferences", () => {
  const map = new Map([["old-p", "new-p"], ["old-t", "new-t"], ["old-c", "new-c"]]);

  it("rewrites a filing id and a link id on the same record", () => {
    const out = remapReferences("task", { text: "Call", category: "old-c", personId: "old-p", reminder: { linkedItem: { type: "contact", id: "old-p" } } }, map);
    expect(out).toEqual({ text: "Call", category: "new-c", personId: "new-p", reminder: { linkedItem: { type: "contact", id: "new-p" } } });
  });

  it("rewrites the registry paths of a type the restore never knew before", () => {
    expect(remapReferences("waiting", { title: "W", contactId: "old-p" }, map)).toEqual({ title: "W", contactId: "new-p" });
    expect(remapReferences("chat_message", { provenance: { refs: [{ id: "old-t" }, { id: "keep" }] } }, map))
      .toEqual({ provenance: { refs: [{ id: "new-t" }, { id: "keep" }] } });
  });

  it("leaves an id with no new home alone, and an unknown type untouched", () => {
    const d = { text: "x", personId: "stranger" };
    expect(remapReferences("task", d, map)).toEqual(d);
    expect(remapReferences("life_area", { name: "A" }, map)).toEqual({ name: "A" });
  });
});
