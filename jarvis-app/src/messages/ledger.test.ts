import { describe, it, expect } from "vitest";
import { buildLedger, ledgerFloor, ledgerTone, sinceLabel, type LedgerInput } from "./ledger";

// UP-MIND-11. The ledger is a VIEW: no store, no rows of its own, and no
// second action-decider. These tests are about what reaches it, what does
// not, and what the sections say when there is nothing to say.

const input = (over: Partial<LedgerInput> = {}): LedgerInput => ({
  today: "2026-08-15",
  tasks: [],
  waiting: [],
  chases: [],
  promises: [],
  ...over,
});

describe("what reaches the ledger", () => {
  // A ledger that listed every to-do would be the task list with a new name.
  it("takes tasks that came out of mail and leaves the rest alone", () => {
    const l = buildLedger(input({
      tasks: [
        { id: "t1", text: "Send the roster", fromThread: "th1", due: "2026-08-20" },
        { id: "t2", text: "Buy milk" },
        { id: "t3", text: "Reply to Nadia", sourceKind: "email" },
      ],
    }));
    expect(l.youOwe.map((r) => r.taskId)).toEqual(["t1", "t3"]);
  });

  it("leaves a finished task out entirely", () => {
    const l = buildLedger(input({ tasks: [{ id: "t1", text: "Done thing", fromThread: "th1", done: true }] }));
    expect(l.total).toBe(0);
  });

  it("carries the person a row is about", () => {
    const l = buildLedger(input({ tasks: [{ id: "t1", text: "Send it", fromThread: "th1", personId: "p1" }] }));
    expect(l.youOwe[0]!.personId).toBe("p1");
  });
});

describe("they owe you", () => {
  it("prepares each waiting row through the one action-decider", () => {
    const l = buildLedger(input({
      waiting: [{ threadId: "w1", to: "Rob", subject: "Field booking", days: 9 }],
    }));
    expect(l.theyOweYou).toHaveLength(1);
    expect(l.theyOweYou[0]!.decision?.tone).toBe("direct");
    expect(l.theyOweYou[0]!.action).toBeTruthy();
    expect(l.theyOweYou[0]!.since).toBe("9 days");
  });

  // A receipt owes nothing, and decide() is what knows that.
  it("drops a thread with no move to make", () => {
    const l = buildLedger(input({
      waiting: [{ threadId: "w1", to: "Amazon", subject: "Your receipt for order 4021", days: 3 }],
    }));
    expect(l.theyOweYou.length + l.youOwe.length).toBeLessThanOrEqual(1);
  });

  it("opens a chase rather than promising a draft it cannot write", () => {
    const l = buildLedger(input({ chases: [{ threadId: "c1", to: "Rob", subject: "Quote" }] }));
    expect(l.theyOweYou[0]!.action).toBe("Open");
    expect(l.theyOweYou[0]!.decision).toBeUndefined();
  });
});

// A reader colours a row by where it came from and when it is due. Both are
// said on the row, so nothing has to read them back out of the key's prefix
// or the sort key's 9999-12-31 sentinel.
describe("each row says what it is", () => {
  it("carries its kind, and its due day only when it has one", () => {
    const l = buildLedger(input({
      tasks: [{ id: "t1", text: "Send it", fromThread: "th1", due: "2026-08-20" }, { id: "t2", text: "Undated", fromThread: "th2" }],
      promises: [{ threadId: "p1", text: "send the quote", due: "2026-08-18" }],
      waiting: [{ threadId: "w1", to: "Rob", subject: "Field booking", days: 9 }],
      chases: [{ threadId: "c1", to: "Ann", subject: "Quote" }],
    }));
    const byKey = new Map([...l.youOwe, ...l.theyOweYou].map((r) => [r.key, r] as const));
    expect(byKey.get("task:t1")).toMatchObject({ kind: "task", due: "2026-08-20" });
    expect(byKey.get("task:t2")!.kind).toBe("task");
    expect(byKey.get("task:t2")).not.toHaveProperty("due");
    expect(byKey.get("promise:p1")).toMatchObject({ kind: "promise", due: "2026-08-18" });
    expect(byKey.get("waiting:w1")).toMatchObject({ kind: "waiting" });
    expect(byKey.get("waiting:w1")).not.toHaveProperty("due");
    expect(byKey.get("chase:c1")).toMatchObject({ kind: "chase" });
  });
});

