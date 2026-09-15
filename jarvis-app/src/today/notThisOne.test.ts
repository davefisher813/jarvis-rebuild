// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { dealFrom, markNotThisOne, notThisOneToday } from "./notThisOne";

// Dave, 2026-09-15: "do the buttons really have any value to the user... the
// worst thing is for someone to click on something and it's pointless."
//
// The Why sheet's That's Wrong emitted an event nothing re-ranked on. This is
// the smallest thing that makes it mean something, and these pin the three
// ways that could quietly go wrong: it lasts a day and not forever, it moves
// the LEADING slot and not the deck, and it never blanks the card.

const t = (id: string) => ({ id });

describe("not this one, today", () => {
  beforeEach(() => localStorage.clear());

  it("remembers nothing until something is said", () => {
    expect(notThisOneToday("2026-09-15").size).toBe(0);
    expect(dealFrom([t("a"), t("b")], "2026-09-15").map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("steps the waved-off task out of the lead, and the next one takes it", () => {
    markNotThisOne("a", "2026-09-15");
    expect(dealFrom([t("a"), t("b"), t("c")], "2026-09-15")[0]!.id).toBe("b");
  });

  it("is today's answer, not forever", () => {
    markNotThisOne("a", "2026-09-15");
    expect(dealFrom([t("a"), t("b")], "2026-09-16")[0]!.id).toBe("a");
    expect(notThisOneToday("2026-09-16").size).toBe(0);
  });

  it("drops yesterday's rows rather than growing forever", () => {
    markNotThisOne("a", "2026-09-14");
    markNotThisOne("b", "2026-09-15");
    // Reading today prunes: only today's row is live.
    expect([...notThisOneToday("2026-09-15")]).toEqual(["b"]);
    markNotThisOne("c", "2026-09-15");
    const stored = JSON.parse(localStorage.getItem("jarvis.today.notThisOne.v1") ?? "[]") as unknown[];
    expect(stored).toHaveLength(2);
  });

  it("says the same thing twice without storing it twice", () => {
    markNotThisOne("a", "2026-09-15");
    markNotThisOne("a", "2026-09-15");
    expect([...notThisOneToday("2026-09-15")]).toEqual(["a"]);
  });

  it("NEVER blanks the card: waving off all of them deals the top one again", () => {
    markNotThisOne("a", "2026-09-15");
    markNotThisOne("b", "2026-09-15");
    // The alternative is Your Move disappearing on a day with open work in
    // it, for a reason nothing on screen explains.
    expect(dealFrom([t("a"), t("b")], "2026-09-15").map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("leaves the deck itself alone", () => {
    markNotThisOne("a", "2026-09-15");
    const deck = [t("a"), t("b"), t("c")];
    // Only the head moved; everything is still in the list behind it, which
    // is what keeps Focus's count and Still Open honest.
    expect(dealFrom(deck, "2026-09-15")).toHaveLength(2);
    expect(deck).toHaveLength(3);
  });

  it("survives a corrupt or unreadable store rather than taking the page down", () => {
    localStorage.setItem("jarvis.today.notThisOne.v1", "{not json");
    expect(notThisOneToday("2026-09-15").size).toBe(0);
    localStorage.setItem("jarvis.today.notThisOne.v1", JSON.stringify([{ nope: 1 }, "x", null]));
    expect(notThisOneToday("2026-09-15").size).toBe(0);
  });
});
