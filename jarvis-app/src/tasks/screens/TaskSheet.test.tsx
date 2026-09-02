// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import TaskSheet, { type SheetCategory } from "./TaskSheet";

const CATS: SheetCategory[] = [
  { id: "c1", name: "Work", color: "blue" },
  { id: "c2", name: "Money", color: "yellow" },
];
const DAY = 86400000;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = iso(new Date());
const tomorrow = iso(new Date(Date.now() + DAY));

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
