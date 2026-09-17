// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { readFileSync } from "node:fs";
import { posix } from "node:path";
import SetStrip from "./SetStrip";
import ExerciseSheet from "./ExerciseSheet";
import type { SetEntry } from "./types";

// ---------------------------------------------------------------------------
// DAVE, 2026-09-17, mid-workout:
//
//   "When I add a new exercise during a workout it doesn't save. It also
//    doesn't allow me to pair with another one."
//   "A new exercise renders a buggy and weird looking log box. The typing is
//    all off too."
//   "When adding a new exercise during a workout it doesn't add to my
//    exercise list and also doesn't render a modal that allows me to add all
//    the proper details."
//   "Title case it titles isn't default when I'm typing."
// ---------------------------------------------------------------------------

const { join } = posix;
const SRC = join(process.cwd().replace(/\\/g, "/"), "src");
const read = (f: string) => readFileSync(join(SRC, f), "utf8");

// ---------------------------------------------------------------------------
// THE LOG BOX. An exercise created mid-session plans no weight, so every ghost
// row opened reading "0" -- and iOS puts the caret AFTER a zero, so typing 135
// showed "0135" the whole way there. On a new lift that is every field on the
// card, which is what "the typing is all off" was.
// ---------------------------------------------------------------------------
const ghost = (over: Partial<SetEntry> = {}): SetEntry => ({ id: "g1", ...over });

function strip(g: SetEntry) {
  return render(
    <SetStrip
      kind="weight_reps" unit="lb" entries={[]} ghost={[g]} nowPos={0}
      editableGhosts onLogGhost={() => {}} onLogGhostAs={() => {}}
      onChange={() => {}}
    />,
  );
}

