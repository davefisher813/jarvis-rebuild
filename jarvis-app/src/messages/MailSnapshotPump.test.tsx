// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { GoogleSessionProvider, useGoogle } from "../connections/google/GoogleSession";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import MailSnapshotPump from "./MailSnapshotPump";
import { saveMailSnapshot, loadMailSnapshot } from "./home";
import { toggleVip } from "./vip";

// The digest scheduler is native-only (a no-op in jsdom); record what the
// pump asks it to schedule so the line itself can be checked.
const digests = vi.hoisted(() => ({ calls: [] as { title: string }[][] }));
vi.mock("../shared/notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/notifications")>()),
  ensureMailDigests: async (specs: { title: string }[]) => { digests.calls.push(specs); },
}));

// S6-Q34: the timer/staleness wiring itself, following TodayOutboxPump's
// "render just the pump, nothing else mounted" pattern. The build behind the
// check (refreshMailSnapshot) has its own full test file; this only proves
// the pump calls it at the right moments -- not with no token, not when the
// snapshot is already fresh, and does call it once a token exists and the
// snapshot is stale or missing, then again on the interval once it goes
// stale a second time.

function ConnectFromAnywhere() {
  const g = useGoogle();
  return <button onClick={() => void g.connect()}>Any Connect</button>;
}

function wrap(node: React.ReactNode, api: ReturnType<typeof makeFakeGoogleApi>) {
  return (
    <NotesProvider userId={"snap-pump-" + Math.random()}>
      <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => api}>{node}</GoogleSessionProvider>
    </NotesProvider>
  );
}

beforeEach(() => { localStorage.clear(); digests.calls = []; });

describe("MailSnapshotPump", () => {
  it("does nothing with no token, even once mounted and the interval has ticked", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const api = makeFakeGoogleApi({ listThreads: async () => { calls++; return []; } });
      render(wrap(<MailSnapshotPump />, api));
      await act(async () => { await vi.advanceTimersByTimeAsync(31 * 60e3); });
      expect(calls).toBe(0);
      expect(loadMailSnapshot().ts).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does nothing once connected when the snapshot is already fresh", async () => {
    // Only the clock is faked, not the timers: this case turns on microtasks
    // settling, not on ticks. 10:00 keeps it clear of the digest windows'
    // ten-minute leads, which are the other thing that makes check() refresh
    // (UP-MIND-14) and would otherwise make "fresh means no call" true or
    // false depending on what time the suite happened to run.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(2026, 7, 15, 10, 0, 0));
      const freshTs = Date.now();
      saveMailSnapshot({ ts: freshTs, needsYou: 0, threads: [], waiting: [], promises: [] });
      let calls = 0;
      const api = makeFakeGoogleApi({ listThreads: async () => { calls++; return []; } });
      render(wrap(<><MailSnapshotPump /><ConnectFromAnywhere /></>, api));
      await act(async () => {
        fireEvent.click(screen.getByText("Any Connect"));
        // Let connect() and the pump's re-fired effect settle.
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(calls).toBe(0);
      expect(loadMailSnapshot().ts).toBe(freshTs);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refreshes once a token exists and the snapshot is stale or missing", async () => {
    // No snapshot at all: loadMailSnapshot().ts is 0, older than any real clock.
    let calls = 0;
    const api = makeFakeGoogleApi({ listThreads: async () => { calls++; return []; } });
    render(wrap(<><MailSnapshotPump /><ConnectFromAnywhere /></>, api));
    await act(async () => {
      fireEvent.click(screen.getByText("Any Connect"));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(calls).toBeGreaterThanOrEqual(1);
    expect(loadMailSnapshot().ts).toBeGreaterThan(0);
  });

  it("re-checks on the interval and refreshes again once the snapshot has gone stale", async () => {
    vi.useFakeTimers();
    try {
      // UP-MIND-14 gave check() a second reason to refresh: the ten minutes
      // before a digest window (9:00, 13:00, 17:00), whatever the staleness
      // clock says. That made this case depend on the wall clock -- run the
      // suite at 8:22 and the tick 30 minutes later lands at 8:52, inside
      // the lead before the 9:00 window, and the "no second refresh" step
      // sees one. 10:00 is clear of every lead, and so are the half-hourly
      // ticks that follow it through 14:30, so what this proves is the
      // staleness window, which is what it says it proves.
      vi.setSystemTime(new Date(2026, 7, 15, 10, 0, 0));
      let calls = 0;
      const api = makeFakeGoogleApi({ listThreads: async () => { calls++; return []; } });
      render(wrap(<><MailSnapshotPump /><ConnectFromAnywhere /></>, api));
      await act(async () => {
        fireEvent.click(screen.getByText("Any Connect"));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(calls).toBe(1);

      // One interval tick, still well inside the 4-hour staleness window:
      // no second refresh.
      await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60e3); });
      expect(calls).toBe(1);

      // Enough interval ticks pass 4 hours: the next check finds the
      // snapshot stale and refreshes again.
      await act(async () => { await vi.advanceTimersByTimeAsync(4 * 3600e3); });
      expect(calls).toBeGreaterThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("looks again in the ten minutes before a window, once (2026-09-11)", async () => {
    // A 30-minute check from 8:40 next ran at 9:10, past the 9:00 window, so
    // the digest fired off the 8:40 snapshot. Now it lands inside 8:50-9:00.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 7, 15, 8, 40, 0));
      let calls = 0;
      const api = makeFakeGoogleApi({ listThreads: async () => { calls++; return []; } });
      render(wrap(<><MailSnapshotPump /><ConnectFromAnywhere /></>, api));
      await act(async () => {
        fireEvent.click(screen.getByText("Any Connect"));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(calls).toBe(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60e3); }); // 8:50
      expect(calls).toBe(2);
      await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60e3); });  // 8:55
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the digest names the Needs You threads and VIPs, never 'nothing urgent' about them (2026-09-11)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(2026, 7, 15, 10, 0, 0));
      // A VIP counts as a person even from an address that looks automated.
      toggleVip("no-reply@school.org");
      saveMailSnapshot({
        ts: Date.now(), needsYou: 2, waiting: [], promises: [],
        threads: [
          { id: "t1", from: "Sarah Lee", fromEmail: "sarah@x.com", subject: "Waiver", gist: "Needs the waiver" },
          { id: "t2", from: "School", fromEmail: "no-reply@school.org", subject: "Pickup", gist: "Pickup change" },
        ],
      });
      const api = makeFakeGoogleApi({});
      render(wrap(<><MailSnapshotPump /><ConnectFromAnywhere /></>, api));
      await act(async () => {
        fireEvent.click(screen.getByText("Any Connect"));
        await Promise.resolve();
        await Promise.resolve();
      });
      const last = digests.calls[digests.calls.length - 1];
      expect(last?.[0]?.title).toBe("2 People wrote · Sarah and 1 other need you");
    } finally {
      vi.useRealTimers();
    }
  });
});
