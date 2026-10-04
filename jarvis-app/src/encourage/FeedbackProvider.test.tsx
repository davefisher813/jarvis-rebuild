// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { FeedbackProvider, useFeedback } from "./FeedbackProvider";
import { DEFAULT_FEEDBACK, setLiveFeedback, setQuietToday } from "./prefs";
import { playCompletion, playTone } from "./effects";
import { Burst } from "../shared/Burst";
import { haptics } from "../shared/haptics";
import { bus } from "../events";
import { todayISO } from "../tasks/grouping";

function Probe() {
  const f = useFeedback();
  return (
    <div>
      <span data-testid="cel">{f.prefs.celebration}</span>
      <button onClick={() => f.apply({ celebration: "expressive" })}>expressive</button>
      <button onClick={() => f.apply({ celebration: "off" })}>off</button>
      <button onClick={() => f.setQuiet(true)}>quiet</button>
      <Burst show />
    </div>
  );
}

const html = document.documentElement;
let vibrate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  setLiveFeedback(null);
  delete html.dataset.celebrate; delete html.dataset.motion; delete html.dataset.quiet;
  vibrate = vi.fn();
  Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
});
afterEach(() => { setLiveFeedback(null); });

describe("FeedbackProvider", () => {
  it("applies the Gentle defaults to the page", () => {
    render(<FeedbackProvider><Probe /></FeedbackProvider>);
    expect(html.dataset.celebrate).toBe("gentle");
    expect(html.dataset.motion).toBe("full");
    expect(html.dataset.quiet).toBe("off");
  });

  it("Gentle draws no burst; Expressive does; Off does not", () => {
    const { container } = render(<FeedbackProvider><Probe /></FeedbackProvider>);
    expect(container.querySelector(".burst")).toBeNull();
    fireEvent.click(screen.getByText("expressive"));
    expect(html.dataset.celebrate).toBe("expressive");
    expect(container.querySelector(".burst")).not.toBeNull();
    fireEvent.click(screen.getByText("off"));
    expect(html.dataset.celebrate).toBe("off");
    expect(container.querySelector(".burst")).toBeNull();
  });

  it("Quiet Today behaves like Off for the day without touching the saved choice", () => {
    const { container } = render(<FeedbackProvider><Probe /></FeedbackProvider>);
    fireEvent.click(screen.getByText("expressive"));
    fireEvent.click(screen.getByText("quiet"));
    expect(html.dataset.celebrate).toBe("off");
    expect(html.dataset.quiet).toBe("on");
    expect(screen.getByTestId("cel").textContent).toBe("expressive");
    expect(container.querySelector(".burst")).toBeNull();
  });

  it("follows the phone's reduce-motion request", () => {
    const real = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: q.includes("reduce"), media: q, addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    try {
      const { container } = render(<FeedbackProvider><Probe /></FeedbackProvider>);
      fireEvent.click(screen.getByText("expressive"));
      expect(html.dataset.motion).toBe("reduce");
      expect(container.querySelector(".burst")).toBeNull();
    } finally { window.matchMedia = real; }
  });

  it("adopts the account's copy and ignores junk", () => {
    function Adopt() {
      const f = useFeedback();
      return <button onClick={() => { f.adopt({ celebration: "off", sound: "x" }); }}>adopt</button>;
    }
    render(<FeedbackProvider><Adopt /><Probe /></FeedbackProvider>);
    fireEvent.click(screen.getByText("adopt"));
    expect(html.dataset.celebrate).toBe("off");
  });

  it("without a provider the hook answers with the defaults", () => {
    function Bare() { return <span>{useFeedback().prefs.celebration}</span>; }
    render(<Bare />);
    expect(screen.getByText("gentle")).toBeInTheDocument();
  });
});

describe("haptics and sound are off until chosen", () => {
  it("the completion tap does nothing by default", () => {
    haptics.success();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("the completion tap fires when chosen, and not under Quiet Today", () => {
    setLiveFeedback({ ...DEFAULT_FEEDBACK, haptics: true });
    haptics.success();
    expect(vibrate).toHaveBeenCalledTimes(1);
    setQuietToday(true, todayISO());
    haptics.success();
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it("other haptics (a switch, a selection) are not part of the choice", () => {
    haptics.selection();
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it("a completion on the bus plays nothing at defaults", () => {
    render(<FeedbackProvider><Probe /></FeedbackProvider>);
    act(() => { bus.emit({ type: "task.completed" } as never); });
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("a completion on the bus taps once when haptics are chosen", () => {
    render(<FeedbackProvider><Probe /></FeedbackProvider>);
    setLiveFeedback({ ...DEFAULT_FEEDBACK, haptics: true });
    act(() => { bus.emit({ type: "task.completed" } as never); });
    expect(vibrate).toHaveBeenCalledTimes(1);
    playCompletion();
    expect(vibrate).toHaveBeenCalledTimes(2);
  });

  it("tones are throttled so a whole list makes one sound", () => {
    const start = vi.fn();
    class FakeCtx {
      state = "running"; currentTime = 0; destination = {};
      resume() {}
      createOscillator() { return { type: "", frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start, stop() {} }; }
      createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
    }
    (window as unknown as { AudioContext: unknown }).AudioContext = FakeCtx;
    const t = 10_000_000;
    expect(playTone(t)).toBe(true);
    expect(playTone(t + 100)).toBe(false);
    expect(playTone(t + 700)).toBe(true);
    expect(start).toHaveBeenCalledTimes(2);
  });
});
