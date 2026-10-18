// @vitest-environment jsdom
// TEMPLATES WAVE 2 (issue #115, Sports), through the real Notes flow over the real store: the picker's shelves, the shared engine (every heading
// drawn from the first open with its own Add, a done mark that leads its row, "save as my template"), and the pages that do arithmetic for the person.
import "../../shared/tiptapTest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Store, InMemoryAdapter, type Item, type ItemData } from "@core";
import { NotesProvider, useNotes } from "../../data/NotesProvider";
import NotesFlow from "../NotesFlow";
import { newTemplatePage } from "./templateDefs";

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
const pageOf = async (kind: string) => { const n = (await svc().listNotes()).find((x) => (x.data as unknown as { page?: { kind?: string } }).page?.kind === kind && !(x.data as { deletedAt?: number }).deletedAt); return n ? { id: n.id, page: (n.data as unknown as { page: import("./pageModel").PageData }).page } : null; };
const count = async (kind: string) => (await svc().listNotes()).filter((n) => (n.data as unknown as { page?: { kind?: string } }).page?.kind === kind && !(n.data as { deletedAt?: number }).deletedAt).length;

afterEach(() => { vi.restoreAllMocks(); });


async function openPicked(user: string, name: string) {
  const view = await mount(user);
  fireEvent.click(await screen.findByText("Use a Template", {}, { timeout: 4000 }));
  fireEvent.click(await screen.findByText(name));
  await screen.findByLabelText("Page options", {}, { timeout: 4000 });
  return view;
}
const sheetOf = () => document.querySelector(".sheet-scrim") as HTMLElement;

describe("the picker", () => {
  it("lists the templates on their shelves, the wave 2 sports among them", async () => {
    await mount("u-w2-picker");
    fireEvent.click(await screen.findByText("Use a Template", {}, { timeout: 4000 }));
    await screen.findByText("Sports");
    for (const n of ["Scoreboard", "Pitching Board", "Session Plan", "Event Day Pack", "Scouting Report", "Profile One-Pager", "Training Log", "Training Plan", "League Standings", "Group Manager Page"]) expect(screen.getByText(n)).toBeInTheDocument();
    expect(screen.getByText("Golf Scorecard")).toBeInTheDocument();
  });
});

describe("Session Plan: headings, minutes and a clock", () => {
  it("opens ready: every heading drawn with its own Add, a Warm-Up and a Cool-Down already on it, and the minutes add up", async () => {
    await openPicked("u-w2-session", "Session Plan");
    // Every heading is on the page from the first open (Alfred 2026-10-16), each with its own Add, and none says a count of zero.
    for (const h of ["Warm-Up", "Drills", "Scrimmage", "Cool-Down"]) expect(screen.getByLabelText(`Add Activity Under ${h}`)).toBeInTheDocument();
    expect(screen.getAllByText("Add Activity")).toHaveLength(4);
    expect(screen.queryByText(/^0 /)).toBeNull();
    expect(screen.getByText("15 Min")).toBeInTheDocument();    // the starter rows: Warm-Up 10, Cool-Down 5
    // Drills' own Add starts the row under Drills.
    fireEvent.click(screen.getByLabelText("Add Activity Under Drills"));
    fireEvent.change(await screen.findByLabelText("Activity"), { target: { value: "Passing Square" } });
    fireEvent.change(screen.getByLabelText("Minutes"), { target: { value: "20" } });
    fireEvent.click(within(sheetOf()).getByText("Add"));
    expect(await screen.findByText("Passing Square", {}, { timeout: 4000 })).toBeInTheDocument();
    await waitFor(async () => expect((await pageOf("session"))!.page.records.find((r) => r.v.act === "Passing Square")!.sec).toBe((await pageOf("session"))!.page.sections![1]!.key), { timeout: 4000 });
    expect(screen.getByText("35 Min")).toBeInTheDocument();
    // A start time puts a clock on the row.
    fireEvent.click(screen.getByText("Start Time"));
    fireEvent.change(await screen.findByPlaceholderText("Start Time"), { target: { value: "17:30" } });
    fireEvent.click(within(sheetOf()).getByText("Save"));
    // Twice: the Start Time row itself reads in 12-hour (it printed the stored "17:30" until 2026-10-18), and the Warm-Up row's clock.
    await waitFor(() => expect(screen.getAllByText("5:30 PM")).toHaveLength(2), { timeout: 4000 });
    expect(screen.queryByText("17:30")).toBeNull();
    expect(screen.getByText("5:40 PM")).toBeInTheDocument();   // Passing Square, after the ten-minute Warm-Up
  });

  it("headings are edited on the page: renamed and added, and a removed one keeps its rows", async () => {
    await openPicked("u-w2-headings", "Session Plan");
    fireEvent.click(screen.getByLabelText("Page options"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Headings/ }));
    fireEvent.change(await screen.findByLabelText("Name for Warm-Up"), { target: { value: "Get Loose" } });
    fireEvent.change(screen.getByLabelText("New heading name"), { target: { value: "Water Break" } });
    fireEvent.click(within(sheetOf()).getByText("Save"));
    await waitFor(async () => {
      const got = await pageOf("session");
      expect(got!.page.sections!.map((s) => s.label)).toEqual(["Get Loose", "Drills", "Scrimmage", "Cool-Down", "Water Break"]);
    }, { timeout: 4000 });
  });
});

