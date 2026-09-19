// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import ClassifySheet from "./ClassifySheet";
import { EMPTY_CLASS, GRIPS, type Classification } from "./classify";
import { MUSCLE_GROUPS, MUSCLE_LABEL } from "./muscles";

// ---------------------------------------------------------------------------
// DAVE, 2026-09-16, photographing this sheet:
//
//   "Pic 3 - typing cursor is all the way to the right and makes editing
//    messy. There should be button selections or dropdowns for most of this.
//    Pic 4 - needs forearms.
//    Pic 3/4 - Re-design this modal. It's ugly, has no color, could be
//    tighter and cleaner. Confusing. Poor logic. Simple, clean, organized,
//    aesthetic and ACCURATE/EFFICIENT."
//
// Five separate complaints, and each one is a fact about the rendered sheet
// rather than a matter of taste, so each one gets a test that fails if the
// sheet goes back.
// ---------------------------------------------------------------------------

const TODAY = "2026-09-17";

function open(initial: Classification = EMPTY_CLASS, extra: { askScope?: boolean } = {}) {
  const onSave = vi.fn();
  render(
    <ClassifySheet
      name="Barbell Row"
      initial={initial}
      todayIso={TODAY}
      onSave={onSave}
      onCancel={() => {}}
      {...extra}
    />,
  );
  return onSave;
}

describe("the muscle picker has every group a program trains", () => {
  it("offers Forearms", () => {
    open();
    expect(screen.getByRole("button", { name: "Forearms" })).toBeInTheDocument();
  });

  it("offers all of them, and each exactly once", () => {
    open();
    for (const m of MUSCLE_GROUPS) {
      expect(screen.getAllByRole("button", { name: MUSCLE_LABEL[m] })).toHaveLength(1);
    }
  });

  it("saves Forearms as a real primary, not a label with nowhere to go", () => {
    const onSave = open();
    fireEvent.click(screen.getByRole("button", { name: "Forearms" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave.mock.calls[0]![0].primary).toEqual(["forearms"]);
  });
});

describe("grip, stance, angle and variation answer with buttons", () => {
  it("offers the common answers as chips instead of an empty text field", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "More Details" }));
    for (const g of GRIPS) {
      expect(screen.getByRole("button", { name: `Grip ${g}` })).toBeInTheDocument();
    }
  });

  it("stores the tapped answer and clears it on a second tap", () => {
    const onSave = open();
    fireEvent.click(screen.getByRole("button", { name: "More Details" }));
    const neutral = screen.getByRole("button", { name: "Grip Neutral" });
    fireEvent.click(neutral);
    expect(screen.getByRole("button", { name: "Grip Neutral" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Grip Neutral" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave.mock.calls[0]![0].grip).toBeUndefined();
  });

  // The chips are the COMMON answers, not the only legal ones. A grip typed
  // into the old free-text row months ago still has to be readable and still
  // has to be clearable, so it rides at the end of the strip as its own chip.
  it("keeps an off-list stored answer as its own chip", () => {
    open({ ...EMPTY_CLASS, grip: "False Grip" });
    fireEvent.click(screen.getByRole("button", { name: "More Details" }));
    const own = screen.getByRole("button", { name: "Grip False Grip" });
    expect(own).toHaveAttribute("aria-pressed", "true");
  });

  it("does not print a stored answer twice when it is already on the list", () => {
    open({ ...EMPTY_CLASS, grip: "Neutral" });
    fireEvent.click(screen.getByRole("button", { name: "More Details" }));
    expect(screen.getAllByRole("button", { name: "Grip Neutral" })).toHaveLength(1);
  });
});

describe("a selection carries the colour of the question it answers", () => {
  const hueOf = (el: HTMLElement) =>
    ["chip-lime", "chip-violet", "chip-cyan"].find((h) => el.classList.contains(h));

  it("paints muscles lime, equipment violet, and the describing axes cyan", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Chest" }));
    expect(hueOf(screen.getByRole("button", { name: "Chest, primary" }))).toBe("chip-lime");

    fireEvent.click(screen.getByRole("button", { name: "Equipment Barbell" }));
    expect(hueOf(screen.getByRole("button", { name: "Equipment Barbell" }))).toBe("chip-violet");

    fireEvent.click(screen.getByRole("button", { name: "Measured as Weight × Reps" }));
    expect(hueOf(screen.getByRole("button", { name: "Measured as Weight × Reps" }))).toBe("chip-cyan");
  });

  it("gives the second muscle role the same hue at half strength, never a louder one", () => {
    open();
    const chest = () => screen.getByRole("button", { name: /^Chest/ });
    fireEvent.click(chest());
    fireEvent.click(chest());
    const el = chest();
    expect(el.className).toContain("chip-half");
    expect(el.className).toContain("chip-lime");
    // .active is the app's filled pill and belongs to the STRONGER role.
    expect(el.classList.contains("active")).toBe(false);
  });

  it("leaves an unpicked chip plain, so the colour means picked", () => {
    open();
    const el = screen.getByRole("button", { name: "Equipment Barbell" });
    expect(hueOf(el)).toBeUndefined();
  });
});

describe("the free-text rows type from the left", () => {
  it("marks every writing row so its caret does not sit at the right edge", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "More Details" }));
    for (const label of ["Gym", "Machine", "Machine ID", "Tags"]) {
      const input = screen.getByLabelText(label);
      expect(input.closest(".xs-row")).toHaveClass("xs-row-write");
    }
  });
});

describe("the sheet says things once", () => {
  it("does not title the muscle card under an eyebrow that already titles it", () => {
    open();
    expect(screen.queryByText("Muscles Worked")).toBeNull();
    expect(screen.getByText("Muscles")).toBeInTheDocument();
  });

  it("explains only the tap that is not obvious", () => {
    open();
    expect(screen.getByText("Tap twice for secondary")).toBeInTheDocument();
  });
});

describe("the scope receipt is facts, not a sentence carrying a date it stores", () => {
  it("says the window as month and day, never as the ISO string", () => {
    open({ ...EMPTY_CLASS, primary: ["back"] }, { askScope: true });
    fireEvent.click(screen.getByRole("button", { name: "Future Records" }));
    expect(screen.getByText("From Sep 17 on")).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(TODAY))).toBeNull();
  });

  // G3: the CSS draws the separator, so no string may carry one.
  it("hands the two clauses over as separate facts", () => {
    const { container } = render(
      <ClassifySheet name="Barbell Row" initial={{ ...EMPTY_CLASS, primary: ["back"] }}
        todayIso={TODAY} askScope onSave={() => {}} onCancel={() => {}} />,
    );
    void container;
    fireEvent.click(screen.getByRole("button", { name: "Existing Records" }));
    const facts = Array.from(document.querySelectorAll(".facts"))
      .find((f) => f.textContent?.includes("Up to Sep 17"));
    expect(facts).toBeTruthy();
    expect(facts!.querySelectorAll(".fact")).toHaveLength(2);
    expect(facts!.textContent).not.toContain("·");
    cleanup();
  });

  it("colours the chosen scope with the muscle hue it is a window on", () => {
    open({ ...EMPTY_CLASS, primary: ["back"] }, { askScope: true });
    const all = screen.getByRole("button", { name: "Existing and Future" });
    expect(all.className).toContain("chip-lime");
  });
});
