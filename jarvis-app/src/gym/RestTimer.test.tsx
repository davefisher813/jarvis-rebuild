// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import RestTimer, { restRemainingSec } from "./RestTimer";

vi.mock("../shared/haptics", () => ({ haptics: { success: vi.fn(), impact: vi.fn(), selection: vi.fn(), warning: vi.fn() } }));
import { haptics } from "../shared/haptics";

vi.mock("../shared/notifications", () => ({ scheduleRestOver: vi.fn(), cancelRestOver: vi.fn() }));
import { scheduleRestOver, cancelRestOver } from "../shared/notifications";

// GYM-F-01 (2026-09-05): the rest timer used to count TICKS, so a webview
// that suspended timers while the app was backgrounded left it reading 2:00
// after a 90-second glance at Music. Now it is a function of the clock.
describe("RestTimer", () => {
  const T0 = 1_700_000_000_000;
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); });
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

  it("restRemainingSec reads the deadline against the clock, never a tick count", () => {
    const endsAt = T0 + 120_000;
    expect(restRemainingSec(endsAt, T0)).toBe(120);
    expect(restRemainingSec(endsAt, T0 + 90_000)).toBe(30);
    expect(restRemainingSec(endsAt, T0 + 90_400)).toBe(30);
    expect(restRemainingSec(endsAt, T0 + 120_000)).toBe(0);
    expect(restRemainingSec(endsAt, T0 + 500_000)).toBe(0);
  });

  it("catches up after the app was suspended: the clock moved, no ticks fired, visibilitychange re-reads it", () => {
    render(<RestTimer endsAt={T0 + 120_000} onDismiss={() => {}} />);
    expect(screen.getByText("2:00")).toBeInTheDocument();
    expect(screen.getByText("Resting")).toBeInTheDocument();
    // The phone locks for 90 seconds: wall clock advances, timers do not.
    vi.setSystemTime(T0 + 90_000);
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(screen.getByText("0:30")).toBeInTheDocument();
    // The tick-counting version would have read 2:00 here and run 2:00 more.
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(screen.getByText("0:00")).toBeInTheDocument();
    expect(screen.getByText("Rest Over")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
  });

  it("cues once at zero with the success haptic, and not again", () => {
    render(<RestTimer endsAt={T0 + 5_000} onDismiss={() => {}} />);
    expect(haptics.success).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(haptics.success).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(haptics.success).toHaveBeenCalledTimes(1);
  });

  it("mounting on a rest that already ended announces nothing: the athlete is looking at it", () => {
    render(<RestTimer endsAt={T0 - 60_000} onDismiss={() => {}} />);
    expect(screen.getByText("Rest Over")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(haptics.success).not.toHaveBeenCalled();
  });

  // UP-ATH-03 (2026-09-06): the beep and the haptic above only reach a phone
  // that is awake. The pocketed phone needs the OS.
  it("arms one notification for the deadline, and takes it back when the timer goes away", () => {
    const view = render(<RestTimer endsAt={T0 + 120_000} notifyLine="Bench Press set 3" onDismiss={() => {}} />);
    expect(scheduleRestOver).toHaveBeenCalledTimes(1);
    expect(scheduleRestOver).toHaveBeenCalledWith(T0 + 120_000, "Bench Press set 3");
    expect(cancelRestOver).not.toHaveBeenCalled();
    // Continue, Skip Rest, the next set's rest, or leaving the session: all
    // of them unmount this, and none of them may leave a buzz behind.
    view.unmount();
    expect(cancelRestOver).toHaveBeenCalledTimes(1);
  });

  it("arms nothing when the athlete has the rest switch off", () => {
    render(<RestTimer endsAt={T0 + 120_000} onDismiss={() => {}} />);
    expect(scheduleRestOver).not.toHaveBeenCalled();
  });

  it("offers the filler only while the rest is still running", () => {
    render(<RestTimer endsAt={T0 + 3_000} fillerName="T-Spine Rotations" onLogFiller={() => {}} onDismiss={() => {}} />);
    expect(screen.getByRole("button", { name: "Or Do T-Spine Rotations" })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(screen.queryByRole("button", { name: "Or Do T-Spine Rotations" })).toBeNull();
  });
});
