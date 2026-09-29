// @vitest-environment jsdom
// FIRST TAP ON QUICK CAPTURE (audit 2026-09-29). A lazy chunk that failed to
// load used to stay rejected for the life of the page (React.lazy memoizes the
// rejection), and the overlay it fed mounted outside every local boundary, so
// the first tap reached the root "Reload Fixes It" card. These pin both fixes.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Suspense } from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { lazyWithRecovery, RELOADED_KEY } from "./chunkRecovery";
import ErrorBoundary from "../monitoring/ErrorBoundary";

vi.mock("../monitoring/monitor", () => ({ captureError: () => {} }));

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  // Ladder rung 3 is a real page reload; keep it out of jsdom and the guard set
  // so the ladder throws instead of parking forever.
  sessionStorage.setItem(RELOADED_KEY, "1");
});

const Sheet = () => <div>Smart Paste</div>;

describe("lazyWithRecovery", () => {
  it("a failed load does not poison the component: the next mount imports afresh and renders", async () => {
    let calls = 0;
    const Lazy = lazyWithRecovery(() => (++calls <= 2 ? Promise.reject(new Error("net")) : Promise.resolve({ default: Sheet })));
    const failed = vi.fn();

    const first = render(<ErrorBoundary fallback={null} onFail={failed}><Suspense fallback={null}><Lazy /></Suspense></ErrorBoundary>);
    await waitFor(() => expect(failed).toHaveBeenCalledTimes(1), { timeout: 5000 });
    first.unmount();
    await new Promise((r) => setTimeout(r, 1100)); // a later tap, not React's own re-render

    // The second tap: same component, brand new mount. Before the fix React.lazy
    // re-threw the memoized rejection here and the crash repeated until reload.
    render(<ErrorBoundary fallback={null} onFail={failed}><Suspense fallback={null}><Lazy /></Suspense></ErrorBoundary>);
    await waitFor(() => expect(screen.getByText("Smart Paste")).toBeInTheDocument());
    expect(failed).toHaveBeenCalledTimes(1);
  }, 15000);

  it("preload warms the chunk without rendering, and swallows a failure", async () => {
    const load = vi.fn(() => Promise.resolve({ default: Sheet }));
    const Lazy = lazyWithRecovery(load);
    Lazy.preload();
    expect(load).toHaveBeenCalledTimes(1);

    const bad = lazyWithRecovery(() => Promise.reject(new Error("offline")));
    await act(async () => { bad.preload(); });
    // no unhandled rejection: reaching here is the assertion
  });
});

describe("overlay boundary", () => {
  it("with a fallback and onFail, a render crash closes the overlay instead of showing the root card", () => {
    const onFail = vi.fn();
    const Boom = (): never => { throw new Error("first open"); };
    render(<div><ErrorBoundary fallback={null} onFail={onFail}><Boom /></ErrorBoundary><span>dock still up</span></div>);
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Something Went Wrong")).not.toBeInTheDocument();
    expect(screen.getByText("dock still up")).toBeInTheDocument();
  });
});