// The age on a row says what it means (§AM R8), read from the row's own
// fields. What he owes wears the date window; a wait on someone else wears
// the one ladder every wait age in mail wears (firm red, direct amber,
// gentle small caps), so a row here never disagrees with the same wait on
// the rail, the wait card or the More Moves sheet.
describe("the colour of a row's age", () => {
  const TODAY = "2026-08-15";
  const tone = (over: Partial<LedgerInput>) => {
    const l = buildLedger(input(over));
    return new Map([...l.youOwe, ...l.theyOweYou].map((r) => [r.key, ledgerTone(r, TODAY)] as const));
  };

  it("colours what he owes by its due day, and leaves an undated one grey", () => {
    const t = tone({
      tasks: [
        { id: "late", text: "A", fromThread: "a", due: "2026-08-14" },
        { id: "today", text: "B", fromThread: "b", due: "2026-08-15" },
        { id: "tmrw", text: "C", fromThread: "c", due: "2026-08-16" },
        { id: "later", text: "D", fromThread: "d", due: "2026-08-20" },
      ],
      promises: [{ threadId: "p", text: "send the quote" }],
    });
    expect(t.get("task:late")).toBe("red");
    expect(t.get("task:today")).toBe("warn");
    expect(t.get("task:tmrw")).toBe("warn");
    expect(t.get("task:later")).toBe("date");
    expect(t.get("promise:p")).toBeUndefined();
  });

  it("puts a wait on the ladder, not on a week", () => {
    const t = tone({
      waiting: [
        { threadId: "w3", to: "Rob", subject: "Field booking", days: 3 },
        { threadId: "w8", to: "Ann", subject: "The roster", days: 8 },
        { threadId: "w21", to: "Sam", subject: "The deposit", days: 21 },
      ],
    });
    expect(t.get("waiting:w3")).toBe("date");
    // Eight days is a wait of weeks coming, amber: the rail and the More
    // Moves sheet both say so, and the ledger used to say red.
    expect(t.get("waiting:w8")).toBe("warn");
    expect(t.get("waiting:w21")).toBe("red");
  });

  // The ladder climbs on nudges as well as on the clock, and the rail reads
  // them. Without them a three-day wait he had chased twice was red on the
  // rail and small caps here.
  it("climbs the ladder on the nudges already sent, as the rail does", () => {
    const t = tone({
      waiting: [
        { threadId: "n0", to: "Rob", subject: "Field booking", days: 3 },
        { threadId: "n1", to: "Ann", subject: "The roster", days: 3, nudges: 1 },
        { threadId: "n2", to: "Sam", subject: "The deposit", days: 3, nudges: 2 },
      ],
    });
    expect(t.get("waiting:n0")).toBe("date");
    expect(t.get("waiting:n1")).toBe("warn");
    expect(t.get("waiting:n2")).toBe("red");
  });

  it("makes a chase he set amber, because it has come due", () => {
    expect(tone({ chases: [{ threadId: "c1", to: "Rob", subject: "Quote" }] }).get("chase:c1")).toBe("warn");
  });
});

describe("one debt, one line", () => {
  it("does not list the same thread on both sides", () => {
    const l = buildLedger(input({
      tasks: [{ id: "t1", text: "Send the roster", fromThread: "th1" }],
      waiting: [{ threadId: "th1", to: "Rob", subject: "Roster", days: 4 }],
    }));
    expect(l.total).toBe(1);
    expect(l.youOwe).toHaveLength(1);
    expect(l.theyOweYou).toHaveLength(0);
  });
});

describe("late", () => {
  it("is a lens over both sides, not a third pile", () => {
    const l = buildLedger(input({
      tasks: [{ id: "t1", text: "Overdue thing", fromThread: "th1", due: "2026-08-01" }],
      waiting: [{ threadId: "w1", to: "Rob", subject: "Field booking", days: 21 }],
    }));
    expect(l.late.map((r) => r.key)).toEqual(["task:t1", "waiting:w1"]);
    expect(l.youOwe).toHaveLength(1);
    expect(l.theyOweYou).toHaveLength(1);
    expect(l.total).toBe(2);
  });

  // Late is the ladder's red rung, the rung that draws the age red. A week
  // used to be the line, so an eight-day wait sat in Late wearing an amber
  // age that says "needs you soon", not "late".
  it("holds a wait only once it is on the red rung, nudges included", () => {
    const l = buildLedger(input({
      waiting: [
        { threadId: "w8", to: "Ann", subject: "The roster", days: 8 },
        { threadId: "w21", to: "Sam", subject: "The deposit", days: 21 },
        { threadId: "w3", to: "Rob", subject: "Field booking", days: 3, nudges: 2 },
      ],
    }));
    expect(l.late.map((r) => r.key).sort()).toEqual(["waiting:w21", "waiting:w3"]);
    for (const r of l.late) expect(ledgerTone(r, "2026-08-15")).toBe("red");
    expect(l.theyOweYou.find((r) => r.key === "waiting:w8")!.late).toBe(false);
  });

  it("counts every row once, whichever sections show it", () => {
    const l = buildLedger(input({ tasks: [{ id: "t1", text: "Overdue", fromThread: "th1", due: "2026-08-01" }] }));
    expect(l.total).toBe(1);
  });
});

describe("the floor line", () => {
  it("says it is showing everything", () => {
    const l = buildLedger(input({ tasks: [{ id: "t1", text: "A", fromThread: "th1" }, { id: "t2", text: "B", fromThread: "th2" }] }));
    expect(ledgerFloor(l)).toBe("That's every one that's open");
  });

  it("is calm when there is nothing, never an apology", () => {
    expect(ledgerFloor(buildLedger(input()))).toBe("Nothing is open");
  });
});

describe("how a wait reads back", () => {
  it("is days up close and weeks past a fortnight, and never a streak", () => {
    expect(sinceLabel(0)).toBe("today");
    expect(sinceLabel(1)).toBe("1 day");
    expect(sinceLabel(9)).toBe("9 days");
    expect(sinceLabel(31)).toBe("4 weeks");
  });
});
