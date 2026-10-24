// @vitest-environment jsdom
// EVERY TEMPLATE OPENS READY (Alfred, production, 2026-10-16: 24 of the 40 templates opened as an EMPTY SHELL, a "0 Items" counter
// and one Add, none of the fields or headings the good ones had). Each of the 40 is picked fresh, through the real picker over the
// real store, and must draw its structure on the first open: a heading, a row, a setting or a starter line, beyond a counter and a
// single Add. The 16 that were already ready keep their known anchors. The catalog setup (laws/catalogSetup.ts) runs under every
// render here, so a lowercase word behind a leading number or a card holding nothing but a capsule fails the template that drew it.
import "../../shared/tiptapTest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Store, InMemoryAdapter } from "@core";
import { NotesProvider, useNotes } from "../../data/NotesProvider";
import NotesFlow from "../NotesFlow";
import { TEMPLATE_KEYS, TEMPLATES, newTemplatePage, type TemplateKey } from "./templateDefs";
import { newTeamPage, newLineupPage, addRecord } from "./pageModel";

vi.mock("../../data/store", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../data/store")>();
  return { ...mod, makeStore: () => new Store(new InMemoryAdapter()) };
});

let svcRef: ReturnType<typeof useNotes> | null = null;
function Grab() { svcRef = useNotes(); return null; }
async function mount(user: string, openId?: string) {
  svcRef = null;
  const view = render(<NotesProvider userId={user}><Grab /><NotesFlow openId={openId} /></NotesProvider>);
  await waitFor(() => expect(svcRef).toBeTruthy());
  return view;
}
const sheetOf = () => document.querySelector(".sheet-scrim") as HTMLElement;
afterEach(() => { vi.restoreAllMocks(); });

/** The template standard opens a page as a filled example. These tests measure the empty page, so they clear it first, as a person does with one tap. */
async function clearExampleIfAny() {
  const row = screen.queryByText("This Is an Example");
  if (!row) return;
  fireEvent.click(row);
  await waitFor(() => expect(screen.queryByText("This Is an Example")).toBeNull());
}

/** The picker, open. */
async function openPicker(user: string) {
  const view = await mount(user);
  fireEvent.click(await screen.findByText("Use a Template", {}, { timeout: 4000 }));
  await screen.findByText("Sports");
  return view;
}

/** A template that is no longer in the picker (folded into another on 2026-10-23) still opens ready from a page made earlier: seeded
 *  through the store and opened by id, exactly as a person's old page is. */
async function openSeeded(user: string, key: TemplateKey) {
  const view = await mount(user);
  let id = "";
  await act(async () => { id = (await svcRef!.createPage(TEMPLATES[key].name, newTemplatePage(key)))!; });
  view.rerender(<NotesProvider userId={user}><Grab /><NotesFlow openId={id} /></NotesProvider>);
  return id;
}

/** The page's structure as drawn: section heads, rows in cards, and anything at all beyond a counter and one Add. */
function drawn() {
  const heads = [...document.querySelectorAll(".sh2 .t")].map((h) => h.textContent ?? "");
  const rows = document.querySelectorAll(".card .row").length;
  const adds = [...document.querySelectorAll(".sh2 .pill-action")].filter((b) => /^Add /.test(b.textContent ?? "")).length;
  const words = document.querySelectorAll(".input-hint").length;
  return { heads, rows, adds, words };
}

/** Not an empty shell: more than one head, or a row, or words of its own under the head; and never a count of zero over nothing. */
function expectReady(name: string) {
  const d = drawn();
  const shell = d.heads.length <= 1 && d.rows === 0 && d.words === 0;
  expect(shell, `${name} opened as an empty shell: heads ${JSON.stringify(d.heads)}, rows ${d.rows}, adds ${d.adds}`).toBe(false);
  expect(screen.queryByText(/^0 [A-Z]/), `${name} says a count of zero`).toBeNull();
}

