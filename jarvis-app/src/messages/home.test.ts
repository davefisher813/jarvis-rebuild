import { describe, it, expect } from "vitest";
import {
  mailNotices, residualLine, dueFromBy, byLabel,
  saveMailSnapshot, loadMailSnapshot, SNAPSHOT_MAX_AGE_MS, EMPTY,
  type MailSnapshot,
} from "./home";

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
  id, from: "Wei Zhang", fromEmail: "wei@bffsa.org",
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
    expect(n[0]!.title).toBe("Wei Zhang");
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
    const n = mailNotices(snap({ waiting: [{ threadId: "w1", to: "nikestrength", subject: "Order #D2565", days: 55 }] }), TODAY, NOW);
    expect(n[0]!.kind).toBe("nudge");
    expect(n[0]!.title).toBe("nikestrength Hasn't Replied");
    expect(n[0]!.sub).toBe("Order #D2565 · 55 Days");
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
