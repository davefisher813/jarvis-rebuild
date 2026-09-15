// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import LaterSheet from "./LaterSheet";

// E-28 (Push H): Later asks when, in three answers.
describe("LaterSheet", () => {
  it("Tonight is today, Tomorrow is tomorrow, Pick a Day saves the day picked", () => {
    const onPick = vi.fn();
    const { unmount } = render(<LaterSheet who="Wei Chang" today="2026-09-12" onPick={onPick} onClose={() => {}} />);
    expect(screen.getByText("Come back to Wei Chang")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Tonight"));
    expect(onPick).toHaveBeenLastCalledWith({ due: "2026-09-12", when: "tonight" });
    fireEvent.click(screen.getByText("Tomorrow"));
    expect(onPick).toHaveBeenLastCalledWith({ due: "2026-09-13", when: "tomorrow" });
    fireEvent.click(screen.getByText("Pick a Day"));
    fireEvent.change(screen.getByLabelText("Day"), { target: { value: "2026-09-20" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onPick).toHaveBeenLastCalledWith({ due: "2026-09-20", when: "day" });
    unmount();
  });
  it("the scrim closes without picking", () => {
    const onPick = vi.fn(); const onClose = vi.fn();
    render(<LaterSheet who="Wei" today="2026-09-12" onPick={onPick} onClose={onClose} />);
    fireEvent.click(document.querySelector(".sheet-scrim")!);
    expect(onClose).toHaveBeenCalled();
    expect(onPick).not.toHaveBeenCalled();
  });
  // Dave 2026-09-15: "I want all rows clickable".
  it("the Pick a Day row's own tap focuses the date field and picks nothing", () => {
    const onPick = vi.fn();
    render(<LaterSheet who="Wei" today="2026-09-12" onPick={onPick} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Pick a Day"));
    fireEvent.click(screen.getByText("Pick a Day"));
    expect(screen.getByLabelText("Day")).toHaveFocus();
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByText("Save"), { key: "Enter" });
    expect(onPick).not.toHaveBeenCalled();
  });
});
