// @vitest-environment jsdom
// TEMPLATES WAVE 4 (issue #115, Entertainment), through the real Notes flow over the real store.
import "../../shared/tiptapTest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Store, InMemoryAdapter, type Item, type ItemData } from "@core";
import { NotesProvider, useNotes } from "../../data/NotesProvider";
import NotesFlow from "../NotesFlow";
import { TEMPLATE_KEYS, TEMPLATES, newTemplatePage } from "./templateDefs";
import { addRecord } from "./pageModel";

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
type Pg = import("./pageModel").PageData;
const pageOf = async (kind: string) => { const n = (await svcRef!.listNotes()).find((x) => (x.data as unknown as { page?: { kind?: string } }).page?.kind === kind && !(x.data as { deletedAt?: number }).deletedAt); return n ? { id: n.id, page: (n.data as unknown as { page: Pg }).page } : null; };
const sheetOf = () => document.querySelector(".sheet-scrim") as HTMLElement;
afterEach(() => { vi.restoreAllMocks(); });

// Open a page that already holds some rows (made directly, so the test is about the page and not about typing).
async function openWith(user: string, kind: (typeof TEMPLATE_KEYS)[number], build: (p: Pg) => Pg) {
  const view = await mount(user);
  const id = await svcRef!.createPage(TEMPLATES[kind].name, build(newTemplatePage(kind)), "");
  view.rerender(<NotesProvider userId={user}><Grab /><NotesFlow openId={id!} /></NotesProvider>);
  await screen.findByLabelText("Page options", {}, { timeout: 4000 });
}
const withRows = (rows: Record<string, string>[]) => (p: Pg) => rows.reduce((acc, r) => addRecord(acc, r).page, p);

describe("the picker", () => {
  it("lists the Entertainment shelf with all six", async () => {
    await mount("u-w4-picker");
    fireEvent.click(await screen.findByText("Use a Template", {}, { timeout: 4000 }));
    await screen.findByText("Entertainment");
    for (const n of ["Brackets and Pools", "Fantasy Draft Board", "Watch List", "Party Planner", "Running Order", "Poker Night"]) expect(screen.getByText(n), n).toBeInTheDocument();
  });
});

describe("Brackets and Pools", () => {
  it("draws the rounds, and a picked winner moves on by themselves", async () => {
    await openWith("u-w4-bracket", "bracket", withRows([{ name: "Hawks" }, { name: "Owls" }, { name: "Wolves" }, { name: "Bears" }]));
    expect(await screen.findByText("Semifinals")).toBeInTheDocument();
    expect(screen.getByText("Final")).toBeInTheDocument();
    // Seed 1 meets seed 4; the final waits on the semifinal winners.
    fireEvent.click(screen.getAllByText("Pick a Winner")[0]!);
    fireEvent.click(within(await waitFor(() => { const el = document.querySelector(".action-sheet") as HTMLElement; expect(el).toBeTruthy(); return el; })).getByText("Hawks"));
    expect(await screen.findByText("Hawks Won", {}, { timeout: 4000 })).toBeInTheDocument();
    await waitFor(async () => expect(Object.keys((await pageOf("bracket"))!.page.meta ?? {}).filter((k) => k.startsWith("w:")).length).toBe(1));
  });
  it("Round Robin shows the standings the other pages use", async () => {
    await openWith("u-w4-pool", "bracket", (p) => withRows([{ name: "Hawks" }, { name: "Owls" }])({ ...p, meta: { ...(p.meta ?? {}), format: "pool" } }));
    expect(await screen.findByText("Standings")).toBeInTheDocument();
    expect(screen.getByText("Round Robin")).toBeInTheDocument();
    expect(screen.queryByText("Semifinals")).toBeNull();
  });
});

