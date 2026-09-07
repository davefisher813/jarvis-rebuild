import { describe, it, expect, beforeEach } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { StrandsService } from "./StrandsService";
import { STRAND_CAP_PER_CATEGORY, EVIDENCE_CAP } from "./types";
import type { EventInput } from "../../events";

const TODAY = "2026-08-21";
const OWNER = "u1";

function make(): { svc: StrandsService; events: EventInput[] } {
  const events: EventInput[] = [];
  const svc = new StrandsService(new Store(new InMemoryAdapter()), OWNER, (e) => events.push(e));
  return { svc, events };
}

describe("StrandsService", () => {
  let ctx: ReturnType<typeof make>;
  beforeEach(() => { ctx = make(); });

  it("an accepted moment becomes a watched strand carrying its receipts", async () => {
    const id = await ctx.svc.accept("Gets things done mid morning", "energy", "completion_window", [{ day: TODAY, a: 9 }], TODAY);
    expect(id).toBeTruthy();
    const [s] = await ctx.svc.list();
    expect(s!.data.source).toBe("watched");
    expect(s!.data.strength).toBe("influence");
    expect(s!.data.evidence).toHaveLength(1);
  });

  it("a typed strand is told-rank, because the user meant it", async () => {
    await ctx.svc.add("Never schedule calls before 10", "work_style", TODAY);
    const [s] = await ctx.svc.list();
    expect(s!.data.source).toBe("told");
    expect(s!.data.derivation).toBeUndefined();
  });

  it("an onboarding seed is asked-rank, BELOW watched, so evidence can overrule it", async () => {
    // The whole point of item 4. A chip tapped during intake is what someone
    // says about themselves before the app has watched them do anything. Filed
    // as told it would outrank a month of real behaviour for the life of the
    // account; filed as asked, the log quietly wins and nobody un-teaches it.
    await ctx.svc.seed("My head is clearest early in the morning", "energy", TODAY);
    const [s] = await ctx.svc.list();
    expect(s!.data.source).toBe("asked");
    expect(s!.data.strength).toBe("influence");
    expect(s!.data.derivation).toBeUndefined();
  });

  it("a seed obeys the same caps as everything else", async () => {
    // A seeded genome that filled a category would lock real derivations out
    // of it later, which is the opposite of what seeding is for.
    for (let i = 0; i < STRAND_CAP_PER_CATEGORY; i++) await ctx.svc.seed("fact " + i, "values", TODAY);
    expect(await ctx.svc.seed("one too many", "values", TODAY)).toBeNull();
    expect((await ctx.svc.list()).filter((x) => x.data.category === "values")).toHaveLength(STRAND_CAP_PER_CATEGORY);
  });

  it("never promotes an influence to a rule on its own", async () => {
    await ctx.svc.accept("x", "energy", "completion_window", [], TODAY);
    const [s] = await ctx.svc.list();
    expect(s!.data.strength).toBe("influence");
  });

  it("refuses a second strand for the same derivation, so a fact never twins", async () => {
    await ctx.svc.accept("first", "energy", "completion_window", [], TODAY);
    const r = await ctx.svc.accept("again", "energy", "completion_window", [], TODAY);
    expect(r.outcome).toBe("refreshed");
    expect(await ctx.svc.list()).toHaveLength(1);
  });

  // 2026-08-24. byDerivation and refreshEvidence were written for this and
  // never called: a re-derivation just returned null, so a strand's receipts
  // were frozen at whatever the first accept happened to see, however long
  // ago that was and however much better the evidence had got since.
  it("a re-derivation brings the receipts up to date", async () => {
    await ctx.svc.accept("first", "energy", "completion_window", [{ day: "2026-08-01", a: 9 }], TODAY);
    await ctx.svc.accept("first", "energy", "completion_window", [{ day: "2026-08-20", a: 11 }], TODAY);
    const [s] = await ctx.svc.list();
    expect(s!.data.evidence).toEqual([{ day: "2026-08-20", a: 11 }]);
  });

  it("a re-derivation refreshes lastConfirmed, which is what confirmation means", async () => {
    await ctx.svc.accept("first", "energy", "completion_window", [], "2026-08-01");
    await ctx.svc.accept("first", "energy", "completion_window", [], "2026-08-24");
    const [s] = await ctx.svc.list();
    expect(s!.data.lastConfirmed).toBe("2026-08-24");
  });

  // The words are his once he has edited them. A later re-derivation must
  // update the receipts and leave the sentence alone, or the machine quietly
  // takes back a correction the user made on purpose.
  it("a re-derivation never overwrites text the user corrected", async () => {
    await ctx.svc.accept("machine words", "energy", "completion_window", [], TODAY);
    const [before] = await ctx.svc.list();
    await ctx.svc.edit(before!, "his own words", TODAY);
    await ctx.svc.accept("machine words again", "energy", "completion_window", [{ day: TODAY, a: 3 }], TODAY);
    const [after] = await ctx.svc.list();
    expect(after!.data.text).toBe("his own words");
    expect(after!.data.source).toBe("told");
    expect(after!.data.evidence).toEqual([{ day: TODAY, a: 3 }]);
  });

  // The distinction the caller needs: a toast that says "the Brain is full"
  // when the real reason is "you already have this one" is a lie, and it was
  // shipping.
  it("tells a full genome apart from a fact already known", async () => {
    await ctx.svc.accept("first", "energy", "completion_window", [], TODAY);
    expect((await ctx.svc.accept("again", "energy", "completion_window", [], TODAY)).outcome).toBe("refreshed");
    for (let i = 0; i < STRAND_CAP_PER_CATEGORY; i++) await ctx.svc.add("v " + i, "values", TODAY);
    expect((await ctx.svc.accept("new fact", "values", "task_timing", [], TODAY)).outcome).toBe("full");
  });

  it("caps a category rather than growing into fifty maybes", async () => {
    for (let i = 0; i < STRAND_CAP_PER_CATEGORY; i++) {
      expect(await ctx.svc.add("fact " + i, "values", TODAY)).toBeTruthy();
    }
    expect(await ctx.svc.add("one too many", "values", TODAY)).toBeNull();
  });

  it("caps receipts so a strand cannot become a log", async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ day: TODAY, a: i }));
    await ctx.svc.accept("x", "energy", "completion_window", many, TODAY);
    const [s] = await ctx.svc.list();
    expect(s!.data.evidence).toHaveLength(EVIDENCE_CAP);
  });

  it("refuses an empty typed strand", async () => {
    expect(await ctx.svc.add("   ", "values", TODAY)).toBeNull();
  });

  // S4-Q24 (2026-09-04): "a rule and a preference carry the same weight."
  // add() has always taken a strength argument; setStrength is the only way
  // to change it on a strand that already exists, and the only caller is
  // the person, on purpose, from the edit sheet.
  describe("setStrength", () => {
    it("promotes an ordinary fact to a rule", async () => {
      await ctx.svc.add("Family dinner is non-negotiable", "people", TODAY);
      const [s] = await ctx.svc.list();
      expect(s!.data.strength).toBe("influence");
      await ctx.svc.setStrength(s!, "rule");
      const [after] = await ctx.svc.list();
      expect(after!.data.strength).toBe("rule");
    });

    it("reverts a rule back to an ordinary influence", async () => {
      await ctx.svc.add("Family dinner is non-negotiable", "people", TODAY, "rule");
      const [s] = await ctx.svc.list();
      expect(s!.data.strength).toBe("rule");
      await ctx.svc.setStrength(s!, "influence");
      const [after] = await ctx.svc.list();
      expect(after!.data.strength).toBe("influence");
    });

    it("touches nothing else: a watched strand stays watched, with its derivation and evidence intact", async () => {
      await ctx.svc.accept("x", "energy", "completion_window", [{ day: TODAY, a: 9 }], TODAY);
      const [s] = await ctx.svc.list();
      await ctx.svc.setStrength(s!, "rule");
      const [after] = await ctx.svc.list();
      expect(after!.data.source).toBe("watched");
      expect(after!.data.derivation).toBe("completion_window");
      expect(after!.data.evidence).toEqual([{ day: TODAY, a: 9 }]);
    });
  });

  it("active() hides paused strands, which is what the AI reads", async () => {
    await ctx.svc.add("live one", "values", TODAY);
    await ctx.svc.add("quiet one", "values", TODAY);
    const all = await ctx.svc.list();
    await ctx.svc.setStatus(all[0]!, "paused");
    const active = await ctx.svc.active();
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe(all[1]!.id);
  });

  // S4-Q22 (2026-09-04): "no control anywhere moves a fact's category."
  // recategorize is what both new chip rows (the capture receipt and the
  // What JARVIS Knows edit sheet) call.
  describe("recategorize", () => {
    it("moves a strand to a different bucket", async () => {
      await ctx.svc.add("Never schedule calls before 10", "work_style", TODAY);
      const [s] = await ctx.svc.list();
      expect(await ctx.svc.recategorize(s!, "routine")).toBe(true);
      const [after] = await ctx.svc.list();
      expect(after!.data.category).toBe("routine");
    });

    it("refuses when the target bucket is already at its cap, and leaves the strand where it was", async () => {
      for (let i = 0; i < STRAND_CAP_PER_CATEGORY; i++) await ctx.svc.add("v " + i, "values", TODAY);
      const id = await ctx.svc.add("Never schedule calls before 10", "work_style", TODAY);
      const strand = (await ctx.svc.list()).find((x) => x.id === id)!;
      expect(await ctx.svc.recategorize(strand, "values")).toBe(false);
      const after = (await ctx.svc.list()).find((x) => x.id === id)!;
      expect(after.data.category).toBe("work_style");
    });

    it("moving the last slot INTO a full bucket doesn't count itself against the cap", async () => {
      // A strand already sitting in "values" moving to "values" is a
      // same-category no-op, not a strand competing with itself for the
      // twelfth slot.
      for (let i = 0; i < STRAND_CAP_PER_CATEGORY; i++) await ctx.svc.add("v " + i, "values", TODAY);
      const [s] = await ctx.svc.list();
      expect(await ctx.svc.recategorize(s!, "values")).toBe(true);
    });

    it("does not touch the accuracy record: no event, no rank promotion", async () => {
      await ctx.svc.accept("x", "energy", "completion_window", [], TODAY);
      const [s] = await ctx.svc.list();
      await ctx.svc.recategorize(s!, "routine");
      expect(ctx.events.map((e) => e.type)).toEqual(["strand.created"]);
      const [after] = await ctx.svc.list();
      expect(after!.data.source).toBe("watched");
    });
  });
});

