// @vitest-environment jsdom
// The Notes flow over a store whose every read and write takes a network
// beat, the way the phone's does. Since the writing system (2026-09-14) the
// note is one document saved as it changes; the flows around it (Create
// Tasks, Connections, the link picker, attachments, deep links) are pinned
// here the way they were before it.
import "../shared/tiptapTest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";

// C-18 (Astra, 2026-09-12): Connections moved into the note menu, behind
// the same ... button, beside Pin, Tags and Archive.
const openConnections = () => {
  fireEvent.click(screen.getByLabelText("Note options"));
  fireEvent.click(screen.getByText("Connections"));
};
import { Store, InMemoryAdapter, type Item, type ItemData } from "@core";
import { NotesProvider, useNotes, useCategories, useTasks, useSchedule } from "../data/NotesProvider";
import NotesFlow from "./NotesFlow";
import { setCategoryRegistry } from "../shared/categories";
import { ScheduleService } from "../schedule/ScheduleService";
import { subscribeToast, resetToasts } from "../shared/toast";
import { todayISO, addDays } from "../schedule/calendar";
import { MemoryFileStore } from "../files/FileStore";

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
  await waitFor(() => expect(screen.getByLabelText("Note")).toBeInTheDocument());
  return { svc, id, ids, view, user };
}

// Typing changes the document in the editor; the flow writes it to the
// store shortly after the last keystroke and says so under the page.
function typeInto(pm: HTMLElement, text: string) {
  const p = pm.querySelector("p")!;
  p.textContent = text;
}

describe("NotesFlow: the document saves as it changes (the writing system)", () => {
  it("words typed reach the store after the pause, and the line under the page says so", async () => {
    const { svc, id } = await openNoteWith([{ type: "text", text: "" }]);
    const pm = screen.getByLabelText("Note");
    await act(async () => { typeInto(pm, "the paragraph I just typed"); });
    await waitFor(async () => {
      const n = (await svc.note(id))!;
      expect(n.doc).toBeTruthy();
      expect(n.blocks.map((b) => b.text)).toContain("the paragraph I just typed");
    }, { timeout: 4000 });
    // No backend in a test build: written, not synced.
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved on device"), { timeout: 4000 });
  });

  it("a note with no title is named by its first line in the list", async () => {
    const { svc, id } = await openNoteWith([{ type: "text", text: "" }]);
    await act(async () => { await svc.editTitle(id, " "); });
    const pm = screen.getByLabelText("Note");
    await act(async () => { typeInto(pm, "Groceries for the week"); });
    await waitFor(async () => expect((await svc.note(id))!.doc).toBeTruthy(), { timeout: 4000 });
    fireEvent.click(screen.getByText("Notes", { selector: "button" }));
    expect(await screen.findByText("Groceries for the week", {}, { timeout: 4000 })).toBeInTheDocument();
  });
});

