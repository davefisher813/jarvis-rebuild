// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import LifeSegments, { LIFE_SEGMENTS } from "./LifeSegments";

// THE ACTIVE LENS IS ALWAYS ON SCREEN, AND THE STRIP SAYS WHEN IT SCROLLS (2026-10-05: "Goals" cut to "Go" at the right
// edge, so on the Goals lens no tab looked selected; the edge fade sat on a strip that fit). jsdom has no layout, so the
// strip's metrics are given.

function metrics(el: HTMLElement, o: { scrollWidth: number; clientWidth: number; scrollLeft?: number }) {
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: o.scrollWidth });
  Object.defineProperty(el, "clientWidth", { configurable: true, value: o.clientWidth });
  el.scrollLeft = o.scrollLeft ?? 0;
}

describe("LifeSegments", () => {
  it("draws all five lenses with the active one selected", () => {
    render(<LifeSegments value="goals" onPick={() => {}} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(LIFE_SEGMENTS.map((s) => s.label));
    expect(screen.getByRole("tab", { name: "Goals" })).toHaveAttribute("aria-selected", "true");
  });

  it("wears no edge fade when the strip fits (data-more is empty), so the last word is never dimmed", () => {
    const { container } = render(<LifeSegments value="areas" onPick={() => {}} />);
    // jsdom lays out nothing: scrollWidth and clientWidth are both 0, the strip fits.
    expect(container.querySelector(".segmented")).toHaveAttribute("data-more", "");
  });

  it("fades only the side it continues on, from its own scroll position", () => {
    const { container } = render(<LifeSegments value="areas" onPick={() => {}} />);
    const strip = container.querySelector<HTMLElement>(".segmented")!;
    metrics(strip, { scrollWidth: 420, clientWidth: 350, scrollLeft: 0 });
    fireEvent.scroll(strip);
    expect(strip).toHaveAttribute("data-more", "r");
    metrics(strip, { scrollWidth: 420, clientWidth: 350, scrollLeft: 70 });
    fireEvent.scroll(strip);
    expect(strip).toHaveAttribute("data-more", "l");
    metrics(strip, { scrollWidth: 420, clientWidth: 350, scrollLeft: 30 });
    fireEvent.scroll(strip);
    expect(strip).toHaveAttribute("data-more", "lr");
  });

  it("centres the active lens in a strip that overflows when the lens changes (a jump lands on Goals with the strip at its start)", () => {
    const { container, rerender } = render(<LifeSegments value="areas" onPick={() => {}} />);
    const strip = container.querySelector<HTMLElement>(".segmented")!;
    metrics(strip, { scrollWidth: 420, clientWidth: 350, scrollLeft: 0 });
    const goals = screen.getByRole("tab", { name: "Goals" });
    // Layout is given as rects: the strip starts at x=20; Goals sits at 330..390 while the strip is at scrollLeft 0.
    strip.getBoundingClientRect = () => ({ left: 20, right: 370, top: 0, bottom: 34, width: 350, height: 34, x: 20, y: 0, toJSON() {} }) as DOMRect;
    goals.getBoundingClientRect = () => ({ left: 330, right: 390, top: 0, bottom: 34, width: 60, height: 34, x: 330, y: 0, toJSON() {} }) as DOMRect;
    Object.defineProperty(goals, "offsetWidth", { configurable: true, value: 60 });
    rerender(<LifeSegments value="goals" onPick={() => {}} />);
    // left of Goals inside the strip = 330 - 20 + 0 = 310; centred = 310 - (350 - 60) / 2 = 165.
    expect(strip.scrollLeft).toBe(165);
  });

  it("does not move a strip that fits", () => {
    const { container, rerender } = render(<LifeSegments value="areas" onPick={() => {}} />);
    const strip = container.querySelector<HTMLElement>(".segmented")!;
    metrics(strip, { scrollWidth: 350, clientWidth: 350, scrollLeft: 0 });
    rerender(<LifeSegments value="goals" onPick={() => {}} />);
    expect(strip.scrollLeft).toBe(0);
  });

  it("a tap on another lens picks it; a tap on the active one does nothing", () => {
    const onPick = vi.fn();
    render(<LifeSegments value="tasks" onPick={onPick} />);
    fireEvent.click(screen.getByRole("tab", { name: "Tasks" }));
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "Goals" }));
    expect(onPick).toHaveBeenCalledWith("goals");
  });
});
