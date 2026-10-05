// @vitest-environment jsdom
//
// BULK DELETE AND BULK ARCHIVE, FROM THE REST (button audit, 2026-09-19).
//
// The audit of all 1,807 controls found these two genuinely uncovered:
// nothing in the suite named deletePicked or archivePicked. They are the
// widest-reaching controls in the tab -- one tap moves every picked thread --
// and the only way back from the delete is a toast that expires in 8s.
//
// Note the labels: "Delete Selected" and "Archive Selected" are the DISABLED
// faces, shown only while nothing is picked. Once a row is picked the button
// says "Delete 2" / "Archive 2", which is what this test clicks. The audit
// flagged the disabled copy, which is how they read as untested.
import "../shared/tiptapTest";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { GoogleSessionProvider } from "../connections/google/GoogleSession";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import { AIService } from "../ai/AIService";
import type { GmailMeta, GmailThreadMeta } from "../connections/google/map";
import MessagesFlow from "./MessagesFlow";
import ToastHost from "../shared/ToastHost";

// The Rest is a triage bucket, so the fold only exists once a pass has run.
// These file as worth_knowing rather than noise on purpose: noise sits behind
// a second "Tap to look" fold AND collapses by sender, so the rows a bulk
// action needs are two interactions further in. Worth Knowing renders its
// rows directly, and deletePicked is handed [...worthKnowing, ...noise]
// either way, so it exercises the same call.
const triage = (text: string) => new AIService({
  available: true,
  getToken: () => "tok",
  fetchImpl: (async () => ({ ok: true, status: 200, json: async () => ({ text }), text: async () => "" })) as unknown as typeof fetch,
});
const AI = () => triage(JSON.stringify([
  { id: "n1", bucket: "worth_knowing", gist: "A promotion." },
  { id: "n2", bucket: "worth_knowing", gist: "A sale." },
  { id: "n3", bucket: "worth_knowing", gist: "A newsletter." },
]));
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const msg = (id: string, from: string, subject: string, snippet: string, labels: string[], dateMs: number): GmailMeta => ({
  id, snippet, labelIds: labels, internalDate: String(dateMs),
  payload: { headers: [{ name: "From", value: from }, { name: "Subject", value: subject }] },
});

// Three machines. Nothing here is waiting on Dave, so all three land in
// The Rest, which is the one place bulk select lives.
const THREADS: GmailThreadMeta[] = [
  { id: "n1", messages: [msg("a1", "DoorDash <no@dd.com>", "20% Off Tonight", "Order now", ["INBOX"], 300)] },
  { id: "n2", messages: [msg("a2", "Old Navy <no@on.com>", "Final Hours", "Sale ends", ["INBOX"], 200)] },
  { id: "n3", messages: [msg("a3", "Substack <no@sub.com>", "Weekly Digest", "This week", ["INBOX"], 100)] },
];

beforeEach(() => { localStorage.clear(); });

function mount(api: ReturnType<typeof makeFakeGoogleApi>) {
  return render(
    <NotesProvider userId="u-bulk">
      <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => api}>
        <ToastHost />
        <MessagesFlow ai={AI()} configured />
      </GoogleSessionProvider>
    </NotesProvider>,
  );
}

/** Connect, wait for triage, open The Rest, turn on select mode. */
async function selectMode() {
  await act(async () => { fireEvent.click(await screen.findByText("Connect Google")); });
  const rest = await screen.findByText("The Rest", {}, { timeout: 5000 });
  await act(async () => { fireEvent.click(rest); });
  const select = await screen.findByRole("button", { name: "Select" });
  await act(async () => { fireEvent.click(select); });
}

