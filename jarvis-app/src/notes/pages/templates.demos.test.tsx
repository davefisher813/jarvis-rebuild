// @vitest-environment jsdom
// THE SIX ACCEPTANCE DEMOS OF ISSUE #115, SLICE 1, each through the real Notes
// flow over the real store: the screens he would tap, in order.
import "../../shared/tiptapTest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Store, InMemoryAdapter, type Item, type ItemData } from "@core";
import { NotesProvider, useNotes } from "../../data/NotesProvider";
import NotesFlow from "../NotesFlow";
import Templates from "../screens/Templates";
import { setCategoryRegistry } from "../../shared/categories";
import { MemoryFileStore } from "../../files/FileStore";
import { addRecord, newTeamPage, newLineupPage, newScorecardPage, setValues, type PageData } from "./pageModel";
import { newScoreboardPage } from "./scoreboard";
import { pageTable } from "./exportPage";
import { toCsv } from "./tabular";

// Every read and write takes a network beat, the way the phone's does.
class SlowAdapter extends InMemoryAdapter {
  private beat() { return new Promise((r) => setTimeout(r, 5)); }
  override async read(o: string, id: string): Promise<Item | null> { await this.beat(); return super.read(o, id); }
  override async apply(o: string, id: string, p: ItemData, t?: number): Promise<boolean> { await this.beat(); return super.apply(o, id, p, t); }
}
vi.mock("../../data/store", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../data/store")>();
  return { ...mod, makeStore: () => new Store(new SlowAdapter()) };
});

let svcRef: ReturnType<typeof useNotes> | null = null;
function Grab() { svcRef = useNotes(); return null; }

