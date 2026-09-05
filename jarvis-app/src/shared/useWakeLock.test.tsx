// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { useWakeLock } from "./useWakeLock";

// GYM-F-09 (2026-09-05): S5-Q30 said "the screen sleeps between sets" was
// fixed, and it was, until the first glance at a text. The Wake Lock spec
// releases every lock when the document becomes hidden, and the hook asked
// once on mount and never again, so from that moment on the screen slept
// between sets for the rest of the session, conditioning clock included.

function Holder({ active = true }: { active?: boolean }) {
  useWakeLock(active);
  return null;
}

describe("useWakeLock", () => {
  let requests: number;
  let released: number;
  let visibility: DocumentVisibilityState;

  const setVisible = (v: DocumentVisibilityState) => {
    visibility = v;
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
  };

  beforeEach(() => {
    requests = 0;
    released = 0;
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: {
        request: () => { requests++; return Promise.resolve({ release: () => { released++; return Promise.resolve(); } }); },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "wakeLock");
  });

  it("asks for the lock once while nothing changes", async () => {
    render(<Holder />);
    await act(async () => {});
    expect(requests).toBe(1);
    setVisible("visible");
    await act(async () => {});
    expect(requests).toBe(1);
  });

  it("asks again after the app was backgrounded: the system already dropped the lock", async () => {
    render(<Holder />);
    await act(async () => {});
    expect(requests).toBe(1);
    setVisible("hidden");
    setVisible("visible");
    await act(async () => {});
    expect(requests).toBe(2);
  });

  it("releases on unmount and stops listening", async () => {
    const { unmount } = render(<Holder />);
    await act(async () => {});
    unmount();
    await act(async () => {});
    expect(released).toBe(1);
    setVisible("hidden");
    setVisible("visible");
    await act(async () => {});
    expect(requests).toBe(1);
  });

  it("inactive asks for nothing at all", async () => {
    render(<Holder active={false} />);
    await act(async () => {});
    setVisible("hidden");
    setVisible("visible");
    await act(async () => {});
    expect(requests).toBe(0);
  });

  it("a browser with no Wake Lock API is silence, never a crash", async () => {
    Reflect.deleteProperty(navigator, "wakeLock");
    expect(() => render(<Holder />)).not.toThrow();
    await act(async () => {});
    setVisible("hidden");
    setVisible("visible");
    await act(async () => {});
  });
});
