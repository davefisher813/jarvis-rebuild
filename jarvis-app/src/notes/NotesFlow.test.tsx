// @vitest-environment jsdom
// HMN-F-01 (2026-09-05): note block edits used to race each other. Every
// mutation is read the note, change the whole blocks array, write it back,
// and the editor's blur-save fires on the same tap that starts the next
// mutation, so two stale read-modify-writes clobbered each other and the
// paragraph just typed reverted. These run the real flow over a store whose
// every read and write takes a network beat, the way the phone's does, so
// the interleaving the audit reproduced is the one exercised here.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Store, InMemoryAdapter, type Item, type ItemData } from "@core";
import { NotesProvider, useNotes } from "../data/NotesProvider";
import NotesFlow from "./NotesFlow";

class SlowAdapter extends InMemoryAdapter {
  private beat() { return new Promise((r) => setTimeout(r, 15)); }
  override async read(o: string, id: string): Promise<Item | null> { await this.beat(); return super.read(o, id); }
  override async apply(o: string, id: string, p: ItemData, t?: number): Promise<boolean> { await this.beat(); return super.apply(o, id, p, t); }
}

vi.mock("../data/store", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../data/store")>();
  return { ...mod, makeStore: () => new Store(new SlowAdapter()) };
});

let svcRef: ReturnType<typeof useNotes> | null = null;
function Grab() {
  svcRef = useNotes();
  return null;
}

async function openNoteWith(blocks: { type: "text" | "checklist"; text?: string; items?: string[] }[]) {
  svcRef = null;
  const user = "u-notes-flow-" + Math.random().toString(36).slice(2);
  const view = render(<NotesProvider userId={user}><Grab /></NotesProvider>);
  await waitFor(() => expect(svcRef).toBeTruthy());
  const svc = svcRef!;
  let id = "";
  const ids: string[] = [];
  await act(async () => {
    id = (await svc.createNote("Race", ""))!;
    for (const b of blocks) {
      if (b.type === "text") ids.push((await svc.addBlock(id, { type: "text", text: b.text ?? "" }))!);
      else ids.push((await svc.addChecklist(id, b.items ?? []))!);
    }
  });
  view.rerender(<NotesProvider userId={user}><Grab /><NotesFlow openId={id} /></NotesProvider>);
  await waitFor(() => expect(screen.getByText("Text")).toBeInTheDocument());
  return { svc, id, ids, view, user };
}

describe("NotesFlow: block mutations run one at a time (HMN-F-01)", () => {
  it("a blur-save and a toolbar Text tap on the same gesture both land", async () => {
    const { svc, id, ids } = await openNoteWith([{ type: "text", text: "" }]);
    const el = await waitFor(() => {
      const n = document.querySelector(`[data-bid="${ids[0]}"]`) as HTMLElement | null;
      expect(n).toBeTruthy();
      return n!;
    });
    // What the phone does when you type in the block and tap the chip: the
    // blur-save and the add fire back to back, neither waiting for the other.
    el.textContent = "the paragraph I just typed";
    fireEvent.blur(el);
    fireEvent.click(screen.getByText("Text"));

    await waitFor(async () => {
      const n = (await svc.note(id))!;
      expect(n.blocks).toHaveLength(2);
      expect(n.blocks.map((b) => b.text)).toContain("the paragraph I just typed");
    }, { timeout: 4000 });
  });

  it("typing an item and tapping another item's checkbox keeps both", async () => {
    const { svc, id, ids } = await openNoteWith([{ type: "checklist", items: ["", "buy milk"] }]);
    const lines = await waitFor(() => {
      const ls = document.querySelectorAll(".check-line");
      expect(ls.length).toBe(2);
      return ls;
    });
    const first = lines[0]!.querySelector("[contenteditable]") as HTMLElement;
    const secondBox = lines[1]!.querySelector(".cb") as HTMLElement;
    first.textContent = "call the dentist";
    fireEvent.blur(first);
    fireEvent.click(secondBox);

    await waitFor(async () => {
      const b = (await svc.note(id))!.blocks.find((x) => x.id === ids[0])!;
      expect(b.items).toEqual([{ text: "call the dentist", done: false }, { text: "buy milk", done: true }]);
    }, { timeout: 4000 });
  });
});

// HMN-F-02 (2026-09-05): the flow is unmounted on any tab change
// (shell/AppShell.tsx), and WKWebView removes a focused element without a
// blur, so a notification tap or a Where You Were card mid-sentence lost the
// sentence. The pending text now reaches the store anyway.
describe("NotesFlow: pending text survives leaving the tab (HMN-F-02)", () => {
  it("text typed in a block reaches the store when the flow unmounts without a blur", async () => {
    const { svc, id, ids, view, user } = await openNoteWith([{ type: "text", text: "" }]);
    const el = await waitFor(() => {
      const n = document.querySelector(`[data-bid="${ids[0]}"]`) as HTMLElement | null;
      expect(n).toBeTruthy();
      return n!;
    });
    el.focus();
    el.textContent = "two minutes of writing";
    fireEvent.input(el);
    // The tab changes: the flow is gone, and no blur ever fired.
    view.rerender(<NotesProvider userId={user}><Grab /></NotesProvider>);
    await waitFor(async () => {
      expect((await svc.note(id))!.blocks[0]!.text).toBe("two minutes of writing");
    }, { timeout: 4000 });
  });
});
