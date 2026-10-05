// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
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
      // Casing sweep 3 (2026-09-27): Title Case by the whole rule (§H2); durations through shared/duration ("45 Min", "About 1 Min").
      expect(seen).toContain("Couldn't Load · Check Your Connection");
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

  it("Cancel on the Delete Block confirm keeps the block", async () => {
    render(
      <NotesProvider userId="u-routine-f06b-cancel">
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
    const dialog = await screen.findByRole("dialog", { name: "Delete Lunch" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Delete Lunch" })).toBeNull());
    expect((await routineRef!.get()).protectedBlocks ?? []).toHaveLength(1);
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
      // The button only asks. Nothing is deleted until the confirm sheet says so.
      const dialog = await screen.findByRole("dialog", { name: "Delete Lunch" });
      expect((await routineRef!.get()).protectedBlocks ?? []).toHaveLength(1);
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete Block" }));
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

// 2026-09-26: a protected-time row states its hours and its days, and both
// must show. The facts go straight into the settings Row's own .conn-meta,
// which wraps unclamped, never a one-line .facts whose day list was cut
// mid-word with the place dropped behind it.
describe("RoutineFlow protected time: the row shows every fact", () => {
  it("puts the facts straight in the wrapping meta line", async () => {
    render(
      <NotesProvider userId="u-routine-meta">
        <CaptureRoutine />
        <RoutineFlow onBack={() => {}} />
      </NotesProvider>,
    );
    fireEvent.click(await screen.findByText("Add Protected Time"));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Gym" } });
    fireEvent.click(screen.getByText("Add Block"));
    await waitFor(async () => expect((await routineRef!.get()).protectedBlocks ?? []).toHaveLength(1));

    const row = (await screen.findByText(/^Gym/)).closest(".set-row") as HTMLElement;
    expect(row.querySelector(".facts"), "never the one-line facts row").toBeNull();
    const meta = row.querySelector(".conn-meta")!;
    const facts = Array.from(meta.children);
    expect(facts.length).toBeGreaterThanOrEqual(2);
    for (const f of facts) expect(f.classList.contains("fact")).toBe(true);
    // The hours and the days are neutral small caps.
    expect(facts.filter((f) => f.classList.contains("date"))).toHaveLength(2);
    expect(meta.textContent).not.toContain("·");
  });
});

// THE NOTE UNDER THE FREE-CHANNEL CHIPS FOLLOWS THEM (2026-10-04). It read "A
// call fits · Typing does not" whatever was picked, so turning Hands on still
// said no typing and a gym with only ears free still said a call fits.
describe("RoutineFlow Can Blend: the note says what the chips mean", () => {
  it("changes with the channels picked", async () => {
    render(
      <NotesProvider userId="u-routine-blend-note">
        <CaptureRoutine />
        <RoutineFlow onBack={() => {}} />
      </NotesProvider>,
    );
    fireEvent.click(await screen.findByText("Add Protected Time"));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Drive" } });
    // The kind chip, not the preset of the same name above the form.
    fireEvent.click(screen.getByRole("button", { name: "Commute", pressed: false }));
    // A commute defaults to Can Blend with the mouth and ears free.
    expect(screen.getByText("A call fits · Typing does not")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Mouth"));
    expect(screen.getByText("Listening fits · Typing does not")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Hands"));
    expect(screen.getByText("Listening fits · Typing fits")).toBeInTheDocument();
    expect(screen.queryByText("A call fits · Typing does not")).toBeNull();
  });

  // 2026-10-05: blockFromForm tested the STORED mode, which stays null on a
  // Commute (Can Blend is its default), so the chips showed a choice that
  // never reached the saved block or the AI line.
  it("saves the channels picked on a Commute, whose Can Blend is the default", async () => {
    render(
      <NotesProvider userId="u-routine-blend-save">
        <CaptureRoutine />
        <RoutineFlow onBack={() => {}} />
      </NotesProvider>,
    );
    fireEvent.click(await screen.findByText("Add Protected Time"));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Drive" } });
    fireEvent.click(screen.getByRole("button", { name: "Commute", pressed: false }));
    fireEvent.click(screen.getByText("Mouth"));
    fireEvent.click(screen.getByText("Hands"));
    fireEvent.click(screen.getByText("Add Block"));
    await waitFor(async () => {
      const saved = await routineRef!.get();
      const b = (saved.protectedBlocks ?? []).find((x) => x.label === "Drive");
      expect(b?.kind).toBe("commute");
      expect([...(b?.free ?? [])].sort()).toEqual(["ears", "hands"]);
    });
  });
});
