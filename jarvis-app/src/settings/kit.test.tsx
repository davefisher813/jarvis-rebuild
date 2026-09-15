// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Switch, Card, focusField } from "./kit";

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

  it("a form row's tap focuses its field", () => {
    render(<div className="row set-row" onClick={focusField}><div className="conn-name">Name</div><input aria-label="Name" /></div>);
    fireEvent.click(screen.getByText("Name"));
    expect(screen.getByLabelText("Name")).toHaveFocus();
  });
});
