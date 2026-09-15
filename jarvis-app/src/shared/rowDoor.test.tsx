// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { rowDoor } from "./rowDoor";

// Dave 2026-09-15: "I want all rows clickable". The row opens; its pill keeps its own verb.
describe("rowDoor", () => {
  const Row = ({ open, act }: { open: () => void; act: () => void }) => (
    <div className="row" data-testid="row" {...rowDoor(open)}>
      <div className="row-grow">Words</div>
      <button type="button" onClick={act}>Pill</button>
    </div>
  );
  it("a tap on the words opens; a tap on the pill does only the pill", () => {
    const open = vi.fn(); const act = vi.fn();
    render(<Row open={open} act={act} />);
    fireEvent.click(screen.getByText("Words"));
    expect(open).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Pill"));
    expect(act).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
  });
  it("Enter on the row opens it; Enter on the pill leaves the row alone", () => {
    const open = vi.fn();
    render(<Row open={open} act={() => {}} />);
    const row = screen.getByTestId("row");
    expect(row).toHaveAttribute("role", "button");
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.keyDown(row, { key: " " });
    expect(open).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(screen.getByText("Pill"), { key: "Enter" });
    expect(open).toHaveBeenCalledTimes(2);
  });
});
