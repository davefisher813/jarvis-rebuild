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
import { NavOriginProvider } from "../shell/navOrigin";
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
    // AMENDED 2026-09-26 (pass-off): a row name is shown in Title Case, the
    // first-line fallback included; the stored line is untouched.
    expect(await screen.findByText("Groceries for the Week", {}, { timeout: 4000 })).toBeInTheDocument();
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
    // The label stays the link's own name, and GONE is a small-caps state
    // beside it, not " · Gone" typed onto the label (§AM F3).
    const dead = await screen.findByText("Book the Flights", { selector: ".note-conn-label" }, { timeout: 4000 });
    const gone = dead.closest(".note-conn")?.querySelector(".urgency");
    expect(gone).toHaveTextContent(/^Gone$/);
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
      // Casing sweep 3 (2026-09-27): Title Case by the whole rule (§H2); durations through shared/duration ("45 Min", "About 1 Min").
      await waitFor(() => expect(seen.some((m) => m.startsWith("Couldn't Load"))).toBe(true));
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

// RECENTLY DELETED (the writing system, wave 3b): a deleted note leaves the
// list for its own room, comes back on Restore, and goes for good on Delete
// Forever.
describe("NotesFlow: Recently Deleted", () => {
  it("moves a deleted note to its own view, restores it, and deletes it for good", async () => {
    svcRef = null;
    const user = "u-trash-w3";
    const view = render(<NotesProvider userId={user}><Grab /></NotesProvider>);
    await waitFor(() => expect(svcRef).toBeTruthy());
    const svc = svcRef!;
    let id = "";
    await act(async () => { id = (await svc.createNote("Roster", ""))!; await svc.createNote("Kept", ""); });
    view.rerender(<NotesProvider userId={user}><Grab /><NotesFlow /></NotesProvider>);
    await screen.findByText("Roster", {}, { timeout: 4000 });
    // The rail names the note now (VoiceOver sweep, 2026-09-21): "Delete
    // Groceries", not "Delete note". Matched by VERB so a change to a note's
    // title does not break a test about the swipe.
    fireEvent.click(screen.getAllByLabelText(/^Delete /)[0]!);
    await waitFor(() => expect(screen.queryByText("Roster")).toBeNull(), { timeout: 4000 });
    expect((await svc.note(id))!.deletedAt).toBeTruthy();
    // AMENDED 2026-09-17 (Unified Headers, rule 2: "Do not mix area names,
    // deleted records and workflow states in the same row"), then again on
    // 2026-09-18 when the views became a menu. Recently Deleted was a chip
    // beside All and Pinned, then an options destination because a chip row
    // had no room for five, and is an option in the view menu now -- which
    // is what it always was. It still appears only when it holds something,
    // and is still excluded from ordinary searches unless chosen. Everything
    // this test is about -- the note goes there, restores, and deletes for
    // good -- is unchanged.
    const openDeleted = async () => {
      fireEvent.click(screen.getByLabelText("View"));
      fireEvent.click(await screen.findByRole("menuitemradio", { name: /Recently Deleted/ }));
    };
    await openDeleted();
    const row = await screen.findByText("Roster");
    expect(screen.getByText("Restore")).toBeInTheDocument();
    fireEvent.click(row);
    await waitFor(async () => expect((await svc.note(id))!.deletedAt).toBeFalsy(), { timeout: 4000 });
    // Empty again, so the view is gone from the menu: a view of nothing is
    // furniture.
    await waitFor(() => {
      fireEvent.click(screen.getByLabelText("View"));
      expect(screen.queryByRole("menuitemradio", { name: /Recently Deleted/ })).toBeNull();
    }, { timeout: 4000 });
    fireEvent.click(document.querySelector(".hmenu-scrim")!);
    // Delete again, then for good.
    fireEvent.click(screen.getAllByLabelText(/^Delete /)[0]!);
    await waitFor(async () => { await openDeleted(); }, { timeout: 4000 });
    fireEvent.click(await screen.findByLabelText(/^Delete forever/));
    await waitFor(async () => expect(await svc.note(id)).toBeNull(), { timeout: 4000 });
  });
});