// The 24 that opened as a shell, each with what a ready open shows. A "head" is a section head's words; a "text" is anywhere on the page.
const WERE_SHELLS: { name: string; seed?: TemplateKey; pick: string[]; heads: string[]; texts?: (string | RegExp)[]; adds?: number }[] = [
  { name: "Team Sheet", pick: ["Team Sheet"], heads: ["Players", "Starts With"], texts: ["Add Player", "Edit Fields", "Name", "Number", "Position"] },
  { name: "Outreach Tracker", pick: ["Outreach Tracker"], heads: ["Contacts", "Starts With"], texts: ["Add Contact", "Who", "Organization", "Status"] },
  { name: "Session Plan", pick: ["Session Plan"], heads: ["Warm-Up", "Drills", "Scrimmage", "Cool-Down", "Headings"], texts: ["Start Time", "15 Min"], adds: 4 },
  { name: "Event Day Pack", pick: ["Event Day Pack"], heads: ["Before You Go", "Bring", "People", "Timeline"], texts: ["Tickets", "Directions", "Water", "Arrive", "Start Time"], adds: 4 },
  { name: "Scouting Report", pick: ["Scouting Report"], heads: ["Reports", "Starts With", "Suggested"], texts: ["Add Report", "Strengths", "Weaknesses", "Position"] },
  { name: "League Standings", seed: "standings", pick: ["League Standings"], heads: ["Standings", "Teams"], texts: ["Add Team", "Won-Lost", "Points", "For-Against"] },
  { name: "Group Manager Page", seed: "group", pick: ["Group Manager Page"], heads: ["Leaders", "Members", "Starts With"], texts: ["Role", "Dues Paid"], adds: 2 },
  { name: "Home and Vehicle Book", pick: ["Home and Vehicle Book", "Home and Vehicle Book"], heads: ["Home", "Vehicles", "Appliances", "Purchases and Warranties", "Starts With"], texts: ["Make and Model", "Next Due"], adds: 4 },
  { name: "Health Card", pick: ["Health Card", "Person"], heads: ["Allergies", "Conditions", "Doctors", "Emergency Contacts"], texts: ["Medications Live in Health; This Card Does Not Copy Them"], adds: 4 },
  { name: "Handover Sheet", pick: ["Handover Sheet", "Handover Sheet"], heads: ["Right Now", "Every Day", "If Something Goes Wrong", "Contacts"], texts: ["Write What Someone Covering for You Needs to Know"], adds: 4 },
  { name: "People and Occasions", pick: ["People and Occasions"], heads: ["Occasions", "Starts With"], texts: ["Add Occasion", "Gift Ideas", "Budget", "A Date Comes Round Every Year; the Page Says When One Is Near"] },
  { name: "Trip Sheet", pick: ["Trip Sheet", "Trip Sheet"], heads: ["Getting There", "Staying", "Doing", "Packing"], texts: ["Flights", "Hotel"], adds: 4 },
  { name: "Kitchen Page", pick: ["Kitchen Page", "Recipes"], heads: ["Mains", "Sides", "Desserts", "Other", "Starts With"], texts: ["Ingredients", "Directions"], adds: 4 },
  { name: "Money Map", pick: ["Money Map", "Money Map"], heads: ["Banking", "Cards and Loans", "Investing", "Policies", "Subscriptions and Renewals", "For My Family", "Other", "Starts With"], texts: ["Where to Find It", "Names and Places Only; No Passwords, PINs or Full Account Numbers"], adds: 7 },
  { name: "Insurance Page", seed: "insurance", pick: ["Insurance Page"], heads: ["Home and Auto", "Health and Life", "Other", "Starts With"], texts: ["Carrier", "Renews", "Premium"], adds: 3 },
  { name: "Giving Log", pick: ["Giving Log"], heads: ["Gifts", "Starts With", "Suggested"], texts: ["Add Gift", "Amount", "Receipt"] },
  { name: "1:1 Log", pick: ["1:1 Log"], heads: ["Meetings", "Starts With"], texts: ["Add Meeting", "Topics", "Follow-Ups", "Next 1:1"] },
  { name: "Project Tracker", pick: ["Project Tracker"], heads: ["Not Started", "In Progress", "Blocked", "Done", "Starts With"], texts: ["Owner", "Due"], adds: 4 },
  { name: "Business Ledger", pick: ["Money Map", "Business Ledger"], heads: ["Entries"], texts: ["Category", "Year", "Business", "Every Year", /Nothing in Money for/] },
  { name: "Watch List", pick: ["Watch List"], heads: ["Up Next", "Watching", "Watched", "Starts With"], texts: ["Where to Watch", "How It Was"], adds: 3 },
  { name: "Party Planner", pick: ["Party Planner"], heads: ["Guests", "Food and Drink", "Supplies", "Schedule", "To Do"], texts: ["Send Invites"], adds: 5 },
  { name: "Running Order", seed: "runorder", pick: ["Running Order"], heads: ["Before", "Show", "After"], texts: ["Doors Open", "Opening", "Strike", "Start Time"], adds: 3 },
  { name: "Poker Night", pick: ["Poker Night"], heads: ["Players", "Starts With", "Settle Up"], texts: ["Add Player", "Buy-In", "Rebuys", "Cash-Out", "Add Players, Their Buy-Ins and Cash-Outs to See Who Owes Whom"] },
];

