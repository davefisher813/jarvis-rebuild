// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Switch, Card, Menu, focusField } from "./kit";

// Row tap (Dave 2026-09-15, "I want all rows clickable"): a settings row
// with a switch flips it from anywhere on the row, exactly once.
describe("settings kit rows", () => {
  it("a tap on the switch row's words flips it; a tap on the switch flips it once", () => {
    const onToggle = vi.fn();
    render(<Card><Switch label="Rest Timer Sound" on={false} onToggle={onToggle} /></Card>);
    fireEvent.click(screen.getByText("Rest Timer Sound"));
    expect(onToggle).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("switch", { name: "Rest Timer Sound" }));
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it("a locked switch row takes no tap", () => {
    const onToggle = vi.fn();
    render(<Switch label="Locked" on onToggle={onToggle} locked />);
    fireEvent.click(screen.getByText("Locked"));
    fireEvent.click(screen.getByRole("switch", { name: "Locked" }));
    expect(onToggle).not.toHaveBeenCalled();
  });

  // THE MENU ROW IS THE DOOR TO ITS MENU (audit 2026-09-26, "Match Master"
  // measured 159x24 under the capture bar at 430 and 834 wide with type at
  // 1.4). The row forwards its taps to the dropdown and says so in the DOM,
  // so the visual auditor measures the 48px row rather than the 24px value.
  // A tap on the value itself is the value's own: it opens once, never
  // twice.
  it("a tap on the menu row's words opens its menu; a tap on the value opens it once", () => {
    render(<Card><Menu label="Email Drafts" value="match" options={[{ value: "match", label: "Match Master" }, { value: "off", label: "Off" }]} onPick={() => {}} /></Card>);
    const dd = screen.getByRole("button", { name: "Email Drafts" });
    expect(dd.closest(".row")!.getAttribute("data-forwards")).toBe(".dd");
    expect(dd.closest(".row")!.getAttribute("role")).toBeNull();
    fireEvent.click(screen.getByText("Email Drafts"));
    expect(dd).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(dd);
    expect(dd).toHaveAttribute("aria-expanded", "false");
  });

  it("a form row's tap focuses its field", () => {
    render(<div className="row set-row" onClick={focusField}><div className="conn-name">Name</div><input aria-label="Name" /></div>);
    fireEvent.click(screen.getByText("Name"));
    expect(screen.getByLabelText("Name")).toHaveFocus();
  });
});
