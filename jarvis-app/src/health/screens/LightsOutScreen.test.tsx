// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import LightsOutScreen from "./LightsOutScreen";

// Health Push D, H-41 (2026-09-12): Edit Time on the last bedtime.
const AT = new Date("2026-09-12T23:40:00").getTime();

describe("LightsOutScreen: Edit Time", () => {
  it("writes the clock on the same night, and nothing else", () => {
    const onEditTime = vi.fn();
    render(<LightsOutScreen last={{ id: "l1", data: { category: "sleep", at: AT } }} onLog={() => {}} onEditTime={onEditTime} onBack={() => {}} />);
    // CLEAN ROW (Dave 2026-10-05): no Edit Time capsule; the row itself is the door to the time.
    expect(screen.queryByRole("button", { name: "Edit Time" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/^Sat/).closest(".row")!);
    // A DRAFT, WRITTEN BY SAVE (2026-10-17): a time wheel fires change while it
    // is still turning, so the change itself is never the write.
    fireEvent.change(screen.getByLabelText("Bedtime time"), { target: { value: "23:15" } });
    expect(onEditTime).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onEditTime).toHaveBeenCalledTimes(1);
    expect(onEditTime).toHaveBeenCalledWith("l1", new Date("2026-09-12T23:15:00").getTime());
  });

  it("Cancel on the draft writes nothing and closes the editor", () => {
    const onEditTime = vi.fn();
    render(<LightsOutScreen last={{ id: "l1", data: { category: "sleep", at: AT } }} onLog={() => {}} onEditTime={onEditTime} onBack={() => {}} />);
    fireEvent.click(screen.getByText(/^Sat/).closest(".row")!);
    fireEvent.change(screen.getByLabelText("Bedtime time"), { target: { value: "22:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onEditTime).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Bedtime time")).toBeNull();
  });

  it("offers no way to edit a row still on its way to the store, or without a seam", () => {
    const { rerender, container } = render(<LightsOutScreen last={{ id: "pending-0", pending: true, data: { category: "sleep", at: AT } }} onLog={() => {}} onEditTime={() => {}} onBack={() => {}} />);
    expect(container.querySelector(".card .row .chev")).toBeNull();
    rerender(<LightsOutScreen last={{ id: "l1", data: { category: "sleep", at: AT } }} onLog={() => {}} onBack={() => {}} />);
    expect(container.querySelector(".card .row .chev")).toBeNull();
  });

  it("the tap still logs, and there is still no duration anywhere on the screen", () => {
    const onLog = vi.fn();
    const { container } = render(<LightsOutScreen last={null} onLog={onLog} onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Lights Out" }));
    expect(onLog).toHaveBeenCalled();
    expect(container.textContent).not.toMatch(/hours|duration|slept/i);
  });
});

// 2026-09-14: last night's hours, a separate entry from the bedtime mark.
describe("LightsOutScreen: sleep from last night", () => {
  it("saves hours and minutes for the night ending, and lists recent sleep", () => {
    const onLogSleep = vi.fn();
    render(<LightsOutScreen last={null} onLog={() => {}} onLogSleep={onLogSleep} recentSleep={[{ date: "2026-09-12", hours: 8 }]} onBack={() => {}} />);
    expect(screen.getByText("Sleep")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "45" }));
    fireEvent.change(screen.getByLabelText("Night ending"), { target: { value: "2026-09-13" } });
    fireEvent.click(screen.getByText("Save Sleep"));
    // The form opened on last night's 8h (rule 7, 2026-10-17), and 45 was picked on top of it.
    expect(onLogSleep).toHaveBeenCalledWith(8.75, "2026-09-13");
    // Casing sweep 1 (2026-09-26): Title Case by the whole rule (§H2), units spelled "Min".
    expect(screen.getByText("8h")).toBeInTheDocument();
  });

  // REPEAT-LAST IS ONE TAP (the Logging Standard, rule 7, 2026-10-17): a night
  // like the last is Save Sleep alone.
  it("opens on last night's hours and minutes, so a night like it is one tap; the seed stands only before the first entry", () => {
    const onLogSleep = vi.fn();
    const { unmount } = render(<LightsOutScreen last={null} onLog={() => {}} onLogSleep={onLogSleep}
      recentSleep={[{ date: "2026-09-10", hours: 6 }, { date: "2026-09-12", hours: 7.25 }, { date: "2026-09-11", hours: 9 }]} onBack={() => {}} />);
    expect(screen.getByLabelText("Hours")).toHaveTextContent("7");
    expect(screen.getByRole("button", { name: "15" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByText("Save Sleep"));
    expect(onLogSleep).toHaveBeenCalledWith(7.25, expect.any(String));
    unmount();
    render(<LightsOutScreen last={null} onLog={() => {}} onLogSleep={() => {}} onBack={() => {}} />);
    expect(screen.getByLabelText("Hours")).toHaveTextContent("7");
    expect(screen.getByRole("button", { name: "30" })).toHaveAttribute("aria-pressed", "true");
  });
});
