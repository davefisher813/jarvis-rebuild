// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import TabBar from "./TabBar";
import EditTabsPage, { TAB_CAP_MESSAGE, TAB_FLOOR_MESSAGE } from "../more/EditTabsPage";
import { subscribeToast } from "../shared/toast";
import { MAX_TABS } from "./destinations";

describe("TabBar", () => {
  it("renders chosen tabs plus a fixed More, highlighting the active one", () => {
    render(<TabBar tabKeys={["today", "life", "notes"]} active="life" onTab={() => {}} />);
    ["Today", "Life", "Notes", "More"].forEach((l) => expect(screen.getByText(l)).toBeInTheDocument());
    expect(screen.getByText("Life").closest(".tab")).toHaveClass("active");
  });

  it("highlights More when the active page is not a tab", () => {
    render(<TabBar tabKeys={["today", "life"]} active="brain" onTab={() => {}} />);
    expect(screen.getByText("More").closest(".tab")).toHaveClass("active");
  });
});

describe("EditTabsPage", () => {
  it("toggles a page in or out of the tab bar", () => {
    const onToggle = vi.fn();
    render(<EditTabsPage tabKeys={["today", "life", "schedule"]} onToggle={onToggle} onBack={() => {}} />);
    fireEvent.click(screen.getByRole("switch", { name: "Notes" }));
    expect(onToggle).toHaveBeenCalledWith("notes");
  });

  it("locks the only remaining tab and blocks adding past the max", () => {
    const onToggle = vi.fn();
    const { rerender } = render(<EditTabsPage tabKeys={["today"]} onToggle={onToggle} onBack={() => {}} />);
    fireEvent.click(screen.getByRole("switch", { name: "Today" }));
    expect(onToggle).not.toHaveBeenCalled(); // can't remove the last tab

    rerender(<EditTabsPage tabKeys={["today", "life", "schedule", "brain", "notes"]} onToggle={onToggle} onBack={() => {}} />);
    // Email is a real destination not in this bar; at the cap it cannot be added.
    fireEvent.click(screen.getByRole("switch", { name: "Email" }));
    expect(onToggle).not.toHaveBeenCalled(); // already at max (5)
  });
});

// AUDIT 2026-09-29 (P0): "Notes, Notifications, Money and Chat switches cannot
// be turned on; Email can." Not a bug in the toggle: the bar holds MAX_TABS,
// the saved bar had four, so Email took the last slot and every other switch
// locked with no word. The cap is real, so the page now says so.
describe("EditTabsPage at the cap", () => {
  const FULL = ["today", "life", "schedule", "brain", "notes"];

  it("has a cap, and one slot left lets exactly one more switch on", () => {
    expect(MAX_TABS).toBe(5);
    const onToggle = vi.fn();
    render(<EditTabsPage tabKeys={FULL.slice(0, 4)} onToggle={onToggle} onBack={() => {}} />);
    expect(screen.queryByText(TAB_CAP_MESSAGE)).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Email" }));
    expect(onToggle).toHaveBeenCalledWith("messages");
  });

  it("says the bar is full, on the page and on every locked switch tapped", () => {
    const seen: string[] = [];
    const stop = subscribeToast((t) => { if (t) seen.push(t.message); });
    seen.length = 0; // a subscriber is handed the toast already showing
    const onToggle = vi.fn();
    render(<EditTabsPage tabKeys={FULL} onToggle={onToggle} onBack={() => {}} />);
    expect(screen.getByText(TAB_CAP_MESSAGE)).toBeInTheDocument();
    expect(TAB_CAP_MESSAGE).toBe("The tab bar holds 5 · Turn another off first");
    const email = screen.getByRole("switch", { name: "Email" });
    expect(email).toHaveAttribute("aria-checked", "false");
    expect(email).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(email);
    fireEvent.click(email.closest(".row")!);
    expect(onToggle).not.toHaveBeenCalled();
    expect(seen).toEqual([TAB_CAP_MESSAGE, TAB_CAP_MESSAGE]);
    // A tab that is in the bar can still be turned off, and says nothing.
    fireEvent.click(screen.getByRole("switch", { name: "Notes" }));
    expect(onToggle).toHaveBeenCalledWith("notes");
    stop();
  });

  it("the last tab standing explains why it cannot go", () => {
    const seen: string[] = [];
    const stop = subscribeToast((t) => { if (t) seen.push(t.message); });
    seen.length = 0; // a subscriber is handed the toast already showing
    render(<EditTabsPage tabKeys={["today"]} onToggle={() => {}} onBack={() => {}} />);
    fireEvent.click(screen.getByRole("switch", { name: "Today" }));
    expect(seen).toEqual([TAB_FLOOR_MESSAGE]);
    stop();
  });
});
