// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { act } from "@testing-library/react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import TasksPage from "./screens/TasksPage";
import type { TaskItem } from "./TasksService";
import type { TaskFilter } from "./filters";
import { setCategoryRegistry } from "../shared/categories";

setCategoryRegistry([
  { id: "orgB", name: "Ridgeley", color: "sky" },
  { id: "elite", name: "Elite", color: "red" },
  { id: "family", name: "Family", color: "pink" },
  { id: "money", name: "Money", color: "yellow" },
  { id: "health", name: "Health", color: "green" },
  { id: "brain", name: "Brain", color: "blue" },
  { id: "friends", name: "Friends", color: "teal" },
]);


const tk = (id: string, due: string | null, cat = "orgB"): TaskItem => ({ id, data: { text: id, category: cat, done: false, due } });
const counts: Record<TaskFilter, number> = { all: 6, daily: 0, today: 2, overdue: 1, upcoming: 3, done: 1 };

describe("TasksPage", () => {
  it("the head is one line of menus: the view with its count, then the area, then the grouping", () => {
    const { container } = render(
      <TasksPage filter="today" counts={counts} items={[tk("a", "2026-05-20")]} today="2026-05-20"
        categories={[{ id: "orgB", name: "Ridgeley", color: "sky" }]} />,
    );
    // Fewer Buttons (2026-09-02): no chip rows anywhere on the page.
    expect(container.querySelector(".chip-row")).toBeNull();
    const dds = container.querySelectorAll(".dd-line .dd");
    expect([...dds].map((d) => d.getAttribute("aria-label"))).toEqual(["Show", "Area", "Group by"]);
    expect(dds[0]).toHaveClass("dd-lead");
    expect(dds[0]).toHaveTextContent("Today1");
    // The counts the chips carried live inside the view menu.
    fireEvent.click(dds[0]!);
    const items = screen.getAllByRole("menuitemradio");
    expect(items.map((i) => i.textContent)).toEqual(["All6", "Daily0", "Today2", "Overdue1", "Upcoming3", "Done1"]);
    expect(screen.getByRole("menuitemradio", { name: /Today/ })).toHaveAttribute("aria-checked", "true");
  });

  it("picking from the view menu fires the filter and closes the menu", () => {
    const onFilter = vi.fn();
    const { container } = render(<TasksPage filter="today" counts={counts} items={[]} today="2026-05-20" onFilter={onFilter} />);
    fireEvent.click(container.querySelector(".dd-lead")!);
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Overdue/ }));
    expect(onFilter).toHaveBeenCalledWith("overdue");
    expect(screen.queryByRole("menu")).toBeNull();
    // The current option is a no-op pick.
    fireEvent.click(container.querySelector(".dd-lead")!);
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Today/ }));
    expect(onFilter).toHaveBeenCalledTimes(1);
  });

  it("the area menu names areas with their dots, and All Areas leads", () => {
    const onCat = vi.fn();
    const { container } = render(
      <TasksPage filter="all" counts={counts} items={[]} today="2026-05-20" catFilter="orgB" onCatFilter={onCat}
        categories={[{ id: "orgB", name: "Ridgeley", color: "sky" }, { id: "money", name: "Money", color: "yellow" }]} />,
    );
    const area = container.querySelector('.dd[aria-label="Area"]')!;
    expect(area).toHaveTextContent("Ridgeley");
    expect(area.querySelector(".cat-dot.cat-bg-sky")).toBeTruthy();
    fireEvent.click(area);
    expect(screen.getAllByRole("menuitemradio").map((i) => i.textContent)).toEqual(["All Areas", "Ridgeley", "Money"]);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "All Areas" }));
    expect(onCat).toHaveBeenCalledWith("all");
    // Unfiltered, the capsule names the control, like Group beside it.
    const { container: c2 } = render(<TasksPage filter="all" counts={counts} items={[]} today="2026-05-20" catFilter="all" categories={[{ id: "orgB", name: "Ridgeley", color: "sky" }]} />);
    expect(c2.querySelector('.dd[aria-label="Area"]')).toHaveTextContent(/^Area$/);
  });

  it("one decision killer: Pick One alone, full width; the mode's way out replaces it", () => {
    const onPickOne = vi.fn();
    const { container, rerender } = render(<TasksPage filter="all" counts={counts} items={[tk("a", null)]} today="2026-05-20" onPickOne={onPickOne} />);
    expect(container.querySelectorAll(".pick-one .btn")).toHaveLength(1);
    expect(container.querySelector(".pick-one .btn")).toHaveClass("btn-primary", "btn-block");
    expect(container.textContent).not.toContain("Just This One");
    rerender(<TasksPage filter="all" counts={counts} items={[tk("a", null)]} today="2026-05-20" onPickOne={onPickOne} overwhelmed onCalm={() => {}} />);
    expect(container.querySelector(".pick-one .btn")).toHaveTextContent("Show Everything");
    // The head states the mode and carries no menu.
    expect(container.querySelector(".dd-line .dd-static")).toHaveTextContent("Just This One");
    expect(container.querySelectorAll(".dd-line button")).toHaveLength(0);
  });

  it("the notice rides as the first row of the first card", () => {
    const { container } = render(
      <TasksPage filter="all" counts={counts} items={[tk("a", null)]} today="2026-05-20"
        notice={<div className="pad-x"><div className="notice-swipe"><div className="card notice-card">Keeps sliding</div></div></div>} />,
    );
    const card = container.querySelector(".list-card-ruled")!;
    expect(card.firstElementChild).toHaveClass("pad-x");
    expect(card.querySelector(".pad-x + .task-swipe")).toBeTruthy();
    // With an empty list the notice still has a card of its own, above the empty state.
    const empty = render(<TasksPage filter="today" counts={counts} items={[]} today="2026-05-20" notice={<div className="pad-x">n</div>} />).container;
    expect(empty.querySelector(".list-card-ruled .pad-x")).toBeTruthy();
    expect(empty.querySelector(".empty-state")).toBeTruthy();
  });

  // ONE ROW PER TASK (Dave 2026-09-02: "'email Danielle' shows up twice,
  // kill the bug"). The task that keeps sliding is its own row, first, with
  // the sliding line in the warning ink and First Step in place of Start;
  // it is not ALSO in its group.
  it("the stalled task is one row, hoisted first, with its line and its pill", () => {
    const onFirst = vi.fn();
    const { container } = render(
      <TasksPage filter="today" counts={counts} items={[tk("a", "2026-05-20"), tk("b", "2026-05-20"), tk("c", "2026-05-20")]} today="2026-05-20"
        onStartTask={() => {}}
        stalled={{ id: "b", line: "Keeps sliding \u00b7 Pushed 5 times", action: { label: "First Step", onClick: onFirst } }} />,
    );
    const names = [...container.querySelectorAll(".task-row .task-name")].map((e) => e.textContent);
    expect(names).toEqual(["b", "a", "c"]);
    expect(names.filter((n) => n === "b")).toHaveLength(1);
    const row = container.querySelector(".task-row")!;
    expect(row.querySelector(".r-goal.r-stalled")).toHaveTextContent("Keeps sliding");
    expect(row.querySelector(".task-check")).toBeTruthy();
    const pill = row.querySelector(".pill-act")!;
    expect(pill).toHaveTextContent("First Step");
    fireEvent.click(pill);
    expect(onFirst).toHaveBeenCalled();
    expect([...container.querySelectorAll(".pill-act")].map((e) => e.textContent)).toEqual(["First Step", "Start", "Start"]);
  });

  it("renders the ruled row: neutral ring, the parent's glyph, distance chip", () => {
    const { container } = render(
      <TasksPage filter="today" counts={counts} items={[tk("over", "2026-05-18"), tk("due", "2026-05-20")]} today="2026-05-20"
        parentOf={(t) => ({ kind: "category", name: "Ridgeley", tone: "cat-fg-sky", pct: null })} />,
    );
    // Ruled 2026-09-01: the ring is never category-coloured. 2026-09-02:
    // the second line opens with the parent's glyph in its colour; the bar
    // is gone.
    expect(container.querySelector(".task-check[class*=cat-bd]")).toBeNull();
    expect(container.querySelector(".r-bar")).toBeNull();
    expect(container.querySelector(".r-parent .r-pg.cat-fg-sky .r-pdot")).toBeTruthy();
    // The chip says the distance, in the late colour.
    expect(container.querySelector(".uchip.u-late")).toHaveTextContent("2 DAYS LATE");
    // LAW 11 (2026-08-29): TODAY never renders on the filter named for it,
    // so the due-today row wears no chip here...
    expect(container.querySelector(".uchip.u-today")).toBeNull();
    // ...and with no goal, the second line names the category, plainly.
    expect(container.querySelector(".r-goal.r-parent")).toHaveTextContent("Ridgeley");
    expect(container.querySelector(".r-is-goal")).toBeNull();
  });

  it("shows the TODAY chip where it carries information (the All filter)", () => {
    const { container } = render(
      <TasksPage filter="all" counts={counts} items={[tk("due", "2026-05-20")]} today="2026-05-20" />,
    );
    // ...and wears it as a chip everywhere the filter does not already say it.
    expect(container.querySelector(".uchip.u-today")).toHaveTextContent("TODAY");
  });

  it("the parent's own glyph leads the line: pie for a project, target for a goal, dot for a category", () => {
    const { container } = render(
      <TasksPage filter="all" counts={counts} items={[tk("a", null), tk("b", null), tk("c", null, "")]} today="2026-05-20"
        parentOf={(t) => (t.id === "a" ? { kind: "goal", name: "Get Paid On Time", tone: "cat-fg-yellow", pct: null }
          : t.id === "b" ? { kind: "project", name: "Kitchen remodel", tone: "cat-fg-sky", pct: 40 } : null)} />,
    );
    const lines = container.querySelectorAll(".r-goal.r-parent");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveTextContent("Get Paid On Time");
    expect(lines[0]!.querySelector(".r-pg.cat-fg-yellow .r-gm")).toBeTruthy();
    expect(lines[1]).toHaveTextContent("Kitchen remodel");
    expect(lines[1]!.querySelector(".r-pg.cat-fg-sky .pp")).toBeTruthy();
    // No parent at all: the plain words, no glyph.
    expect(container.querySelectorAll(".r-goal.r-cat")).toHaveLength(1);
    expect(container.querySelector(".r-goal.r-cat")).toHaveTextContent("No category");
  });

  it("rows ride inside one card, under a head whose menus name the cut and carry group-by", () => {
    const { container } = render(
      <TasksPage filter="all" counts={counts} items={[tk("a", "2026-05-18", "money"), tk("b", null, "family")]} today="2026-05-20"
        goalOf={(t) => (t.id === "a" ? "Get Paid On Time" : null)} />,
    );
    expect(container.querySelectorAll(".list-card-ruled")).toHaveLength(1);
    expect(container.querySelectorAll(".list-card-ruled .task-row")).toHaveLength(2);
    expect(container.querySelector(".dd-lead")).toHaveTextContent("All2");
    const group = () => container.querySelector('.dd[aria-label="Group by"]')!;
    expect(group()).toHaveTextContent("Group");
    // Open the menu, group by area: two cards under two heads, and the
    // capsule says what it is grouped by.
    fireEvent.click(group());
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Area" }));
    expect(container.querySelectorAll(".list-card-ruled")).toHaveLength(2);
    expect([...container.querySelectorAll(".grp-head")].map((h) => h.textContent)).toEqual(["Money1", "Family1"]);
    expect(group()).toHaveTextContent("By Area");
    // By goal: the goalless bucket comes last.
    fireEvent.click(group());
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Goal" }));
    expect([...container.querySelectorAll(".grp-head")].map((h) => h.textContent)).toEqual(["Get Paid On Time1", "No goal1"]);
    // Back to none, for the next test: the memory is session-wide.
    fireEvent.click(group());
    fireEvent.click(screen.getByRole("menuitemradio", { name: "None" }));
  });

  it("shows an empty state when the filter has no items", () => {
    const { container } = render(<TasksPage filter="done" counts={{ all: 0, daily: 0, today: 0, overdue: 0, upcoming: 0, done: 0 }} items={[]} today="2026-05-20" />);
    expect(container.querySelector(".empty-state")).toBeTruthy();
  });

  it("fires onToggle after the completion animation window (optimistic check)", () => {
    vi.useFakeTimers();
    const onToggle = vi.fn();
    const { container } = render(<TasksPage filter="today" counts={counts} items={[tk("a", "2026-05-20")]} today="2026-05-20" onToggle={onToggle} />);
    fireEvent.click(container.querySelector(".task-check") as HTMLElement);
    // check flips immediately (optimistic), burst plays, toggle is held 600ms
    expect(container.querySelector(".task-check.done")).toBeTruthy();
    expect(container.querySelector(".burst")).toBeTruthy();
    expect(onToggle).not.toHaveBeenCalled();
    // a second tap during the window is ignored (no double toggle)
    fireEvent.click(container.querySelector(".task-check") as HTMLElement);
    vi.advanceTimersByTime(700);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith("a");
    vi.useRealTimers();
  });

  it("un-completing fires immediately with no ceremony", () => {
    const onToggle = vi.fn();
    const doneTask: TaskItem = { id: "d", data: { text: "d", category: "orgB", done: true, due: "2026-05-20" } };
    const { container } = render(<TasksPage filter="done" counts={counts} items={[doneTask]} today="2026-05-20" onToggle={onToggle} />);
    fireEvent.click(container.querySelector(".task-check") as HTMLElement);
    expect(onToggle).toHaveBeenCalledWith("d");
  });
});

