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

// BRAIN-F-06 (2026-09-05, fork option A): a block edited in this sheet used to
// live in local state until the header Save, while the same sheet on Today and
// Schedule saves on the tap. So the S5 deep link landed people in a sheet that
// looked immediate and was not: Back threw the change away in silence,
// "Duplicated Gym" appeared with nothing saved, and Delete Block came back on
// a Back and vanished for good on a Save.
import { useRoutine } from "../data/NotesProvider";

let routineRef: ReturnType<typeof useRoutine> | null = null;
function CaptureRoutine() {
  routineRef = useRoutine();
  return null;
}

describe("RoutineFlow blocks save on the tap (BRAIN-F-06)", () => {
  it("Add Block writes through, and Back cannot lose it", async () => {
    render(
      <NotesProvider userId="u-routine-f06">
        <CaptureRoutine />
        <RoutineFlow onBack={() => {}} />
      </NotesProvider>,
    );
    fireEvent.click(await screen.findByText("Add Protected Time"));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Gym" } });
    fireEvent.click(screen.getByText("Add Block"));

    // On the server, not just on the screen: no header Save was tapped.
    await waitFor(async () => {
      const saved = await routineRef!.get();
      expect((saved.protectedBlocks ?? []).map((b) => b.label)).toEqual(["Gym"]);
    });
    // And the header still reads Saved: a block write is not a pending edit.
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("Delete Block writes through and hands back an Undo that restores it", async () => {
    const seen: { message: string; onAction?: () => void }[] = [];
    const stop = subscribeToast((t) => { if (t) seen.push(t); });
    try {
      render(
        <NotesProvider userId="u-routine-f06b">
          <CaptureRoutine />
          <RoutineFlow onBack={() => {}} />
        </NotesProvider>,
      );
      fireEvent.click(await screen.findByText("Add Protected Time"));
      fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Lunch" } });
      fireEvent.click(screen.getByText("Add Block"));
      await waitFor(async () => expect((await routineRef!.get()).protectedBlocks ?? []).toHaveLength(1));

      fireEvent.click(screen.getByText(/^Lunch/));
      fireEvent.click(await screen.findByText("Delete Block"));
      await waitFor(async () => expect((await routineRef!.get()).protectedBlocks ?? []).toHaveLength(0));

      const toast = seen[seen.length - 1]!;
      expect(toast.message).toBe("Block deleted");
      toast.onAction!();
      await waitFor(async () => {
        const saved = await routineRef!.get();
        expect((saved.protectedBlocks ?? []).map((b) => b.label)).toEqual(["Lunch"]);
      });
    } finally {
      stop();
    }
  });
});
