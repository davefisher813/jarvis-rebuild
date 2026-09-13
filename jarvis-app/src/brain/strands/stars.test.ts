import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { StrandsService } from "./StrandsService";
import type { EventInput } from "../../events";

// C-50 (Astra, 2026-09-12): the Remember star's two writes, and what the
// log hears about them.
const OWNER = "u1";
const TODAY = "2026-09-12";

describe("StrandsService: the Remember star", () => {
  it("addLinked writes a told-rank fact linked to the row's entity, and the event names the entity, not the words", async () => {
    const events: EventInput[] = [];
    const svc = new StrandsService(new Store(new InMemoryAdapter()), OWNER, (e) => events.push(e));
    const id = await svc.addLinked("Invoice · Wei", "mail_thread", "t-1", TODAY);
    expect(id).toBeTruthy();
    const s = (await svc.list()).find((x) => x.id === id)!;
    expect(s.data).toMatchObject({ text: "Invoice · Wei", source: "told", strength: "influence", type: "fact", category: "values", link: { entityType: "mail_thread", entityId: "t-1" } });
    const starred = events.find((e) => e.type === "strand.starred")!;
    expect(starred).toMatchObject({ entityType: "mail_thread", entityId: "t-1" });
    expect(JSON.stringify(starred)).not.toContain("Wei");
  });

  it("unstar removes the strand and says so without a strand.deleted, which would feed the nod test", async () => {
    const events: EventInput[] = [];
    const svc = new StrandsService(new Store(new InMemoryAdapter()), OWNER, (e) => events.push(e));
    const id = (await svc.addLinked("Pay Ticket", "task", "k-1", TODAY))!;
    await svc.unstar(id, "task", "k-1");
    expect(await svc.list()).toEqual([]);
    expect(events.map((e) => e.type)).toContain("strand.unstarred");
    expect(events.map((e) => e.type)).not.toContain("strand.deleted");
  });

  it("add carries a link and a type when given, and neither when not", async () => {
    const svc = new StrandsService(new Store(new InMemoryAdapter()), OWNER);
    const plain = (await svc.add("Family dinner is fixed", "values", TODAY))!;
    const ruled = (await svc.add("Bridge wins ties", "values", TODAY, "rule", "principle", { entityType: "decision_record", entityId: "d-1" }))!;
    const all = await svc.list();
    expect(all.find((s) => s.id === plain)!.data).not.toHaveProperty("link");
    expect(all.find((s) => s.id === plain)!.data).not.toHaveProperty("type");
    expect(all.find((s) => s.id === ruled)!.data).toMatchObject({ strength: "rule", type: "principle", link: { entityType: "decision_record", entityId: "d-1" } });
  });
});
