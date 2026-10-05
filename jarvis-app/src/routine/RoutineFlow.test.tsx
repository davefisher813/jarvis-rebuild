// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { RoutineService } from "./RoutineService";
import { subscribeToast } from "../shared/toast";
import RoutineFlow from "./RoutineFlow";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
    fireEvent.click(await screen.findByRole("button", { name: "Add Protected Time" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "Add Protected Time" }));
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
      fireEvent.click(await screen.findByRole("button", { name: "Add Protected Time" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "Add Protected Time" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "Add Protected Time" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "Add Protected Time" }));
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

// A BUTTON NEVER STANDS ALONE IN A BOX, AND ADD LIVES IN THE HEAD (Dave 2026-10-05, locked; catalog rule 12). Protected Time's
// Add was a row-act at the foot of its own card (and, with no blocks, a card holding nothing but it); the failed read's retry sat
// alone in a grey plate; a learned rhythm's Update Routine was a pill on its row. Each is checked on the DOM of the real page.
describe("RoutineFlow: clean rows, the Add is in the section head (2026-10-05)", () => {
  const mount = (id: string) => render(
    <NotesProvider userId={id}>
      <CaptureRoutine />
      <RoutineFlow onBack={() => {}} />
    </NotesProvider>,
  );

  it("with no blocks the section is its head and the capsule, with no card drawn round it", async () => {
    const { container } = mount("u-routine-head-empty");
    const add = await screen.findByRole("button", { name: "Add Protected Time" });
    expect(add.closest(".sh2")).not.toBeNull();
    expect(add.className).toContain("pill-action");
    const head = add.closest(".sh2")!;
    expect(head.querySelector(".t")!.textContent).toBe("Protected Time");
    // Nothing between this head and the next one but the crafted empty state (a glyph, a title, one line): no plate round the
    // capsule, which stays in the head (D9, 2026-10-05).
    const next = head.nextElementSibling!;
    expect(next.classList.contains("empty-state")).toBe(true);
    expect(next.querySelector(".empty-title")!.textContent).toBe("Nothing Protected Yet");
    expect(next.querySelector("button")).toBeNull();
    expect(add.textContent).toBe("Add");
    expect(container.querySelectorAll(".card .row-act, .card .pill-act").length).toBe(0);
  });

  it("with blocks the card holds only their rows, the Add stays in the head, and the row keeps its door", async () => {
    const { container } = mount("u-routine-head-rows");
    fireEvent.click(await screen.findByRole("button", { name: "Add Protected Time" }));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "deep work" } });
    fireEvent.click(screen.getByText("Add Block"));
    const row = await screen.findByText("Deep Work"); // a typed title is shown in Title Case, stored as typed
    await waitFor(async () => expect((await routineRef!.get()).protectedBlocks!.map((b) => b.label)).toEqual(["deep work"]));
    expect(row.closest(".card")!.querySelectorAll(".row-act, .pill-act, .btn-sm").length).toBe(0);
    expect(screen.getAllByRole("button", { name: "Add Protected Time" }).every((b) => b.closest(".sh2") !== null)).toBe(true);
    expect(container.querySelectorAll(".card .row-act").length).toBe(0);
  });

  it("the failed read keeps its card, with words of its own beside Try Again", async () => {
    const spy = vi.spyOn(RoutineService.prototype, "get").mockRejectedValueOnce(new Error("offline"));
    try {
      const { container } = mount("u-routine-loadfail-words");
      const retry = await screen.findByText("Try Again");
      const box = retry.closest(".empty-state")!;
      expect(box.textContent).toContain("Couldn't Load Your Routine");
      expect(container.querySelectorAll(".row-act").length).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});

// A TIME LOOKS LIKE SOMETHING YOU CAN TAP (Dave 2026-10-05, the review: Your Routine's times were text beside a clock glyph, and only the
// glyph said they could be changed). Every time on the page sits in the same quiet well a typed name does, at the width of the time. And
// the head reads "PROTECTED TIME" in full in both themes: its capsule is "Add", the same in both, so the title never gets squeezed.
describe("RoutineFlow: times are wells, and the Protected Time head never squeezes its title (2026-10-05)", () => {
  it("every time field on the page is a well, with weekends' two in a card of their own", async () => {
    const { container } = render(
      <NotesProvider userId="u-routine-wells"><CaptureRoutine /><RoutineFlow onBack={() => {}} /></NotesProvider>,
    );
    await screen.findByRole("button", { name: "Add Protected Time" });
    const times = () => [...container.querySelectorAll<HTMLInputElement>("input[type=time]")];
    expect(times()).toHaveLength(4);
    for (const t of times()) expect(t.className).toBe("set-field set-field-well set-field-time");
    fireEvent.click(screen.getByRole("switch", { name: "Different hours on weekends" }));
    await waitFor(() => expect(times()).toHaveLength(6));
    for (const t of times()) expect(t.className).toContain("set-field-well");
    // The toggle is its own card and the two weekend times are another (the page grew under the thumb with no rhythm).
    const toggleCard = container.querySelector("[role=switch]")!.closest(".card")!;
    expect(toggleCard.querySelector("input[type=time]")).toBeNull();
    expect(toggleCard.parentElement!.nextElementSibling!.querySelectorAll("input[type=time]")).toHaveLength(2);
  });

  it("the Protected Time head's capsule is the short word the title does not need said twice, and it keeps its full name for a screen reader", async () => {
    const { container } = render(
      <NotesProvider userId="u-routine-short-cap"><CaptureRoutine /><RoutineFlow onBack={() => {}} /></NotesProvider>,
    );
    const add = await screen.findByRole("button", { name: "Add Protected Time" });
    expect(add.textContent).toBe("Add");
    const head = add.closest(".sh2")!;
    expect(head.querySelector(".t")!.textContent).toBe("Protected Time");
    expect(container.querySelector(".sh2 .t")!.getAttribute("style")).toBeNull();
  });

  it("the stylesheet gives the time well its own width, and never a light-only size", () => {
    const css = ["components.css", "ruled.css"].map((f) => readFileSync(join(process.cwd(), "src/styles", f), "utf8")).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => m[1]!.split(",").some((s) => s.trim() === ".ruled .set-field.set-field-well.set-field-time")).map((m) => m[2]!).join(" ");
    expect(rule).toMatch(/flex:\s*0 0 auto/);
    expect(rule).toMatch(/max-width:\s*none/);
    expect(css).not.toMatch(/\[data-theme="light"\][^{}]*\.set-field[^{}]*\{[^}]*font-size/);
    expect(css).not.toMatch(/\[data-theme="light"\][^{}]*\.sh2 \.t[^{}]*\{[^}]*font-size/);
  });
});
