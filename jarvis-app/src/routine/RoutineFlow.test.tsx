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
