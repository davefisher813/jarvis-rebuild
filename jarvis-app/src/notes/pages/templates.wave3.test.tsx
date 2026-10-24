// @vitest-environment jsdom
// TEMPLATES WAVE 3 (issue #115: Finance, the rest of Life, Professional), through the real Notes flow over the real store: the picker and its
// "which one?" for a template with presets, pointers only, confirmation, and the three pages that read the rest of the app.
import "../../shared/tiptapTest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Store, InMemoryAdapter, type Item, type ItemData } from "@core";
import { NotesProvider, useNotes, useMoney, useTracker, usePeople } from "../../data/NotesProvider";
import NotesFlow from "../NotesFlow";
import { resetToasts, subscribeToast, type ToastState } from "../../shared/toast";

class SlowAdapter extends InMemoryAdapter {
  private beat() { return new Promise((r) => setTimeout(r, 5)); }
  override async read(o: string, id: string): Promise<Item | null> { await this.beat(); return super.read(o, id); }
  override async apply(o: string, id: string, p: ItemData, t?: number): Promise<boolean> { await this.beat(); return super.apply(o, id, p, t); }
}
vi.mock("../../data/store", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../data/store")>();
  return { ...mod, makeStore: () => new Store(new SlowAdapter()) };
});

let svcs: { notes: ReturnType<typeof useNotes>; money: ReturnType<typeof useMoney>; tracker: ReturnType<typeof useTracker>; people: ReturnType<typeof usePeople> } | null = null;
function Grab() { svcs = { notes: useNotes(), money: useMoney(), tracker: useTracker(), people: usePeople() }; return null; }

async function mount(user: string) {
  svcs = null;
  const view = render(<NotesProvider userId={user}><Grab /><NotesFlow /></NotesProvider>);
  await waitFor(() => expect(svcs).toBeTruthy());
  return view;
}
type Pg = import("./pageModel").PageData;
const pageOf = async (kind: string) => { const n = (await svcs!.notes.listNotes()).find((x) => (x.data as unknown as { page?: { kind?: string } }).page?.kind === kind && !(x.data as { deletedAt?: number }).deletedAt); return n ? { id: n.id, page: (n.data as unknown as { page: Pg }).page } : null; };
const sheetOf = () => document.querySelector(".sheet-scrim") as HTMLElement;

const toasts: ToastState[] = [];
subscribeToast((t) => { if (t) toasts.push(t); });
afterEach(() => { vi.restoreAllMocks(); resetToasts(); toasts.length = 0; });

async function openTemplates(user: string) {
  const view = await mount(user);
  fireEvent.click(await screen.findByText("Use a Template", {}, { timeout: 4000 }));
  await screen.findByText("Sports");
  return view;
}
/** Picked from the picker; a template with presets under it (Money Map's Business Ledger) asks which one, so the second name is that tap. */
async function openPicked(user: string, name: string, entry?: string) {
  const view = await openTemplates(user);
  fireEvent.click(screen.getByText(name));
  if (entry) {
    fireEvent.click(await within(await waitFor(() => { const el = document.querySelector(".action-sheet") as HTMLElement; expect(el).toBeTruthy(); return el; })).findByText(entry));
  }
  await screen.findByLabelText("Page options", {}, { timeout: 4000 });
  return view;
}

