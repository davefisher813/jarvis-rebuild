// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  getTodayOutbox, subscribeTodayOutbox, enqueueTodaySend, removeTodaySend, markTodaySendState,
  resetTodayOutboxForTest, type TodaySend,
} from "./todayOutbox";

beforeEach(() => {
  localStorage.clear();
  resetTodayOutboxForTest();
});

describe("todayOutbox: the Today card's own hold", () => {
  it("queues held, not sent, with a real dueMs in the future", () => {
    const before = Date.now();
    enqueueTodaySend({ to: "wei@x.com", subject: "Re: Waiver", body: "On it", threadId: "t1", todayKind: "nudge" });
    const [item] = getTodayOutbox();
    expect(item!.state).toBe("held");
    expect(item!.dueMs).toBeGreaterThan(before);
    expect(item!.todayKind).toBe("nudge");
  });

  it("survives a reload: a second read of the store sees what the first wrote", () => {
    enqueueTodaySend({ to: "a@b.com", subject: "s", body: "b", threadId: "t1", todayKind: "reply" });
    // localStorage IS the reload boundary here; read it back raw, the way a
    // fresh module import would on the next launch.
    const raw = JSON.parse(localStorage.getItem("jarvis.today.outbox.v1") || "[]") as TodaySend[];
    expect(raw).toHaveLength(1);
    expect(raw[0]!.to).toBe("a@b.com");
  });

  it("notifies subscribers on every change, and hands the current list on subscribe", () => {
    const seen: number[] = [];
    const unsub = subscribeTodayOutbox((items) => seen.push(items.length));
    expect(seen).toEqual([0]); // fired immediately with whatever is there
    enqueueTodaySend({ to: "a@b.com", subject: "s", body: "b", todayKind: "chase" });
    expect(seen).toEqual([0, 1]);
    unsub();
    enqueueTodaySend({ to: "c@d.com", subject: "s2", body: "b2", todayKind: "reply" });
    expect(seen).toEqual([0, 1]); // unsubscribed: no further pushes
  });

  it("removeTodaySend takes exactly the one item, leaving the rest", () => {
    enqueueTodaySend({ to: "a@b.com", subject: "s1", body: "b1", todayKind: "reply" });
    enqueueTodaySend({ to: "c@d.com", subject: "s2", body: "b2", todayKind: "nudge" });
    const [first, second] = getTodayOutbox();
    removeTodaySend(first!.id);
    expect(getTodayOutbox()).toEqual([second]);
  });

  it("markTodaySendState flips just that item's state, in place", () => {
    enqueueTodaySend({ to: "a@b.com", subject: "s", body: "b", todayKind: "reply" });
    const [item] = getTodayOutbox();
    markTodaySendState(item!.id, "sending");
    expect(getTodayOutbox()[0]!.state).toBe("sending");
  });
});