describe("Event Day Pack: the done mark leads the row", () => {
  it("opens with its headings and starters, and a tap on the checkbox ticks the item without opening it", async () => {
    await openPicked("u-w2-eventday", "Event Day Pack");
    for (const h of ["Before You Go", "Bring", "People", "Schedule"]) expect(screen.getByLabelText(`Add Item Under ${h}`)).toBeInTheDocument();
    for (const seed of ["Tickets", "Directions", "Water"]) expect(screen.getByText(seed)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Add Item Under Bring"));
    fireEvent.change(await screen.findByLabelText("Item"), { target: { value: "Water Bottles" } });
    fireEvent.click(within(sheetOf()).getByText("Add"));
    const row = (await screen.findByText("Water Bottles", {}, { timeout: 4000 })).closest(".row")!;
    const box = row.querySelector('[role="checkbox"]')!;
    expect(box).toBeTruthy();
    // It leads the row: it comes before the name in the row's own order.
    expect(box.compareDocumentPosition(row.querySelector(".conn-name")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(box);
    await waitFor(async () => expect((await pageOf("eventday"))!.page.records.find((r) => r.v.item === "Water Bottles")!.v.done).toBe("1"), { timeout: 4000 });
    expect(document.querySelector(".sheet-scrim")).toBeNull();
  });
});

describe("Scoreboard: pick the sport and score it", () => {
  it("Basketball arranges itself: four quarters, totals add up, the leader says so", async () => {
    await mount("u-w2-score");
    fireEvent.click(await screen.findByText("Use a Template", {}, { timeout: 4000 }));
    fireEvent.click(await screen.findByText("Scoreboard"));
    fireEvent.click(await screen.findByText("Basketball"));
    fireEvent.click(within(sheetOf()).getByText("Start"));
    fireEvent.click(await screen.findByText("Start Quarter 1", {}, { timeout: 4000 }));
    expect(await screen.findByText("Quarter 1")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("More Quarter 1 for Home"));
    fireEvent.click(screen.getByLabelText("More Quarter 1 for Home"));
    await waitFor(async () => expect((await pageOf("scoreboard"))!.page.records[0]!.v.p1).toBe("2"), { timeout: 4000 });
    fireEvent.click(screen.getByText("Basketball"));   // back to the page
    expect(await screen.findByText("Leading", {}, { timeout: 4000 })).toBeInTheDocument();
  });
});

describe("League Standings: record a game and the table works itself out", () => {
  it("two teams and a game give a leader, wins, losses and points", async () => {
    await openPicked("u-w2-standings", "League Standings");
    for (const n of ["Tigers", "Bears"]) {
      fireEvent.click(screen.getByText("Add Team"));
      fireEvent.change(await screen.findByLabelText("Team"), { target: { value: n } });
      fireEvent.click(within(sheetOf()).getByText("Add"));
      await screen.findByText(n, {}, { timeout: 4000 });
    }
    fireEvent.click(await screen.findByText("Record a Game"));
    fireEvent.change(await screen.findByLabelText("First team score"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Second team score"), { target: { value: "1" } });
    fireEvent.click(within(sheetOf()).getByText("Add"));
    await waitFor(async () => expect((await pageOf("standings"))!.page.games).toHaveLength(1), { timeout: 4000 });
    expect(await screen.findByText("1-0")).toBeInTheDocument();
    expect(screen.getByText("0-1")).toBeInTheDocument();
  });
});

describe("Pitching Board: rest follows from the pitches", () => {
  it("says a pitcher who threw 70 yesterday is resting, and when they are back", async () => {
    svcRef = null;
    const view = render(<NotesProvider userId="u-w2-pitch"><Grab /></NotesProvider>);
    await waitFor(() => expect(svcRef).toBeTruthy());
    const d = new Date(); d.setDate(d.getDate() - 1);
    const yesterday = d.toISOString().slice(0, 10);
    const base = newTemplatePage("pitching");
    let id = "";
    await act(async () => { id = (await svc().createPage("Pitching Board", { ...base, records: [{ id: "r_a1", v: { name: "Sam", date: yesterday, pitches: "70" } }] }))!; });
    view.rerender(<NotesProvider userId="u-w2-pitch"><Grab /><NotesFlow openId={id} /></NotesProvider>);
    expect(await screen.findByText(/Rests Until/, {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText("Who Can Pitch")).toBeInTheDocument();
  });
});

describe("Profile One-Pager: one record, empty fields stay off the page", () => {
  it("opens with its one record and draws only what is filled in", async () => {
    await openPicked("u-w2-profile", "Profile One-Pager");
    expect((await pageOf("profile"))!.page.records).toHaveLength(1);
    expect(screen.getByText("Add What You Want on the Page; Empty Fields Stay Off It")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Edit Profile"));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Ava Chen" } });
    fireEvent.click(within(sheetOf()).getByText("Save"));
    expect(await screen.findByText("Ava Chen", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByText("GPA")).toBeNull();
  });
});

describe("Training Log and Training Plan", () => {
  it("the log reads Health rather than keeping workouts of its own", async () => {
    await openPicked("u-w2-tlog", "Training Log");
    expect(await screen.findByText("From Health")).toBeInTheDocument();
    expect(screen.getByText(/Workouts Are Read From Health, Never Copied/)).toBeInTheDocument();
    expect((await pageOf("traininglog"))!.page.records).toHaveLength(0);
  });
  it("the plan starts with a week and takes days", async () => {
    await openPicked("u-w2-tplan", "Training Plan");
    fireEvent.click(screen.getByText("Add Day"));
    fireEvent.change(await screen.findByLabelText("Day"), { target: { value: "Monday" } });
    fireEvent.click(within(sheetOf()).getByText("Add"));
    expect(await screen.findByText("Monday", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText("Week 1")).toBeInTheDocument();
  });
});

describe("Save as My Template", () => {
  it("keeps the edited structure with no rows, lists it in the picker, and starts a fresh page from it", async () => {
    await openPicked("u-w2-mine", "Group Manager Page");
    fireEvent.click(screen.getByLabelText("Page options"));
    fireEvent.click(screen.getByText("Fields"));
    fireEvent.click(await screen.findByText("Add Coming"));
    fireEvent.click(within(sheetOf()).getByText("Save"));
    await waitFor(async () => expect((await pageOf("group"))!.page.fields.some((f) => f.key === "coming")).toBe(true), { timeout: 4000 });
    fireEvent.click(screen.getByLabelText("Page options"));
    fireEvent.click(screen.getByText("Save as My Template"));
    await waitFor(async () => expect((await svc().listNotes()).some((n) => (n.data as unknown as { page?: { mine?: boolean } }).page?.mine)).toBe(true), { timeout: 4000 });
    // The picker lists it under My Templates.
    fireEvent.click(document.querySelector(".nav-back")!);
    fireEvent.click(await screen.findByText("Use a Template", {}, { timeout: 4000 }));
    expect(await screen.findByText("My Templates", {}, { timeout: 4000 })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Group Manager Page Template"));
    await screen.findByLabelText("Page options", {}, { timeout: 4000 });
    await waitFor(async () => {
      const made = (await svc().listNotes()).map((n) => (n.data as unknown as { page?: { kind: string; mine?: boolean; fields: { key: string }[]; records: unknown[] } }).page).filter((p) => p && p.kind === "group" && !p.mine);
      expect(made.length).toBeGreaterThanOrEqual(2);
      expect(made.some((p) => p!.fields.some((f) => f.key === "coming") && p!.records.length === 0)).toBe(true);
    }, { timeout: 4000 });
  });
});

describe("removing a field a calculation needs says what stops working first (the 2026-10-13 spec, 2026-10-17)", () => {
  it("Session Plan's Minutes: the clock and the total are named before Remove, and nothing changes until Remove", async () => {
    await openPicked("u-w2-remove-min", "Session Plan");
    fireEvent.click(screen.getByLabelText("Page options"));
    fireEvent.click(await screen.findByText("Fields"));
    const head = (await screen.findByText("Remove a Field")).parentElement!;
    fireEvent.click(within(head.nextElementSibling as HTMLElement).getByText("Minutes"));
    expect(await screen.findByText("Remove Minutes")).toBeInTheDocument();
    const notes = [...sheetOf().querySelectorAll(".input-hint")].map((n) => n.textContent);
    // What stops working comes first, then what the field holds (the two starter rows' minutes) and the snapshot.
    expect(notes).toHaveLength(4);
    expect(notes.slice(0, 2)).toEqual(["Clock Times From the Start Stop Working", "The Minutes Total Stops Adding Up"]);
    // The definition's own plural, never a bolted-on "s".
    expect(notes[2]).toBe("2 Activities Have a Value Here");
    expect((await pageOf("session"))!.page.fields.some((f) => f.key === "min")).toBe(true);
    fireEvent.click(within(sheetOf()).getByText("Remove"));
    await waitFor(async () => expect((await pageOf("session"))!.page.fields.some((f) => f.key === "min")).toBe(false), { timeout: 4000 });
  });

  it("a field nothing reads says only what it holds", async () => {
    await openPicked("u-w2-remove-notes", "Session Plan");
    fireEvent.click(screen.getByLabelText("Page options"));
    fireEvent.click(await screen.findByText("Fields"));
    const head = (await screen.findByText("Remove a Field")).parentElement!;
    fireEvent.click(within(head.nextElementSibling as HTMLElement).getByText("Notes"));
    expect(await screen.findByText("Remove Notes")).toBeInTheDocument();
    const notes = [...sheetOf().querySelectorAll(".input-hint")].map((n) => n.textContent);
    expect(notes).toEqual(["No Record Has a Value Here", "A Snapshot Keeps Them First; See Snapshots in the Page Menu"]);
  });
});
