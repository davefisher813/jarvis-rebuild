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
import { subscribeToast, resetToasts } from "../shared/toast";
import { Store, InMemoryAdapter } from "@core";

// Phase 0 D4 (2026-10-10): trust_v1 decides what the New Task sheet's toast
// says while the Store is pending. One switch, on the seam every flagged
// test uses (connections/google/sync.test.ts); off by default, so every
// other test here runs against the build's own answer.
const flags = vi.hoisted(() => ({ trustOn: false }));
vi.mock("../substrate/flags", async (orig) => {
  const real = await orig<typeof import("../substrate/flags")>();
  return { ...real, flagOn: (f: Parameters<typeof real.flagOn>[0]) => (f === "trust_v1" ? flags.trustOn : real.flagOn(f)) };
});

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
    await waitFor(() => expect(rowNamed("Create Calder Invoice")).toBeInTheDocument());
    fireEvent.click(rowNamed("Create Calder Invoice"));
    await waitFor(() => expect(screen.getByText("Add a Note")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Add a Note"));
    await waitFor(() => expect(opened.length).toBe(1));
    const made = await notesSvc!.note(opened[0]!);
    // Shown and made in Title Case (Dave 2026-10-05), though the task was typed in lower case.
    expect(made?.title).toBe("Create Calder Invoice");
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
    await waitFor(() => expect(screen.getByText("Work Done One")).toBeInTheDocument());
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
      // Casing sweep 2 (2026-09-27): Title Case by the whole rule (§H2); durations through shared/duration ("45 Min", "1h 30m").
      await waitFor(() => expect(toasts.some((m) => m.startsWith("Set Aside"))).toBe(true));
      expect(toasts.find((m) => m.startsWith("Set Aside"))).toBe("Set Aside 1 Quiet Task · 1 Still Overdue");
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
    await waitFor(() => expect(rowNamed("Confirm the Venue")).toBeInTheDocument());
    fireEvent.click(rowNamed("Confirm the Venue"));
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
      const later = new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10);
      await tasks.createTask("Set up everything on jarvis", { due: todayISO() });
      await tasks.createTask("Book the Bridge venue", { due: soon });
      await tasks.createTask("Water the plants", { due: later });
      // isFromEmail reads `source.type`, not `source.kind` -- an open task
      // with this stamp lands in From Email whatever the email-home setting
      // says (filters.partition), which is the view Dave was looking at.
      await tasks.createTask("Get back to Google: Security alert", { due: todayISO(), source: { type: "email", ref: "m1", ts: Date.now() } });
      // A second email task, a few days behind the first, so From Email has a
      // lead rather than a tie: topPick makes no pick among equals
      // (2026-09-18, "the logic better be flawless").
      await tasks.createTask("Reply to Stripe about the dispute", { due: soon, source: { type: "email", ref: "m2", ts: Date.now() } });
      twoSvc = tasks;
      setReady(true);
    })();
  }, []);
  return ready ? <TasksFlow /> : null;
}

/** The views are one menu now (2026-09-18): open it, pick the option. */
const pickView = (name: RegExp) => {
  fireEvent.click(screen.getByLabelText("View"));
  fireEvent.click(screen.getByRole("menuitemradio", { name }));
};

