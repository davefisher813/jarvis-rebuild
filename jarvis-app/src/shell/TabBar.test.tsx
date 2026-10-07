// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import TabBar from "./TabBar";

// THE TAB BAR (palette and craft pass, Dave 2026-10-05). Its look is the
// stylesheet's (laws/warmPalette: a faint warm material, a hairline, press
// feedback); what it owes in markup is that every tab is a real, keyboard
// reachable control that says which one is current.
describe("TabBar", () => {
  it("a tab answers Enter and Space as it answers a tap", () => {
    const onTab = vi.fn();
    render(<TabBar tabKeys={["today", "life"]} active="today" onTab={onTab} />);
    const life = screen.getByText("Life").closest(".tab")!;
    expect(life).toHaveAttribute("role", "button");
    expect(life).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(life, { key: "Enter" });
    fireEvent.keyDown(life, { key: " " });
    fireEvent.click(life);
    expect(onTab).toHaveBeenCalledTimes(3);
    expect(onTab).toHaveBeenCalledWith("life");
  });

  it("only the current tab says it is current, and More takes it for a page opened from More", () => {
    const { rerender } = render(<TabBar tabKeys={["today", "life"]} active="life" onTab={() => {}} />);
    const cur = () => [...document.querySelectorAll(".tab[aria-current]")].map((t) => t.textContent);
    expect(cur()).toEqual(["Life"]);
    rerender(<TabBar tabKeys={["today", "life"]} active="brain" onTab={() => {}} />);
    expect(cur()).toEqual(["More"]);
  });

  it("carries no badge or count, by law", () => {
    render(<TabBar tabKeys={["today", "life", "schedule"]} active="today" onTab={() => {}} />);
    for (const t of document.querySelectorAll(".tab")) expect(t.querySelector(".badge, .tab-badge, .count-pill")).toBeNull();
  });
});

describe("TabBar: the one status mark (Foundation Fix Spec 3)", () => {
  it("marks only the tab it is told to, with a warning glyph and no number", () => {
    render(<TabBar tabKeys={["today", "messages"]} active="today" onTab={() => {}} warn={["messages"]} />);
    const marked = [...document.querySelectorAll(".tab")].filter((t) => t.querySelector(".tab-warn"));
    expect(marked.map((t) => t.textContent)).toEqual(["Email"]);
    const mark = marked[0]!.querySelector(".tab-warn")!;
    expect(mark).toHaveAttribute("aria-label", "Needs attention");
    expect(mark.textContent).toBe("");
  });

  it("without a warning the bar is exactly as it was", () => {
    render(<TabBar tabKeys={["today", "messages"]} active="today" onTab={() => {}} />);
    expect(document.querySelector(".tab-warn")).toBeNull();
  });
});