// 2026-10-04: select mode's Delete inside Recently Deleted ran trashNote on
// notes that were already trashed. Nothing was deleted, the 30-day clock
// restarted, the toast said "deleted" and its Undo put the notes back in
// Notes. It is the permanent delete now, behind a confirm, with no Undo.
describe("NotesFlow: bulk Delete inside Recently Deleted", () => {
  it("deletes the ticked notes for good once confirmed, leaves the rest, and offers no Undo", async () => {
    svcRef = null;
    const user = "u-trash-bulk-forever";
    // A toast with an action from an earlier test would hold the slot.
    resetToasts();
    document.getElementById("select-bar-host")?.remove();
    const host = document.createElement("div"); host.id = "select-bar-host"; document.body.appendChild(host);
    const view = render(<NotesProvider userId={user}><Grab /></NotesProvider>);
    await waitFor(() => expect(svcRef).toBeTruthy());
    const svc = svcRef!;
    let a = "", b = "", keep = "";
    await act(async () => {
      a = (await svc.createNote("Gone One", ""))!; b = (await svc.createNote("Gone Two", ""))!; keep = (await svc.createNote("Kept Note", ""))!;
      await svc.trashNote(a); await svc.trashNote(b);
    });
    view.rerender(<NotesProvider userId={user}><Grab /><NotesFlow /></NotesProvider>);
    await screen.findByText("Kept Note", {}, { timeout: 4000 });
    fireEvent.click(screen.getByLabelText("View"));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: /Recently Deleted/ }));
    await screen.findByText("Gone One");
    fireEvent.click(screen.getByLabelText("Notes Options"));
    fireEvent.click(screen.getByText("Select Notes"));
    fireEvent.click(screen.getByText("Select All"));
    const got: { message: string; actionLabel?: string }[] = [];
    const stop = subscribeToast((t) => { if (t) got.push(t); });
    fireEvent.click(document.querySelector(".select-del")!);
    // Nothing is deleted until the confirm is answered.
    expect(await svc.note(a)).not.toBeNull();
    fireEvent.click(screen.getByText("Delete 2 Notes Forever"));
    await waitFor(async () => { expect(await svc.note(a)).toBeNull(); expect(await svc.note(b)).toBeNull(); }, { timeout: 4000 });
    expect(await svc.note(keep)).not.toBeNull();
    await waitFor(() => expect(got.at(-1)?.message).toBe("2 Notes Deleted for Good"), { timeout: 4000 });
    expect(got.at(-1)?.actionLabel).toBeUndefined();
    stop();
    resetToasts();
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

// BACK GOES TO WHERE IT WAS OPENED (audit 2026-09-29). Schedule's Add Notes
// hands the shell a note to open; the editor's Back used to close onto the
// Notes list, a tab nobody chose. A note the shell opened for another page now
// returns there, says so on the button, and leaves the return pill out of it.
describe("NotesFlow: a note opened for another page goes back to that page", () => {
  async function shown(withOrigin: boolean) {
    svcRef = null;
    const user = "u-note-origin-" + Math.random().toString(36).slice(2);
    const view = render(<NotesProvider userId={user}><Grab /></NotesProvider>);
    await waitFor(() => expect(svcRef).toBeTruthy());
    let id = "";
    await act(async () => {
      id = (await svcRef!.createNote("Standup", ""))!;
      await svcRef!.addBlock(id, { type: "text", text: "" });
    });
    const back = vi.fn(() => true);
    const claim = vi.fn(() => () => {});
    view.rerender(
      <NotesProvider userId={user}>
        <Grab />
        <NavOriginProvider value={{ origin: withOrigin ? { key: "schedule", label: "Schedule" } : null, back, claim, claimed: false }}>
          <NotesFlow openId={id} />
        </NavOriginProvider>
      </NotesProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText("Note")).toBeInTheDocument());
    return { back, claim };
  }

  it("Back returns to the origin, not the Notes list", async () => {
    const { back, claim } = await shown(true);
    expect(claim, "the editor's Back is the way home, so the pill stands down").toHaveBeenCalled();
    expect(screen.queryByText("Notes", { selector: ".nav-back" })).toBeNull();
    fireEvent.click(screen.getByText("Schedule", { selector: ".nav-back" }));
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("with no jump behind it, Back is still the Notes list", async () => {
    const { back, claim } = await shown(false);
    expect(claim).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Notes", { selector: ".nav-back" }));
    expect(back).not.toHaveBeenCalled();
  });
});

// CLICK-THROUGH AUDIT 2026-09-29, Notes. Three taps that looked dead.
describe("NotesFlow: New Note and Import or Attach (click-through audit 2026-09-29)", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("Blank makes an empty, untitled note and opens the editor on it (it used to return to the templates)", async () => {
    svcRef = null;
    const user = "u-blank-template";
    render(<NotesProvider userId={user}><Grab /><NotesFlow /></NotesProvider>);
    await waitFor(() => expect(svcRef).toBeTruthy());
    fireEvent.click(await screen.findByLabelText("New Note", {}, { timeout: 4000 }));
    fireEvent.click(await screen.findByText("Blank"));
    // The editor, not the templates screen.
    expect(await screen.findByLabelText("Note", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByText("Templates")).toBeNull();
    const all = await svcRef!.list();
    expect(all).toHaveLength(1);
    expect((all[0] as { title: string }).title, "the list's own fallback for a note with no title yet").toBe("Untitled");
  });

  it("Import or Attach: Cancel closes the sheet without opening the picker", async () => {
    const clicks: HTMLInputElement[] = [];
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) { clicks.push(this); });
    svcRef = null;
    render(<NotesProvider userId="u-import-cancel"><Grab /><NotesFlow /></NotesProvider>);
    await waitFor(() => expect(svcRef).toBeTruthy());
    fireEvent.click(await screen.findByLabelText("Notes Options", {}, { timeout: 4000 }));
    fireEvent.click(screen.getByText("Import or Attach"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByText("Choose a File")).toBeNull();
    expect(clicks).toHaveLength(0);
  });

  it("Import or Attach opens a sheet, then the file picker inside that sheet's tap", async () => {
    const clicks: HTMLInputElement[] = [];
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) { clicks.push(this); });
    svcRef = null;
    render(<NotesProvider userId="u-import-attach"><Grab /><NotesFlow /></NotesProvider>);
    await waitFor(() => expect(svcRef).toBeTruthy());
    fireEvent.click(await screen.findByLabelText("Notes Options", {}, { timeout: 4000 }));
    fireEvent.click(screen.getByText("Import or Attach"));
    // The options sheet is gone and a visible sheet of our own has replaced it;
    // the phone's picker has not opened yet.
    expect(screen.queryByText("Notes Options")).toBeNull();
    expect(screen.getByText("Import or Attach", { selector: ".eyebrow" })).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
    expect(clicks).toHaveLength(0);
    fireEvent.click(screen.getByText("Choose a File"));
    // Synchronous with the row's tap, and that sheet is gone too.
    expect(screen.queryByText("Choose a File")).toBeNull();
    expect(clicks).toHaveLength(1);
    expect(clicks[0]!.type).toBe("file");
    expect(clicks[0]!.isConnected, "the picker input outlives the menu that opened it").toBe(true);
    expect(screen.queryByText("Notes Options")).toBeNull();
    // The chosen file becomes a note titled after it, with the file attached.
    vi.spyOn(MemoryFileStore.prototype, "upload").mockResolvedValue({ path: "u/n/menu.pdf", name: "menu.pdf", mime: "application/pdf", bytes: 10 });
    fireEvent.change(clicks[0]!, { target: { files: [new File(["x"], "menu.pdf", { type: "application/pdf" })] } });
    await waitFor(async () => {
      const titles = (await svcRef!.list()).map((n) => (n as { title: string }).title);
      expect(titles).toContain("Menu");
    }, { timeout: 4000 });
  });
});