describe("A Place to Begin picks out of the view you are looking at", () => {
  // THE CARD ONLY APPEARS WHERE ONE TASK IS ACTUALLY AHEAD (2026-09-18). Two
  // tasks due the same day are not separated by anything he set, so there is
  // no pick and no card -- which is why these views are the ones with real
  // date spread in them.
  const cardName = () => document.querySelector(".start-top-name")?.textContent ?? "";

  it("proposes a task from the chosen view, not one from somewhere else", async () => {
    twoSvc = null;
    render(<NotesProvider userId="start-per-view"><TwoViews /></NotesProvider>);
    await waitFor(() => expect(screen.getByLabelText("View")).toBeInTheDocument(), { timeout: 4000 });
    // Upcoming holds two, six and nine days out. The nearer one leads.
    pickView(/Upcoming/);
    await waitFor(() => expect(cardName()).toContain("Book the Bridge Venue"), { timeout: 4000 });
    expect(cardName(), "the card is about the list it is sitting on").not.toContain("jarvis");
    void twoSvc;
  });

  // The exact view in Dave's screenshot: email tasks with a card on top
  // proposing something from somewhere else.
  it("proposes an email task on From Email, never one from somewhere else", async () => {
    render(<NotesProvider userId="start-per-view-3"><TwoViews /></NotesProvider>);
    await waitFor(() => expect(screen.getByLabelText("View")).toBeInTheDocument(), { timeout: 4000 });
    // The views are one menu as of 2026-09-18, so From Email is back beside
    // the rest instead of living in the options sheet.
    pickView(/From Email/);
    await waitFor(() => expect(cardName()).toContain("Get Back to Google"), { timeout: 4000 });
    expect(cardName(), "setting up Jarvis has nothing to do with emails").not.toContain("jarvis");
  });

  // Done has no open task in it, so topPick returns null and the card is
  // simply gone -- the page does not have to remember to hide it.
  it("says nothing on a view with nothing startable in it", async () => {
    render(<NotesProvider userId="start-per-view-2"><TwoViews /></NotesProvider>);
    await waitFor(() => expect(screen.getByLabelText("View")).toBeInTheDocument(), { timeout: 4000 });
    pickView(/Upcoming/);
    await waitFor(() => expect(screen.getByText("A Place to Begin")).toBeInTheDocument(), { timeout: 4000 });
    pickView(/^Done/);
    await waitFor(() => expect(screen.queryByText("A Place to Begin")).toBeNull(), { timeout: 4000 });
  });

  // "It's beyond overkill." One task on the list is not a choice between
  // anything, and the row underneath already carries its own Start.
  it("does not highlight the only task on the list", async () => {
    render(<NotesProvider userId="start-per-view-4"><TwoViews /></NotesProvider>);
    await waitFor(() => expect(screen.getByLabelText("View")).toBeInTheDocument(), { timeout: 4000 });
    // Today holds exactly one (the email task partitions out of it).
    pickView(/^Today/);
    await waitFor(() => expect(screen.getAllByText("Set Up Everything on Jarvis").length).toBeGreaterThan(0), { timeout: 4000 });
    expect(screen.queryByText("A Place to Begin")).toBeNull();
  });
});

// ONLY MAIL GOES TO EMAIL (audit 2026-09-29). A task whose source is another
// task opens that task from its provenance line. The flow used to know two
// doors (a note, a mail thread), so this line was a dead fact and the only
// origin that did reach a door was Email.
describe("TasksFlow: a task's source line opens what it names", () => {
  function SeededFrom({ spy, onEmail }: { spy: (k: string, id: string) => void; onEmail: (id: string) => void }) {
    const tasks = useTasks();
    const [ready, setReady] = useState(false);
    useEffect(() => {
      (async () => {
        await tasks.createTask("Follow Up With Sam", { due: todayISO(), source: { type: "task", ref: "task-origin-1", ts: Date.now() - 86_400_000 * 3 } });
        setReady(true);
      })();
    }, [tasks]);
    return ready ? <TasksFlow onOpenEntity={spy} onGoEmail={onEmail} /> : null;
  }
  it("routes a task source through the shell, and never to email", async () => {
    const spy = vi.fn(); const onEmail = vi.fn();
    render(<NotesProvider userId="u-task-source-door"><SeededFrom spy={spy} onEmail={onEmail} /></NotesProvider>);
    fireEvent.click(await screen.findByText("From a task", undefined, { timeout: 4000 }));
    expect(spy).toHaveBeenCalledWith("task", "task-origin-1");
    expect(onEmail).not.toHaveBeenCalled();
  });
});

// THE ROW'S SHEET HOLDS EVERY ACTION (Dave 2026-10-05, locked: "Tap a row, detail bottom sheet with all actions"). The
// pills left the rows; a tap on one opens its task's sheet, whose first lines are the primary (Start) and the quieter
// verbs (Move to Tomorrow, Mark Done), the same ones the swipe runs. Rendered through the real flow and its services.
let moveRef: { svc: TasksService; id: string } | null = null;
function SeededForSheet() {
  const tasks = useTasks();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      const id = await tasks.createTask("renew the passport", { due: todayISO() });
      moveRef = { svc: tasks, id: id! };
      setReady(true);
    })();
  }, [tasks]);
  return ready ? <TasksFlow /> : null;
}

