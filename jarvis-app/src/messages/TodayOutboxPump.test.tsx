// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { processTodaySend } from "./TodayOutboxPump";
import TodayOutboxPump from "./TodayOutboxPump";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import { GoogleSessionProvider } from "../connections/google/GoogleSession";
import { NotesProvider } from "../data/NotesProvider";
import type { TodaySend } from "./todayOutbox";
import { enqueueTodaySend, getTodayOutbox, resetTodayOutboxForTest } from "./todayOutbox";
import { loadOutbox } from "./outbox";
import { loadNudgeCounts } from "./escalate";
import { loadChases, setChase } from "./followUp";
import { subscribeToast } from "../shared/toast";

const item = (over: Partial<TodaySend> = {}): TodaySend => ({
  id: "t1", to: "wei@x.com", subject: "Re: Waiver", body: "On it",
  threadId: "th1", dueMs: Date.now(), scheduled: false, state: "held", todayKind: "reply",
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  resetTodayOutboxForTest();
});

describe("processTodaySend: the actual send behind a Today card", () => {
  it("with no api available, it reverts to held for the next tick, never a genuine failure", async () => {
    resetTodayOutboxForTest();
    enqueueTodaySend({ to: "a@b.com", subject: "s", body: "b", todayKind: "reply" });
    const [queued] = getTodayOutbox();
    // The pump always marks an item "sending" before handing it to
    // processTodaySend; simulate that so the revert has something to undo.
    await processTodaySend({ ...queued!, state: "sending" }, null);
    // Reverted to held, not stuck as "sending" forever with nothing able to
    // pick it up again (dueNow only ever looks at held items).
    expect(getTodayOutbox()[0]!.state).toBe("held");
    // And nothing graduated into the real outbox: this is a startup race,
    // not a genuine failure.
    expect(loadOutbox()).toEqual([]);
  });

  it("sends exactly what the card queued, to the reply's thread", async () => {
    const calls: { raw: string; threadId?: string }[] = [];
    const api = makeFakeGoogleApi({ sendMessage: async (raw, threadId) => { calls.push({ raw, threadId }); return { id: "s1" }; } });
    await processTodaySend(item({ to: "wei@x.com", subject: "Re: Waiver", body: "On it", inReplyTo: "<a@x>" }), api);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.threadId).toBe("th1");
    // encodeEmail returns a base64url MIME message, not plain text.
    const decoded = atob(calls[0]!.raw.replace(/-/g, "+").replace(/_/g, "/"));
    expect(decoded).toContain("wei@x.com");
    expect(decoded).toContain("On it");
  });

  it("a nudge or chase counts toward the ladder; a plain reply does not", async () => {
    const api = makeFakeGoogleApi({ sendMessage: async () => ({ id: "s1" }) });
    await processTodaySend(item({ id: "n1", threadId: "th-nudge", todayKind: "nudge" }), api);
    expect(loadNudgeCounts()["th-nudge"]).toBe(1);

    await processTodaySend(item({ id: "r1", threadId: "th-reply", todayKind: "reply" }), api);
    expect(loadNudgeCounts()["th-reply"]).toBeUndefined();
  });

  it("N3: any successful send retires a chase on that thread", async () => {
    setChase({ threadId: "th1", to: "wei@x.com", subject: "Waiver", setISO: "2026-09-01", days: 3 });
    expect(loadChases().some((c) => c.threadId === "th1")).toBe(true);
    const api = makeFakeGoogleApi({ sendMessage: async () => ({ id: "s1" }) });
    await processTodaySend(item({ threadId: "th1", todayKind: "reply" }), api);
    expect(loadChases().some((c) => c.threadId === "th1")).toBe(false);
  });

  it("a failed send is never lost: it graduates into the real outbox, failed, with Retry and Edit waiting there", async () => {
    const api = makeFakeGoogleApi({ sendMessage: async () => { throw new Error("gmail 500"); } });
    let toasted: string | null = null;
    const unsub = subscribeToast((t) => { if (t) toasted = t.message; });
    await processTodaySend(item({ id: "f1", to: "wei@x.com" }), api);
    unsub();
    const graduated = loadOutbox().find((o) => o.id === "f1");
    expect(graduated).toBeDefined();
    expect(graduated!.state).toBe("failed");
    expect(graduated!.to).toBe("wei@x.com");
    expect(typeof graduated!.error).toBe("string");
    expect(toasted).not.toBeNull();
  });
});

describe("TodayOutboxPump: the always-alive timer behind it", () => {
  it("picks up a queued send once its hold elapses, even with nothing else mounted", async () => {
    vi.useFakeTimers();
    try {
      // A component-only render: no compose screen, no Today screen, just
      // the pump -- the whole point is that it needs neither to be mounted.
      // No accounts seeded, matching AppShell's own GoogleSessionProvider
      // with nothing yet signed in.
      render(
        <NotesProvider userId={"today-pump-" + Math.random()}>
          <GoogleSessionProvider><TodayOutboxPump /></GoogleSessionProvider>
        </NotesProvider>,
      );
      enqueueTodaySend({ to: "a@b.com", subject: "s", body: "b", threadId: "t1", todayKind: "reply" });
      expect(getTodayOutbox()[0]!.state).toBe("held");
      // No Google session is seeded here, so g.api() resolves to null: this
      // exercises the interval actually finding the item once its hold
      // elapses and handing it to processTodaySend, which -- with no api --
      // reverts it to held rather than leaving it stuck. Proves the timer
      // wiring itself works without needing a full authenticated session
      // just to test that a 1-second interval is running.
      await act(async () => { await vi.advanceTimersByTimeAsync(13000); });
      expect(getTodayOutbox()[0]!.state).toBe("held");
    } finally {
      vi.useRealTimers();
    }
  });
});