describe("MessagesFlow: bulk actions on The Rest", () => {
  it("Delete N moves every picked thread to Trash in one batch, and Undo puts back the same ones", async () => {
    // 2026-09-29: one batchModify for the whole pick (add TRASH, remove
    // INBOX) instead of a thread-trash request each, and Undo is the inverse
    // on the same message ids, not a whole-thread untrash.
    const batches: { ids: string[]; add: string[]; remove: string[] }[] = [];
    let threadLevel = 0;
    const api = makeFakeGoogleApi({
      listThreads: async () => THREADS,
      batchModifyMessages: async (ids: string[], add: string[], remove: string[]) => { batches.push({ ids, add, remove }); },
      trashThread: async () => { threadLevel++; },
      untrashThread: async () => { threadLevel++; },
    });
    mount(api);
    await selectMode();

    // Nothing picked: the button names itself and refuses.
    const idle = screen.getByRole("button", { name: "Delete" });
    expect(idle).toBeDisabled();

    const rows = await screen.findAllByLabelText("Not picked");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    await act(async () => { fireEvent.click(rows[0]!); fireEvent.click(rows[1]!); });

    const del = await screen.findByRole("button", { name: "Delete 2" });
    await act(async () => { fireEvent.click(del); });
    await waitFor(() => expect(batches).toHaveLength(1));
    expect(batches[0]!.add).toEqual(["TRASH"]);
    expect(batches[0]!.remove).toEqual(["INBOX"]);
    expect(batches[0]!.ids).toHaveLength(2);

    // The toast is the only way back, and it has to put back what it took.
    const undo = await screen.findByRole("button", { name: "Undo" }, { timeout: 4000 });
    await act(async () => { fireEvent.click(undo); });
    await waitFor(() => expect(batches).toHaveLength(2));
    expect(batches[1]!.add).toEqual(["INBOX"]);
    expect(batches[1]!.remove).toEqual(["TRASH"]);
    expect([...batches[1]!.ids].sort()).toEqual([...batches[0]!.ids].sort());
    expect(threadLevel).toBe(0); // no thread-level trash or untrash anywhere
  });

  it("Archive N takes the picked threads out of the inbox and nothing else", async () => {
    const archived: string[] = [];
    const api = makeFakeGoogleApi({
      listThreads: async () => THREADS,
      modifyThread: async (id: string, add: string[], remove: string[]) => {
        expect(remove).toContain("INBOX");
        expect(add).toEqual([]);
        archived.push(id);
      },
    });
    mount(api);
    await selectMode();

    const rows = await screen.findAllByLabelText("Not picked");
    await act(async () => { fireEvent.click(rows[0]!); });
    const arch = await screen.findByRole("button", { name: "Archive 1" });
    await act(async () => { fireEvent.click(arch); });
    await waitFor(() => expect(archived).toHaveLength(1));
  });
});