describe("the 24 templates that opened as an empty shell open ready", () => {
  for (const t of WERE_SHELLS) {
    it(t.name, async () => {
      if (t.seed) await openSeeded("u-ready-" + t.name.replace(/\W+/g, "-").toLowerCase(), t.seed);
      else {
        await openPicker("u-ready-" + t.name.replace(/\W+/g, "-").toLowerCase());
        fireEvent.click(screen.getByText(t.pick[0]!));
        if (t.pick.length > 1) fireEvent.click(await within(await waitFor(() => { const el = document.querySelector(".action-sheet") as HTMLElement; expect(el).toBeTruthy(); return el; })).findByText(t.pick[1]!));
      }
      await screen.findByLabelText("Page options", {}, { timeout: 4000 }); await clearExampleIfAny();
      expectReady(t.name);
      const d = drawn();
      for (const h of t.heads) expect(d.heads, `${t.name}: head ${h}`).toContain(h);
      for (const x of t.texts ?? []) expect(screen.getAllByText(x).length, `${t.name}: ${String(x)}`).toBeGreaterThan(0);
      if (t.adds !== undefined) expect(d.adds, `${t.name}: one Add per heading`).toBe(t.adds);
    });
  }
  it("To-Do / Checklist opens as a checklist with its first item ready", async () => {
    await openPicker("u-ready-todo");
    fireEvent.click(screen.getByText("To-Do / Checklist"));
    await screen.findByLabelText("Note", {}, { timeout: 4000 });
    await waitFor(() => expect(document.querySelectorAll("ul[data-type='taskList'] li").length).toBe(1));
  });
});

