// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import ConditioningFace from "./ConditioningFace";
import CondReceipt from "./CondReceipt";
import type { Exercise } from "./types";

// THE FACE and THE RECEIPT (Check, Health, Stop, 2026-09-02). The clock is
// driven by performance.now under fake timers; the tests walk the lead-in,
// tap rounds, and read what the finish hands back.
describe("ConditioningFace", () => {
  let t = 0;
  beforeEach(() => {
    vi.useFakeTimers();
    t = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => t);
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  const tick = (ms: number) => { t += ms; act(() => { vi.advanceTimersByTime(ms); }); };

  it("counts three in, then runs, marks rounds by the button, and finishes on the slide with the splits", () => {
    const onFinish = vi.fn();
    render(<ConditioningFace name="Cindy" cond={{ format: "amrap", capSec: 720 }} onFinish={onFinish} onCancel={() => {}} />);
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Round" })).toBeNull();
    tick(3100);
    // The corner copies exist for landscape; the mid-ring line is the one read.
    const round = () => document.querySelector(".cf-round")!.textContent;
    expect(round()).toBe("Round 1");
    // An AMRAP counts down its window.
    expect(document.querySelector(".cf-num")).toHaveTextContent("12:00");
    tick(98_000);
    fireEvent.click(screen.getByRole("button", { name: "Round" }));
    expect(round()).toBe("Round 2");
    expect(document.querySelector(".cf-last")).toHaveTextContent("last 1:38");
    tick(104_000);
    fireEvent.click(screen.getByRole("button", { name: "Round" }));
    expect(document.querySelector(".cf-last")).toHaveTextContent("last 1:44");
    // Enter on the knob is the keyboard's slide.
    fireEvent.keyDown(screen.getByRole("button", { name: "Slide to finish" }), { key: "Enter" });
    expect(onFinish).toHaveBeenCalledTimes(1);
    const r = onFinish.mock.calls[0]![0];
    expect(r.splits.map(Math.round)).toEqual([98, 202]);
    expect(Math.round(r.elapsed)).toBe(202);
  });

  it("ends itself when the cap lands", () => {
    const onFinish = vi.fn();
    render(<ConditioningFace name="Cindy" cond={{ format: "amrap", capSec: 10 }} onFinish={onFinish} onCancel={() => {}} />);
    tick(3100);
    tick(10_200);
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish.mock.calls[0]![0].elapsed).toBe(10);
  });

  it("an EMOM marks its own rounds and offers no Round button", () => {
    render(<ConditioningFace name="Power cleans" cond={{ format: "emom", capSec: 600, intervalSec: 60, rounds: 10 }} onFinish={() => {}} onCancel={() => {}} />);
    tick(3100);
    expect(screen.queryByRole("button", { name: "Round" })).toBeNull();
    expect(document.querySelector(".cf-round")).toHaveTextContent("Round 1 of 10");
    tick(61_000);
    expect(document.querySelector(".cf-round")).toHaveTextContent("Round 2 of 10");
  });

  it("Cancel discards without a result", () => {
    const onFinish = vi.fn(); const onCancel = vi.fn();
    render(<ConditioningFace name="Cindy" cond={{ format: "amrap", capSec: 720 }} onFinish={onFinish} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
    expect(onFinish).not.toHaveBeenCalled();
  });
});

describe("CondReceipt", () => {
  const ex: Exercise = { id: "e1", name: "Cindy", kind: "rounds", sets: [], note: "5 pull-ups, 10 push-ups, 15 squats", cond: { format: "amrap", capSec: 720 } };
  it("prints every round with its delta, and the score with the reps typed by hand", () => {
    const onChange = vi.fn();
    const { container } = render(<CondReceipt exercise={ex} entries={[{ id: "s1", r: 3, elapsed: 720, splits: [98, 202, 313] }]} onChange={onChange} />);
    expect(screen.getByText("AMRAP")).toBeInTheDocument();
    expect(screen.getByText("5 pull-ups, 10 push-ups, 15 squats")).toBeInTheDocument();
    const rows = container.querySelectorAll(".cr-table tr");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent("1:44");
    expect(rows[1]!.querySelector(".cr-d.up")).toHaveTextContent("+6");
    expect(screen.getByText("Rounds + reps · 12:00")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Reps past the last round"), { target: { value: "12" } });
    expect(onChange).toHaveBeenCalledWith([{ id: "s1", r: 3, elapsed: 720, splits: [98, 202, 313], extra: 12 }]);
  });
  it("says Not run yet before the clock has run", () => {
    render(<CondReceipt exercise={ex} entries={[]} onChange={() => {}} />);
    expect(screen.getByText("Not run yet")).toBeInTheDocument();
  });
});
