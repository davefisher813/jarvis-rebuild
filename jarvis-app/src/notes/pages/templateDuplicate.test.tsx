// @vitest-environment jsdom
// A TEMPLATE PAGE THAT ALREADY EXISTS IS NEVER SILENTLY MADE AGAIN (Alfred's deep audit 2026-10-13: Team Sheet quietly added a second
// "Team Sheet, 0 Players"). Through the real Notes flow over the real store.
import "../../shared/tiptapTest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Store, InMemoryAdapter, type Item, type ItemData } from "@core";
import { NotesProvider, useNotes } from "../../data/NotesProvider";
import NotesFlow from "../NotesFlow";

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
const count = async (kind: string) => (await svc().listNotes()).filter((n) => (n.data as unknown as { page?: { kind?: string } }).page?.kind === kind && !(n.data as { deletedAt?: number }).deletedAt).length;

afterEach(() => { vi.restoreAllMocks(); });

describe.each([["Team Sheet", "team"], ["Outreach Tracker", "outreach"]])("choosing %s from the picker", (name, kind) => {
  it("makes the first one, then asks before making a second: open the existing one, or make another on purpose", async () => {
    await mount("u-tpl-dup-" + kind);
    fireEvent.click(await screen.findByText("Use a Template", {}, { timeout: 4000 }));
    fireEvent.click(await screen.findByText(name));
    await waitFor(async () => expect(await count(kind)).toBe(1), { timeout: 4000 });
    // Back to the picker, and pick it again: nothing is made; the question is asked.
    await waitFor(() => expect(document.querySelector(".nav-back")).toBeTruthy(), { timeout: 4000 });
    fireEvent.click(document.querySelector(".nav-back")!);
    fireEvent.click(await screen.findByText("Use a Template", {}, { timeout: 4000 }));
    fireEvent.click(await screen.findByText(name));
    const sheet = await screen.findByText(/You Already Have a/, {}, { timeout: 4000 });
    expect(sheet).toBeInTheDocument();
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
    expect(await count(kind)).toBe(1);
    // Cancel leaves it at one.
    fireEvent.click(screen.getByText("Cancel"));
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
    expect(await count(kind)).toBe(1);
    // Making another is a deliberate pick.
    fireEvent.click(await screen.findByText(name));
    fireEvent.click(await screen.findByText(`Make Another ${name}`));
    await waitFor(async () => expect(await count(kind)).toBe(2), { timeout: 4000 });
  });
});