describe("TasksFlow: a tap opens the sheet that holds the row's actions", () => {
  it("shows Start, Move to Tomorrow and Mark Done, in Title Case, and Move re-dates the stored task", async () => {
    render(<NotesProvider userId="sheet-actions-1"><SeededForSheet /></NotesProvider>);
    await waitFor(() => expect(rowNamed("Renew the Passport")).toBeInTheDocument());
    // No capsule on the list's row.
    expect(document.querySelectorAll(".task-row .pill-act")).toHaveLength(0);
    fireEvent.click(rowNamed("Renew the Passport"));
    await waitFor(() => expect(screen.getByText("Edit Task")).toBeInTheDocument());
    const lines = [...document.querySelectorAll(".xs-do .conn-name")].map((n) => n.textContent);
    expect(lines).toEqual(["Start", "Move to Tomorrow", "Mark Done"]);
    // The sheet shows his title in Title Case and the Due value is amber (due today).
    expect(screen.getByLabelText("Task")).toHaveValue("Renew the Passport");
    expect(screen.getByLabelText("Due").closest(".row")).toHaveClass("xs-due-warn");
    fireEvent.click(screen.getByText("Move to Tomorrow"));
    await waitFor(async () => { expect((await moveRef!.svc.task(moveRef!.id))?.due).toBe(localTomorrow()); });
    await waitFor(() => expect(screen.queryByText("Edit Task")).not.toBeInTheDocument());
  });
});

// THE TRUST CHECKPOINT ON THE NEW TASK SHEET (Phase 0 D4, 2026-10-10). Dave,
// 2026-09-28: "a filing never says Saved before it reaches the server". The
// sheet said "Saved to <Filter>" the moment the Store accepted the write, and
// said nothing at all when the row landed in the filter on screen. Behind
// trust_v1, with the Store pending, the first becomes "Filed to <Filter> ·
// Will Sync" and the second becomes "Filed · Will Sync", because a row
// appearing in the list with no word is the lie the checkpoint names. The
// offline Store comes through NotesProvider's test seam (store prop).
function offlineStore(): Store {
  const s = new Store(new InMemoryAdapter());
  s.goOffline();
  return s;
}

async function saveNewTask(opts: { userId: string; store?: Store; openFilter?: string }): Promise<string[]> {
  const toasts: string[] = [];
  // The toast store is one module: an action toast left showing by an earlier
  // case (Set Aside's Undo) would hold a plain toast in its queue (SHARED-F-09).
  resetToasts();
  const stop = subscribeToast((t) => { if (t) toasts.push(t.message); });
  const r = render(
    <NotesProvider userId={opts.userId} {...(opts.store ? { store: opts.store } : {})}>
      <TasksFlow openFilter={opts.openFilter} />
    </NotesProvider>,
  );
  try {
    const add = await screen.findAllByRole("button", { name: "New Task" });
    fireEvent.click(add[0]!);
    fireEvent.change(await screen.findByLabelText("Task"), { target: { value: "Email the roster" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(rowNamed("Email the Roster")).toBeInTheDocument());
    // The toast fires after the reload the row appeared on; give the queue one turn.
    await new Promise((res) => setTimeout(res, 0));
  } finally {
    stop();
    r.unmount();
  }
  return toasts;
}

describe("TasksFlow: the New Task sheet's toast tells the truth about where the row is (trust_v1)", () => {
  it("online, a moved filter says Saved to <Filter>, as today", async () => {
    flags.trustOn = true;
    // Viewing All, the sheet prefills today, so the row lands on Today and the filter moves.
    const toasts = await saveNewTask({ userId: "trust-online", openFilter: "all" });
    expect(toasts).toEqual(["Saved to Today"]);
  });

  it("pending, a moved filter says Filed to <Filter> · Will Sync", async () => {
    flags.trustOn = true;
    const toasts = await saveNewTask({ userId: "trust-moved", store: offlineStore(), openFilter: "all" });
    expect(toasts).toEqual(["Filed to Today · Will Sync"]);
  });

  it("pending, a filter that did not move still says Filed · Will Sync", async () => {
    flags.trustOn = true;
    // Viewing Today, the sheet prefills today, so the row lands where the person is looking.
    const toasts = await saveNewTask({ userId: "trust-still", store: offlineStore() });
    expect(toasts).toEqual(["Filed · Will Sync"]);
  });

  it("flag off, an offline Store changes nothing: Saved to <Filter>, and silence when the filter stays", async () => {
    flags.trustOn = false;
    expect(await saveNewTask({ userId: "trust-off-moved", store: offlineStore(), openFilter: "all" })).toEqual(["Saved to Today"]);
    expect(await saveNewTask({ userId: "trust-off-still", store: offlineStore() })).toEqual([]);
  });
});