// S6-Q39 (2026-09-05): "a project cannot adopt a task you already have."
// Bulk-filing an existing selection into a project from the Tasks page's
// own multi-select bar.
describe("TasksPage bulk select: Move to Project (S6-Q39)", () => {
  // The select bar portals into the shell's host.
  function withSelectHost() {
    const host = document.createElement("div");
    host.id = "select-bar-host";
    document.body.appendChild(host);
    return () => host.remove();
  }

  // The bar itself, and everything in it, portals to document.body (via the
  // host above), not into the render's own container -- so it is read off
  // `document`, the same way notes.test.tsx's own SelectBar assertions do.
  it("stays off the bar entirely when there are no projects", () => {
    const cleanup = withSelectHost();
    render(
      <TasksPage filter="all" counts={counts} items={[tk("a", null)]} today="2026-05-20"
        onDeleteMany={() => {}} onMoveMany={() => {}} projects={[]} />,
    );
    fireEvent.click(screen.getByText("Select"));
    expect(document.querySelector(".select-bar")).toBeTruthy();
    expect(document.querySelector(".select-move")).toBeNull();
    cleanup();
  });

  it("bulk-files the whole selection into the picked project, then closes selection", () => {
    const cleanup = withSelectHost();
    const onMoveMany = vi.fn();
    render(
      <TasksPage filter="all" counts={counts} items={[tk("a", null), tk("b", null)]} today="2026-05-20"
        onDeleteMany={() => {}} onMoveMany={onMoveMany}
        projects={[{ id: "p1", title: "Kitchen Remodel" }]} />,
    );
    fireEvent.click(screen.getByText("Select"));
    fireEvent.click(screen.getByText("Select All"));
    fireEvent.click(document.querySelector(".select-move .dd")!);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Kitchen Remodel" }));
    expect(onMoveMany).toHaveBeenCalledWith(["a", "b"], "p1");
    // Selection closes after the move, same as Delete and Mark Done.
    expect(document.querySelector(".select-bar")).toBeNull();
    cleanup();
  });

  it("reads as inert (not hidden) at zero selection, matching Delete's own treatment", () => {
    const cleanup = withSelectHost();
    render(
      <TasksPage filter="all" counts={counts} items={[tk("a", null)]} today="2026-05-20"
        onDeleteMany={() => {}} onMoveMany={() => {}}
        projects={[{ id: "p1", title: "Kitchen Remodel" }]} />,
    );
    fireEvent.click(screen.getByText("Select"));
    expect(document.querySelector(".select-move")).toHaveClass("select-move-off");
    cleanup();
  });
});

