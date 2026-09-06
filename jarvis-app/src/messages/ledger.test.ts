import { describe, it, expect } from "vitest";
import { buildLedger, ledgerFloor, sinceLabel, type LedgerInput } from "./ledger";

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