describe("Fantasy Draft Board", () => {
  it("names who is on the clock and puts each pick under its round", async () => {
    await openWith("u-w4-draft", "draft", (p) => withRows([{ player: "A. Rivera" }, { player: "B. Okafor" }, { player: "C. Stone" }])({ ...p, meta: { teams: "Sam, Dana, Lee", snake: "1" } }));
    expect(await screen.findByText("Round 1", { selector: ".sh2 .t, .t" })).toBeInTheDocument();
    expect(screen.getByText(/Lee Is on the Clock|Is on the Clock/)).toBeInTheDocument();
    expect(screen.getAllByText("A. Rivera").length).toBeGreaterThan(0);
  });
  it("teams are set on the page, and the order can be changed", async () => {
    await openWith("u-w4-draft2", "draft", (p) => p);
    fireEvent.click(await screen.findByText("Teams"));
    fireEvent.change(await screen.findByPlaceholderText("Sam, Dana, Lee"), { target: { value: "Sam, Dana, Lee" } });
    fireEvent.click(within(sheetOf()).getByText("Save"));
    expect(await screen.findByText("3 Teams", {}, { timeout: 4000 })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Order"));
    fireEvent.click(await screen.findByText("Straight"));
    expect(await screen.findByText("Straight", { selector: ".row *" }, { timeout: 4000 })).toBeInTheDocument();
  });
});

describe("Poker Night", () => {
  it("shows who is up and down and settles a balanced table", async () => {
    await openWith("u-w4-poker", "poker", withRows([
      { name: "Sam", buyin: "20", cashout: "80" }, { name: "Dana", buyin: "20", cashout: "0" }, { name: "Lee", buyin: "20", cashout: "0" }, { name: "Jo", buyin: "20", cashout: "0" },
    ]));
    expect(await screen.findByText("Settle Up")).toBeInTheDocument();
    expect(screen.getByText("Pot $80")).toBeInTheDocument();
    expect(screen.getAllByText(/Pays/).length).toBe(3);
  });
  it("a table that does not balance says so instead of settling", async () => {
    await openWith("u-w4-poker2", "poker", withRows([{ name: "Sam", buyin: "20", cashout: "50" }, { name: "Dana", buyin: "20", cashout: "0" }]));
    expect(await screen.findByText(/Cash-Outs Are \$10 Over the Pot/)).toBeInTheDocument();
    expect(screen.queryByText("Settle Up")).toBeNull();
  });
});

describe("Running Order, Party Planner and Watch List ride the shared engine", () => {
  it("Running Order puts a clock on each item from the start time", async () => {
    await openWith("u-w4-run", "runorder", (p) => withRows([{ item: "Doors", min: "30" }, { item: "Opening Act", min: "20" }])({ ...p, meta: { ...(p.meta ?? {}), start: "19:00" } }));
    expect(await screen.findByText("7:00 PM")).toBeInTheDocument();
    expect(screen.getByText("7:30 PM")).toBeInTheDocument();
  });
  it("Party Planner totals what it costs", async () => {
    await openWith("u-w4-party", "party", withRows([{ item: "Cake", cost: "40" }, { item: "Balloons", cost: "12.50" }]));
    expect(await screen.findByText("$52.50")).toBeInTheDocument();
  });
  it("Watch List opens with every heading drawn, each with its own Add, and no count of zero", async () => {
    await openWith("u-w4-watch", "watchlist", (p) => p);
    for (const h of ["Up Next", "Watching", "Watched"]) expect(screen.getByText(h)).toBeInTheDocument();
    expect(screen.getAllByText("Add Title")).toHaveLength(3);
    expect(screen.queryByText(/^0 /)).toBeNull();
    // What its rows will carry, and the fields it offers in one tap.
    expect(screen.getByText("Starts With")).toBeInTheDocument();
    expect(screen.getByText("Edit Fields")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Length"));
    await waitFor(async () => expect((await pageOf("watchlist"))!.page.fields.some((f) => f.key === "length")).toBe(true), { timeout: 4000 });
  });
});

describe("every wave 4 template opens and draws its row", () => {
  for (const k of TEMPLATE_KEYS.filter((x) => TEMPLATES[x].wave === 4)) {
    it(TEMPLATES[k].name, async () => {
      const d = TEMPLATES[k];
      await openWith("u-w4-smoke-" + k, k, (p) => addRecord(p, { [d.headline]: "Sample " + d.noun }).page);
      expect((await screen.findAllByText("Sample " + d.noun, {}, { timeout: 4000 })).length).toBeGreaterThan(0);
      expect(screen.getByLabelText("Export or Share")).toBeInTheDocument();
      fireEvent.click(screen.getByLabelText("Page options"));
      expect(screen.getByText("Save as My Template")).toBeInTheDocument();
    });
  }
});
