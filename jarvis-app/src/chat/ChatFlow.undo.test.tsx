// @vitest-environment jsdom
// CHAT'S UNDOS TELL THE TRUTH (dead-button audit, 2026-10-04).
//
// Two of Chat's Undo buttons did less than they said:
//   - "Task deleted" > Undo wrote a bare text, category and due copy under a
//     NEW id, so a recurring task lost its recurrence, its steps and its
//     notes, and anything that held the old id stopped opening it.
//   - "Filed to Money" and "Saved to Notes" > Undo threw away the result of
//     the delete, then said "Receipt removed" / "Note removed" over the top of
//     the failure toast, and took the stored file away from a row that was
//     still there.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useTasks, useNotes, useOptionalFiles, useFileStore } from "../data/NotesProvider";
import { WRITE_FAILED_MESSAGE } from "../shared/guard";
import ChatFlow from "./ChatFlow";
import type { AIService } from "../ai/AIService";
import type { TaskData } from "../notes/types";

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

// AI off: a PDF is routed by name (a receipt) or lands in Notes, and nothing
// here may call a model.
vi.mock("../ai/useAI", () => ({ useAI: () => ({ available: false } as unknown as AIService) }));

const showToast = vi.fn();
vi.mock("../shared/toast", () => ({ showToast: (...a: unknown[]) => showToast(...a) }));

let tasksRef: ReturnType<typeof useTasks> | null = null;
let notesRef: ReturnType<typeof useNotes> | null = null;
let filesRef: ReturnType<typeof useOptionalFiles> | null = null;
let storeRef: ReturnType<typeof useFileStore> | null = null;
function Capture() {
  tasksRef = useTasks();
  notesRef = useNotes();
  filesRef = useOptionalFiles();
  storeRef = useFileStore();
  return null;
}

const renderChat = (userId: string) =>
  render(
    <NotesProvider userId={userId}>
      <Capture />
      <ChatFlow />
    </NotesProvider>,
  );

type ToastCall = { message: string; actionLabel?: string; onAction?: () => Promise<void> };
const toastCalls = () => showToast.mock.calls.map((c) => c[0] as ToastCall);
const toastNamed = (message: string) => toastCalls().find((t) => t.message === message);
const messages = () => toastCalls().map((t) => t.message);