describe("the accuracy record (what makes the nod test operational)", () => {
  let ctx: ReturnType<typeof make>;
  beforeEach(() => { ctx = make(); });

  it("accepting a moment records the derivation that said it", async () => {
    await ctx.svc.accept("x", "energy", "completion_window", [], TODAY);
    expect(ctx.events).toEqual([
      expect.objectContaining({ type: "strand.created", props: expect.objectContaining({ kind: "completion_window" }) }),
    ]);
  });

  it("editing a watched strand counts against its derivation AND earns told rank", async () => {
    await ctx.svc.accept("half right", "energy", "completion_window", [], TODAY);
    const [s] = await ctx.svc.list();
    await ctx.svc.edit(s!, "the way I would say it", TODAY);
    expect(ctx.events.map((e) => e.type)).toEqual(["strand.created", "strand.corrected"]);
    const [after] = await ctx.svc.list();
    expect(after!.data.text).toBe("the way I would say it");
    expect(after!.data.source).toBe("told");
  });

  it("a no-op edit is not a correction", async () => {
    await ctx.svc.accept("same words", "energy", "completion_window", [], TODAY);
    const [s] = await ctx.svc.list();
    await ctx.svc.edit(s!, "same words", TODAY);
    expect(ctx.events.map((e) => e.type)).toEqual(["strand.created"]);
  });

  it("deleting a watched strand counts against its derivation", async () => {
    await ctx.svc.accept("wrong", "energy", "completion_window", [], TODAY);
    const [s] = await ctx.svc.list();
    await ctx.svc.remove(s!);
    expect(ctx.events.map((e) => e.type)).toEqual(["strand.created", "strand.deleted"]);
    expect(await ctx.svc.list()).toHaveLength(0);
  });

  it("editing a strand the user typed themselves is not a correction of anything", async () => {
    await ctx.svc.add("my own words", "values", TODAY);
    const [s] = await ctx.svc.list();
    await ctx.svc.edit(s!, "my better words", TODAY);
    expect(ctx.events.map((e) => e.type)).toEqual(["strand.created"]);
  });

  it("no strand event ever carries the strand's text", async () => {
    await ctx.svc.accept("a sentence about the user", "energy", "completion_window", [], TODAY);
    const [s] = await ctx.svc.list();
    await ctx.svc.edit(s!, "another sentence about the user", TODAY);
    await ctx.svc.remove(s!);
    const dumped = JSON.stringify(ctx.events);
    expect(dumped).not.toContain("sentence about the user");
  });
});