// SELECT ON THE MAIN LIST, AND THE ONE CONFIRMATION (2026-09-29). Select used
// to live inside the fold and could only ever reach the low-stakes pile. It is
// on the main list now and reaches everything, so what makes it safe is that
// deleting mail that may need him asks ONCE, for the whole batch, and that a
// selection survives anything that stops it.
describe("MessagesFlow: select on the main list", () => {
  const MIXED = [
    { id: "n1", bucket: "needs_you", gist: "Waiver needed by Friday." },
    { id: "n2", bucket: "worth_knowing", gist: "A sale." },
    { id: "n3", bucket: "worth_knowing", gist: "A newsletter." },
  ];
  const mountMixed = (api: ReturnType<typeof makeFakeGoogleApi>) => render(
    <NotesProvider userId="u-bulk2">
      <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => api}>
        <ToastHost />
        <MessagesFlow ai={triage(JSON.stringify(MIXED))} configured />
      </GoogleSessionProvider>
    </NotesProvider>,
  );
  const openSelect = async () => {
    await act(async () => { fireEvent.click(await screen.findByText("Connect Google")); });
    await screen.findByText(/Waiver needed by Friday/, {}, { timeout: 5000 });
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Select" })); });
  };

  it("a batch that includes mail that may need him asks once, with the count, and Cancel changes nothing", async () => {
    const batches: string[][] = [];
    const api = makeFakeGoogleApi({
      listThreads: async () => THREADS,
      batchModifyMessages: async (ids: string[]) => { batches.push(ids); },
    });
    mountMixed(api);
    await openSelect();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Select All Shown" })); });
    expect(screen.getAllByLabelText("Picked")).toHaveLength(3);

    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Delete 3" })); });
    // ONE question, naming the batch and how much of it may need him.
    expect(await screen.findByText("Move 3 conversations to Trash? 1 may need you.")).toBeInTheDocument();
    expect(batches).toHaveLength(0);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Cancel" })); });
    expect(batches).toHaveLength(0);
    // Cancelled means untouched: still selected, still in the list.
    expect(screen.getAllByLabelText("Picked")).toHaveLength(3);
    expect(screen.getByText(/Waiver needed by Friday/)).toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Delete 3" })); });
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Move to Trash" })); });
    await waitFor(() => expect(batches).toHaveLength(1));
    expect(batches[0]).toHaveLength(3);
    await waitFor(() => expect(screen.queryByText(/Waiver needed by Friday/)).toBeNull());
    expect(await screen.findByText(/3 Conversations Moved to Trash \u00b7 Gmail Keeps Them for 30 Days/)).toBeInTheDocument();
  });

  it("a batch of things already judged safe goes straight through with an Undo, no question", async () => {
    const batches: string[][] = [];
    const api = makeFakeGoogleApi({
      listThreads: async () => THREADS,
      batchModifyMessages: async (ids: string[]) => { batches.push(ids); },
    });
    mountMixed(api);
    await openSelect();
    const boxes = await screen.findAllByLabelText("Not picked");
    // The two worth-knowing rows only.
    await act(async () => { fireEvent.click(screen.getByText(/A sale\./)); fireEvent.click(screen.getByText(/A newsletter\./)); });
    expect(boxes.length).toBe(3);
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Delete 2" })); });
    await waitFor(() => expect(batches).toHaveLength(1));
    expect(screen.queryByText(/may need you/)).toBeNull();
    expect(await screen.findByRole("button", { name: "Undo" })).toBeInTheDocument();
  });

  it("a session that cannot write names the cause, moves nothing, and keeps the selection", async () => {
    const batches: string[][] = [];
    let networkDown = false;
    const api = makeFakeGoogleApi({
      listThreads: async () => THREADS,
      getProfile: async () => { if (networkDown) throw new TypeError("Failed to fetch"); return { emailAddress: "me@example.com" }; },
      batchModifyMessages: async (ids: string[]) => { batches.push(ids); },
    });
    mountMixed(api);
    await openSelect();
    await act(async () => { fireEvent.click(screen.getByText(/A sale\./)); });
    // Between selecting and deleting, the connection to Google drops: the
    // account cannot be verified, so it cannot be written to.
    networkDown = true;
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Delete 1" })); });
    await waitFor(() => expect(screen.getByText(/reach Google/i)).toBeInTheDocument());
    expect(batches).toHaveLength(0);
    expect(screen.getByLabelText("Picked")).toBeInTheDocument(); // the selection survived
    expect(screen.getByText(/A sale\./)).toBeInTheDocument();     // and so did the row
  });

  it("a double tap on Delete sends one batch, not two", async () => {
    const batches: string[][] = [];
    const api = makeFakeGoogleApi({
      listThreads: async () => THREADS,
      batchModifyMessages: async (ids: string[]) => { await new Promise((r) => setTimeout(r, 30)); batches.push(ids); },
    });
    mountMixed(api);
    await openSelect();
    await act(async () => { fireEvent.click(screen.getByText(/A sale\./)); });
    const del = await screen.findByRole("button", { name: "Delete 1" });
    await act(async () => { fireEvent.click(del); fireEvent.click(del); });
    await waitFor(() => expect(batches.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 120));
    expect(batches).toHaveLength(1);
  });

  it("Select All Shown covers what is shown, and Done leaves select mode without touching anything", async () => {
    const api = makeFakeGoogleApi({ listThreads: async () => THREADS });
    mountMixed(api);
    await openSelect();
    expect(screen.queryAllByLabelText("Picked")).toHaveLength(0);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Select All Shown" })); });
    expect(screen.getAllByLabelText("Picked")).toHaveLength(3);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Done" })); });
    expect(screen.queryByLabelText("Picked")).toBeNull();
    expect(screen.getByText(/Waiver needed by Friday/)).toBeInTheDocument();
  });
});