const sendText = (text: string) => {
  fireEvent.change(screen.getByPlaceholderText("Ask, Tell or Paste"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
};

const attach = (file: File) => {
  fireEvent.change(document.querySelector("input[type=file]")!, { target: { files: [file] } });
};
// jsdom's File has no arrayBuffer(); give it the one the browser has.
const pdf = (name: string) => {
  const f = new File(["%PDF-1.4 x"], name, { type: "application/pdf" });
  Object.defineProperty(f, "arrayBuffer", { value: () => Promise.resolve(new TextEncoder().encode("%PDF-1.4 x").buffer) });
  return f;
};

beforeEach(() => {
  showToast.mockReset();
  tasksRef = null; notesRef = null; filesRef = null; storeRef = null;
  let n = 0;
  vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:" + ++n, revokeObjectURL: () => undefined });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Chat > Task deleted > Undo", () => {
  it("brings the whole task back under its own id, not a bare copy under a new one", async () => {
    renderChat("u-chat-undo-task");
    await waitFor(() => expect(tasksRef).toBeTruthy());
    const rich: TaskData = {
      text: "Water the plants", category: "home", done: false, due: "2026-10-10",
      recurrence: "weekly", notes: "The fern on the left wants less",
      steps: [{ text: "Fill the can", done: true }, { text: "Do the porch", done: false }],
      estimateMin: 15, projectId: "proj-house", extraCategories: ["errands"], slips: 2, runLen: 3, bestRun: 5, doneCount: 7,
    };
    let id = "";
    await act(async () => { id = (await tasksRef!.recreateFrom(rich))!; });
    const snapshot = (await tasksRef!.task(id))!;
    expect(snapshot.recurrence).toBe("weekly");

    sendText("delete the task water the plants");
    await waitFor(() => expect(screen.getByText("Deleted: Water the plants")).toBeInTheDocument());
    expect(await tasksRef!.task(id)).toBeNull();

    const undo = toastNamed("Task deleted")!;
    expect(undo.actionLabel).toBe("Undo");
    await act(async () => { await undo.onAction!(); });

    // Every field, and the very same id: a note that links to it still opens it.
    expect(await tasksRef!.task(id)).toEqual(snapshot);
    expect(await tasksRef!.listTasks()).toHaveLength(1);
  });
});

// The Undo is a function, and React treats a function handed to setState as an
// updater and CALLS it. Storing the Undo for "Move to" did exactly that, so a
// file was taken back the instant it was filed and the toast promised a
// receipt that was already gone.
describe("Chat > a filed file stays filed until Undo or Move to", () => {
  it("a receipt is still there after filing, and a note too", async () => {
    renderChat("u-chat-stays-filed");
    await waitFor(() => expect(filesRef && notesRef).toBeTruthy());
    attach(pdf("lunch-receipt.pdf"));
    await waitFor(() => expect(toastNamed("Filed to Money")).toBeTruthy());
    await screen.findByText("Move to Notes");
    expect(await filesRef!.list("money")).toHaveLength(1);

    attach(pdf("memo.pdf"));
    await waitFor(() => expect(toastNamed("Saved to Notes")).toBeTruthy());
    await screen.findByText("Move to Money");
    expect(await notesRef!.listNotes()).toHaveLength(1);
    expect(await filesRef!.list("money")).toHaveLength(1);
  });

  it("Move to takes the old filing back, and a second Move to takes that one back in turn", async () => {
    renderChat("u-chat-move-to");
    await waitFor(() => expect(filesRef && notesRef).toBeTruthy());
    attach(pdf("lunch-receipt.pdf"));
    fireEvent.click(await screen.findByText("Move to Notes"));
    await waitFor(() => expect(toastNamed("Saved to Notes")).toBeTruthy());
    await waitFor(async () => expect(await filesRef!.list("money")).toHaveLength(0));
    expect(await notesRef!.listNotes()).toHaveLength(1);

    fireEvent.click(await screen.findByText("Move to Money"));
    await waitFor(async () => expect(await filesRef!.list("money")).toHaveLength(1));
    await waitFor(async () => expect(await notesRef!.listNotes()).toHaveLength(0));
    expect(messages()).not.toContain(WRITE_FAILED_MESSAGE);
  });
});

describe("Chat > Filed to Money > Undo", () => {
  it("removes the receipt and its file together, and only then says so", async () => {
    renderChat("u-chat-undo-money-ok");
    await waitFor(() => expect(filesRef && storeRef).toBeTruthy());
    const removeBlob = vi.spyOn(storeRef!, "remove");
    attach(pdf("lunch-receipt.pdf"));
    await waitFor(() => expect(toastNamed("Filed to Money")).toBeTruthy());
    const row = (await filesRef!.list("money"))[0]!;
    expect(row.data.path).toBeTruthy();

    await act(async () => { await toastNamed("Filed to Money")!.onAction!(); });

    expect(await filesRef!.get(row.id)).toBeNull();
    expect(removeBlob).toHaveBeenCalledWith([row.data.path]);
    expect(messages()).toContain("Receipt removed");
  });

  it("a delete that failed says it failed, keeps the stored file, and never says the receipt was removed", async () => {
    renderChat("u-chat-undo-money-fail");
    await waitFor(() => expect(filesRef && storeRef).toBeTruthy());
    const removeBlob = vi.spyOn(storeRef!, "remove");
    attach(pdf("lunch-receipt.pdf"));
    await waitFor(() => expect(toastNamed("Filed to Money")).toBeTruthy());
    const row = (await filesRef!.list("money"))[0]!;
    vi.spyOn(filesRef!, "remove").mockRejectedValue(new Error("rls"));

    await act(async () => { await toastNamed("Filed to Money")!.onAction!(); });

    expect(messages()).toContain(WRITE_FAILED_MESSAGE);
    expect(messages()).not.toContain("Receipt removed");
    // The row is still there, so the file it points at must be too.
    expect(await filesRef!.get(row.id)).not.toBeNull();
    expect(removeBlob).not.toHaveBeenCalled();
  });
});

describe("Chat > Saved to Notes > Undo", () => {
  it("removes the note and its files together, and only then says so", async () => {
    renderChat("u-chat-undo-note-ok");
    await waitFor(() => expect(notesRef && storeRef).toBeTruthy());
    const removeAll = vi.spyOn(storeRef!, "removeAll");
    attach(pdf("memo.pdf"));
    await waitFor(() => expect(toastNamed("Saved to Notes")).toBeTruthy());
    expect(await notesRef!.listNotes()).toHaveLength(1);

    await act(async () => { await toastNamed("Saved to Notes")!.onAction!(); });

    expect(await notesRef!.listNotes()).toHaveLength(0);
    expect(removeAll).toHaveBeenCalledTimes(1);
    expect(messages()).toContain("Note removed");
  });

  it("a delete that failed says it failed, keeps the note's files, and never says the note was removed", async () => {
    renderChat("u-chat-undo-note-fail");
    await waitFor(() => expect(notesRef && storeRef).toBeTruthy());
    const removeAll = vi.spyOn(storeRef!, "removeAll");
    attach(pdf("memo.pdf"));
    await waitFor(() => expect(toastNamed("Saved to Notes")).toBeTruthy());
    vi.spyOn(notesRef!, "deleteNote").mockRejectedValue(new Error("rls"));

    await act(async () => { await toastNamed("Saved to Notes")!.onAction!(); });

    expect(messages()).toContain(WRITE_FAILED_MESSAGE);
    expect(messages()).not.toContain("Note removed");
    expect(await notesRef!.listNotes()).toHaveLength(1);
    expect(removeAll).not.toHaveBeenCalled();
  });
});

// 2026-10-05: an Undo in state belongs to ONE file. A second file whose
// delivery threw left the first file's Undo behind, and Move to on the second
// then ran the first's Undo, deleting a filing nobody asked to touch.
describe("Chat > Move to after a delivery that failed", () => {
  it("never takes back the earlier file's filing", async () => {
    renderChat("u-chat-failed-second");
    await waitFor(() => expect(filesRef && notesRef && storeRef).toBeTruthy());
    attach(pdf("lunch-receipt.pdf"));
    await waitFor(() => expect(toastNamed("Filed to Money")).toBeTruthy());
    await screen.findByText("Move to Notes");
    expect(await filesRef!.list("money")).toHaveLength(1);

    // The second file lands in Notes, and its upload fails once.
    const upload = vi.spyOn(storeRef!, "upload").mockRejectedValueOnce(new Error("offline"));
    attach(pdf("memo.pdf"));
    await screen.findByText("offline");
    expect(upload).toHaveBeenCalledTimes(1);
    expect(await filesRef!.list("money")).toHaveLength(1);

    // Move the memo to Money: it is delivered, and the receipt stays put.
    fireEvent.click(await screen.findByText("Move to Money"));
    await waitFor(async () => expect(await filesRef!.list("money")).toHaveLength(2));
    const names = (await filesRef!.list("money")).map((r) => r.data.name).sort();
    expect(names).toEqual(["lunch-receipt.pdf", "memo.pdf"]);
  });

  it("a pick made while one is still being filed is dropped, so Move to stays on the file that was filed", async () => {
    renderChat("u-chat-overlap");
    await waitFor(() => expect(filesRef && storeRef).toBeTruthy());
    let release: () => void = () => undefined;
    const real = storeRef!.upload.bind(storeRef!);
    vi.spyOn(storeRef!, "upload").mockImplementationOnce(async (id, f) => { await new Promise<void>((r) => { release = r; }); return real(id, f); });
    attach(pdf("lunch-receipt.pdf"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    attach(pdf("memo.pdf"));
    await act(async () => { release(); });
    await waitFor(() => expect(toastNamed("Filed to Money")).toBeTruthy());
    // Only the first file was ever delivered, and nothing else was filed.
    expect((await filesRef!.list("money")).map((r) => r.data.name)).toEqual(["lunch-receipt.pdf"]);
    expect(await notesRef!.listNotes()).toHaveLength(0);
    // Move to acts on the receipt: it leaves Money rather than copying a memo
    // nobody filed.
    fireEvent.click(await screen.findByText("Move to Notes"));
    await waitFor(async () => expect(await filesRef!.list("money")).toHaveLength(0));
    expect((await notesRef!.listNotes()).map((n) => n.data.title)).toEqual(["Lunch receipt"]);
  });
});
