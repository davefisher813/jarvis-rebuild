// @vitest-environment jsdom
// DELETE PAGE ASKS FIRST, BY NAME (2026-10-13 fix order). A template page's Delete Page opens a confirm that names the page,
// with Delete and Cancel, Cancel the default; nothing is deleted until Delete is tapped, and the Undo toast after it stays.
import "../../shared/tiptapTest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Store, InMemoryAdapter, type Item, type ItemData } from "@core";
import { NotesProvider, useNotes } from "../../data/NotesProvider";
import NotesFlow from "../NotesFlow";
import { addRecord, newTeamPage, type PageData } from "./pageModel";
import { subscribeToast, resetToasts } from "../../shared/toast";

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
const team3 = (): PageData => {
  let p = newTeamPage();
  for (const [name, number, position] of [["Ava Chen", "7", "Pitcher"], ["Ben Ruiz", "12", "Catcher"]]) p = addRecord(p, { name: name!, number: number!, position: position! }).page;
  return p;
};

afterEach(() => { vi.restoreAllMocks(); resetToasts(); });

describe("Delete Page asks first", () => {
  it("names the page, deletes nothing until Delete, defaults to Cancel, and keeps the Undo toast", async () => {
    const view = await mount("u-page-delete-ask");
    let id = "";
    await act(async () => { id = (await svc().createPage("Tigers", team3()))!; });
    view.rerender(<NotesProvider userId="u-page-delete-ask"><Grab /><NotesFlow openId={id} /></NotesProvider>);
    fireEvent.click(await screen.findByLabelText("Page options", {}, { timeout: 4000 }));
    fireEvent.click(screen.getByText("Delete Page"));
    // The confirm names the page, and nothing is written yet.
    const title = document.querySelector(".sheet-scrim .eyebrow")?.textContent;
    expect(title).toBe("Delete \u201cTigers\u201d, Restore It Within 30 Days");
    expect(document.activeElement?.textContent).toBe("Cancel");
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
    expect((await svc().listNotes()).some((n) => n.id === id)).toBe(true);
    // Cancel leaves it alone.
    fireEvent.click(screen.getByText("Cancel"));
    expect(document.querySelector(".sheet-scrim")).toBeNull();
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
    expect((await svc().listNotes()).some((n) => n.id === id)).toBe(true);
    // Delete trashes it, and the post-delete Undo toast is still offered.
    const got: { message: string; actionLabel?: string }[] = [];
    const stop = subscribeToast((t) => { if (t) got.push(t); });
    fireEvent.click(screen.getByLabelText("Page options"));
    fireEvent.click(screen.getByText("Delete Page"));
    fireEvent.click(within(document.querySelector(".sheet-scrim .action-sheet") as HTMLElement).getByText("Delete Page"));
    await waitFor(() => expect(got.at(-1)?.actionLabel).toBe("Undo"), { timeout: 4000 });
    stop();
  });
});