describe("the picker", () => {
  it("lists Finance, the rest of Life and Professional, with presets one tap further in", async () => {
    await openTemplates("u-w3-picker");
    for (const n of ["Money Map", "Debt Payoff", "Giving Log", "Home and Vehicle Book", "Health Card", "Handover Sheet", "People and Occasions", "Trip Sheet", "Kitchen Page", "1:1 Log", "Project Tracker"]) {
      expect(screen.getByText(n), n).toBeInTheDocument();
    }
    // Accomplishments and Milestones is listed under Life AND Professional (the 2026-10-13 spec): two rows, one template, one page.
    const both = screen.getAllByText("Accomplishments and Milestones");
    expect(both).toHaveLength(2);
    const shelfOf = (el: HTMLElement) => el.closest(".lib-row")!.parentElement!.querySelector(".sh2 .t")!.textContent;
    expect(both.map((el) => shelfOf(el)).sort()).toEqual(["Life", "Professional"]);
    for (const n of ["Home Inventory", "Pet Card", "Care Record", "Expenses to Submit", "Meal Plan", "Freezer", "Recipes", "Business Ledger", "Insurance Page"]) expect(screen.queryByText(n), n + " is not a row of its own").toBeNull();
    for (const shelf of ["Finance", "Professional"]) expect(screen.getByText(shelf)).toBeInTheDocument();
  });
  it("a template with presets asks which one, and the choice is the page that opens", async () => {
    await openTemplates("u-w3-which");
    fireEvent.click(screen.getByText("Kitchen Page"));
    const sheet = await screen.findByText("Kitchen Page: Which One?");
    expect(sheet).toBeInTheDocument();
    expect([...document.querySelectorAll(".action-sheet button")].map((b) => b.textContent)).toEqual(["Recipes", "Meal Plan", "Freezer", "Cancel"]);
    fireEvent.click(screen.getByText("Meal Plan"));
    await screen.findByLabelText("Page options", {}, { timeout: 4000 });
    await waitFor(async () => expect(await pageOf("mealplan")).toBeTruthy());
    expect(await pageOf("recipes")).toBeNull();
  });
});

