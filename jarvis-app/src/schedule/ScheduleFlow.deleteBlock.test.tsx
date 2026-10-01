// @vitest-environment jsdom
//
// DELETE BLOCK ASKS FIRST, ON THE SCHEDULE DOOR (Dave, 2026-10-01). The block
// sheet's Delete Block used to remove the protected time at once. These drive
// the real tab: the button opens a confirm, Cancel changes nothing, and the
// confirm deletes and hands back an Undo.
import { describe, it, expect } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useRoutine } from "../data/NotesProvider";
import type { RoutineService } from "../routine/RoutineService";
import { DEFAULT_ROUTINE } from "../routine/types";
import ScheduleFlow from "./ScheduleFlow";
import { subscribeToast } from "../shared/toast";

// Tomorrow only, so the row is never in the collapsed past whatever hour the
// suite runs at; the test steps to it with Next.
const TOMORROW = [(new Date().getDay() + 1) % 7];

function setup(user: string): { get: () => RoutineService } {
  let svc: RoutineService | null = null;
  function Gate() {
    const routine = useRoutine();
    const [ready, setReady] = useState(false);
    useEffect(() => {
      svc = routine;
      void routine
        .save({
          ...DEFAULT_ROUTINE,
          protectedBlocks: [{ id: "lunch", label: "Lunch", startMin: 12 * 60, endMin: 13 * 60, days: TOMORROW, kind: "meal" }],
        })
        .then(() => setReady(true));
    }, [routine]);
    return ready ? <ScheduleFlow /> : null;
  }
  render(<NotesProvider userId={user}><Gate /></NotesProvider>);
  return { get: () => svc! };
}

async function openDeleteConfirm() {
  fireEvent.click(await screen.findByLabelText("Next", undefined, { timeout: 4000 }));
  fireEvent.click(await screen.findByText("Lunch"));
  const sheet = await screen.findByText("Edit Protected Time");
  expect(sheet).toBeInTheDocument();
  fireEvent.click(await screen.findByRole("radio", { name: "Every Day" }));
  fireEvent.click(await screen.findByText("Delete Block"));
  return screen.findByRole("dialog", { name: "Delete Lunch" });
}

describe("Schedule: Delete Block on the block sheet asks first", () => {
  it("opens a confirm, and Cancel leaves the block and the sheet alone", async () => {
    const t = setup("u-delblock-cancel");
    const dialog = await openDeleteConfirm();
    expect((await t.get().get()).protectedBlocks).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Delete Lunch" })).toBeNull());
    expect((await t.get().get()).protectedBlocks).toHaveLength(1);
    expect(screen.getByText("Edit Protected Time")).toBeInTheDocument();
  });

  it("the confirm deletes it and the toast's Undo brings it back", async () => {
    const seen: { message: string; onAction?: () => void }[] = [];
    const stop = subscribeToast((x) => { if (x) seen.push(x); });
    try {
      const t = setup("u-delblock-confirm");
      const dialog = await openDeleteConfirm();
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete Block" }));
      await waitFor(async () => expect((await t.get().get()).protectedBlocks ?? []).toHaveLength(0));
      const toast = seen[seen.length - 1]!;
      expect(toast.message).toBe("Lunch deleted");
      toast.onAction!();
      await waitFor(async () => expect((await t.get().get()).protectedBlocks ?? []).toHaveLength(1));
    } finally {
      stop();
    }
  });
});
