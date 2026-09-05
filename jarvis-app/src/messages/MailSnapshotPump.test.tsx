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

beforeEach(() => localStorage.clear());

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
});