// B6 / B8 (2026-08-23): editing and adding without leaving the list.
describe("TasksPage editing in place", () => {
  // Dave 2026-08-24: "when I tap to edit a task it now edits the text
  // instead... it's WAY more important that I can easily click and edit the
  // tasks." B6 gave the title's TAP to InlineEdit, and the test that shipped
  // with it asserted exactly that, so the suite was holding the complaint in
  // place. The title is the biggest thing on the row and what a thumb aims
  // for when the intent is "open this". The tap opens; rename is the hold.
  const hold = (el: Element) => {
    fireEvent.touchStart(el, { touches: [{ clientX: 10, clientY: 10 }] });
    act(() => { vi.advanceTimersByTime(500); });
    fireEvent.touchEnd(el);
  };

  it("tapping the title opens the editor, because that is what a tap means", () => {
    const onOpenTask = vi.fn();
    const onRenameTask = vi.fn();
    const { container } = render(
      <TasksPage filter="today" counts={counts} items={[tk("a", "2026-05-20")]} today="2026-05-20"
        onRenameTask={onRenameTask} onOpenTask={onOpenTask} />,
    );
    const title = container.querySelector(".task-name")!;
    // Not editable at rest: nothing to fall into.
    expect(title.getAttribute("contenteditable")).not.toBe("true");
    fireEvent.click(title);
    expect(onOpenTask).toHaveBeenCalledWith("a");
    expect(onRenameTask).not.toHaveBeenCalled();
  });

  it("holding the title renames it where it stands", () => {
    vi.useFakeTimers();
    const onRenameTask = vi.fn();
    const onOpenTask = vi.fn();
    const { container } = render(
      <TasksPage filter="today" counts={counts} items={[tk("a", "2026-05-20")]} today="2026-05-20"
        onRenameTask={onRenameTask} onOpenTask={onOpenTask} />,
    );
    hold(container.querySelector(".task-name")!);
    const field = container.querySelector('[contenteditable="true"]')!;
    expect(field).toBeTruthy();
    field.textContent = "Renamed";
    fireEvent.blur(field);
    expect(onRenameTask).toHaveBeenCalledWith("a", "Renamed");
    // The hold must not ALSO open the sheet: one gesture, one outcome.
    expect(onOpenTask).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("a done task is not renamable, so the hold does nothing", () => {
    vi.useFakeTimers();
    const onRenameTask = vi.fn();
    const done = { ...tk("a", "2026-05-20"), data: { ...tk("a", "2026-05-20").data, done: true } } as TaskItem;
    const { container } = render(
      <TasksPage filter="today" counts={counts} items={[done]} today="2026-05-20" onRenameTask={onRenameTask} />,
    );
    hold(container.querySelector(".task-name")!);
    expect(container.querySelector('[contenteditable="true"]')).toBeNull();
    vi.useRealTimers();
  });

  it("keeps the rest of the row opening the full editor", () => {
    const onOpenTask = vi.fn();
    const { container } = render(
      <TasksPage filter="today" counts={counts} items={[tk("a", "2026-05-20")]} today="2026-05-20"
        onRenameTask={() => {}} onOpenTask={onOpenTask} />,
    );
    fireEvent.click(container.querySelector(".r-k")!);
    expect(onOpenTask).toHaveBeenCalledWith("a");
  });

  it("does not save an empty title or an unchanged one", () => {
    const onRenameTask = vi.fn();
    const { container } = render(
      <TasksPage filter="today" counts={counts} items={[tk("a", "2026-05-20")]} today="2026-05-20"
        onRenameTask={onRenameTask} />,
    );
    const title = container.querySelector(".task-name")!;
    title.textContent = "   ";
    fireEvent.blur(title);
    expect(onRenameTask).not.toHaveBeenCalled();
  });

  it("ends the list with the way to grow it, and never as a second red fill", () => {
    const onNew = vi.fn();
    const { container } = render(
      <TasksPage filter="today" counts={counts} items={[tk("a", "2026-05-20")]} today="2026-05-20" onNew={onNew} />,
    );
    const add = container.querySelector(".row-act")!;
    expect(add).toHaveTextContent("Add a Task");
    expect(add.className).not.toContain("btn-primary");
    fireEvent.click(add);
    expect(onNew).toHaveBeenCalled();
  });

  it("offers no trailing add on the done list", () => {
    const { container } = render(
      <TasksPage filter="done" counts={counts} items={[tk("a", "2026-05-20")]} today="2026-05-20" onNew={() => {}} />,
    );
    expect(container.querySelector(".row-act")).toBeNull();
  });
});
