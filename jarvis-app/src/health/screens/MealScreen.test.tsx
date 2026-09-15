// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import MealScreen from "./MealScreen";

// Health Push D, H-42 (2026-09-12): a meal is a line of text.
const NOW = new Date("2026-09-13T12:30:00").getTime();

describe("MealScreen", () => {
  it("logs the trimmed text, on the button or on Enter, and never with nothing typed", () => {
    const onLog = vi.fn();
    render(<MealScreen today={[]} onLog={onLog} onBack={() => {}} />);
    const field = screen.getByLabelText("What you ate");
    expect(screen.getByRole("button", { name: "Log It" })).toBeDisabled();
    fireEvent.change(field, { target: { value: "  Eggs and toast " } });
    fireEvent.click(screen.getByRole("button", { name: "Log It" }));
    expect(onLog).toHaveBeenCalledWith("Eggs and toast");
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    fireEvent.change(field, { target: { value: "Apple" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onLog).toHaveBeenLastCalledWith("Apple");
  });

  it("lists today's meals with the clock and Undo, except a pending one", () => {
    const onUndo = vi.fn();
    render(<MealScreen today={[
      { id: "a", data: { category: "fuel", at: NOW - 3_600_000, text: "Oats" } },
      { id: "pending-0", pending: true, data: { category: "fuel", at: NOW - 60_000, text: "Banana" } },
    ]} onLog={() => {}} onUndo={onUndo} onBack={() => {}} />);
    expect(screen.getByText("Oats")).toBeInTheDocument();
    expect(screen.getByText("Banana")).toBeInTheDocument();
    const undos = screen.getAllByRole("button", { name: /^Undo/ });
    expect(undos).toHaveLength(1);
    fireEvent.click(undos[0]!);
    expect(onUndo).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });

  it("carries no nutrition field of any kind", () => {
    const { container } = render(<MealScreen today={[]} onLog={() => {}} onBack={() => {}} />);
    // 2026-09-14: the text and the When clock, and nothing else.
    expect([...container.querySelectorAll("input")].map((i) => i.type)).toEqual(["text", "time"]);
    expect(container.textContent).not.toMatch(/cal|gram|protein|carb/i);
  });
});

// 2026-09-14: a recent meal fills the field, and a changed time rides along.
describe("MealScreen: recent meals and When", () => {
  it("a recent chip fills the field, and the time is passed only when changed", () => {
    const onLog = vi.fn();
    render(<MealScreen today={[]} recent={["Chicken and rice", "Oats"]} onLog={onLog} onBack={() => {}} />);
    fireEvent.click(screen.getByText("Oats"));
    expect((screen.getByLabelText("What you ate") as HTMLInputElement).value).toBe("Oats");
    fireEvent.change(screen.getByLabelText("When"), { target: { value: "12:30" } });
    fireEvent.click(screen.getByText("Log It"));
    expect(onLog).toHaveBeenCalledTimes(1);
    expect(onLog.mock.calls[0]![0]).toBe("Oats");
    expect(new Date(onLog.mock.calls[0]![1] as number).getHours()).toBe(12);
  });
  // Row tap (Dave 2026-09-15, "I want all rows clickable"): a logged meal
  // fills the field; Undo on the same row undoes and fills nothing.
  it("a tap on a logged meal fills the field, and Undo does not", () => {
    const onUndo = vi.fn();
    render(<MealScreen today={[{ id: "a", data: { category: "fuel", at: NOW - 3_600_000, text: "Oats" } }]} onLog={() => {}} onUndo={onUndo} onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Undo Oats" }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("What you ate")).toHaveValue("");
    fireEvent.click(screen.getByText("Oats"));
    expect(screen.getByLabelText("What you ate")).toHaveValue("Oats");
    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});
