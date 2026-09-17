// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useTasks, useCategories, useNotes, usePeople } from "../data/NotesProvider";
import type { TasksService } from "./TasksService";
import type { NotesService } from "../notes/NotesService";
import TasksFlow from "./TasksFlow";
import { todayISO } from "./grouping";
import { subscribeToast } from "../shared/toast";

// UP-MIND-01 class (2026-09-07): MessageDraftSheet has accepted `voice`
// since PeopleFlow started passing it; this door (a task's own "Text
// <name>" row) never gathered it and never passed it. Mocked here so the
// prop reaching the sheet can be asserted directly, the same way a defect
// with no visible DOM trace has to be caught.
const draftProps: { voice?: string }[] = [];
vi.mock("../people/MessageDraftSheet", () => ({
  default: (props: { voice?: string }) => { draftProps.push(props); return null; },
}));

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
      await waitFor(() => expect(rowNamed("Email Sam")).toBeInTheDocument());
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
    await waitFor(() => expect(rowNamed("Create Calder invoice")).toBeInTheDocument());
    fireEvent.click(rowNamed("Create Calder invoice"));
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
    // AMENDED 2026-09-17 (Unified Headers): Area moved from a capsule under
    // the head into the options sheet, the one place all five pages keep
    // their Area, Sort, Group and secondary tools. Same control, same menu.
    fireEvent.click(screen.getByLabelText("Tasks Options"));
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

// LIFE-F-13 (2026-09-05): the Set Aside receipt ended in the fixed string
// "Nothing overdue" while everything 1 to 14 days late was still sitting in
// the Overdue filter. The count is read off the reloaded list now.

const toasts: string[] = [];

function daysAgo(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function SeededAncient() {
  const tasks = useTasks();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      await tasks.createTask("Ancient paperwork", { due: daysAgo(40) });
      await tasks.createTask("Call the roofer", { due: daysAgo(3) });
      setReady(true);
    })();
  }, [tasks]);
  return ready ? <TasksFlow openFilter="overdue" /> : null;
}

describe("TasksFlow set aside receipt (LIFE-F-13)", () => {
  it("names what is still overdue instead of claiming nothing is", async () => {
    localStorage.removeItem("jarvis.setaside.last");
    const stop = subscribeToast((t) => { if (t) toasts.push(t.message); });
    try {
      render(<NotesProvider userId="aside-life-13"><SeededAncient /></NotesProvider>);
      await waitFor(() => expect(toasts.some((m) => m.startsWith("Set aside"))).toBe(true));
      expect(toasts.find((m) => m.startsWith("Set aside"))).toBe("Set aside 1 quiet task · 1 still overdue");
    } finally {
      stop();
    }
  });
});

function SeededTextPerson() {
  const tasks = useTasks();
  const people = usePeople();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      const pid = (await people.create({ name: "Nadia Brandt", group: "contacts", phone: "555-0101" }))!;
      await tasks.createTask("Confirm the venue", { due: todayISO(), personId: pid });
      setReady(true);
    })();
  }, [tasks, people]);
  return ready ? <TasksFlow /> : null;
}

// START NOW (2026-09-16): A Place to Begin names the top-picked task above
// the list, so a task can legitimately appear twice on this screen. These
// tests are about the ROW, so they ask for the row.
const rowNamed = (name: string) =>
  screen.getAllByText(name).find((el) => !el.classList.contains("start-top-name")) as HTMLElement;

describe("TasksFlow: the task's Text door hands the sheet a real voice (UP-MIND-01 class)", () => {
  it("gathers How You Write before the sheet opens, same as every other door", async () => {
    draftProps.length = 0;
    render(<NotesProvider userId="text-voice-tasks"><SeededTextPerson /></NotesProvider>);
    await waitFor(() => expect(rowNamed("Confirm the venue")).toBeInTheDocument());
    fireEvent.click(rowNamed("Confirm the venue"));
    fireEvent.click(await screen.findByText("Text Nadia Brandt"));
    await waitFor(() => expect(draftProps.length).toBeGreaterThan(0));
    // BEFORE the fix, MessageDraftSheet was never even passed a voice prop
    // (personSheet's about carried the task text, nothing else). AFTER,
    // gatherContext + voiceToText resolve to at least the identity line
    // every real context carries.
    await waitFor(() => expect(draftProps.at(-1)!.voice).toMatch(/^User: /));
  });
});

// ---------------------------------------------------------------------------
// DAVE, 2026-09-17: "the huge start now container is the same for all of the
// pages. Like setting up Jarvis has NOTHING to do with emails."
//
// A Place to Begin read `parts.all` on every view, so the card sitting on top
// of seven email tasks proposed a task from somewhere else entirely -- the
// same card, the same suggestion, whichever chip was chosen.
// ---------------------------------------------------------------------------
let twoSvc: TasksService | null = null;

function TwoViews() {
  const tasks = useTasks();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      const soon = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);
      await tasks.createTask("Set up everything on jarvis", { due: todayISO() });
      await tasks.createTask("Book the Bridge venue", { due: soon });
      // isFromEmail reads `source.type`, not `source.kind` -- an open task
      // with this stamp lands in From Email whatever the email-home setting
      // says (filters.partition), which is the view Dave was looking at.
      await tasks.createTask("Get back to Google: Security alert", { due: todayISO(), source: { type: "email", ref: "m1", ts: Date.now() } });
      twoSvc = tasks;
      setReady(true);
    })();
  }, []);
  return ready ? <TasksFlow /> : null;
}

describe("A Place to Begin picks out of the view you are looking at", () => {
  it("proposes a task from the chosen view, not one from somewhere else", async () => {
    twoSvc = null;
    render(<NotesProvider userId="start-per-view"><TwoViews /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("A Place to Begin")).toBeInTheDocument(), { timeout: 4000 });
    const cardName = () => document.querySelector(".start-top-name")?.textContent ?? "";
    // Today holds the one due today, so that is what the card is about.
    await waitFor(() => expect(cardName()).toContain("Set up everything on jarvis"), { timeout: 4000 });

    // Upcoming holds the other one. The card follows.
    fireEvent.click(screen.getByRole("tab", { name: /Upcoming/ }));
    await waitFor(() => expect(cardName()).toContain("Book the Bridge venue"), { timeout: 4000 });
    expect(cardName(), "the card is about the list it is sitting on").not.toContain("jarvis");
    void twoSvc;
  });

  // The exact view in Dave's screenshot: seven email tasks with a card on top
  // proposing something from somewhere else.
  it("proposes an email task on From Email, never one from somewhere else", async () => {
    render(<NotesProvider userId="start-per-view-3"><TwoViews /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("A Place to Begin")).toBeInTheDocument(), { timeout: 4000 });
    const cardName = () => document.querySelector(".start-top-name")?.textContent ?? "";
    fireEvent.click(screen.getByRole("tab", { name: /From Email/ }));
    await waitFor(() => expect(cardName()).toContain("Get back to Google"), { timeout: 4000 });
    expect(cardName(), "setting up Jarvis has nothing to do with emails").not.toContain("jarvis");
  });

  // Done has no open task in it, so topPick returns null and the card is
  // simply gone -- the page does not have to remember to hide it.
  it("says nothing on a view with nothing startable in it", async () => {
    render(<NotesProvider userId="start-per-view-2"><TwoViews /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("A Place to Begin")).toBeInTheDocument(), { timeout: 4000 });
    fireEvent.click(screen.getByRole("tab", { name: /Done/ }));
    await waitFor(() => expect(screen.queryByText("A Place to Begin")).toBeNull(), { timeout: 4000 });
  });
});
