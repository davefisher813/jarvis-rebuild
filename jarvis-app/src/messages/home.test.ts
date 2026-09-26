import { describe, it, expect } from "vitest";
import {
  mailNotices, residualLine, dueFromBy, byLabel, deadlineTone,
  saveMailSnapshot, loadMailSnapshot, SNAPSHOT_MAX_AGE_MS, EMPTY,
  type MailSnapshot,
} from "./home";
import { decide } from "./mailAction";

const TODAY = "2026-08-20";
const NOW = new Date("2026-08-20T09:00:00");

const snap = (over: Partial<MailSnapshot> = {}): MailSnapshot => ({
  ts: NOW.getTime(),
  needsYou: 0,
  threads: [],
  waiting: [],
  promises: [],
  ...over,
});

const thread = (id: string, over: Partial<MailSnapshot["threads"][0]> = {}) => ({
  id, from: "Nadia Brandt", fromEmail: "wei@northlake.org",
  subject: "invoice attached", gist: "Wants the invoice signed", ...over,
});

describe("the home email surface", () => {
  it("renders nothing at all when nothing needs him", () => {
    expect(mailNotices(snap(), TODAY, NOW)).toEqual([]);
    expect(residualLine(snap(), [])).toBe("");
  });

  it("shows the actual email, not a count", () => {
    const n = mailNotices(snap({ needsYou: 1, threads: [thread("t1")] }), TODAY, NOW);
    expect(n).toHaveLength(1);
    expect(n[0]!.kind).toBe("reply");
    expect(n[0]!.title).toBe("Nadia Brandt");
    expect(n[0]!.sub).toBe("Wants the invoice signed");
    expect(n[0]!.action).toBe("Reply");
  });

  it("pulls the sender's own deadline out and makes it a task", () => {
    const n = mailNotices(snap({ needsYou: 1, threads: [thread("t1", { by: "today" })] }), TODAY, NOW);
    expect(n[0]!.kind).toBe("deadline");
    expect(n[0]!.task).toEqual({ text: "Invoice Attached", due: TODAY });
    expect(n[0]!.action).toBe("Add Task");
  });

  it("never invents a deadline the sender did not name", () => {
    expect(dueFromBy(undefined, TODAY)).toBeUndefined();
    expect(dueFromBy("", TODAY)).toBeUndefined();
    expect(dueFromBy("no rush", TODAY)).toBeUndefined();
    expect(dueFromBy("today", TODAY, NOW)).toBe(TODAY);
    expect(dueFromBy("tomorrow", TODAY, NOW)).toBe("2026-08-21");
  });

  it("only calls it a deadline when the date is now, not next month", () => {
    const far = mailNotices(snap({ needsYou: 1, threads: [thread("t1", { by: "next week" })] }), TODAY, NOW);
    expect(far[0]!.kind).toBe("reply");
  });

  it("never surfaces one thread twice", () => {
    const n = mailNotices(snap({ needsYou: 1, threads: [thread("t1", { by: "today" })] }), TODAY, NOW, 3);
    expect(n).toHaveLength(1);
  });

  it("nudges whoever owes him, and says how long without shaming him", () => {
    const n = mailNotices(snap({ waiting: [{ threadId: "w1", to: "summitgear", subject: "Order #D2565", days: 55 }] }), TODAY, NOW);
    expect(n[0]!.kind).toBe("nudge");
    expect(n[0]!.title).toBe("summitgear Hasn't Replied");
    expect(n[0]!.sub).toBe("Order #D2565, sent 55 days ago");
  });

  it("catches what HE promised and offers it as a task", () => {
    const n = mailNotices(snap({ promises: [{ threadId: "p1", text: "send rob the deck", due: "2026-08-21" }] }), TODAY, NOW);
    expect(n[0]!.kind).toBe("promised");
    expect(n[0]!.task).toEqual({ text: "Send Rob the Deck", due: "2026-08-21" });
    expect(n[0]!.sub).toBe("You said you would, by tomorrow");
  });

  it("shows one of each job before a second of any: not the same job three times", () => {
    const n = mailNotices(snap({
      needsYou: 4,
      threads: [thread("t1", { by: "today" }), thread("t2"), thread("t3"), thread("t4")],
      waiting: [{ threadId: "w1", to: "Rob", subject: "Deck", days: 9 }],
      promises: [{ threadId: "p1", text: "send the invoice" }],
    }), TODAY, NOW, 3);
    expect(n.map((x) => x.kind)).toEqual(["deadline", "reply", "promised"]);
  });

  it("honours dismissals so a swiped notice stays gone", () => {
    const s = snap({ needsYou: 2, threads: [thread("t1"), thread("t2")] });
    const first = mailNotices(s, TODAY, NOW, 1);
    const next = mailNotices(s, TODAY, NOW, 1, [first[0]!.key]);
    expect(next[0]!.threadId).toBe("t2");
  });

  it("demotes the count to a footnote, and stays silent when it is covered", () => {
    const s = snap({ needsYou: 7, threads: [thread("t1"), thread("t2")] });
    expect(residualLine(s, ["t1"])).toBe("6 More Emails in Your Inbox");
    expect(residualLine(snap({ needsYou: 1, threads: [thread("t1")] }), ["t1"])).toBe("");
  });

  it("says Today and Tomorrow, and otherwise repeats the sender's phrase", () => {
    expect(byLabel("today", NOW)).toBe("Today");
    expect(byLabel("tomorrow", NOW)).toBe("Tomorrow");
    expect(byLabel("aug 30", NOW)).toBe("Aug 30");
  });
});

