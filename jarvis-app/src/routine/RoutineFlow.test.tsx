// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { RoutineService } from "./RoutineService";
import { subscribeToast } from "../shared/toast";
import RoutineFlow from "./RoutineFlow";

// BRAIN-F-12 (2026-09-05): routine.get() had no catch, so one failed read
// left every field on this page disabled forever, with no message and no way
// to ask again short of leaving the tab.

describe("RoutineFlow load failure (BRAIN-F-12)", () => {
  it("says the read failed and offers Try Again, which loads the routine", async () => {
    const seen: string[] = [];
    const stop = subscribeToast((t) => { if (t) seen.push(t.message); });
    const spy = vi.spyOn(RoutineService.prototype, "get").mockRejectedValueOnce(new Error("offline"));
    try {
      render(
        <NotesProvider userId="u-routine-f12">
          <RoutineFlow onBack={() => {}} />
        </NotesProvider>,
      );
      await waitFor(() => expect(screen.getByText("Try Again")).toBeInTheDocument());
      expect(seen).toContain("Couldn't load · Check your connection");
      expect(screen.getByLabelText("Wake up")).toBeDisabled();

      fireEvent.click(screen.getByText("Try Again"));
      await waitFor(() => expect(screen.queryByText("Try Again")).not.toBeInTheDocument());
      expect(screen.getByLabelText("Wake up")).not.toBeDisabled();
    } finally {
      spy.mockRestore();
      stop();
    }
  });
});

// BRAIN-F-25 (2026-09-05): tapping Clear on the iOS time picker hands back an
// empty string, which the old parser read as 0, so Wake Up silently became
// 12:00 AM and the planner's day started at midnight.
describe("RoutineFlow time fields (BRAIN-F-25)", () => {
  it("a cleared time keeps the time it had, it does not become midnight", async () => {
    render(
      <NotesProvider userId="u-routine-f25">
        <RoutineFlow onBack={() => {}} />
      </NotesProvider>,
    );
    const wake = await screen.findByLabelText("Wake up");
    await waitFor(() => expect(wake).not.toBeDisabled());
    const before = (wake as HTMLInputElement).value;
    expect(before).not.toBe("00:00");

    fireEvent.change(wake, { target: { value: "" } });
    expect((screen.getByLabelText("Wake up") as HTMLInputElement).value).toBe(before);
    // And Save stays where it was: nothing was edited, so nothing is dirty.
    expect(screen.getByText("Saved")).toBeInTheDocument();

    // A real pick still lands.
    fireEvent.change(screen.getByLabelText("Wake up"), { target: { value: "05:30" } });
    expect((screen.getByLabelText("Wake up") as HTMLInputElement).value).toBe("05:30");
  });
});
