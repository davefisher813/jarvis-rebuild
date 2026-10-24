// @vitest-environment jsdom
// THE TEMPLATE STANDARD, PART 2 (quick entry, Repeat Last, today's date). Header as stage 1:
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
import { type PageData } from "./pageModel";

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
afterEach(() => { vi.restoreAllMocks(); });

async function openGiving(user: string) {
  await mount(user);
  fireEvent.click(await screen.findByText("Use a Template", {}, { timeout: 4000 }));
  fireEvent.click(await screen.findByText("Giving Log"));
  fireEvent.click(await screen.findByText("This Is an Example", {}, { timeout: 4000 }));
  await waitFor(() => expect(screen.queryByText("This Is an Example")).toBeNull());
}

describe("template standard: quick entry, Repeat Last and today's date", () => {
  it("a name typed in the page and Return makes the row, dated today", async () => {
    await openGiving("u-std-quick");
    const box = await screen.findByLabelText("Quick Add Gift");
    fireEvent.change(box, { target: { value: "Library Fund" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(async () => expect((await pageOf("giving"))!.page.records.map((r) => r.v.to)).toEqual(["Library Fund"]));
    expect((await pageOf("giving"))!.page.records[0]!.v.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("a new row opens with today's date and offers Repeat Last once a row exists", async () => {
    await openGiving("u-std-repeat");
    fireEvent.click(await screen.findByText("Add Gift"));
    const date = (await screen.findByLabelText("Date")) as HTMLInputElement;
    expect(date.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(screen.queryByText("Repeat Last")).toBeNull();
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "Food Bank" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "25" } });
    fireEvent.click(within(document.querySelector(".sheet-scrim") as HTMLElement).getByText("Add"));
    await waitFor(async () => expect((await pageOf("giving"))!.page.records.length).toBe(1));
    fireEvent.click(await screen.findByText("Add Gift"));
    fireEvent.click(await screen.findByText("Repeat Last"));
    expect((screen.getByLabelText("To") as HTMLInputElement).value).toBe("Food Bank");
    expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("25");
  });
});