describe("the live log box does not print a zero nobody typed", () => {
  it("opens empty when the plan carries no weight", () => {
    strip(ghost({ r: 8 }));
    expect(screen.getByLabelText("Set 1 weight")).toHaveValue(null);
    cleanup();
  });

  it("opens empty when the plan carries no reps", () => {
    strip(ghost({ w: 135 }));
    expect(screen.getByLabelText("Set 1 reps")).toHaveValue(null);
    cleanup();
  });

  it("shows a real planned number, which is the whole point of a ghost", () => {
    strip(ghost({ w: 135, r: 5 }));
    expect(screen.getByLabelText("Set 1 weight")).toHaveValue(135);
    expect(screen.getByLabelText("Set 1 reps")).toHaveValue(5);
    cleanup();
  });

  it("says what the empty field wants, in its placeholder", () => {
    strip(ghost({ r: 8 }));
    expect(screen.getByLabelText("Set 1 weight")).toHaveAttribute("placeholder", "lb");
    expect(screen.getByLabelText("Set 1 reps")).toHaveAttribute("placeholder", "reps");
    cleanup();
  });

  it("reports what is typed into an empty field, not the zero it replaced", () => {
    const onLogGhostAs = vi.fn();
    render(
      <SetStrip kind="weight_reps" unit="lb" entries={[]} ghost={[ghost({ r: 8 })]} nowPos={0}
        editableGhosts onLogGhost={() => {}} onLogGhostAs={onLogGhostAs} onChange={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText("Set 1 weight"), { target: { value: "135" } });
    fireEvent.click(screen.getByLabelText("Log set 1"));
    expect(onLogGhostAs.mock.calls[0]![1]).toMatchObject({ w: 135, r: 8 });
    cleanup();
  });

  // The other half of the same complaint: a field already reading 135 put the
  // caret at the end, so typing 145 gave 135145.
  it("selects a prefilled number on focus, so the first keystroke replaces it", () => {
    expect(read("gym/SetStrip.tsx")).toContain("e.currentTarget.select()");
    const src = read("gym/SetStrip.tsx");
    expect((src.match(/onFocus=\{selectAll\}/g) ?? []).length, "both fields select").toBe(2);
  });
});

// ---------------------------------------------------------------------------
// WHERE THE ADD LANDS. Catalog §3.10 says a mid-session add does not touch the
// program, and that is still a real thing to want. It was the ONLY thing on
// offer, so the lift lived in one session and nowhere else.
// ---------------------------------------------------------------------------
describe("adding a lift mid-session asks where it lands", () => {
  const sheet = (alsoOnDay?: { dayName: string; value: boolean; onChange: (v: boolean) => void }) =>
    render(<ExerciseSheet mode="new" alsoOnDay={alsoOnDay} onSave={() => {}} onCancel={() => {}} />);

  it("offers the day by name, already switched on", () => {
    sheet({ dayName: "Auxiliary Day", value: true, onChange: () => {} });
    expect(screen.getByText("Add to Auxiliary Day")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Add to the day" })).toHaveAttribute("aria-checked", "true");
    cleanup();
  });

  it("says what each answer means, including the one he asked for", () => {
    sheet({ dayName: "Leg Day", value: true, onChange: () => {} });
    expect(screen.getByText("Kept for next time")).toBeInTheDocument();
    expect(screen.getByText("Can be paired")).toBeInTheDocument();
    cleanup();
    sheet({ dayName: "Leg Day", value: false, onChange: () => {} });
    expect(screen.getByText("This session only")).toBeInTheDocument();
    expect(screen.queryByText("Can be paired")).toBeNull();
    cleanup();
  });

  it("flips from the row, not only from the switch", () => {
    const onChange = vi.fn();
    sheet({ dayName: "Leg Day", value: true, onChange });
    fireEvent.click(screen.getByText("Add to Leg Day"));
    expect(onChange).toHaveBeenCalledWith(false);
    cleanup();
  });

  it("stays away entirely when there is no day to add to", () => {
    sheet(undefined);
    expect(screen.queryByRole("switch", { name: "Add to the day" })).toBeNull();
    cleanup();
  });
});

describe("the session hands the answer up, and the flow acts on all three", () => {
  it("passes whether the day was asked for", () => {
    const s = read("gym/SessionScreen.tsx");
    expect(s).toContain("onAddMidSession(draft, !!programDay && addToDay)");
    expect(s).toContain("alsoOnDay={programDay ? { dayName: programDay.name");
  });

  it("writes the live session, the day when asked, and the library either way", () => {
    const s = read("gym/GymFlow.tsx");
    expect(s).toContain("onAddMidSession={(draft, alsoOnDay) => {");
    expect(s).toContain("const week = alsoOnDay && day ? program?.data.weeks.find");
    expect(s).toContain("seedLibrary(draft);");
    // A free-text swap mints a lift too.
    expect(s).toContain("seedLibrary(sub);");
  });

  // The empty-session add had every other field and not this one, so a lift
  // that opened a session arrived unclassified and the strip stepped it by 5.
  it("carries the loading convention on BOTH mid-session add paths", () => {
    const s = read("gym/GymFlow.tsx");
    expect((s.match(/addExerciseMidSession\(l, \{[^}]*\.\.\.loadFields\(draft\)/g) ?? []).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// TITLE CASE WHILE TYPING, not only on save.
// ---------------------------------------------------------------------------
describe("a name field capitalizes as you type", () => {
  it("shifts each word and keeps the dictionary out of it", () => {
    render(<ExerciseSheet mode="new" onSave={() => {}} onCancel={() => {}} />);
    const input = screen.getByLabelText("Exercise name");
    expect(input).toHaveAttribute("autocapitalize", "words");
    expect(input).toHaveAttribute("autocorrect", "off");
    expect(input).toHaveAttribute("spellcheck", "false");
    cleanup();
  });

  it("is spent on every field that holds a name, and on none that holds a search", () => {
    for (const f of ["gym/ExerciseSheet.tsx", "gym/LibraryPage.tsx", "gym/GymFlow.tsx", "gym/ClassifySheet.tsx"]) {
      expect(read(f), f).toContain("NAME_FIELD");
    }
    // The library's own search box takes whatever case you feel like typing.
    const lib = read("gym/LibraryPage.tsx");
    const search = lib.slice(lib.indexOf('placeholder="Search Names and Aliases"') - 200, lib.indexOf('placeholder="Search Names and Aliases"'));
    expect(search).not.toContain("NAME_FIELD");
  });
});