// THE LINE, DRAWN WITH THE KEY (§AM R6, R8, 2026-09-26). A bill's amount, a
// deadline and a wait's age each mean something, so these notices hand
// Today facts rather than one grey sentence: the same bill reads amber on
// the Today bill card and on the mail card under it. The short, toned fact
// comes first, and the one that may ellipsize last.
describe("the line, drawn with the key", () => {
  it("a bill is its amount in white and its due day in the date window", () => {
    const anchored = { sourceMsgId: "m1", span: "Your bill of $12.00 is due tomorrow.", confidence: "high" as const };
    const bill = (date: string, actEv?: typeof anchored) => mailNotices(snap({ needsYou: 1, threads: [thread("t1", {
      act: { kind: "bill", title: "Internet", date, amount: 12 }, ...(actEv ? { actEv } : {}),
    })] }), TODAY, NOW)[0]!;
    expect(bill("2026-08-21", anchored).facts).toEqual([
      { text: "", num: "$12.00" },
      { text: "Due tomorrow", tone: "warn" },
    ]);
    expect(bill("2026-08-27", anchored).facts![1]).toEqual({ text: "Due Aug 27", tone: "date" });
    // A reading the app cannot back still says so first, in front of the
    // amount, and the amount keeps its shape.
    expect(bill("2026-08-21").facts![0]).toEqual({ text: "Looks like", num: "$12.00" });
  });

  it("a deadline is due, amber, and the sender is the fact that yields", () => {
    const n = mailNotices(snap({ needsYou: 1, threads: [thread("t1", { by: "tomorrow" })] }), TODAY, NOW)[0]!;
    expect(n.kind).toBe("deadline");
    expect(n.facts).toEqual([
      { text: "Looks like tomorrow", tone: "warn" },
      { text: "From Nadia Brandt" },
    ]);
  });

  // The toned fact never shrinks, so it is the deadline alone. The clash
  // with the calendar rides with the sender in the last fact, the one that
  // ellipsizes: glued to the deadline it was cut mid-word and pushed the
  // sender off a 390px line. The sentence read aloud keeps all of it.
  it("a deadline's clash rides with the sender, never in the toned fact", () => {
    const events = [{ title: "Design Review", date: TODAY, start: "14:00", end: "15:00" }];
    const n = mailNotices(snap({ needsYou: 1, threads: [thread("t1", { by: "3 PM" })] }), TODAY, NOW, 3, [], events)[0]!;
    expect(n.kind).toBe("deadline");
    expect(n.facts).toEqual([
      { text: "Looks like 3:00 PM", tone: "warn" },
      { text: "From Nadia Brandt, while you're in Design Review until 3:00" },
    ]);
    expect(n.facts![0]!.text).not.toMatch(/while/);
    expect(n.sub).toBe("From Nadia Brandt, looks like 3:00 PM while you're in Design Review until 3:00");
    // No clash, no clause: the sender stands alone.
    const calm = mailNotices(snap({ needsYou: 1, threads: [thread("t1", { by: "3 PM" })] }), TODAY, NOW)[0]!;
    expect(calm.facts![1]).toEqual({ text: "From Nadia Brandt" });
  });

  // The age is short so it always fits first (the wait card's and the More
  // Moves sheet's own "55 Days"); "Sent 55 days ago" was wider than the
  // whole line beside the widest verb at 390px.
  it("a wait's age wears the one ladder: gentle small caps, direct amber, firm red", () => {
    const age = (days: number) => mailNotices(snap({ waiting: [{ threadId: "w1", to: "Rob", subject: "The deck", days }] }), TODAY, NOW)[0]!.facts;
    expect(age(3)).toEqual([{ text: "3 Days", tone: "date" }, { text: "The deck" }]);
    expect(age(1)![0]).toEqual({ text: "1 Day", tone: "date" });
    expect(age(9)![0]).toEqual({ text: "9 Days", tone: "warn" });
    expect(age(55)![0]).toEqual({ text: "55 Days", tone: "red" });
  });

  // The ladder climbs on nudges as well as on the clock (toneFor), and the
  // rail reads them, so the card does too: a short wait he has already
  // chased twice is red here exactly as it is red on the rail.
  it("a wait he has already nudged climbs the ladder, as it does on the rail", () => {
    const s = snap({ waiting: [{ threadId: "w1", to: "Rob", subject: "The deck", days: 3 }] });
    const tone = (nudges: Record<string, number>) => mailNotices(s, TODAY, NOW, 3, [], [], nudges)[0]!.facts![0]!.tone;
    expect(tone({})).toBe("date");
    expect(tone({ w1: 1 })).toBe("warn");
    expect(tone({ w1: 2 })).toBe("red");
    // Another thread's nudges are not this one's.
    expect(tone({ w9: 2 })).toBe("date");
  });

  // A promise's day is a date with a meaning, so it wears the date window
  // the ledger gives the same promise: late red, due amber, later caps.
  it("a promise's day is its own fact, in the date window", () => {
    const line = (due?: string) => mailNotices(snap({ promises: [{ threadId: "p1", text: "send rob the deck", ...(due ? { due } : {}) }] }), TODAY, NOW)[0]!;
    expect(line("2026-08-21").facts).toEqual([{ text: "Tomorrow", tone: "warn" }, { text: "You said you would" }]);
    expect(line("2026-08-20").facts![0]).toEqual({ text: "Today", tone: "warn" });
    expect(line("2026-08-19").facts![0]).toEqual({ text: "Yesterday", tone: "red" });
    expect(line("2026-08-29").facts![0]).toEqual({ text: "Aug 29", tone: "date" });
    // No day, nothing to colour: the sentence stands, as one grey.
    expect(line().facts).toBeUndefined();
    expect(line().sub).toBe("You said you would");
  });

  it("a reminder is its day, in the date window, and hedged inside the one fact", () => {
    const anchored = { sourceMsgId: "m1", span: "Your package arrives tomorrow.", confidence: "high" as const };
    const remind = (date: string, actEv?: typeof anchored) => mailNotices(snap({ needsYou: 1, threads: [thread("t1", {
      act: { kind: "delivery", title: "Package", date }, ...(actEv ? { actEv } : {}),
    })] }), TODAY, NOW)[0]!;
    expect(remind("2026-08-21", anchored).kind).toBe("act");
    expect(remind("2026-08-21", anchored).facts).toEqual([{ text: "Tomorrow", tone: "warn" }]);
    expect(remind("2026-08-19", anchored).facts).toEqual([{ text: "Yesterday", tone: "red" }]);
    expect(remind("2026-08-27", anchored).facts).toEqual([{ text: "Aug 27", tone: "date" }]);
    expect(remind("2026-08-21").facts).toEqual([{ text: "Looks like tomorrow", tone: "warn" }]);
  });

  it("an event is its day and time in small caps, then its length in white", () => {
    const anchored = { sourceMsgId: "m1", span: "See you Saturday at 2 PM.", confidence: "high" as const };
    const event = (actEv?: typeof anchored) => mailNotices(snap({ needsYou: 1, threads: [thread("t1", {
      act: { kind: "appointment", title: "Dental cleaning", date: "2026-08-22", start: "14:00", durationMin: 45 },
      ...(actEv ? { actEv } : {}),
    })] }), TODAY, NOW)[0]!;
    expect(event(anchored).facts).toEqual([
      { text: "Saturday 2:00 PM", tone: "date" },
      { text: "", num: "45 min" },
    ]);
    // A reading it cannot back keeps the sentence, hedge first: the hedge
    // has to be read before the tap that writes the event, and the line
    // cannot hold it, the day, the time and the length.
    expect(event().facts).toBeUndefined();
    expect(event().sub).toMatch(/^Looks like saturday 2:00 PM/);
  });

  it("leaves a line with nothing to colour as the sentence it was", () => {
    const n = mailNotices(snap({ needsYou: 1, threads: [thread("t1")] }), TODAY, NOW)[0]!;
    expect(n.kind).toBe("reply");
    expect(n.facts).toBeUndefined();
  });
});