async function mount(user: string, openId?: string) {
  svcRef = null;
  const view = render(<NotesProvider userId={user}><Grab /><NotesFlow openId={openId} /></NotesProvider>);
  await waitFor(() => expect(svcRef).toBeTruthy());
  return view;
}
const svc = () => svcRef!;
async function pages() {
  const items = await svc().listNotes();
  return items.map((it) => ({ id: it.id, data: it.data as unknown as { title: string; category: string; page?: PageData } })).filter((x) => x.data.page);
}
const team3 = (): PageData => {
  let p = newTeamPage();
  for (const [name, number, position] of [["Ava Chen", "7", "Pitcher"], ["Ben Ruiz", "12", "Catcher"], ["Cal Diaz", "3", "First Base"]]) p = addRecord(p, { name: name!, number: number!, position: position! }).page;
  return p;
};
async function seedTeam(user: string) {
  const view = await mount(user);
  let id = "";
  await act(async () => { id = (await svc().createPage("Tigers", team3()))!; });
  return { view, id };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("issue #115 slice 1: the acceptance demos", () => {
  it("demo 1: start a golf round without arranging columns, and score hole 1", async () => {
    await mount("u-demo-golf");
    fireEvent.click(await screen.findByText("Use a Template", {}, { timeout: 4000 }));
    fireEvent.click(await screen.findByText("Golf Scorecard"));
    fireEvent.click(await screen.findByText("New Round"));
    // The round's one sheet: a course if wanted, 9 or 18, the players. No columns.
    fireEvent.change(await screen.findByLabelText("Player 1"), { target: { value: "Dave" } });
    fireEvent.click(screen.getByText("Add a Player"));
    fireEvent.change(screen.getByLabelText("Player 2"), { target: { value: "Sam" } });
    fireEvent.change(screen.getByLabelText("Course name"), { target: { value: "Pebble Beach" } });
    fireEvent.click(screen.getByText("Start"));
    fireEvent.click(await screen.findByText("Start Hole 1", {}, { timeout: 4000 }));
    expect(await screen.findByText("Hole 1")).toBeInTheDocument();
    // Par is set by a tap, never assumed; the strokes are big chips, one tap each: a 5 on a par 4 is a bogey, a 3 a birdie.
    fireEvent.click(screen.getByLabelText("Par 4 for Hole 1"));
    fireEvent.click(screen.getByLabelText("Strokes 5 for Dave"));
    fireEvent.click(screen.getByLabelText("Strokes 3 for Sam"));
    expect(await screen.findByText("Bogey")).toBeInTheDocument();
    expect(screen.getByText("Birdie")).toBeInTheDocument();
    await waitFor(async () => {
      const [g] = await pages();
      expect(g!.data.title).toBe("Pebble Beach");
      expect(g!.data.page!.records.map((r) => [r.v.name, r.v.h1])).toEqual([["Dave", "5"], ["Sam", "3"]]);
    });
    // Running totals and to par beside each name.
    expect(screen.getAllByText("+1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("-1").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("Next: Hole 2"));
    expect(await screen.findByText("Hole 2")).toBeInTheDocument();
  });

  it("demo 2: import a roster and correct one uncertain field before it is saved", async () => {
    await mount("u-demo-import");
    fireEvent.click(await screen.findByText("Import", { selector: ".conn-name" }, { timeout: 4000 }));
    fireEvent.click(screen.getByText("Paste Rows"));
    const paste = "Player\tNo.\tPos\tShirt Size\nAva Chen\t7\tPitcher\tM\nBen Ruiz\t12?\tCatcher\tL\nCal Diaz\t3\tFirst Base\tS\n";
    fireEvent.change(await screen.findByLabelText("Pasted rows"), { target: { value: paste } });
    fireEvent.click(screen.getByText("Next"));
    // Stored first: the page exists with its original before anything is confirmed.
    await waitFor(async () => {
      const [t] = await pages();
      expect(t!.data.page!.originals![0]).toMatchObject({ name: "Pasted Rows", used: false });
      expect(t!.data.page!.records).toHaveLength(0);
    });
    expect(await screen.findByText("Bring In Rows", {}, { timeout: 4000 })).toBeInTheDocument();
    // The uncertain value is visibly uncertain, in amber, with its reason.
    const unsure = screen.getByText(/Not One Clear Number/);
    expect(unsure).toHaveClass("fact", "warn");
    // The unknown column is kept, not dropped.
    expect(screen.getByText("New Fields: Shirt Size")).toBeInTheDocument();
    fireEvent.click(unsure.closest("[role=button]")!);
    const fix = await screen.findByLabelText("Number");
    fireEvent.change(fix, { target: { value: "12" } });
    fireEvent.click(within(document.querySelector(".form-sheet")! as HTMLElement).getByText("Save"));
    await waitFor(() => expect(screen.queryByText(/Not One Clear Number/)).toBeNull());
    fireEvent.click(screen.getByText("Bring In 3 Players"));
    await waitFor(async () => {
      const [t] = await pages();
      const recs = t!.data.page!.records;
      expect(recs.map((r) => r.v.number)).toEqual(["7", "12", "3"]);
      expect(recs.every((r) => !r.flags)).toBe(true);
      const shirt = t!.data.page!.fields.find((f) => f.label === "Shirt Size")!.key;
      expect(recs[0]!.v[shirt]).toBe("M");
      expect(t!.data.page!.originals![0]!.used).toBe(true);
    });
    expect(await screen.findByText("Ben Ruiz")).toBeInTheDocument();
  });

  it("demo 3: make a lineup from the team sheet without retyping a player", async () => {
    const { view, id } = await seedTeam("u-demo-lineup");
    view.rerender(<NotesProvider userId="u-demo-lineup"><Grab /><NotesFlow openId={id} /></NotesProvider>);
    fireEvent.click(await screen.findByText("Make a Lineup", {}, { timeout: 4000 }));
    expect(await screen.findByText("New Lineup")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Cal Diaz"));
    fireEvent.click(screen.getByText("Ava Chen"));
    fireEvent.click(screen.getByText("Make Lineup of 2"));
    await waitFor(async () => {
      const l = (await pages()).find((p) => p.data.page!.kind === "lineup");
      expect(l).toBeTruthy();
      expect(l!.data.page!.records.map((r) => [r.v.name, r.v.number, r.v.position])).toEqual([["Cal Diaz", "3", "First Base"], ["Ava Chen", "7", "Pitcher"]]);
      expect(l!.data.page!.lineup!.teamId).toBe(id);
    });
    expect(await screen.findByText("Batting Order", {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it("demo 4: update the roster without changing yesterday's lineup", async () => {
    const { view, id } = await seedTeam("u-demo-roster");
    let lineupId = "";
    await act(async () => {
      const t = (await svc().note(id))!.page!;
      lineupId = (await svc().createPage("Tigers Lineup", newLineupPage({ id, title: "Tigers", page: t }, t.records.map((r) => ({ playerId: r.id })), "2026-10-12", Date.UTC(2026, 9, 12, 18))))!;
      // Today Ava's name and number change on the roster.
      await svc().setPage(id, setValues(t, t.records[0]!.id, { name: "Ava Chen-Park", number: "17" }));
    });
    view.rerender(<NotesProvider userId="u-demo-roster"><Grab /><NotesFlow openId={lineupId} /></NotesProvider>);
    expect(await screen.findByText("Ava Chen", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByText("Ava Chen-Park")).toBeNull();
    expect(screen.getByText("#7")).toBeInTheDocument();
    // Quietly: one line under the order, and nothing rewritten.
    expect(await screen.findByText(/Roster Changed Since Oct 12/)).toHaveClass("input-hint");
    expect(screen.getByText("Use Roster Names")).toBeInTheDocument();
    const l = (await svc().note(lineupId))!.page!;
    expect(l.records[0]!.v).toMatchObject({ name: "Ava Chen", number: "7" });
  });

  it("demo 5: export, edit in Sheets, reimport: changes previewed, local edit kept, no duplicates", async () => {
    const { view, id } = await seedTeam("u-demo-roundtrip");
    let csv = "";
    await act(async () => {
      // Export (the share sheet's onExported does exactly this: snapshot, then the values become the base).
      const { takeSnapshot, markBase } = await import("./pageModel");
      const t = (await svc().note(id))!.page!;
      const exported = markBase(takeSnapshot(t, "export", 1));
      await svc().setPage(id, exported);
      csv = toCsv(pageTable(exported));
      // A local edit after the export: Cal moves to Second Base on the phone.
      await svc().setPage(id, setValues(exported, exported.records[2]!.id, { position: "Second Base" }));
    });
    // In Sheets: Ava's number changes and a new player is added at the bottom with no id.
    const edited = csv.replace(",7,Pitcher", ",8,Pitcher").replace(/\r\n$/, "\r\n,Dee Park,21,Outfield,\r\n");
    view.rerender(<NotesProvider userId="u-demo-roundtrip"><Grab /><NotesFlow openId={id} /></NotesProvider>);
    fireEvent.click(await screen.findByLabelText("Page options", {}, { timeout: 4000 }));
    fireEvent.click(screen.getByText("Paste Rows"));
    fireEvent.change(await screen.findByLabelText("Pasted rows"), { target: { value: edited } });
    fireEvent.click(screen.getByText("Next"));
    expect(await screen.findByText("Review Changes", {}, { timeout: 4000 })).toBeInTheDocument();
    // The preview: one changed, one new, Cal's edit kept without a question, no columns to confirm.
    expect(screen.getByText("Changed")).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("Your Edits, Kept")).toBeInTheDocument();
    expect(screen.queryByText("Changed on Both Sides")).toBeNull();
    expect(screen.queryAllByLabelText(/^Bring in /)).toHaveLength(0);
    fireEvent.click(screen.getByText("Apply 2 Changes"));
    await waitFor(async () => {
      const t = (await svc().note(id))!.page!;
      expect(t.records.map((r) => r.v.name)).toEqual(["Ava Chen", "Ben Ruiz", "Cal Diaz", "Dee Park"]);
      expect(new Set(t.records.map((r) => r.id)).size).toBe(4);
      expect(t.records[0]!.v.number).toBe("8");
      expect(t.records[2]!.v.position).toBe("Second Base");
      expect(t.snapshots!.map((s) => s.why)).toEqual(["export", "reimport"]);
    });
  });

  it("demo 6: find the page later by a name inside it, without remembering its shelf", async () => {
    svcRef = null;
    const view = render(<NotesProvider userId="u-demo-search"><Grab /></NotesProvider>);
    await waitFor(() => expect(svcRef).toBeTruthy());
    await act(async () => {
      setCategoryRegistry([{ id: "cat-kids", name: "Kids", color: "green" }]);
      const id = (await svc().createPage("Spring Season", team3(), "cat-kids"))!;
      await svc().createNote("Groceries", "");
      void id;
    });
    view.rerender(<NotesProvider userId="u-demo-search"><Grab /><NotesFlow /></NotesProvider>);
    const box = await screen.findByPlaceholderText("Search Notes", {}, { timeout: 4000 });
    await waitFor(() => expect(screen.getByText("Groceries")).toBeInTheDocument());
    fireEvent.change(box, { target: { value: "ben ruiz" } });
    await waitFor(() => expect(screen.getByText("Spring Season")).toBeInTheDocument());
    expect(screen.queryByText("Groceries")).toBeNull();
    // The global search reads the same words.
    const { noteBlockText } = await import("../../search/search");
    const [p] = await pages();
    expect(noteBlockText(p!.data as never).toLowerCase()).toContain("ben ruiz");
  });
});

describe("#106 V3: a template tap answers at once and can never make two notes", () => {
  it("a pending template row is pressed with a spinner and every row, template pages included, stands down", async () => {
    const onSelect = vi.fn();
    const onPage = vi.fn();
    render(<Templates onSelect={onSelect} onPage={onPage} pending="meeting" />);
    const row = screen.getByText("Meeting Notes").closest("[role=button]")!;
    expect(row).toHaveAttribute("aria-busy", "true");
    expect(row.querySelector(".spinner")).toBeTruthy();
    fireEvent.click(screen.getByText("Blank").closest("[role=button]")!);
    fireEvent.click(screen.getByText("Golf Scorecard").closest("[role=button]")!);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onPage).not.toHaveBeenCalled();
  });

  it("through the real flow, two quick taps on a template make one note", async () => {
    await mount("u-v3-once");
    fireEvent.click(await screen.findByText("Use a Template", {}, { timeout: 4000 }));
    const row = (await screen.findByText("Project Brief")).closest("[role=button]")!;
    fireEvent.click(row);
    fireEvent.click(row);
    expect(await screen.findByLabelText("Note", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(await svc().list()).toHaveLength(1);
  });

  it("an original is stored through the file pipeline as the table it is", async () => {
    const up = vi.spyOn(MemoryFileStore.prototype, "upload").mockResolvedValue({ path: "u/n/roster.csv", name: "roster.csv", mime: "text/csv", bytes: 20 });
    const { keepOriginal } = await import("./pageImport");
    const f = new File(["Name,Number\nAva,7\n"], "roster.csv", { type: "" });
    const kept = await keepOriginal(new MemoryFileStore("u"), "n", newTeamPage(), { file: f, name: f.name }, 5);
    expect(up.mock.calls[0]![1].type).toBe("text/csv");
    expect(up.mock.calls[0]![2]).toEqual({ table: true });
    expect(kept.original).toMatchObject({ path: "u/n/roster.csv", used: false });
  });
});

describe("Outreach Tracker is not Tasks, and every page edit can be undone", () => {
  it("adding a contact with a next step makes no task; Make a Task makes exactly one, on purpose", async () => {
    await mount("u-outreach");
    fireEvent.click(await screen.findByText("Use a Template", {}, { timeout: 4000 }));
    fireEvent.click(await screen.findByText("Outreach Tracker"));
    fireEvent.click(await screen.findByText("Add Contact", {}, { timeout: 4000 }));
    fireEvent.change(await screen.findByLabelText("Who"), { target: { value: "Coach Miller" } });
    fireEvent.change(screen.getByLabelText("Next Step"), { target: { value: "Send the schedule" } });
    fireEvent.click(screen.getByText("Add"));
    expect(await screen.findByText("Coach Miller")).toBeInTheDocument();
    await waitFor(async () => expect((await svc().note((await pages())[0]!.id))!.page!.records).toHaveLength(1));
    expect(await svc().listTasks()).toHaveLength(0);
    fireEvent.click(screen.getByText("Coach Miller"));
    fireEvent.click(await screen.findByText("Make a Task from the Next Step"));
    await waitFor(async () => expect(await svc().listTasks()).toHaveLength(1));
    const [p] = await pages();
    await waitFor(async () => expect((await svc().note(p!.id))!.page!.records[0]!.taskId).toBeTruthy());
  });

  it("Undo in the bar puts the page back as it was before the last edit", async () => {
    const { view, id } = await seedTeam("u-undo");
    view.rerender(<NotesProvider userId="u-undo"><Grab /><NotesFlow openId={id} /></NotesProvider>);
    fireEvent.click(await screen.findByText("Add Player", {}, { timeout: 4000 }));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Dee Park" } });
    fireEvent.click(screen.getByText("Add"));
    expect(await screen.findByText("Dee Park")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Undo"));
    await waitFor(() => expect(screen.queryByText("Dee Park")).toBeNull());
    await waitFor(async () => expect((await svc().note(id))!.page!.records).toHaveLength(3));
  });
});

describe("issue #115: a page opened after a lineup is made opens as itself (2026-10-17)", () => {
  async function makeLineupThroughTheCard(user: string) {
    svcRef = null;
    const view = render(<NotesProvider userId={user}><Grab /></NotesProvider>);
    await waitFor(() => expect(svcRef).toBeTruthy());
    let id = "";
    await act(async () => { id = (await svc().createPage("Tigers", team3()))!; });
    view.rerender(<NotesProvider userId={user}><Grab /><NotesFlow /></NotesProvider>);
    expect(await screen.findByText("Tigers", {}, { timeout: 4000 })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Use a Template"));
    fireEvent.click(await screen.findByText("Lineup Card"));
    fireEvent.click(await screen.findByText("Tigers"));
    expect(await screen.findByText("New Lineup", {}, { timeout: 4000 })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Cal Diaz"));
    fireEvent.click(screen.getByText("Ava Chen"));
    fireEvent.click(screen.getByText("Make Lineup of 2"));
    expect(await screen.findByText("Batting Order", {}, { timeout: 4000 })).toBeInTheDocument();
    return id;
  }
  const back = () => document.querySelector(".nav-back") as HTMLElement;

  it("the Team Sheet opened from the Notes list shows its roster and a Back to Notes", async () => {
    await makeLineupThroughTheCard("u-lineup-then-list");
    // The lineup was opened by id, so it is a page from the list, not the template picker.
    expect(back()).toHaveTextContent(/^Notes$/);
    fireEvent.click(back());
    fireEvent.click(await screen.findByText("Tigers", {}, { timeout: 4000 }));
    expect(await screen.findByText("Make a Lineup", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText("Ben Ruiz")).toBeInTheDocument();
    expect(screen.queryByText("New Lineup")).toBeNull();
    expect(back()).toHaveTextContent(/^Notes$/);
  });

  it("the Team Sheet opened from the lineup's own Team Sheet row shows its roster too", async () => {
    await makeLineupThroughTheCard("u-lineup-then-team");
    fireEvent.click(await screen.findByText("Team Sheet", {}, { timeout: 4000 }));
    expect(await screen.findByText("Make a Lineup", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByText("New Lineup")).toBeNull();
    expect(back()).toHaveTextContent(/^Notes$/);
  });
});

describe("issue #115 stays alive: finishing a record keeps a dated snapshot (2026-10-17)", () => {
  async function openSeeded(user: string, title: string, page: PageData) {
    const view = await mount(user);
    let id = "";
    await act(async () => { id = (await svc().createPage(title, page))!; });
    view.rerender(<NotesProvider userId={user}><Grab /><NotesFlow openId={id} /></NotesProvider>);
    return id;
  }
  async function snapshotsShow(label: string) {
    fireEvent.click(await screen.findByLabelText("Page options", {}, { timeout: 4000 }));
    fireEvent.click(screen.getByText("Snapshots"));
    expect(await screen.findByText(label)).toBeInTheDocument();
  }

  it("Golf's Finish Round keeps the finished card as an At Finish snapshot", async () => {
    const id = await openSeeded("u-finish-golf", "Pebble Beach", newScorecardPage({ course: "Pebble Beach", holes: 9, players: ["Dave"], date: "2026-10-17" }));
    fireEvent.click(await screen.findByText("Start Hole 1", {}, { timeout: 4000 }));
    fireEvent.click(await screen.findByLabelText("Strokes 5 for Dave"));
    for (let h = 2; h <= 9; h++) fireEvent.click(await screen.findByText(`Next: Hole ${h}`));
    expect((await svc().note(id))!.page!.snapshots ?? []).toHaveLength(0);
    fireEvent.click(screen.getByText("Finish Round"));
    await waitFor(async () => {
      const p = (await svc().note(id))!.page!;
      expect(p.snapshots!.map((s) => s.why)).toEqual(["finish"]);
      expect(p.snapshots![0]!.at).toBeGreaterThan(0);
      expect(p.snapshots![0]!.records[0]!.v.h1).toBe("5");
    });
    await snapshotsShow("At Finish");
  });

  it("the scoreboard's Finish keeps the finished game as an At Finish snapshot", async () => {
    const id = await openSeeded("u-finish-game", "Scoreboard", newScoreboardPage("basketball", ["Tigers", "Lions"], "2026-10-17"));
    fireEvent.click(await screen.findByText("Start Quarter 1", {}, { timeout: 4000 }));
    for (let q = 2; q <= 4; q++) fireEvent.click(await screen.findByText(`Next: Quarter ${q}`));
    expect((await svc().note(id))!.page!.snapshots ?? []).toHaveLength(0);
    fireEvent.click(screen.getByText("Finish"));
    await waitFor(async () => expect((await svc().note(id))!.page!.snapshots!.map((s) => s.why)).toEqual(["finish"]));
    await snapshotsShow("At Finish");
  });
});
