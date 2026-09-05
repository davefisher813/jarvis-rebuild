// Decision Record: the behaviors the build doc pinned, as laws. No AI, no
// counts, no judgment copy, no confirm gates, supersede never deletes, and
// an ignored revisit is gone at midnight, not repeated.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Store, InMemoryAdapter } from "@core";
import { DecisionService } from "./DecisionService";
import { ENTITY_DECISION } from "./types";

const U = "user1";
const rig = () => new DecisionService(new Store(new InMemoryAdapter()), U);

const srcOf = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const FLOW_FILES = ["./DecisionsFlow.tsx", "./DecisionCaptureSheet.tsx", "./DecisionService.ts", "./types.ts"];

describe("law: the entity type ships with its registry migration", () => {
  it("migration 0025 registers decision_record", () => {
    const sql = srcOf("../../../jarvis-core/supabase/migrations/0025_decision_record.sql");
    expect(sql).toContain("insert into entity_type");
    expect(sql).toContain("'decision_record'");
    expect(ENTITY_DECISION).toBe("decision_record");
  });
});

describe("law: save is never gated on the reason", () => {
  it("a decision with no why saves anyway", async () => {
    const svc = rig();
    const id = await svc.create({ decision: "Student template ships first" });
    expect(id).not.toBeNull();
    const rec = await svc.get(id!);
    expect(rec?.data.why).toBeUndefined();
  });

  it("only an empty decision refuses (the one required field)", async () => {
    const svc = rig();
    expect(await svc.create({ decision: "   " })).toBeNull();
  });
});

describe("law: a reversal supersedes, it never deletes", () => {
  it("the superseded record leaves the list but stays reachable", async () => {
    const svc = rig();
    const oldId = await svc.create({ decision: "Student first" });
    const newId = await svc.supersede(oldId!, { decision: "Personal first" });
    expect(newId).not.toBeNull();

    const live = await svc.list();
    expect(live.map((r) => r.id)).toEqual([newId]);

    // Reachable: the old record still exists, chained both directions.
    const old = await svc.get(oldId!);
    expect(old).not.toBeNull();
    expect(old!.data.supersededById).toBe(newId);
    const fresh = await svc.get(newId!);
    expect(fresh!.data.supersedesId).toBe(oldId);
  });

  it("undo of a supersede restores the old record to the list", async () => {
    const svc = rig();
    const oldId = await svc.create({ decision: "Student first" });
    const newId = await svc.supersede(oldId!, { decision: "Personal first" });
    await svc.undoSupersede(newId!);
    const live = await svc.list();
    expect(live.map((r) => r.id)).toEqual([oldId]);
    expect((await svc.get(oldId!))!.data.supersededById).toBeUndefined();
  });

  it("deleting a replacement returns the older record to the list", async () => {
    const svc = rig();
    const oldId = await svc.create({ decision: "Student first" });
    const newId = await svc.supersede(oldId!, { decision: "Personal first" });
    await svc.remove(newId!);
    const live = await svc.list();
    expect(live.map((r) => r.id)).toEqual([oldId]);
  });
});

describe("law: revisit shows once, on the day, and expires unanswered", () => {
  it("a due revisit surfaces on its day", async () => {
    const svc = rig();
    const id = await svc.create({ decision: "Saturdays only", revisitOn: "2026-08-18" });
    const due = await svc.getRevisitsDue("2026-08-18");
    expect(due.map((r) => r.id)).toEqual([id]);
    // Not before its day.
    expect(await svc.getRevisitsDue("2026-08-17")).toEqual([]);
  });

  it("a passed day expires and never renders again", async () => {
    const svc = rig();
    const id = await svc.create({ decision: "Saturdays only", revisitOn: "2026-08-17" });
    const n = await svc.expirePastRevisits("2026-08-18");
    expect(n).toBe(1);
    expect(await svc.getRevisitsDue("2026-08-18")).toEqual([]);
    expect((await svc.get(id!))!.data.revisitState).toBe("expired");
  });

  it("still good stamps a confirmed date and closes the revisit", async () => {
    const svc = rig();
    const id = await svc.create({ decision: "Saturdays only", revisitOn: "2026-08-18" });
    await svc.confirmRevisit(id!);
    const rec = await svc.get(id!);
    expect(rec!.data.revisitState).toBe("confirmed");
    expect(rec!.data.confirmedAt).toBeTruthy();
    expect(await svc.getRevisitsDue("2026-08-18")).toEqual([]);
    // Undo returns it to pending, so it can render again today.
    await svc.unconfirmRevisit(id!);
    expect(await svc.getRevisitsDue("2026-08-18")).toHaveLength(1);
  });

  it("a superseded record's revisit never surfaces", async () => {
    const svc = rig();
    const oldId = await svc.create({ decision: "Saturdays only", revisitOn: "2026-08-18" });
    await svc.supersede(oldId!, { decision: "Sundays too" });
    expect(await svc.getRevisitsDue("2026-08-18")).toEqual([]);
  });
});

