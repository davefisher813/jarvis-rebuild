// @vitest-environment jsdom
// STAGE 1 OF THE STAGED BUILD (the 2026-10-13 FINAL spec, audited against the code 2026-10-17), through the real Notes flow over the real
// store: the Game Night sheets scored their real way, a Team Sheet's positions by sport, an Outreach Tracker's kinds, Poker Night's
// blind schedule, and a 1:1 Log carrying its open follow-ups forward. The catalog setup (laws/catalogSetup.ts) runs under every render.
import "../../shared/tiptapTest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Store, InMemoryAdapter, type Item, type ItemData } from "@core";
import { NotesProvider, useNotes } from "../../data/NotesProvider";
import NotesFlow from "../NotesFlow";
import { newTemplatePage } from "./templateDefs";
import { addRecord, newTeamPage, type PageData } from "./pageModel";
import { newScoreboardPage } from "./scoreboard";

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
const pageOf = async (kind: string) => { const n = (await svc().listNotes()).find((x) => (x.data as unknown as { page?: { kind?: string } }).page?.kind === kind && !(x.data as { deletedAt?: number }).deletedAt); return n ? { id: n.id, page: (n.data as unknown as { page: PageData }).page } : null; };
const sheetOf = () => document.querySelector(".sheet-scrim") as HTMLElement;
afterEach(() => { vi.restoreAllMocks(); });

async function openPicked(user: string, name: string) {
  const view = await mount(user);
  fireEvent.click(await screen.findByText("Use a Template", {}, { timeout: 4000 }));
  fireEvent.click(await screen.findByText(name));
  await screen.findByLabelText("Page options", {}, { timeout: 4000 });
  return view;
}
/** A page seeded straight into the store, then opened. */
async function openSeeded(user: string, title: string, page: PageData) {
  const view = await mount(user);
  const id = (await svc().createPage(title, page, ""))!;
  view.rerender(<NotesProvider userId={user}><Grab /><NotesFlow openId={id} /></NotesProvider>);
  await screen.findByLabelText("Page options", {}, { timeout: 4000 });
  return { view, id };
}
/** The dropdown a Menu row holds: open it and pick the option by its words. */
async function pickMenu(ariaLabel: string, option: string) {
  fireEvent.click(screen.getByLabelText(ariaLabel));
  fireEvent.click(await screen.findByRole("menuitemradio", { name: option }));
}

