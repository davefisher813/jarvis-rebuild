// The link registry mirror (Phase 0 D2). linkLaw.test.ts holds this file to
// 0060's jarvis_link_paths(); these pin what the mirror itself promises: the
// row count, the sixteen kinds, and what linksOf reads off a record.

import { describe, it, expect } from "vitest";
import { LINK_KINDS, LINK_PATHS, linkPathsFor, linksOf } from "./paths";
import { ALL_ENTITY_TYPES } from "../../backup/entityRegistry";

describe("the link registry mirror", () => {
  it("mirrors the 42 registry rows and the 16 kinds", () => {
    expect(LINK_PATHS.length).toBe(42);
    expect(LINK_KINDS.length).toBe(16);
    expect(new Set(LINK_KINDS).size).toBe(16);
    // Every row's kind is a registry word, and every word is derived by a row.
    expect(LINK_PATHS.filter((r) => !(LINK_KINDS as readonly string[]).includes(r.kind))).toEqual([]);
    expect(LINK_KINDS.filter((k) => !LINK_PATHS.some((r) => r.kind === k))).toEqual([]);
  });

  it("every registry entity type is one this build registers", () => {
    const unknown = [...new Set(LINK_PATHS.map((r) => r.entityType))].filter((t) => !ALL_ENTITY_TYPES.includes(t));
    expect(unknown, "a registry row for a kind the app does not know").toEqual([]);
  });

  it("the same (type, path, kind) row never appears twice", () => {
    const keys = LINK_PATHS.map((r) => `${r.entityType} · ${r.path} · ${r.kind}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("linksOf reads a task's person and project", () => {
    const links = linksOf("task", { text: "Call Mike", personId: "p1", projectId: "pr1", category: "c1" });
    expect(links).toEqual([
      { path: "personId", kind: "about", toId: "p1" },
      { path: "projectId", kind: "in", toId: "pr1" },
    ]);
  });

  it("skips a pointer at the record itself, and empty or non string values", () => {
    expect(linksOf("decision_record", { supersedesId: "d1", linkedId: "", supersededById: 7 }, "d1")).toEqual([]);
    expect(linksOf("decision_record", { supersedesId: "d2" }, "d1")).toEqual([{ path: "supersedesId", kind: "replaces", toId: "d2" }]);
  });

  it("an array path yields one link per element, and a nested one descends", () => {
    expect(linksOf("event", { taskIds: ["t1", "t2"] })).toEqual([
      { path: "taskIds[]", kind: "has", toId: "t1" },
      { path: "taskIds[]", kind: "has", toId: "t2" },
    ]);
    expect(linksOf("note", { blocks: [{ items: [{ taskId: "t1" }, { text: "no task" }] }, { items: [{ taskId: "t2" }] }] }))
      .toEqual([
        { path: "blocks[].items[].taskId", kind: "has", toId: "t1" },
        { path: "blocks[].items[].taskId", kind: "has", toId: "t2" },
      ]);
  });

  it("a note's person connection is about, any other connection mentions, a missing kind counting as other", () => {
    const links = linksOf("note", { connections: [
      { kind: "person", targetId: "p1" },
      { kind: "event", targetId: "e1" },
      { targetId: "x1" },
    ] });
    expect(links).toEqual([
      { path: "connections[].targetId", kind: "about", toId: "p1" },
      { path: "connections[].targetId", kind: "mentions", toId: "e1" },
      { path: "connections[].targetId", kind: "mentions", toId: "x1" },
    ]);
  });

  it("a nested object path and a missing branch", () => {
    expect(linksOf("task", { reminder: { linkedItem: { type: "contact", id: "p1" } } })).toEqual([{ path: "reminder.linkedItem.id", kind: "reminds", toId: "p1" }]);
    expect(linksOf("task", { reminder: { time: "09:00" } })).toEqual([]);
    expect(linksOf("task", null)).toEqual([]);
    expect(linksOf("unknown_kind", { personId: "p1" })).toEqual([]);
  });

  it("linkPathsFor keeps registry order", () => {
    expect(linkPathsFor("task").map((r) => r.path)).toEqual([
      "personId", "projectId", "goalId", "eventId", "fromNote", "reminder.linkedItem.id", "plan.contextTrigger.targetId",
    ]);
  });
});
