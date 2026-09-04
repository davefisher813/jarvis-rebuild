// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import ErrorBoundary from "./ErrorBoundary";

// S3-Q19 (2026-09-04): ErrorBoundary had no test file before this one, and it
// is now load-bearing in a new way -- AppShell wraps each tab's content in one
// of these, keyed on the active tab, so a crash in one tab shows its own card
// while the tab bar (a sibling, outside the boundary) keeps working, and a
// switch to another tab remounts a fresh boundary in place of a tripped one.
// These tests prove that mechanism directly, without paying for AppShell's
// full provider tree.

const captureError = vi.fn();
vi.mock("./monitor", () => ({ captureError: (...a: unknown[]) => captureError(...a) }));

function Boom(): never {
  throw new Error("kaboom");
}
function Fine() {
  return <div>Still here</div>;
}

beforeEach(() => {
  captureError.mockReset();
  // React logs the caught error to console.error twice (its own dev warning,
  // then this component's own componentDidCatch); both are expected noise
  // for a boundary test, not a real failure.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("ErrorBoundary", () => {
  it("catches a render crash and shows the recoverable card", () => {
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByText("Something Went Wrong")).toBeInTheDocument();
    expect(screen.getByText("Reload")).toBeInTheDocument();
  });

  it("reports the crash through the monitor seam", () => {
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError.mock.calls[0]![0]).toBeInstanceOf(Error);
  });

  it("renders children unchanged when nothing throws", () => {
    render(<ErrorBoundary><Fine /></ErrorBoundary>);
    expect(screen.getByText("Still here")).toBeInTheDocument();
  });

  // The exact shape AppShell uses: a sibling sits OUTSIDE the boundary, the
  // way VoiceBar/TabBar sit outside the per-tab boundary in the shell.
  it("a sibling outside the boundary is untouched by a crash inside it", () => {
    render(
      <div>
        <div>tab bar</div>
        <ErrorBoundary><Boom /></ErrorBoundary>
      </div>,
    );
    expect(screen.getByText("tab bar")).toBeInTheDocument();
    expect(screen.getByText("Something Went Wrong")).toBeInTheDocument();
  });

  // AppShell keys the boundary on the active tab (<ErrorBoundary key={active}>),
  // so switching tabs is a remount, not a re-render -- this is what actually
  // clears a tripped boundary's state.failed, since nothing else does.
  it("keying the boundary on a changing value recovers it, the way switching tabs does", () => {
    const { rerender } = render(<ErrorBoundary key="today"><Boom /></ErrorBoundary>);
    expect(screen.getByText("Something Went Wrong")).toBeInTheDocument();

    rerender(<ErrorBoundary key="schedule"><Fine /></ErrorBoundary>);
    expect(screen.getByText("Still here")).toBeInTheDocument();
    expect(screen.queryByText("Something Went Wrong")).not.toBeInTheDocument();
  });

  it("without a key change, a tripped boundary stays tripped even if children stop throwing", () => {
    const { rerender } = render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByText("Something Went Wrong")).toBeInTheDocument();

    rerender(<ErrorBoundary><Fine /></ErrorBoundary>);
    // Same instance, so state.failed never resets: this is exactly why the
    // key is required, not an accident of how AppShell happens to work today.
    expect(screen.getByText("Something Went Wrong")).toBeInTheDocument();
  });
});