// ONE DEADLINE RULE (§AM R8). The Today card and the thread's Where This
// Stands card read the same phrase through this, so the same deadline is
// never amber on one and small caps on the other.
describe("the colour of a stated deadline", () => {
  it("today, tomorrow and a bare clock are due; later is a neutral date", () => {
    expect(deadlineTone("today", NOW)).toBe("warn");
    expect(deadlineTone("tomorrow", NOW)).toBe("warn");
    expect(deadlineTone("end of day", NOW)).toBe("warn");
    // A clock with no day word is today (byRank leaves it at 500).
    expect(deadlineTone("3 PM", NOW)).toBe("warn");
    expect(deadlineTone("by 15:00", NOW)).toBe("warn");
    expect(deadlineTone("next week", NOW)).toBe("date");
    expect(deadlineTone("aug 30", NOW)).toBe("date");
    // A phrase no one can place, and no clock in it, says nothing in colour.
    expect(deadlineTone("sometime soon", NOW)).toBe("date");
  });
});

describe("the snapshot", () => {
  const mem = () => {
    let v: string | null = null;
    return { getItem: () => v, setItem: (_k: string, s: string) => { v = s; } };
  };

  it("round-trips", () => {
    const st = mem();
    const s = snap({ needsYou: 3, threads: [thread("t1")] });
    saveMailSnapshot(s, st);
    expect(loadMailSnapshot(NOW.getTime(), st).threads).toHaveLength(1);
  });

  it("drops a stale snapshot rather than showing last week as current", () => {
    const st = mem();
    saveMailSnapshot(snap({ needsYou: 3 }), st);
    expect(loadMailSnapshot(NOW.getTime() + SNAPSHOT_MAX_AGE_MS + 1, st)).toEqual(EMPTY);
  });

  it("survives garbage without taking the page down", () => {
    const st = { getItem: () => "{not json" };
    expect(loadMailSnapshot(NOW.getTime(), st)).toEqual(EMPTY);
  });
});

