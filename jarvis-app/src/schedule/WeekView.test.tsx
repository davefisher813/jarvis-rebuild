// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import ScheduleFlow from "./ScheduleFlow";

describe("Schedule views", () => {
  it("Week shows a 7-day strip; Day hides the month grid", async () => {
    const { container } = render(<NotesProvider userId="u1"><ScheduleFlow /></NotesProvider>);
    // SPEC MOVED (Library chassis 2026-08-18): the title renders twice
    // (large + condensed bar); wait on the pair.
    await screen.findAllByText("Schedule");
    // SCHEDULE AUDIT 2026-08-29: the tab lands on DAY now (the timeline is
    // the daily question; the month grid is the browsing one), so no grid
    // and no week strip until asked for.
    expect(container.querySelector(".cal-grid")).toBeFalsy();
    fireEvent.click(screen.getByText("Month"));
    await waitFor(() => expect(container.querySelector(".cal-grid")).toBeTruthy());
    fireEvent.click(screen.getByText("Week"));
    await waitFor(() => expect(container.querySelectorAll(".wk-cell").length).toBe(7));
    fireEvent.click(screen.getByText("Day"));
    await waitFor(() => {
      expect(container.querySelector(".cal-grid")).toBeFalsy();
      expect(container.querySelector(".week-strip")).toBeFalsy();
    });
  });
});