// HMN-F-14 (2026-09-05): runCreateTasks switched back to the editor without
// re-reading the note, so the linked-task badges and the new connection
// chips were missing until the note was reopened.
describe("NotesFlow: the editor comes back fresh from Create Tasks (HMN-F-14)", () => {
  it("shows the linked-task badges and connection chips on arrival", async () => {
    const { svc, id } = await openNoteWith([{ type: "checklist", items: ["Milk", "Eggs"] }]);
    openConnections();
    fireEvent.click(await screen.findByText("Create Tasks from Checklist"));
    fireEvent.click(await screen.findByText("Create 2 Tasks"));
    await waitFor(() => {
      expect(screen.getByLabelText("Note")).toBeInTheDocument();
      expect(document.querySelectorAll("li[data-task-id]").length).toBe(2);
      expect(document.querySelectorAll(".note-conn").length).toBe(2);
    }, { timeout: 4000 });
    expect((await svc.listTasks()).length).toBe(2);
    expect((await svc.note(id))!.connections).toHaveLength(2);
  });

  // HMN-F-16 (2026-09-05): the flow passed only `items`, so the header kept
  // the locked frame's default and said From "This Week" for every note.
  it("the header names the note it was opened from", async () => {
    await openNoteWith([{ type: "checklist", items: ["Milk", "Eggs"] }]);
    openConnections();
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
let tasksRef: ReturnType<typeof useTasks> | null = null;
let schedRef: ReturnType<typeof useSchedule> | null = null;
function GrabAll() { svcRef = useNotes(); catsRef = useCategories(); tasksRef = useTasks(); schedRef = useSchedule(); return null; }

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
    await waitFor(() => expect(screen.getByLabelText("Note")).toBeInTheDocument());

    openConnections();
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

// HMN-F-18 (2026-09-05): nothing prunes a note's connections when the thing
// they point at is deleted, and only the person branch of navigateToEntity
// checked the target existed. A note linked to a deleted task kept a
// live-looking chip that switched tabs and opened nothing, with no toast.
describe("NotesFlow: a link to something deleted says so (HMN-F-18)", () => {
  it("marks the dead link Gone and refuses the tap, leaving the live one alone", async () => {
    svcRef = null; tasksRef = null;
    const user = "u-gone-f18";
    const view = render(<NotesProvider userId={user}><GrabAll /></NotesProvider>);
    await waitFor(() => expect(svcRef && tasksRef).toBeTruthy());
    const svc = svcRef!;
    let id = "";
    await act(async () => {
      const deadId = (await tasksRef!.createTask("Book the Flights"))!;
      const liveId = (await tasksRef!.createTask("Pack the Bags"))!;
      id = (await svc.createNote("Race", ""))!;
      await svc.addBlock(id, { type: "text", text: "" });
      await svc.addConnection(id, "task", "Book the Flights", deadId);
      await svc.addConnection(id, "task", "Pack the Bags", liveId);
      await tasksRef!.deleteTask(deadId);
    });
    const onNavigate = vi.fn();
    view.rerender(<NotesProvider userId={user}><GrabAll /><NotesFlow openId={id} onNavigate={onNavigate} /></NotesProvider>);

    // The chip strip under the title: one link says what happened to it.
    const dead = await screen.findByText(/Book the Flights · Gone/, {}, { timeout: 4000 });
    fireEvent.click(dead);
    expect(onNavigate).not.toHaveBeenCalled();
    // The link that still points at something opens the way it always did.
    fireEvent.click(screen.getByText("Pack the Bags"));
    expect(onNavigate).toHaveBeenCalledWith("task", expect.any(String));

    // And on the Connections screen, as its own trailing word.
    openConnections();
    expect(await screen.findByText("Gone")).toBeInTheDocument();
    onNavigate.mockClear();
    fireEvent.click(screen.getByText("Book the Flights"));
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

// HMN-F-20 (2026-09-05): the events and tasks reads behind Add Link had no
// fallback, unlike the other three, so a failed read threw inside
// openLinkPicker and the tap opened nothing and said nothing.
describe("NotesFlow: Add Link on a bad connection (HMN-F-20)", () => {
  it("still opens the picker and says the lists could not be read", async () => {
    const seen: string[] = [];
    const stop = subscribeToast((t) => { if (t) seen.push(t.message); });
    vi.spyOn(ScheduleService.prototype, "listEvents").mockRejectedValue(new Error("offline"));
    try {
      await openNoteWith([{ type: "text", text: "" }]);
      fireEvent.click(screen.getByLabelText("Link Something"));
      expect(await screen.findByText("Add Link", {}, { timeout: 4000 })).toBeInTheDocument();
      await waitFor(() => expect(seen.some((m) => m.startsWith("Couldn't load"))).toBe(true));
    } finally {
      stop();
      vi.restoreAllMocks();
      resetToasts();
    }
  });
});

// HMN-F-26 (2026-09-05): the picker listed every event ever, oldest and
// newest mixed, so after a few months the Events section was hundreds of
// rows to scroll. The flow hands it the window around now instead.
describe("NotesFlow: the link picker's Events are the window around now (HMN-F-26)", () => {
  it("drops what is long past, leads with what is coming, and says which window", async () => {
    svcRef = null; schedRef = null;
    const user = "u-events-f26";
    const view = render(<NotesProvider userId={user}><GrabAll /></NotesProvider>);
    await waitFor(() => expect(svcRef && schedRef).toBeTruthy());
    const svc = svcRef!;
    let id = "";
    await act(async () => {
      await schedRef!.createEvent("Last Season Banquet", { date: addDays(todayISO(), -200), start: "18:00" });
      await schedRef!.createEvent("Dentist Yesterday", { date: addDays(todayISO(), -1), start: "09:00" });
      await schedRef!.createEvent("Kickoff Tomorrow", { date: addDays(todayISO(), 1), start: "09:00" });
      id = (await svc.createNote("Race", ""))!;
      await svc.addBlock(id, { type: "text", text: "" });
    });
    view.rerender(<NotesProvider userId={user}><GrabAll /><NotesFlow openId={id} /></NotesProvider>);
    await waitFor(() => expect(screen.getByLabelText("Note")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Link Something"));
    expect(await screen.findByText("Kickoff Tomorrow", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText("Dentist Yesterday")).toBeInTheDocument();
    expect(screen.queryByText("Last Season Banquet")).not.toBeInTheDocument();
    // What is coming leads what just happened.
    const text = document.body.textContent ?? "";
    expect(text.indexOf("Kickoff Tomorrow")).toBeLessThan(text.indexOf("Dentist Yesterday"));
    // And the section says it is a window, not the whole calendar.
    expect(screen.getByText("That's every event from the last 30 days on.")).toBeInTheDocument();
  });
});

// HMN-F-27 (2026-09-05): deleting a photo or file block took the block and
// left its bytes in storage forever. The note delete has swept its files
// since the day it shipped; the block delete never did.
async function openNoteWithPhoto(user: string) {
  svcRef = null;
  const view = render(<NotesProvider userId={user}><GrabAll /></NotesProvider>);
  await waitFor(() => expect(svcRef).toBeTruthy());
  const svc = svcRef!;
  let id = "";
  await act(async () => {
    id = (await svc.createNote("Race", ""))!;
    await svc.addBlock(id, { type: "photo", name: "Beach", size: "1 KB", path: "u/n/beach.jpg", mime: "image/jpeg" });
  });
  view.rerender(<NotesProvider userId={user}><GrabAll /><NotesFlow openId={id} /></NotesProvider>);
  await screen.findByLabelText("Remove Beach", {}, { timeout: 4000 });
  return { svc, id };
}

describe("NotesFlow: removing a photo block takes its bytes with it (HMN-F-27)", () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("sweeps the file a beat after the block, never on the tap itself", async () => {
    const remove = vi.spyOn(MemoryFileStore.prototype, "remove").mockResolvedValue(undefined);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await openNoteWithPhoto("u-sweep-f27");
    fireEvent.click(screen.getByLabelText("Remove Beach"));
    await waitFor(() => expect(screen.queryByLabelText("Remove Beach")).not.toBeInTheDocument(), { timeout: 4000 });
    // The beat is the point: Undo can still bring the picture back.
    expect(remove).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(6100);
    expect(remove).toHaveBeenCalledWith(["u/n/beach.jpg"]);
  });

  it("Undo keeps the bytes, because Undo brings the picture back", async () => {
    const remove = vi.spyOn(MemoryFileStore.prototype, "remove").mockResolvedValue(undefined);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await openNoteWithPhoto("u-sweep-f27-undo");
    fireEvent.click(screen.getByLabelText("Remove Beach"));
    await waitFor(() => expect(screen.queryByLabelText("Remove Beach")).not.toBeInTheDocument(), { timeout: 4000 });
    // No toast host in this render: the toast is taken through its
    // subscription and its Undo tapped there.
    let last: { actionLabel?: string; onAction?: () => void } | null = null;
    const stop = subscribeToast((t) => { if (t) last = t as typeof last; });
    await waitFor(() => expect(last?.actionLabel).toBe("Undo"), { timeout: 4000 });
    await act(async () => { last!.onAction!(); });
    stop();
    resetToasts();
    await waitFor(() => expect(screen.getByLabelText("Remove Beach")).toBeInTheDocument(), { timeout: 4000 });
    await vi.advanceTimersByTimeAsync(6100);
    expect(remove).not.toHaveBeenCalled();
  });
});

// HMN-F-02 (2026-09-05): the flow is unmounted on any tab change
// (shell/AppShell.tsx), and WKWebView removes a focused element without a
// blur, so a notification tap or a Where You Were card mid-sentence lost the
// sentence. The pending text now reaches the store anyway.
describe("NotesFlow: pending text survives leaving the tab (HMN-F-02)", () => {
  it("words typed reach the store when the flow unmounts before the pause ends", async () => {
    const { svc, id, view, user } = await openNoteWith([{ type: "text", text: "" }]);
    const pm = screen.getByLabelText("Note");
    await act(async () => { typeInto(pm, "two minutes of writing"); });
    // The tab changes at once: the flow is gone before the 600ms pause.
    view.rerender(<NotesProvider userId={user}><Grab /></NotesProvider>);
    await waitFor(async () => {
      expect((await svc.note(id))!.blocks[0]!.text).toBe("two minutes of writing");
    }, { timeout: 4000 });
  });
});

// QUICK APPEND (the writing system, wave 3): the swipe's Add puts lines on
// the end of a note without opening it.
describe("NotesFlow: quick append from the list", () => {
  it("appends the typed lines to that note's document and says so", async () => {
    svcRef = null;
    const user = "u-append-w3";
    const view = render(<NotesProvider userId={user}><Grab /></NotesProvider>);
    await waitFor(() => expect(svcRef).toBeTruthy());
    const svc = svcRef!;
    let id = "";
    await act(async () => {
      id = (await svc.createNote("Roster", ""))!;
      await svc.addBlock(id, { type: "text", text: "First line" });
    });
    view.rerender(<NotesProvider userId={user}><Grab /><NotesFlow /></NotesProvider>);
    fireEvent.click(await screen.findByLabelText("Add to this note", {}, { timeout: 4000 }));
    const field = await screen.findByLabelText("Lines to add");
    await act(async () => { field.querySelector("p")!.textContent = "Bring the forms"; });
    await waitFor(() => expect(field.textContent).toContain("Bring the forms"));
    fireEvent.click(screen.getByText("Add to Note"));
    await waitFor(async () => {
      const n = (await svc.note(id))!;
      expect(n.blocks.map((b) => b.text)).toEqual(["First line", "Bring the forms"]);
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