// THE SAME BUG, ON THE SCREEN HE SEES FIRST (2026-08-21).
//
// The Email tab stopped printing one universal button. The home page kept
// printing "Nudge" on every waiting thread, so Dave's original complaint was
// still true on Today. These pin the fix in both directions.
describe("the home page derives its mail action too", () => {
  const wait = (threadId: string, to: string, subject: string, days: number) =>
    ({ threadId, to, subject, days });
  const snapOf = (waiting: ReturnType<typeof wait>[]) =>
    ({ threads: [], waiting, promises: [], savedAt: "2026-08-21T12:00:00Z" });

  it("no two waiting threads carry the same button", () => {
    const out = mailNotices(
      snapOf([
        wait("a", "summitgear", "Missing Items From Order #D2565", 58),
        wait("b", "wei", "Invoice", 53),
        wait("c", "Joseph", "CALL ME", 51),
      ]) as never,
      "2026-08-21",
      new Date("2026-08-21T12:00:00Z"),
      9,
    );
    const acts = out.filter((n) => n.kind === "nudge").map((n) => n.action);
    expect(acts.length).toBe(3);
    expect(new Set(acts).size).toBe(3);
    expect(acts).not.toContain("Nudge");
  });

  it("a receipt owes nothing, so it never reaches the home page", () => {
    const out = mailNotices(
      snapOf([wait("r", "Elieserhenry0", "Reservation Receipt", 49)]) as never,
      "2026-08-21",
      new Date("2026-08-21T12:00:00Z"),
      9,
    );
    expect(out.find((n) => n.threadId === "r")).toBeUndefined();
  });

  it("[edge] the card can only draft, so it never prints a button that dials", () => {
    // Whatever the ask, the label on this surface has to be an email, because
    // the only handler behind it writes one.
    for (const s of ["Invoice", "CALL ME", "Missing item", "Question?", "$400 past due"]) {
      for (const days of [1, 8, 40]) {
        const out = mailNotices(
          snapOf([wait("x", "Somebody", s, days)]) as never,
          "2026-08-21",
          new Date("2026-08-21T12:00:00Z"),
          9,
        );
        const n = out.find((x) => x.kind === "nudge");
        if (!n) continue;
        const d = decide(s, "", days);
        const match = [d.primary, ...d.alternates].find((a) => a.label === n.action);
        expect(match?.channel, s + " " + days + " -> " + n.action).toBe("email");
      }
    }
  });
});
