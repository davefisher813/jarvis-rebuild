// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import TaskSheet, { type SheetCategory } from "./TaskSheet";

const CATS: SheetCategory[] = [
  { id: "c1", name: "Work", color: "blue" },
  { id: "c2", name: "Money", color: "yellow" },
];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = iso(new Date());
const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return iso(d); })();

describe("TaskSheet", () => {
  it("new mode: header, no delete, empty field", () => {
    render(<TaskSheet mode="new" categories={CATS} onSave={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("New Task")).toBeInTheDocument();
    expect(screen.queryByText("Delete Task")).not.toBeInTheDocument();
  });

  it("blocks save on empty text, shows error, then saves trimmed", () => {
    const onSave = vi.fn();
    render(<TaskSheet mode="new" categories={CATS} onSave={onSave} onCancel={() => {}} />);
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Add a task name.")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("What needs doing?"), { target: { value: "  Pay rent  " } });
    fireEvent.click(screen.getByText("Save"));
    // Default category is NONE (2026-08-09): first-in-list silently mis-tagged.
    expect(onSave).toHaveBeenCalledWith({ text: "Pay rent", category: "", due: "", repeat: "" });
  });

  // THE VALUE ON THE RIGHT (Brain and the Task Sheet, 2026-09-02): Area is
  // a row whose value opens the Tasks head's own dropdown, many at once.
  it("the area value opens a menu; a pick adds the area, wears its dot, and stays open for more", () => {
    const onSave = vi.fn();
    render(<TaskSheet mode="new" categories={CATS} onSave={onSave} onCancel={() => {}} />);
    const area = screen.getByLabelText("Area");
    expect(area.textContent).toContain("None"); // honest default (2026-08-09)
    expect(area).toHaveClass("dd-off");
    fireEvent.click(area);
    // every option keeps its dot, picked or not; None leads
    expect(document.querySelectorAll(".hmenu-item .cat-dot")).toHaveLength(CATS.length);
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Money/ }));
    expect(document.querySelector(".hmenu"), "the menu stays open for a second area").toBeTruthy();
    expect(screen.getByRole("menuitemcheckbox", { name: /Money/ }).getAttribute("aria-checked")).toBe("true");
    expect(area.textContent).toContain("Money");
    expect(area.querySelector(".cat-dot.cat-bg-yellow")).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Work/ }));
    expect(area.textContent).toContain("Money +1");
    expect(screen.getByText("Money is the main one")).toBeInTheDocument();
    fireEvent.click(document.querySelector(".hmenu-scrim")!);
    expect(document.querySelector(".hmenu")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("What needs doing?"), { target: { value: "X" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith({ text: "X", category: "c2", extraCategories: ["c1"], due: "", repeat: "" });
  });

  it("the due value opens a menu and Today sets the date", () => {
    const onSave = vi.fn();
    render(<TaskSheet mode="new" categories={CATS} onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("What needs doing?"), { target: { value: "X" } });
    fireEvent.click(screen.getByLabelText("Due"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Today" }));
    expect(document.querySelector(".hmenu"), "a single pick closes the menu").toBeNull();
    expect(screen.getByLabelText("Due").textContent).toContain("Today");
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith({ text: "X", category: "", due: today, repeat: "" });
  });

  it("Pick a Date shows the date row under Due", () => {
    render(<TaskSheet mode="new" categories={CATS} onSave={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByLabelText("Due"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Pick a Date" }));
    const date = screen.getByLabelText("Due date") as HTMLInputElement;
    expect(date.type).toBe("date");
    fireEvent.change(date, { target: { value: "2026-12-24" } });
    expect(screen.getByLabelText("Due").textContent).toContain("Dec 24");
  });

  // TWO DAYS A WEEK IT DID NOTHING AT ALL (bug found 2026-09-03; this suite
  // had been failing on Thursdays and getting waved through as flake).
  //
  // Pick a Date seeds today+2 as a starting value, and the mode was read
  // back OFF that date. From a Thursday, today+2 is the Saturday that "This
  // Weekend" already means; from a Saturday it is the Monday "Next Week"
  // means. On those two days the derivation answered with the preset, the
  // date row it gates never appeared, and the menu quietly moved itself to
  // an option the user had not picked. The clock is what made it flicker.
  //
  // Fake timers pin a real Thursday and a real Saturday so both faces of it
  // are held down, on every day of the week the suite happens to run.
  for (const [dayName, when] of [["a Thursday", "2026-09-03"], ["a Saturday", "2026-09-05"]] as const) {
    it(`Pick a Date still opens the date row on ${dayName}, when today+2 lands on another option`, () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(`${when}T09:00:00`));
      try {
        render(<TaskSheet mode="new" categories={CATS} onSave={() => {}} onCancel={() => {}} />);
        fireEvent.click(screen.getByLabelText("Due"));
        fireEvent.click(screen.getByRole("menuitemradio", { name: "Pick a Date" }));
        const date = screen.getByLabelText("Due date") as HTMLInputElement;
        expect(date.type).toBe("date");
        // And the menu still reads as the user's own choice, not the preset
        // its seed date collides with.
        expect(screen.getByLabelText("Due").textContent).not.toContain("Weekend");
        expect(screen.getByLabelText("Due").textContent).not.toContain("Next Week");
      } finally {
        vi.useRealTimers();
      }
    });
  }

  // LIFE-F-12 (2026-09-05): the presets added a fixed 86,400,000ms per day,
  // and the clocks-back Sunday has 25 hours, so under America/New_York on
  // 2026-11-01 Tomorrow and Next Week both meant today and This Weekend
  // meant Friday. Pinned to that Sunday morning in that zone.
  it("Tomorrow, This Weekend and Next Week step calendar days on the clocks-back Sunday", () => {
    const prevTz = process.env.TZ;
    process.env.TZ = "America/New_York";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T00:30:00")); // a Sunday, before the 2am fall-back
    try {
      const pick = (name: string) => {
        const onSave = vi.fn();
        const view = render(<TaskSheet mode="new" categories={CATS} onSave={onSave} onCancel={() => {}} />);
        fireEvent.change(screen.getByPlaceholderText("What needs doing?"), { target: { value: "X" } });
        fireEvent.click(screen.getByLabelText("Due"));
        fireEvent.click(screen.getByRole("menuitemradio", { name }));
        fireEvent.click(screen.getByText("Save"));
        view.unmount();
        return (onSave.mock.calls[0]![0] as { due: string }).due;
      };
      expect(pick("Tomorrow")).toBe("2026-11-02");
      expect(pick("This Weekend")).toBe("2026-11-07");
      expect(pick("Next Week")).toBe("2026-11-02");
    } finally {
      vi.useRealTimers();
      process.env.TZ = prevTz;
    }
  });

  it("a preset picked after the date wheel wins it back", () => {
    render(<TaskSheet mode="new" categories={CATS} onSave={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByLabelText("Due"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Pick a Date" }));
    expect(screen.getByLabelText("Due date")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Due"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Tomorrow" }));
    expect(screen.queryByLabelText("Due date")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Due").textContent).toContain("Tomorrow");
  });

  // B12's fix (MoneyFlow's Account/Payday sheets), generalized: Save used to
  // fire onSave every tap, so a fast double-tap wrote the task twice. The
  // button's own label flips to "Saving" on the first tap -- one query for
  // the button, clicked twice, is what a fast real double-tap looks like.
  it("a fast double-tap on Save only fires once, and the button says so", () => {
    const onSave = vi.fn();
    render(<TaskSheet mode="new" categories={CATS} onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("What needs doing?"), { target: { value: "Pay rent" } });
    const save = screen.getByText("Save");
    fireEvent.click(save);
    expect(save).toHaveTextContent("Saving");
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("edit mode: prefilled, delete present and fires", () => {
    const onDelete = vi.fn();
    render(
      <TaskSheet
        mode="edit"
        initial={{ text: "Send Invoice", category: "c2", due: tomorrow }}
        categories={CATS}
        onSave={() => {}}
        onDelete={onDelete}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText("Edit Task")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Send Invoice")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Delete Task"));
    expect(onDelete).toHaveBeenCalled();
  });
});

describe("editing a task that owns a plan (2026-08-25)", () => {
  const PLAN = { cue: { kind: "after" as const, what: "Lunch" }, then: "send the invoice" };
  const OTHERS = [
    { id: "t1", text: "Send Invoice", plan: PLAN },
    { id: "t2", text: "Walk the dog", plan: { cue: { kind: "after" as const, what: "Dinner" }, then: "walk" } },
  ];

  it("does not report the task as clashing with itself", () => {
    render(
      <TaskSheet
        mode="edit"
        selfId="t1"
        initial={{ text: "Send Invoice", category: "c1", due: "", repeat: "", plan: PLAN }}
        otherPlans={OTHERS}
        categories={CATS}
        onSave={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByText('"Send Invoice" already starts there')).not.toBeInTheDocument();
  });

  it("still reports a real clash with a DIFFERENT task on the same cue", () => {
    render(
      <TaskSheet
        mode="edit"
        selfId="t2"
        initial={{ text: "Walk the dog", category: "c1", due: "", repeat: "", plan: { cue: { kind: "after", what: "lunch" }, then: "walk" } }}
        otherPlans={OTHERS}
        categories={CATS}
        onSave={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText('"Send Invoice" already starts there')).toBeInTheDocument();
  });

  it("an untouched edit keeps the plan instead of silently erasing it", () => {
    const onSave = vi.fn();
    render(
      <TaskSheet
        mode="edit"
        selfId="t1"
        initial={{ text: "Send Invoice", category: "c1", due: "", repeat: "", plan: PLAN }}
        otherPlans={OTHERS}
        categories={CATS}
        onSave={onSave}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]![0].plan).toEqual(PLAN);
  });
});

// LINKED NOTES (Dave 2026-08-28, "very very easy to connect things"): the
// same "Linked Notes" section Person/Project/Goal detail already show,
// brought to the task sheet. Add a Note is "born connected" (PICK 27's
// pattern), not a picker.
describe("TaskSheet linked notes", () => {
  const NOTES = [{ id: "n1", title: "Renewal Terms", category: "c1" }];

  it("stays hidden on a brand new task -- there's no id yet to link against", () => {
    render(<TaskSheet mode="new" categories={CATS} onSave={() => {}} onCancel={() => {}} onAddNote={() => {}} />);
    expect(screen.queryByText("Linked Notes")).not.toBeInTheDocument();
  });

  it("stays hidden in edit mode when there's nothing to show and no way to add one", () => {
    render(<TaskSheet mode="edit" initial={{ text: "X", category: "c1", due: "", repeat: "" }} categories={CATS} onSave={() => {}} onCancel={() => {}} />);
    expect(screen.queryByText("Add a Note")).not.toBeInTheDocument();
  });

  it("lists linked notes and opens one on tap", () => {
    const onOpenNote = vi.fn();
    render(
      <TaskSheet mode="edit" initial={{ text: "X", category: "c1", due: "", repeat: "" }} categories={CATS}
        onSave={() => {}} onCancel={() => {}} linkedNotes={NOTES} onOpenNote={onOpenNote} />,
    );
    // A note is a row in the More group (the grouped sheet, 2026-09-02).
    expect(screen.getByText("Renewal Terms").closest(".xs-row")).toBeTruthy();
    fireEvent.click(screen.getByText("Renewal Terms"));
    expect(onOpenNote).toHaveBeenCalledWith("n1");
  });

  it("Add a Note fires even with nothing linked yet -- the row that solves the problem is the one that should always show up", () => {
    const onAddNote = vi.fn();
    render(
      <TaskSheet mode="edit" initial={{ text: "X", category: "c1", due: "", repeat: "" }} categories={CATS}
        onSave={() => {}} onCancel={() => {}} onAddNote={onAddNote} />,
    );
    fireEvent.click(screen.getByText("Add a Note"));
    expect(onAddNote).toHaveBeenCalled();
  });
});

// STEPS (2026-09-04, "isn't there supposed to be an option to assign steps
// to a task? I don't see that"). A checklist line inside the task: add,
// check, uncheck, remove on a blank blur, and the one-tap Close offer once
// every line is checked.
describe("TaskSheet steps", () => {
  it("Add Step appends a blank line; typing and a second Add Step build the list", () => {
    render(<TaskSheet mode="new" categories={CATS} onSave={() => {}} onCancel={() => {}} />);
    expect(screen.queryByLabelText("Checklist item 1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Add Item"));
    const first = screen.getByLabelText("Checklist item 1") as HTMLInputElement;
    fireEvent.change(first, { target: { value: "Book flights" } });
    fireEvent.click(screen.getByText("Add Item"));
    const second = screen.getByLabelText("Checklist item 2") as HTMLInputElement;
    fireEvent.change(second, { target: { value: "Pack" } });
    expect(screen.getByText("0 of 2")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Book flights")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Pack")).toBeInTheDocument();
  });

  it("a blank step left on blur is removed, so no orphaned checkbox lingers", () => {
    render(<TaskSheet mode="new" categories={CATS} onSave={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByText("Add Item"));
    const step = screen.getByLabelText("Checklist item 1");
    fireEvent.change(step, { target: { value: "  " } });
    fireEvent.blur(step);
    expect(screen.queryByLabelText("Checklist item 1")).not.toBeInTheDocument();
  });

  it("a step with no text can't be checked", () => {
    render(<TaskSheet mode="new" categories={CATS} onSave={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByText("Add Item"));
    fireEvent.click(screen.getByLabelText("Mark item done"));
    expect(screen.queryByLabelText("Mark item not done")).not.toBeInTheDocument();
  });

  it("toggling a step flips the rollup count and its own label", () => {
    render(<TaskSheet mode="new" categories={CATS} onSave={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByText("Add Item"));
    fireEvent.change(screen.getByLabelText("Checklist item 1"), { target: { value: "Book flights" } });
    expect(screen.getByText("0 of 1")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Mark item done"));
    expect(screen.getByText("1 of 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Mark item not done")).toBeInTheDocument();
  });

  it("Remove step deletes it outright", () => {
    render(<TaskSheet mode="new" categories={CATS} onSave={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByText("Add Item"));
    fireEvent.change(screen.getByLabelText("Checklist item 1"), { target: { value: "Book flights" } });
    fireEvent.click(screen.getByLabelText("Remove item"));
    expect(screen.queryByDisplayValue("Book flights")).not.toBeInTheDocument();
  });

  it("a new task saves its steps, trimmed, alongside everything else", () => {
    const onSave = vi.fn();
    render(<TaskSheet mode="new" categories={CATS} onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("What needs doing?"), { target: { value: "Plan the trip" } });
    fireEvent.click(screen.getByText("Add Item"));
    fireEvent.change(screen.getByLabelText("Checklist item 1"), { target: { value: "  Book flights  " } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Plan the trip", steps: [{ text: "  Book flights  ", done: false }] }),
    );
  });

  it("an edited task starts from its existing steps", () => {
    render(
      <TaskSheet mode="edit" initial={{ text: "Ship it", category: "c1", due: "", repeat: "", steps: [{ text: "Write code", done: true }, { text: "Write tests", done: false }] }}
        categories={CATS} onSave={() => {}} onCancel={() => {}} />,
    );
    expect(screen.getByDisplayValue("Write code")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Write tests")).toBeInTheDocument();
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
  });

  it("no Close Task offer while steps remain unchecked", () => {
    render(
      <TaskSheet mode="edit" initial={{ text: "Ship it", category: "c1", due: "", repeat: "", steps: [{ text: "Write code", done: true }, { text: "Write tests", done: false }] }}
        categories={CATS} onSave={() => {}} onCancel={() => {}} />,
    );
    expect(screen.queryByText("Close Task")).not.toBeInTheDocument();
  });

  it("no Close Task offer on a brand new task, even with every seeded step checked", () => {
    render(
      <TaskSheet mode="new" categories={CATS} initial={{ steps: [{ text: "Write code", done: true }] }} onSave={() => {}} onCancel={() => {}} />,
    );
    expect(screen.queryByText("Close Task")).not.toBeInTheDocument();
  });

  // "Ticking the last step offers one-tap Close. It never closes the task
  // for you" (catalog spec) -- the offer appears once every line is
  // checked, and firing it saves the steps AND asks the caller to close.
  it("Close Task appears once every step is checked, and one tap saves with closeNow set", () => {
    const onSave = vi.fn();
    render(
      <TaskSheet mode="edit" initial={{ text: "Ship it", category: "c1", due: "", repeat: "", steps: [{ text: "Write code", done: false }] }}
        categories={CATS} onSave={onSave} onCancel={() => {}} />,
    );
    expect(screen.queryByText("Close Task")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Mark item done"));
    expect(screen.getByText("Checklist Complete")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Close Task"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ steps: [{ text: "Write code", done: true }], closeNow: true }),
    );
  });

  it("the ordinary Save tap never sets closeNow, even with every step checked", () => {
    const onSave = vi.fn();
    render(
      <TaskSheet mode="edit" initial={{ text: "Ship it", category: "c1", due: "", repeat: "", steps: [{ text: "Write code", done: true }] }}
        categories={CATS} onSave={onSave} onCancel={() => {}} />,
    );
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]![0].closeNow).toBeUndefined();
  });
});
