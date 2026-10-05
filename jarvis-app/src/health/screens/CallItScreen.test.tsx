// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import CallItScreen from "./CallItScreen";

// Health Push D, H-45 (2026-09-12): the two ends named, and a Skip that
// logs nothing.
describe("CallItScreen", () => {
  it("names Easy and All Out under the blocks", () => {
    const { container } = render(<CallItScreen history={[]} onLog={() => {}} onBack={() => {}} />);
    const ends = container.querySelector(".rpe-ends");
    expect(ends?.textContent).toBe("EasyAll Out");
    expect(screen.getAllByRole("button", { name: /^Effort \d+ of 10$/ })).toHaveLength(10);
  });

  it("Skip goes back and logs nothing", () => {
    const onLog = vi.fn();
    const onBack = vi.fn();
    render(<CallItScreen history={[]} onLog={onLog} onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(onBack).toHaveBeenCalled();
    expect(onLog).not.toHaveBeenCalled();
  });

  it("a block logs its number", () => {
    const onLog = vi.fn();
    render(<CallItScreen history={[]} onLog={onLog} onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Effort 7 of 10" }));
    expect(onLog).toHaveBeenCalledWith(7);
    expect(screen.getByText("Logged 7 Of 10")).toBeInTheDocument();
  });

  // THE CATALOG (Dave 2026-10-05): a day is said in words ("Sep 3"), never the phone's numeric "9/3/2026".
  it("recent sessions name their day in words", () => {
    const { container } = render(<CallItScreen history={[{ at: new Date(2026, 8, 3, 18, 0).getTime(), rpe: 6 }]} onLog={() => {}} onBack={() => {}} />);
    const titles = Array.from(container.querySelectorAll(".row .conn-name")).map((n) => n.textContent);
    expect(titles).toEqual(["Sep 3"]);
  });
});
