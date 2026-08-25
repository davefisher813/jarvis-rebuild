import { describe, it, expect } from "vitest";
import { senderPiles, selectedCount, selectedIds, purgeLabel, purgePromise, defaultPicks } from "./purge";
import type { ThreadRow } from "../connections/google/map";

// 11C: THE PURGE. The most dangerous surface in the app, so every promise it
// makes is held here.

const row = (id: string, email: string, from: string, ageDays = 1): ThreadRow => ({
  id, from, fromEmail: email, subject: "S", snippet: "",
  unread: false, inInbox: true, dateMs: Date.parse("2026-08-25T12:00:00Z") - ageDays * 86400e3,
  count: 1, lastMsgId: "m" + id,
});

describe("grouping: eight decisions instead of four hundred", () => {
  it("piles by sender, biggest offender first", () => {
    const rows = [
      row("1", "a@x.com", "Alpha"), row("2", "a@x.com", "Alpha"), row("3", "a@x.com", "Alpha"),
      row("4", "b@x.com", "Bravo"),
      row("5", "c@x.com", "Cara"), row("6", "c@x.com", "Cara"),
    ];
    const piles = senderPiles(rows);
    expect(piles.map((p) => [p.name, p.count])).toEqual([["Alpha", 3], ["Cara", 2], ["Bravo", 1]]);
  });

  it("treats one sender as one identity whatever case they wrote in", () => {
    const piles = senderPiles([row("1", "A@X.com", "Alpha"), row("2", "a@x.com", "Alpha")]);
    expect(piles).toHaveLength(1);
    expect(piles[0]!.count).toBe(2);
  });

  it("breaks ties on recency, so the order does not shuffle between renders", () => {
    const piles = senderPiles([row("1", "a@x.com", "Alpha", 9), row("2", "b@x.com", "Bravo", 1)]);
    expect(piles.map((p) => p.name)).toEqual(["Bravo", "Alpha"]);
  });
});

describe("the safety line", () => {
  it("one needs-you thread makes the WHOLE pile unsafe", () => {
    const rows = [row("1", "a@x.com", "Alpha"), row("2", "a@x.com", "Alpha"), row("3", "a@x.com", "Alpha")];
    const piles = senderPiles(rows, { "2": { bucket: "needs_you" } });
    expect(piles[0]!.safe).toBe(false);
    // Still SHOWN: the count is the reason to look. Just never pre-picked.
    expect(piles[0]!.count).toBe(3);
    expect(defaultPicks(piles).has("a@x.com")).toBe(false);
  });

  it("a VIP never appears in a bulk-delete list at all", () => {
    // Not greyed out, not unselected: absent. The one rule allowed to
    // overrule everything else cannot be overruled by a big red button.
    const piles = senderPiles([row("1", "vip@x.com", "Attorney"), row("2", "b@x.com", "Bravo")], {}, ["VIP@x.com"]);
    expect(piles.map((p) => p.name)).toEqual(["Bravo"]);
  });

  it("pre-picks only safe piles of more than one", () => {
    const rows = [
      row("1", "a@x.com", "Alpha"), row("2", "a@x.com", "Alpha"),
      row("3", "b@x.com", "Bravo"),
      row("4", "c@x.com", "Cara"), row("5", "c@x.com", "Cara"),
    ];
    const piles = senderPiles(rows, { "4": { bucket: "needs_you" } });
    const picks = defaultPicks(piles);
    expect(picks.has("a@x.com")).toBe(true);   // safe, two threads
    expect(picks.has("b@x.com")).toBe(false);  // a single thread is not a pile
    expect(picks.has("c@x.com")).toBe(false);  // unsafe
  });
});

describe("the count is the contract", () => {
  it("counts and collects exactly the picked piles", () => {
    const rows = [
      row("1", "a@x.com", "Alpha"), row("2", "a@x.com", "Alpha"),
      row("3", "b@x.com", "Bravo"),
    ];
    const piles = senderPiles(rows);
    const picked = new Set(["a@x.com"]);
    expect(selectedCount(piles, picked)).toBe(2);
    expect(selectedIds(piles, picked).sort()).toEqual(["1", "2"]);
  });

  it("the button always says the number", () => {
    expect(purgeLabel(179)).toBe("Delete 179");
    expect(purgeLabel(1)).toBe("Delete 1");
    // A bulk delete whose label does not say how many is a button nobody
    // should press.
    expect(purgeLabel(0)).toBe("Pick Some Senders");
  });

  it("the promise never says permanently, because that would be a lie", () => {
    const p = purgePromise();
    expect(p).toMatch(/trash/i);
    expect(p).toMatch(/30 days/i);
    expect(p).not.toMatch(/permanent|forever|erased|unrecoverable/i);
  });

  it("an empty inbox purges nothing and says so with a zero", () => {
    expect(senderPiles([])).toEqual([]);
    expect(selectedCount([], new Set())).toBe(0);
    expect(purgeLabel(0)).toBe("Pick Some Senders");
  });
});