// The 16 that were ready keep their anchors.
describe("the 16 that were ready still open as they did", () => {
  const PAGES: { name: string; seed?: TemplateKey; pick: string[]; anchors: string[] }[] = [
    { name: "Pitching Board", pick: ["Pitching Board"], anchors: ["Rules", "Daily Limit", "Add Outing"] },
    { name: "Profile One-Pager", seed: "profile", pick: ["Profile One-Pager"], anchors: ["Profile", "Edit Profile", "Add What You Want on the Page; Empty Fields Stay Off It"] },
    { name: "Training Log", pick: ["Training Plan", "Training Log"], anchors: ["From Health", "Workouts Are Read From Health, Never Copied; This Page Keeps No Entries of Its Own"] },
    { name: "Training Plan", pick: ["Training Plan", "Training Plan"], anchors: ["Week 1", "Add Day"] },
    { name: "Accomplishments and Milestones", pick: ["Accomplishments and Milestones"], anchors: ["Add Entry", "Starts With"] },
    { name: "Debt Payoff", pick: ["Debt Payoff"], anchors: ["Pay First", "Extra Each Month", "Add Debt"] },
    { name: "Brackets and Pools", pick: ["Brackets and Pools"], anchors: ["Format", "Single Elimination", "Add Entrant"] },
    { name: "Fantasy Draft Board", seed: "draft", pick: ["Fantasy Draft Board"], anchors: ["Teams", "Order", "Add Pick"] },
  ];
  for (const t of PAGES) {
    it(t.name, async () => {
      if (t.seed) await openSeeded("u-ready16-" + t.name.replace(/\W+/g, "-").toLowerCase(), t.seed);
      else {
        await openPicker("u-ready16-" + t.name.replace(/\W+/g, "-").toLowerCase());
        // Accomplishments and Milestones sits under Life AND Professional (the 2026-10-13 spec): two rows, one template.
        fireEvent.click(screen.getAllByText(t.pick[0]!)[0]!);
        if (t.pick.length > 1) fireEvent.click(await within(await waitFor(() => { const el = document.querySelector(".action-sheet") as HTMLElement; expect(el).toBeTruthy(); return el; })).findByText(t.pick[1]!));
      }
      await screen.findByLabelText("Page options", {}, { timeout: 4000 }); await clearExampleIfAny();
      expectReady(t.name);
      for (const a of t.anchors) expect(screen.getAllByText(a).length, `${t.name}: ${a}`).toBeGreaterThan(0);
    });
  }
  it("Golf Scorecard starts at its round sheet and opens on its round", async () => {
    await openPicker("u-ready16-golf");
    fireEvent.click(screen.getByText("Golf Scorecard"));
    fireEvent.click(await screen.findByText("New Round"));
    fireEvent.change(await screen.findByPlaceholderText("Player 1"), { target: { value: "Ava" } });
    fireEvent.click(within(sheetOf()).getByText("Start"));
    await screen.findByLabelText("Page options", {}, { timeout: 4000 }); await clearExampleIfAny();
    for (const a of ["Scores", "Round", "Course", "Holes", "Start Hole 1"]) expect(screen.getAllByText(a).length, a).toBeGreaterThan(0);
  });
  it("Scoreboard picks its game and opens on the score", async () => {
    await openPicker("u-ready16-score");
    fireEvent.click(screen.getByText("Scoreboard"));
    // The Scoreboard row asks which one (its League Standings view sits under it, 2026-10-23).
    fireEvent.click(await within(await waitFor(() => { const el = document.querySelector(".action-sheet") as HTMLElement; expect(el).toBeTruthy(); return el; })).findByText("Scoreboard"));
    fireEvent.click(await screen.findByText("Basketball"));
    fireEvent.click(within(sheetOf()).getByText("Start"));
    await screen.findByLabelText("Page options", {}, { timeout: 4000 }); await clearExampleIfAny();
    for (const a of ["Score", "Game", "Sport", "Add a Side", "Start Quarter 1"]) expect(screen.getAllByText(a).length, a).toBeGreaterThan(0);
  });
  it("Lineup Card opens on its batting order", async () => {
    const user = "u-ready16-lineup";
    const view = await mount(user);
    let team = newTeamPage();
    team = addRecord(team, { name: "Ava Chen", number: "7", position: "Pitcher" }).page;
    const teamId = (await svcRef!.createPage("Tigers", team, ""))!;
    const id = (await svcRef!.createPage("Tigers Lineup", newLineupPage({ id: teamId, title: "Tigers", page: team }, [{ playerId: team.records[0]!.id }], "2026-10-16", Date.now()), ""))!;
    view.rerender(<NotesProvider userId={user}><Grab /><NotesFlow openId={id} /></NotesProvider>);
    await screen.findByLabelText("Page options", {}, { timeout: 4000 }); await clearExampleIfAny();
    for (const a of ["Batting Order", "Team Sheet", "Date", "Ava Chen"]) expect(screen.getAllByText(a).length, a).toBeGreaterThan(0);
  });
  for (const [name, anchor] of [["Meeting Notes", "Agenda"], ["Project Brief", "Objective"], ["Log / Journal", "Log"], ["Tracker", ""], ["Blank", ""]] as const) {
    it(name, async () => {
      await openPicker("u-ready16-" + name.replace(/\W+/g, "-").toLowerCase());
      fireEvent.click(screen.getByText(name));
      await screen.findByLabelText("Note", {}, { timeout: 4000 });
      await waitFor(() => expect(document.querySelector(".ProseMirror")).toBeTruthy());
      if (anchor) expect(within(document.querySelector(".ProseMirror") as HTMLElement).getAllByText(anchor).length).toBeGreaterThan(0);
      if (name === "Tracker") await waitFor(() => expect(document.querySelector(".ProseMirror table")).toBeTruthy());
      // Meeting Notes' Action Items and the Brief's Tasks render a checklist with one item ready, as To-Do does.
      if (name === "Meeting Notes" || name === "Project Brief") await waitFor(() => expect(document.querySelectorAll("ul[data-type='taskList'] li").length).toBe(1));
    });
  }
});

describe("the catalog covers what the picker holds", () => {
  it("every template in the picker is in one of the two lists above", () => {
    // 2026-10-23, Dave's cut list: Lineup Card folded into the Team Sheet, six templates folded into others (retired) and two became views
    // under their parents (presets, one tap further in). The picker lists the three core pages, every catalog template that is neither a
    // preset nor retired, and the six note templates.
    const pages = ["Golf Scorecard", "Team Sheet", "Outreach Tracker", ...TEMPLATE_KEYS.filter((k) => !TEMPLATES[k].parent && !TEMPLATES[k].retired).map((k) => TEMPLATES[k].shelfName ?? TEMPLATES[k].name)];
    const docs = ["Blank", "Meeting Notes", "To-Do / Checklist", "Tracker", "Project Brief", "Log / Journal"];
    const all = [...pages, ...docs];
    expect(pages).toHaveLength(25);
    expect(all).toHaveLength(31);
    const covered = new Set([...WERE_SHELLS.map((t) => t.name), "To-Do / Checklist", "Pitching Board", "Profile One-Pager", "Training Log", "Training Plan", "Accomplishments and Milestones", "Debt Payoff", "Brackets and Pools", "Fantasy Draft Board", "Golf Scorecard", "Scoreboard", "Lineup Card", "Meeting Notes", "Project Brief", "Log / Journal", "Tracker", "Blank"]);
    for (const n of all) expect(covered.has(n), n).toBe(true);
    expect(WERE_SHELLS.length + 1).toBe(24);
  });
});