describe("law: zero AI calls at every level", () => {
  it("no decisions file touches the AI stack", () => {
    const dir = fileURLToPath(new URL(".", import.meta.url));
    for (const f of readdirSync(dir)) {
      if (!/\.(ts|tsx)$/.test(f) || f.endsWith(".test.ts")) continue;
      const src = readFileSync(dir + f, "utf8");
      expect(src, f).not.toMatch(/useAI|AIService|\/api\/ai|aiFetch|anthropic/i);
    }
  });

  it("the surfaces that mount decisions pass no AI into them", () => {
    // The flow's imports are the proof: DecisionsFlow pulls services and
    // primitives only, never the AI hook.
    const src = srcOf("./DecisionsFlow.tsx");
    expect(src).not.toMatch(/from "\.\.\/ai\//);
  });
});

describe("law: no guilt metrics, no judgment copy", () => {
  it("no decision count renders anywhere in the feature", () => {
    for (const f of FLOW_FILES) {
      const src = srcOf(f);
      // The sh2 count slot (className="n") is the sanctioned count chip on
      // other list pages; a count of decisions is a guilt metric, so the
      // slot is banned in this folder.
      expect(src, f).not.toContain('className="n"');
    }
  });

  it("the banned judgment words appear in no literal", () => {
    for (const f of FLOW_FILES) {
      const src = srcOf(f);
      expect(src, f).not.toMatch(/reversed|changed your mind|\bagain\b|still haven/i);
    }
  });

  it("no em dashes in the feature's copy", () => {
    for (const f of FLOW_FILES) {
      expect(srcOf(f), f).not.toContain("—");
    }
  });
});

describe("law: every user mutation runs through the write guard", () => {
  it("the flow wraps its writes in attemptWrite", () => {
    const src = srcOf("./DecisionsFlow.tsx");
    expect(src).toContain('import { attemptWrite } from "../shared/guard"');
    // Every mutation path in the flow (create, patch, supersede, undo,
    // delete) runs through the guard; the count pins the wrap sites.
    const guarded = src.match(/attemptWrite\(/g) ?? [];
    expect(guarded.length).toBeGreaterThanOrEqual(5);
  });
});

describe("newest first, linked lookups", () => {
  it("list is newest first and getByLink returns the newest live decision", async () => {
    const svc = rig();
    const a = await svc.create({ decision: "First call", linkedType: "project", linkedId: "p1", linkedLabel: "Launch" });
    await new Promise((r) => setTimeout(r, 5));
    const b = await svc.create({ decision: "Second call", linkedType: "project", linkedId: "p1", linkedLabel: "Launch" });
    const live = await svc.list();
    expect(live.map((r) => r.id)).toEqual([b, a]);
    const hit = await svc.getByLink("project", "p1");
    expect(hit!.id).toBe(b);
  });
});

// BRAIN-F-01 / SCHED-F-01 (2026-09-05): clears written as `undefined` never
// reached Supabase (JSON drops the key; `data || p_patch` cannot see it).
// The in-memory adapter now merges the way the server does, so these prove
// the clears the Brain's decisions make actually land: the key is absent
// from the row, not null, not the old value.
describe("BRAIN-F-01: decision clears reach the row (jsonb-style adapter)", () => {
  const absent = (data: object, key: string) => expect(Object.prototype.hasOwnProperty.call(data, key), `${key} should be gone`).toBe(false);

  it("Undo on Decision replaced removes the old record's forward pointer entirely", async () => {
    const svc = rig();
    const oldId = await svc.create({ decision: "Student first" });
    const newId = await svc.supersede(oldId!, { decision: "Personal first" });
    expect((await svc.get(oldId!))!.data.supersededById).toBe(newId);
    await svc.undoSupersede(newId!);
    absent((await svc.get(oldId!))!.data, "supersededById");
    expect((await svc.list()).map((r) => r.id)).toEqual([oldId]);
  });

  it("deleting a replacement clears the older record's pointer, so it returns to the list", async () => {
    const svc = rig();
    const oldId = await svc.create({ decision: "Student first" });
    const newId = await svc.supersede(oldId!, { decision: "Personal first" });
    await svc.remove(newId!);
    absent((await svc.get(oldId!))!.data, "supersededById");
    expect((await svc.list()).map((r) => r.id)).toEqual([oldId]);
  });

  it("Clear on the reason, the revisit date and Attached To all leave the row", async () => {
    const svc = rig();
    const id = await svc.create({ decision: "Saturdays only", why: "Family time", revisitOn: "2026-08-18", linkedType: "project", linkedId: "p1", linkedLabel: "Field House" });
    await svc.update(id!, { why: undefined });
    await svc.update(id!, { revisitOn: undefined });
    await svc.update(id!, { linkedType: undefined, linkedId: undefined, linkedLabel: undefined });
    const d = (await svc.get(id!))!.data;
    absent(d, "why");
    absent(d, "revisitOn");
    absent(d, "linkedType");
    absent(d, "linkedId");
    absent(d, "linkedLabel");
    expect(d.revisitState).toBe("none");
    expect(d.decision).toBe("Saturdays only");
  });

  it("Undo on Still Good clears the confirmation stamp", async () => {
    const svc = rig();
    const id = await svc.create({ decision: "Saturdays only", revisitOn: "2026-08-18" });
    await svc.confirmRevisit(id!);
    await svc.unconfirmRevisit(id!);
    const d = (await svc.get(id!))!.data;
    absent(d, "confirmedAt");
    expect(d.revisitState).toBe("pending");
  });
});