// THE EVIDENCE FLIPPED (2026-09-07). A no-pattern fact and the fact it denies
// are two answers to one question, so they get two derivation keys (see
// NO_PATTERN_TWIN, and the reasoning above it in types.ts). Two keys is what
// keeps the nod test honest and lets JARVIS change its mind when his life
// changes; the price is a genome that could hold both, and these pin that
// price paid.
describe("a no-pattern fact and the fact it denies never sit in the genome together", () => {
  let ctx: ReturnType<typeof make>;
  beforeEach(() => { ctx = make(); });

  const BAND = "Gets things done between 9 PM and 12 AM in the evening";
  const SPREAD = "Finishes things across the whole day rather than in one stretch";

  it("accepting the absence retires the band it contradicts", async () => {
    await ctx.svc.accept(BAND, "energy", "completion_window", [{ day: TODAY, a: 21 }], TODAY);
    const r = await ctx.svc.accept(SPREAD, "energy", "completion_no_band", [], TODAY);
    expect(r.outcome).toBe("created");
    expect(r.outcome === "created" && r.replaced).toBe(true);
    const all = await ctx.svc.list();
    expect(all).toHaveLength(1);
    expect(all[0]!.data.text).toBe(SPREAD);
    expect(all[0]!.data.derivation).toBe("completion_no_band");
  });

  it("and the flip runs the other way too, so a life that develops a band is heard", async () => {
    // Same shape, opposite direction: he accepted "across the whole day" in
    // September, his evenings tighten up, and the band detector speaks again.
    // This is the case that separate keys exist to make possible at all: on a
    // shared key the accepted absence would have suppressed the band forever.
    await ctx.svc.accept(SPREAD, "energy", "completion_no_band", [], TODAY);
    const r = await ctx.svc.accept(BAND, "energy", "completion_window", [{ day: TODAY, a: 21 }], TODAY);
    expect(r.outcome === "created" && r.replaced).toBe(true);
    const all = await ctx.svc.list();
    expect(all).toHaveLength(1);
    expect(all[0]!.data.text).toBe(BAND);
  });

  it("retiring the twin emits no strand.deleted, so an honest flip never mutes a correct detector", async () => {
    // The nod test reads strand.deleted as "this derivation was wrong about
    // him" and switches it off after two. The band was not wrong; his life
    // changed. Emitting here would cost him the detector after two flips.
    await ctx.svc.accept(BAND, "energy", "completion_window", [], TODAY);
    ctx.events.length = 0;
    await ctx.svc.accept(SPREAD, "energy", "completion_no_band", [], TODAY);
    expect(ctx.events.map((e) => e.type)).toEqual(["strand.created"]);
  });

  it("the twin's slot is the slot being taken, so a full category still lets the flip through", async () => {
    // The retired fact is excluded from the cap count. Without that, holding
    // a full energy bucket would refuse the replacement AND keep the fact it
    // was replacing, which is the worst of both.
    await ctx.svc.accept(BAND, "energy", "completion_window", [], TODAY);
    for (let i = 0; i < STRAND_CAP_PER_CATEGORY - 1; i++) await ctx.svc.add("energy fact " + i, "energy", TODAY);
    expect((await ctx.svc.list()).filter((x) => x.data.category === "energy")).toHaveLength(STRAND_CAP_PER_CATEGORY);
    const r = await ctx.svc.accept(SPREAD, "energy", "completion_no_band", [], TODAY);
    expect(r.outcome).toBe("created");
    expect((await ctx.svc.list()).filter((x) => x.data.category === "energy")).toHaveLength(STRAND_CAP_PER_CATEGORY);
  });

  it("a derivation with no twin retires nothing, and says nothing was replaced", async () => {
    await ctx.svc.accept("Trains between 4 PM and 7 PM", "routine", "training_window", [], TODAY);
    const r = await ctx.svc.accept("Deals with email in the morning", "work_style", "email_window", [], TODAY);
    expect(r.outcome === "created" && r.replaced).toBeUndefined();
    expect(await ctx.svc.list()).toHaveLength(2);
  });
});