describe("Money Map keeps pointers only", () => {
  it("refuses a password and says which field, keeps a place, and confirms when asked", async () => {
    await openPicked("u-w3-map", "Money Map", "Money Map");
    fireEvent.click(screen.getByLabelText("Add Pointer Under Banking"));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Chase Checking" } });
    fireEvent.change(screen.getByLabelText("Where to Find It"), { target: { value: "online login: dave / hunter2" } });
    fireEvent.click(within(sheetOf()).getByText("Add"));
    await waitFor(() => expect(toasts.some((t) => /Where to Find It Looks Like a Way In/.test(t.message))).toBe(true));
    expect((await pageOf("moneymap"))!.page.records.length).toBe(0);
    // A place is a pointer.
    fireEvent.change(screen.getByLabelText("Where to Find It"), { target: { value: "Blue folder, file cabinet" } });
    fireEvent.click(within(sheetOf()).getByText("Add"));
    expect(await screen.findByText("Chase Checking", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText("Not Confirmed")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Confirm Everything Is Still True"));
    await waitFor(() => expect(screen.getByText(/^Confirmed /)).toBeInTheDocument());
    await waitFor(async () => expect((await pageOf("moneymap"))!.page.records[0]?.confirmedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/));
  });
  it("has no field for a way in", async () => {
    await openPicked("u-w3-map-fields", "Money Map", "Money Map");
    fireEvent.click(screen.getByLabelText("Page options"));
    fireEvent.click(screen.getByText("Fields"));
    fireEvent.change(await screen.findByLabelText("New field name"), { target: { value: "Password" } });
    fireEvent.click(within(sheetOf()).getByText("Save"));
    await waitFor(() => expect(toasts.some((t) => /Pointers Only/.test(t.message))).toBe(true));
    expect((await pageOf("moneymap"))!.page.fields.some((f) => /password/i.test(f.label))).toBe(false);
  });
});

describe("Debt Payoff reads Money", () => {
  it("adds a card from Money by pointer, draws its balance and a plan, and holds no balance of its own", async () => {
    await mount("u-w3-debt");
    await svcs!.money.create({ name: "Visa", balance: 2000, kind: "credit", asOf: "2026-10-01" });
    fireEvent.click(await screen.findByText("Use a Template", {}, { timeout: 4000 }));
    fireEvent.click(await screen.findByText("Debt Payoff"));
    await screen.findByLabelText("Page options", {}, { timeout: 4000 });
    fireEvent.click(await screen.findByText("Add From Money"));
    fireEvent.click(await screen.findByText("Visa"));
    expect((await screen.findAllByText("$2,000", {}, { timeout: 4000 })).length).toBeGreaterThan(0);
    await waitFor(async () => expect((await pageOf("debt"))!.page.records.length).toBe(1));
    const page = (await pageOf("debt"))!.page;
    expect(page.records[0]!.link).toBeTruthy();
    expect(page.records[0]!.v.balance).toBeUndefined();
    // With a rate and a minimum there is a plan.
    fireEvent.click(screen.getByText("Visa"));
    fireEvent.change(await screen.findByLabelText("APR %"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("Minimum"), { target: { value: "100" } });
    fireEvent.click(within(sheetOf()).getByText("Save"));
    expect(await screen.findByText(/Debt-Free in/, {}, { timeout: 4000 })).toBeInTheDocument();
    // Money stays the one ledger: the account is untouched.
    expect((await svcs!.money.list())[0]!.data.balance).toBe(2000);
  });
});

describe("Business Ledger is a view over Money", () => {
  it("shows the tagged spending read from Money, stores no rows, and has no import", async () => {
    await mount("u-w3-biz");
    await svcs!.tracker.saveTx(null, { date: "2026-03-04", month: "2026-03", merchant: "Staples", name: "Staples", amountCents: 4599, category: "Business", account: "Visa" });
    await svcs!.tracker.saveTx(null, { date: "2026-03-05", month: "2026-03", merchant: "Grocer", name: "Grocer", amountCents: 8000, category: "Groceries", account: "Visa" });
    fireEvent.click(await screen.findByText("Use a Template", {}, { timeout: 4000 }));
    fireEvent.click(await screen.findByText("Money Map"));
  fireEvent.click(await within(await waitFor(() => { const el = document.querySelector(".action-sheet") as HTMLElement; expect(el).toBeTruthy(); return el; })).findByText("Business Ledger"));
    expect(await screen.findByText("Staples", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByText("Grocer")).toBeNull();
    expect(screen.getAllByText("$45.99").length).toBeGreaterThan(0);
    expect((await pageOf("bizledger"))!.page.records.length).toBe(0);
    fireEvent.click(screen.getByLabelText("Page options"));
    expect(screen.queryByText("Import Rows")).toBeNull();
    expect(screen.queryByText("Fields")).toBeNull();
  });
});

describe("People and Occasions suggests from People, and adds only on a tap", () => {
  it("offers a birthday and adds it when asked", async () => {
    await mount("u-w3-occ");
    await svcs!.people.create({ name: "Sam Okafor", group: "contacts", birthday: "1990-11-09" } as never);
    fireEvent.click(await screen.findByText("Use a Template", {}, { timeout: 4000 }));
    fireEvent.click(await screen.findByText("People and Occasions"));
    expect(await screen.findByText("From People", {}, { timeout: 4000 })).toBeInTheDocument();
    expect((await pageOf("occasions"))!.page.records.length).toBe(0);
    fireEvent.click(screen.getByText("Sam Okafor"));
    await waitFor(async () => expect((await pageOf("occasions"))!.page.records.length).toBe(1));
    expect((await pageOf("occasions"))!.page.records[0]!.v).toMatchObject({ name: "Sam Okafor", occasion: "Birthday" });
  });
});

// EVERY ONE OF THEM OPENS AND DRAWS (a smoke over the whole wave): a page of each kind with one row opens, names its row and its noun, and
// has the controls the engine gives every template.
import { TEMPLATE_KEYS, TEMPLATES, newTemplatePage } from "./templateDefs";
import { addRecord } from "./pageModel";

describe("every wave 3 template opens and draws its row", () => {
  const keys = TEMPLATE_KEYS.filter((k) => TEMPLATES[k].wave === 3);
  for (const k of keys) {
    it(`${TEMPLATES[k].name}`, async () => {
      const view = await mount("u-w3-smoke-" + k);
      const d = TEMPLATES[k];
      let page = newTemplatePage(k);
      if (!d.derived) page = addRecord(page, { [d.headline]: "Sample " + d.noun }).page;
      let id: string | null = null;
      id = await svcs!.notes.createPage(d.name, page, "");
      view.rerender(<NotesProvider userId={"u-w3-smoke-" + k}><Grab /><NotesFlow openId={id!} /></NotesProvider>);
      await screen.findByLabelText("Page options", {}, { timeout: 4000 });
      if (!d.derived) expect(await screen.findByText("Sample " + d.noun, {}, { timeout: 4000 })).toBeInTheDocument();
      expect(screen.getByLabelText("Export or Share")).toBeInTheDocument();
      fireEvent.click(screen.getByLabelText("Page options"));
      expect(screen.getByText("Save Snapshot")).toBeInTheDocument();
      expect(screen.getByText("Duplicate Page")).toBeInTheDocument();
    });
  }
});
