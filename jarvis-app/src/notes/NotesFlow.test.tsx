// @vitest-environment jsdom
// HMN-F-01 (2026-09-05): note block edits used to race each other. Every
// mutation is read the note, change the whole blocks array, write it back,
// and the editor's blur-save fires on the same tap that starts the next
// mutation, so two stale read-modify-writes clobbered each other and the
// paragraph just typed reverted. These run the real flow over a store whose
// every read and write takes a network beat, the way the phone's does, so
// the interleaving the audit reproduced is the one exercised here.
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Store, InMemoryAdapter, type Item, type ItemData } from "@core";
import { NotesProvider, useNotes, useCategories } from "../data/NotesProvider";
import NotesFlow from "./NotesFlow";
import { setCategoryRegistry } from "../shared/categories";

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

// HMN-F-14 (2026-09-05): runCreateTasks switched back to the editor without
// re-reading the note, so the linked-task badges and the new connection
// chips were missing until the note was reopened.
describe("NotesFlow: the editor comes back fresh from Create Tasks (HMN-F-14)", () => {
  it("shows the linked-task badges and connection chips on arrival", async () => {
    const { svc, id } = await openNoteWith([{ type: "checklist", items: ["Milk", "Eggs"] }]);
    fireEvent.click(screen.getByLabelText("Connections"));
    fireEvent.click(await screen.findByText("Create Tasks from Checklist"));
    fireEvent.click(await screen.findByText("Create 2 Tasks"));
    await waitFor(() => {
      expect(screen.getByText("Text")).toBeInTheDocument();
      expect(document.querySelectorAll(".check-linked").length).toBe(2);
      expect(document.querySelectorAll(".note-conn").length).toBe(2);
    }, { timeout: 4000 });
    expect((await svc.listTasks()).length).toBe(2);
    expect((await svc.note(id))!.connections).toHaveLength(2);
  });

  // HMN-F-16 (2026-09-05): the flow passed only `items`, so the header kept
  // the locked frame's default and said From "This Week" for every note.
  it("the header names the note it was opened from", async () => {
    await openNoteWith([{ type: "checklist", items: ["Milk", "Eggs"] }]);
    fireEvent.click(screen.getByLabelText("Connections"));
    fireEvent.click(await screen.findByText("Create Tasks from Checklist"));
    expect(await screen.findByText("From “Race”")).toBeInTheDocument();
    expect(screen.queryByText(/This Week/)).not.toBeInTheDocument();
  });
});

// HMN-F-17 (2026-09-05): `current?.category ?? defaultCatId` does not catch
// the empty string a note is born with, so Connections showed an Area row
// with a blank value, and setCategory refuses "" so nothing there could put
// a note back to unfiled.
let catsRef: ReturnType<typeof useCategories> | null = null;
function GrabAll() { svcRef = useNotes(); catsRef = useCategories(); return null; }

describe("NotesFlow: Connections names the unfiled state and can return to it (HMN-F-17)", () => {
  it("says Not Filed, files under an area, and unfiles again", async () => {
    svcRef = null; catsRef = null;
    const user = "u-conn-f17";
    const view = render(<NotesProvider userId={user}><GrabAll /></NotesProvider>);
    await waitFor(() => expect(svcRef && catsRef).toBeTruthy());
    const svc = svcRef!;
    let id = "";
    await act(async () => {
      const catId = (await catsRef!.create("Health", "green"))!;
      // The registry is seeded by AppShell in the app; this flow renders
      // without it, and catName needs it to turn the id into the word.
      setCategoryRegistry([{ id: catId, name: "Health", color: "green" }]);
      id = (await svc.createNote("Race", ""))!;
      await svc.addBlock(id, { type: "text", text: "" });
    });
    view.rerender(<NotesProvider userId={user}><GrabAll /><NotesFlow openId={id} /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Text")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Connections"));
    expect(await screen.findByText("Not Filed")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Area"));
    fireEvent.click(await screen.findByText("Health"));
    await waitFor(async () => expect((await svc.note(id))!.category).toBeTruthy(), { timeout: 4000 });

    // And back: the row the list's File sheet has always had.
    fireEvent.click(screen.getByText("Area"));
    fireEvent.click(await screen.findByText("Not Filed"));
    await waitFor(async () => expect((await svc.note(id))!.category).toBe(""), { timeout: 4000 });
    setCategoryRegistry([]);
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

// HMN-F-19 (2026-09-05): the note deep link fired on a CHANGE of openId and
// nothing ever cleared it, so opening note X from search, backing out to the
// list and searching X again did nothing: the prop was still X.
function ShellLike({ id }: { id: string }) {
  const [intent, setIntent] = useState<{ value?: string; nonce: number }>({ nonce: 0 });
  return (
    <>
      <button onClick={() => setIntent((i) => ({ value: id, nonce: i.nonce + 1 }))}>Open It</button>
      <NotesFlow
        openId={intent.value}
        openNonce={intent.nonce}
        onOpenConsumed={() => setIntent((i) => ({ nonce: i.nonce }))}
      />
    </>
  );
}

describe("the same note deep link, twice (HMN-F-19)", () => {
  it("opens it, and opens it again after backing out to the list", async () => {
    svcRef = null;
    const user = "u-notes-f19";
    const view = render(<NotesProvider userId={user}><Grab /></NotesProvider>);
    await waitFor(() => expect(svcRef).toBeTruthy());
    let id = "";
    await act(async () => { id = (await svcRef!.createNote("Roster", ""))!; });

    view.rerender(<NotesProvider userId={user}><Grab /><ShellLike id={id} /></NotesProvider>);
    // The list first: the editor's back row reads Notes.
    await waitFor(() => expect(screen.queryByText("Notes", { selector: "button" })).not.toBeInTheDocument());

    fireEvent.click(screen.getByText("Open It"));
    await waitFor(() => expect(screen.getByText("Notes", { selector: "button" })).toBeInTheDocument());

    fireEvent.click(screen.getByText("Notes", { selector: "button" }));
    await waitFor(() => expect(screen.queryByText("Notes", { selector: "button" })).not.toBeInTheDocument());

    // The same note, a second time: it opens, because the nonce moved.
    fireEvent.click(screen.getByText("Open It"));
    await waitFor(() => expect(screen.getByText("Notes", { selector: "button" })).toBeInTheDocument());
  });
});
