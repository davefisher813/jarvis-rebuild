import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { DecisionService } from "./DecisionService";
import { linksOf } from "./types";
import type { EventInput } from "../events";

// C-53 and C-55 (Astra, 2026-09-12): several homes, a source, an outcome.
const U = "u1";

describe("DecisionService: links, source and outcome", () => {
  it("create keeps the old triple and the new list in step both ways", async () => {
    const svc = new DecisionService(new Store(new InMemoryAdapter()), U);
    const a = (await svc.create({ decision: "Use Stripe", links: [{ type: "project", id: "p1", label: "Payments" }, { type: "person", id: "x1", label: "Alberto" }] }))!;
    const b = (await svc.create({ decision: "Drop Clover", linkedType: "org", linkedId: "o1", linkedLabel: "Tucci" }))!;
    const ra = (await svc.get(a))!.data; const rb = (await svc.get(b))!.data;
    expect(ra).toMatchObject({ linkedType: "project", linkedId: "p1", linkedLabel: "Payments" });
    expect(linksOf(ra).map((l) => l.id)).toEqual(["p1", "x1"]);
    expect(linksOf(rb)).toEqual([{ type: "org", id: "o1", label: "Tucci" }]);
    // getByLink finds a decision by any of its homes.
    expect((await svc.getByLink("person", "x1"))?.id).toBe(a);
    expect((await svc.getByLink("org", "o1"))?.id).toBe(b);
  });

  it("markOutcome stamps the word and the day, and the log hears only that an outcome was recorded", async () => {
    const events: EventInput[] = [];
    const svc = new DecisionService(new Store(new InMemoryAdapter()), U, (e) => events.push(e));
    const id = (await svc.create({ decision: "Use Stripe", source: { kind: "chat", entityId: "m-9", at: "2026-09-12T15:22:00.000Z" }, expected: "Simpler integration" }))!;
    expect(await svc.markOutcome(id, "didnt")).toBe(true);
    const d = (await svc.get(id))!.data;
    expect(d.outcome?.word).toBe("didnt");
    expect(d.outcome?.at).toBeTruthy();
    expect(d.source).toEqual({ kind: "chat", entityId: "m-9", at: "2026-09-12T15:22:00.000Z" });
    expect(d.expected).toBe("Simpler integration");
    const ev = events.filter((e) => e.type === "decision.recorded").map((e) => e.props?.kind);
    expect(ev).toEqual(["new", "outcome"]);
    // Expiry rule unchanged: no revisit state was touched by an outcome.
    expect(d.revisitState).toBe("none");
  });
});
