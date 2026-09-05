// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useTasks, useCategories, useNotes } from "../data/NotesProvider";
import type { TasksService } from "./TasksService";
import type { NotesService } from "../notes/NotesService";
import TasksFlow from "./TasksFlow";
import { todayISO } from "./grouping";

// LIFE-F-01 (2026-09-05): "Swipe Tomorrow re-dates the task to TODAY for
// anyone east of UTC." TasksFlow computed tomorrow by serialising local
// midnight with toISOString(), which reads the UTC date; in Tokyo (UTC+9)
// local midnight of tomorrow is 15:00 UTC today, so the due date never
// moved and the toast still said "Moved to tomorrow". This renders the real
// flow under a zone east of Greenwich and presses the real button.

let captured: { svc: TasksService; id: string } | null = null;

function Seeded() {
  const tasks = useTasks();
  const cats = useCategories();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      const cid = await cats.create("Bridge", "blue");
      const id = await tasks.createTask("Email Sam", { category: cid!, due: todayISO() });
      captured = { svc: tasks, id: id! };
      setReady(true);
    })();
  }, [tasks, cats]);
  return ready ? <TasksFlow /> : null;
}

// Local wall-clock tomorrow, spelled out with getters so the expectation does
// not lean on the helper under repair.
function localTomorrow(): string {
  const d = new Date(); d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe("TasksFlow snooze (LIFE-F-01)", () => {
  it("Tomorrow lands on the next local day under Asia/Tokyo", async () => {
    const prevTz = process.env.TZ;
    process.env.TZ = "Asia/Tokyo";
    try {
      render(<NotesProvider userId="tz-life-01"><Seeded /></NotesProvider>);
      await waitFor(() => expect(screen.getByText("Email Sam")).toBeInTheDocument());
      const today = todayISO();
      const want = localTomorrow();
      expect(want).not.toBe(today);
      fireEvent.click(screen.getByRole("button", { name: "Move to tomorrow" }));
      await waitFor(async () => {
        const t = await captured!.svc.task(captured!.id);
        expect(t?.due).toBe(want);
      });
    } finally {
      process.env.TZ = prevTz;
    }
  });
});

// BROWSER-F-01 (2026-09-05): "Add a Note" on a task was a dead tap. The
// caller read the new note's id off attemptWrite, which resolves a boolean,
// so onOpenNote never fired and the note the tap made was never seen. This
// renders the real flow, opens a task and presses the real row.

let notesSvc: NotesService | null = null;
const opened: string[] = [];

function SeededForNote() {
  const tasks = useTasks();
  const notes = useNotes();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      await tasks.createTask("Create Calder invoice", { due: todayISO() });
      notesSvc = notes;
      setReady(true);
    })();
  }, [tasks, notes]);
  return ready ? <TasksFlow onOpenNote={(id) => { opened.push(id); }} /> : null;
}

describe("TasksFlow add a note (BROWSER-F-01)", () => {
  it("Add a Note opens the note it just made", async () => {
    render(<NotesProvider userId="note-life-b01"><SeededForNote /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Create Calder invoice")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create Calder invoice"));
    await waitFor(() => expect(screen.getByText("Add a Note")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Add a Note"));
    await waitFor(() => expect(opened.length).toBe(1));
    const made = await notesSvc!.note(opened[0]!);
    expect(made?.title).toBe("Create Calder invoice");
  });
});

// LIFE-F-11 (2026-09-05): with an Area filter on, the filter menu's counts,
// "Clear N Completed" and "Move All to Today" all read the unfiltered lists,
// so the label disagreed with the list and the bulk write reached tasks the
// filter was hiding. This seeds two areas and clears one of them.

let areaSvc: TasksService | null = null;

function SeededAreas() {
  const tasks = useTasks();
  const cats = useCategories();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      const work = (await cats.create("Work", "blue"))!;
      const home = (await cats.create("Home", "green"))!;
      const done = async (text: string, category: string) => {
        const id = (await tasks.createTask(text, { category, due: todayISO() }))!;
        await tasks.toggleDone(id);
      };
      await done("Work done one", work);
      await done("Work done two", work);
      await done("Home done one", home);
      await done("Home done two", home);
      await done("Home done three", home);
      areaSvc = tasks;
      setReady(true);
    })();
  }, [tasks, cats]);
  return ready ? <TasksFlow openFilter="done" /> : null;
}

describe("TasksFlow area filter (LIFE-F-11)", () => {
  it("Clear Completed counts and deletes only the area on screen", async () => {
    render(<NotesProvider userId="area-life-11"><SeededAreas /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Work done one")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Clear 5 Completed" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Area" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Work" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Clear 2 Completed" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Clear 2 Completed" }));
    await waitFor(async () => {
      const left = await areaSvc!.listTasks();
      expect(left.map((t) => t.data.text).sort()).toEqual(["Home done one", "Home done three", "Home done two"]);
    });
  });
});
