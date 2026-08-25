import { describe, it, expect } from "vitest";
import { peekLine } from "./batching";
import type { ThreadRow } from "../connections/google/map";

// 1B: THE DOOR'S PEEK (Dave 2026-08-25, the Anti-Inbox catalog).
//
// The door already said WHEN. The peek says WHAT, in the only two terms that
// do not reintroduce the anxiety the door exists to remove: people, and
// whether any of them is waiting on you. Every test here is really the same
// test asked in a different place: is this a fact about humans, or is it a
// count of a pile?

const row = (id: string, email: string, from: string): ThreadRow => ({
  id, from, fromEmail: email, subject: "S", snippet: "",
  unread: true, inInbox: true, dateMs: Date.parse("2026-08-25T09:00:00Z"),
  count: 1, lastMsgId: "m" + id,
});

describe("the peek counts people, not mail", () => {
  it("counts SENDERS, so four emails from one person is one person", () => {
    const rows = [row("1", "a@x.com", "Alpha"), row("2", "a@x.com", "Alpha"),
      row("3", "a@x.com", "Alpha"), row("4", "a@x.com", "Alpha")];
    expect(peekLine(rows, {}, [])).toBe("1 Person wrote · nothing urgent");
  });

  it("pluralises like a human", () => {
    const rows = [row("1", "a@x.com", "Alpha"), row("2", "b@x.com", "Bravo")];
    expect(peekLine(rows, {}, [])).toBe("2 People wrote · nothing urgent");
  });

  it("machines do not exist behind the door", () => {
    // The whole promise of the curtain is that the shops are not your
    // problem right now. A peek that counted them would break it.
    const rows = [
      row("1", "a@x.com", "Alpha"),
      row("2", "no-reply@shop.com", "Shop"),
      row("3", "c@promo.com", "Promo"),
    ];
    expect(peekLine(rows, { "3": { bucket: "noise" } }, [])).toBe("1 Person wrote · nothing urgent");
  });

  it("says something true when no person has written", () => {
    expect(peekLine([], {}, [])).toBe("Nothing from a person");
    expect(peekLine([row("1", "no-reply@shop.com", "Shop")], {}, [])).toBe("Nothing from a person");
  });

  it("ignores what is not in the inbox", () => {
    const rows = [{ ...row("1", "a@x.com", "Alpha"), inInbox: false }];
    expect(peekLine(rows, {}, [])).toBe("Nothing from a person");
  });
});

describe("urgency wears a name, never a number", () => {
  it("names the one person who is waiting", () => {
    const rows = [row("1", "a@x.com", "Sarah Kane"), row("2", "b@x.com", "Bravo")];
    expect(peekLine(rows, { "1": { bucket: "needs_you" } }, [])).toBe("2 People wrote · Sarah needs you");
  });

  it("names one and counts the rest, so the line stays one line", () => {
    const rows = [row("1", "a@x.com", "Sarah Kane"), row("2", "b@x.com", "Bravo Smith"), row("3", "c@x.com", "Cara")];
    const line = peekLine(rows, { "1": { bucket: "needs_you" }, "2": { bucket: "needs_you" } }, []);
    expect(line).toBe("3 People wrote · Sarah and 1 other need you");
  });

  it("a VIP is urgent whatever the classifier thought", () => {
    const rows = [row("1", "boss@x.com", "Dana Reed")];
    expect(peekLine(rows, {}, ["BOSS@x.com"])).toBe("1 Person wrote · Dana needs you");
  });

  it("never prints a bare unread count anywhere in the line", () => {
    const rows = Array.from({ length: 40 }, (_, i) => row(String(i), `p${i}@x.com`, "Person " + i));
    const line = peekLine(rows, {}, []);
    expect(line).not.toMatch(/unread|new messages|waiting for you/i);
    // 40 people is 40 people. That is a fact about the world, and the
    // second clause is what makes it survivable.
    expect(line).toBe("40 People wrote · nothing urgent");
  });

  it("never blames, never scolds, whatever the numbers are", () => {
    const rows = [row("1", "a@x.com", "Sarah Kane")];
    const line = peekLine(rows, { "1": { bucket: "needs_you" } }, []);
    expect(line.toLowerCase()).not.toMatch(/behind|overdue|still|ignor|neglect|fail|should/);
  });
});