describe("the slip pair retires the same way, because the rule is the pair's, not the fact's", () => {
  let ctx: ReturnType<typeof make>;
  beforeEach(() => { ctx = make(); });

  const NAMED = "Admin tasks tend to slip and need extra room";
  const EVERY = "Tasks slip across every area, none more than the rest";

  it("accepting the absence retires the named area, and the other way round", async () => {
    await ctx.svc.accept(NAMED, "work_style", "slip_category", [{ day: TODAY, a: 1 }], TODAY);
    const r = await ctx.svc.accept(EVERY, "work_style", "slip_no_leader", [], TODAY);
    expect(r.outcome === "created" && r.replaced).toBe(true);
    expect((await ctx.svc.list()).map((s) => s.data.text)).toEqual([EVERY]);
    const back = await ctx.svc.accept(NAMED, "work_style", "slip_category", [{ day: TODAY, a: 1 }], TODAY);
    expect(back.outcome === "created" && back.replaced).toBe(true);
    expect((await ctx.svc.list()).map((s) => s.data.text)).toEqual([NAMED]);
  });

  it("retiring across the pair still emits no strand.deleted", async () => {
    await ctx.svc.accept(NAMED, "work_style", "slip_category", [], TODAY);
    ctx.events.length = 0;
    await ctx.svc.accept(EVERY, "work_style", "slip_no_leader", [], TODAY);
    expect(ctx.events.map((e) => e.type)).toEqual(["strand.created"]);
  });

  it("the two pairs are independent: the energy answer survives a work_style flip", async () => {
    await ctx.svc.accept("Finishes things across the whole day rather than in one stretch", "energy", "completion_no_band", [], TODAY);
    await ctx.svc.accept(NAMED, "work_style", "slip_category", [], TODAY);
    await ctx.svc.accept(EVERY, "work_style", "slip_no_leader", [], TODAY);
    const held = (await ctx.svc.list()).map((s) => s.data.derivation).sort();
    expect(held).toEqual(["completion_no_band", "slip_no_leader"]);
  });
});