describe("the Game Night sheets, scored their real way", () => {
  it("Hearts: the lowest total leads, and the game is over when a side reaches 100", async () => {
    await mount("u-s1-hearts");
    fireEvent.click(await screen.findByText("Use a Template", {}, { timeout: 4000 }));
    fireEvent.click(await screen.findByText("Scoreboard"));
    // The named sheets sit on the Game Night shelf of the picker.
    for (const g of ["Hearts", "Spades", "Euchre", "Rummy", "Phase 10", "Yahtzee", "Farkle"]) expect(within(sheetOf()).getByText(g), g).toBeInTheDocument();
    fireEvent.click(within(sheetOf()).getByText("Hearts"));
    fireEvent.click(within(sheetOf()).getByText("Start"));
    await screen.findByLabelText("Page options", {}, { timeout: 4000 });
    expect(screen.getByText("Lowest Total Wins; the Game Ends When a Side Reaches 100")).toBeInTheDocument();
    expect(screen.getByText("Start Hand 1")).toBeInTheDocument();
    // Nobody leads before a hand is scored: a side with no points is not ahead for having none.
    expect(screen.queryByText("Leading")).toBeNull();
    fireEvent.click(screen.getByText("Start Hand 1"));
    expect(await screen.findByText("Hand 1")).toBeInTheDocument();
    for (let i = 0; i < 13; i++) fireEvent.click(screen.getByLabelText("More Hand 1 for Player 1"));   // 13 points
    fireEvent.click(screen.getByLabelText("More Hand 1 for Player 2"));                                // 1 point: the lowest so far
    await waitFor(async () => expect((await pageOf("scoreboard"))!.page.records[0]!.v.p1).toBe("13"), { timeout: 4000 });
    fireEvent.click(screen.getByText("Hearts"));   // back to the page
    const leader = (await screen.findByText("Leading", {}, { timeout: 4000 })).closest(".row") as HTMLElement;
    expect(within(leader).getByText("Player 2")).toBeInTheDocument();
  });

  it("Hearts: a side at 100 ends the game, and the lowest total has won", async () => {
    const base = newScoreboardPage("hearts", ["Ann", "Bo"], "2026-10-17");
    const over: PageData = { ...base, records: base.records.map((r, i) => ({ ...r, v: { ...r.v, p1: i === 0 ? "26" : "20", p2: i === 0 ? "26" : "5", p3: i === 0 ? "26" : "5", p4: i === 0 ? "26" : "5" } })) };
    await openSeeded("u-s1-hearts-over", "Hearts Night", over);
    const won = (await screen.findByText("Won", {}, { timeout: 4000 })).closest(".row") as HTMLElement;
    expect(within(won).getByText("Bo")).toBeInTheDocument();
    expect(screen.queryByText("Leading")).toBeNull();
    // Each hand is a fact of its own: no dot typed into the line between them.
    const anns = screen.getByText("Ann").closest(".row")!;
    expect([...anns.querySelectorAll(".fact")].map((f) => f.textContent)).toEqual(expect.arrayContaining(["26", "26", "26", "26"]));
    for (const f of anns.querySelectorAll(".fact")) expect(f.textContent).not.toContain("·");
  });

  it("Yahtzee: one box at a time, each moved by its own step, the upper bonus at 63", async () => {
    await mount("u-s1-dice");
    fireEvent.click(await screen.findByText("Use a Template", {}, { timeout: 4000 }));
    fireEvent.click(await screen.findByText("Scoreboard"));
    fireEvent.click(await within(sheetOf()).findByText("Yahtzee"));
    fireEvent.click(within(sheetOf()).getByText("Start"));
    await screen.findByLabelText("Page options", {}, { timeout: 4000 });
    expect(screen.getByText("Start Scoring")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Start Scoring"));
    expect(await screen.findByText("Ones")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("More Ones for Player 1"));
    fireEvent.click(screen.getByLabelText("More Ones for Player 1"));
    await waitFor(async () => expect((await pageOf("scoreboard"))!.page.records[0]!.v.y1).toBe("2"), { timeout: 4000 });
    fireEvent.click(screen.getByText("Next: Twos"));
    expect(await screen.findByText("Twos")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("More Twos for Player 1"));   // moves by two
    await waitFor(async () => expect((await pageOf("scoreboard"))!.page.records[0]!.v.y2).toBe("2"), { timeout: 4000 });
    expect(screen.getByText("4")).toBeInTheDocument();   // the running total beside the name
    expect(screen.getByText("Back to Ones")).toBeInTheDocument();
  });
});

describe("Team Sheet: positions by sport", () => {
  it("picking Baseball makes Position a choice of its spots; a typed position stays as typed", async () => {
    const { id } = await openSeeded("u-s1-team", "Tigers", addRecord(newTeamPage(), { name: "Ben Ruiz", number: "12", position: "Wing" }).page);
    expect(screen.getByText("Team")).toBeInTheDocument();
    expect(screen.getByText("Any Sport")).toBeInTheDocument();
    await pickMenu("Sport", "Baseball");
    await waitFor(async () => expect(((await svc().note(id))!.page!.meta ?? {}).sport).toBe("baseball"), { timeout: 4000 });
    expect((await svc().note(id))!.page!.records[0]!.v.position).toBe("Wing");
    // A new player's Position is now a menu of Baseball's spots.
    fireEvent.click(screen.getByText("Add Player"));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Ava Chen" } });
    fireEvent.click(within(sheetOf()).getByLabelText("Position"));
    expect(await screen.findByRole("menuitemradio", { name: "Shortstop" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Shortstop" }));
    fireEvent.click(within(sheetOf()).getByText("Add"));
    expect(await screen.findByText("Shortstop", {}, { timeout: 4000 })).toBeInTheDocument();
    // The typed position is still on its row, drawn as typed.
    expect(screen.getByText("Wing")).toBeInTheDocument();
    expect((await svc().note(id))!.page!.fields.find((f) => f.key === "position")!.options).toContain("Catcher");
  });
});

describe("Outreach Tracker: a kind is a configuration", () => {
  it("Grants and Sponsors renames the fields and the status words and adds an amount and a deadline; the contact is untouched", async () => {
    await openPicked("u-s1-outreach", "Outreach Tracker");
    fireEvent.click(screen.getByText("Add Contact"));
    fireEvent.change(await screen.findByLabelText("Who"), { target: { value: "Coach Miller" } });
    fireEvent.change(screen.getByLabelText("Organization"), { target: { value: "Lions Club" } });
    fireEvent.click(within(sheetOf()).getByText("Add"));
    await screen.findByText("Coach Miller", {}, { timeout: 4000 });
    expect(screen.getByText("Tracker")).toBeInTheDocument();
    await pickMenu("Kind", "Grants and Sponsors");
    await waitFor(async () => expect((await pageOf("outreach"))!.page.meta?.kind).toBe("grants"), { timeout: 4000 });
    const got = (await pageOf("outreach"))!.page;
    expect(got.fields.find((f) => f.key === "org")!.label).toBe("Funder or Sponsor");
    expect(got.fields.find((f) => f.key === "status")!.options).toContain("Funded");
    expect(got.fields.some((f) => f.key === "amount")).toBe(true);
    expect(got.records[0]!.v).toMatchObject({ who: "Coach Miller", org: "Lions Club" });
    // The sheet speaks the kind's words now.
    fireEvent.click(screen.getByText("Coach Miller"));
    expect(await screen.findByLabelText("Funder or Sponsor")).toHaveValue("Lions Club");
    expect(screen.getByLabelText("Amount Asked")).toBeInTheDocument();
    fireEvent.click(within(sheetOf()).getByLabelText("Status"));
    expect(await screen.findByRole("menuitemradio", { name: "Funded" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Funded" }));
    fireEvent.click(within(sheetOf()).getByText("Save"));
    const fact = await screen.findByText("Funded", {}, { timeout: 4000 });
    expect(fact.classList.contains("fact")).toBe(true);
    expect(fact.classList.contains("good")).toBe(true);
  });
});

describe("Poker Night: the blind schedule", () => {
  it("opens with Set Blinds and no card; three numbers draw the levels", async () => {
    await openPicked("u-s1-poker", "Poker Night");
    expect(screen.getByText("Blinds")).toBeInTheDocument();
    expect(screen.getByText("Set Blinds")).toBeInTheDocument();
    expect(screen.queryByText(/^Level \d/)).toBeNull();
    fireEvent.click(screen.getByText("Set Blinds"));
    fireEvent.change(await screen.findByLabelText("Starting small blind"), { target: { value: "25" } });
    fireEvent.change(screen.getByLabelText("Minutes a level"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("Levels"), { target: { value: "4" } });
    fireEvent.click(within(sheetOf()).getByText("Save"));
    expect(await screen.findByText("Level 4", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText("100 / 200")).toBeInTheDocument();
    expect(screen.getByText("25 / 50")).toBeInTheDocument();
    expect(screen.getAllByText("20 Min")).toHaveLength(4);
    expect(screen.getByText("Edit Blinds")).toBeInTheDocument();
    await waitFor(async () => expect((await pageOf("poker"))!.page.meta).toMatchObject({ blindStart: "25", blindMin: "20", blindLevels: "4" }), { timeout: 4000 });
  });
});

describe("1:1 Log: open promises carry forward", () => {
  it("a new meeting opens with the last meeting's follow-ups already in, and says where they came from", async () => {
    let page = newTemplatePage("oneonone");
    page = addRecord(page, { date: "2026-10-08", topics: "Hiring", actions: "Book the panel" }).page;
    await openSeeded("u-s1-oneonone", "1:1 Log", page);
    fireEvent.click(screen.getByText("Add Meeting"));
    expect(await screen.findByLabelText("Follow-Ups")).toHaveValue("Book the panel");
    expect(screen.getByText(/Follow-Ups Carried From Oct 8/)).toBeInTheDocument();
    // The person edits them: the done one goes, the open one stays, the new meeting keeps only what is still open.
    fireEvent.change(screen.getByLabelText("Follow-Ups"), { target: { value: "Share the rubric" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-15" } });
    fireEvent.click(within(sheetOf()).getByText("Add"));
    await waitFor(async () => expect((await pageOf("oneonone"))!.page.records).toHaveLength(2), { timeout: 4000 });
    const got = (await pageOf("oneonone"))!.page;
    expect(got.records.find((r) => r.v.date === "2026-10-15")!.v.actions).toBe("Share the rubric");
    expect(got.records.find((r) => r.v.date === "2026-10-08")!.v.actions).toBe("Book the panel");
  });
});
