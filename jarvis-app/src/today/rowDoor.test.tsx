// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import OtherChoicesSheet from "./OtherChoicesSheet";

vi.mock("../events", () => ({ emit: vi.fn() }));

// THE WHOLE ROW IS THE DOOR (Dave 2026-09-15: "I want all rows clickable").
describe("row door", () => {
  afterEach(cleanup);
  const choices = [{ id: "t1", text: "Call the bank", facts: "15 Min" }];

  it("opens the task from anywhere on the row, and Start keeps its own verb", () => {
    const onOpen = vi.fn();
    const onStart = vi.fn();
    render(<OtherChoicesSheet offeredId="t0" choices={choices} onStart={onStart} onOpen={onOpen} onClose={() => {}} />);
    const row = screen.getByText("Call the bank").closest(".row") as HTMLElement;
    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledWith("t1");
    fireEvent.click(screen.getByText("15 Min"));
    expect(onOpen).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(onStart).toHaveBeenCalledWith("t1");
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("answers Enter on the row, but not Enter on the pill inside it", () => {
    const onOpen = vi.fn();
    render(<OtherChoicesSheet offeredId="t0" choices={choices} onStart={() => {}} onOpen={onOpen} onClose={() => {}} />);
    const row = screen.getByText("Call the bank").closest(".row") as HTMLElement;
    fireEvent.keyDown(screen.getByRole("button", { name: "Start" }), { key: "Enter" });
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith("t1");
  });
});
