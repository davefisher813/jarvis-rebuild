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
    expect(container.querySelectorAll("input")).toHaveLength(1);
    expect(container.textContent).not.toMatch(/cal|gram|protein|carb/i);
  });
});
