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
  it("Delete N trashes every picked thread, and Undo untrashes the same ones", async () => {
    const trashed: string[] = [], untrashed: string[] = [];
    const api = makeFakeGoogleApi({
      listThreads: async () => THREADS,
      trashThread: async (id: string) => { trashed.push(id); },
      untrashThread: async (id: string) => { untrashed.push(id); },
    });
    mount(api);
    await selectMode();

    // Nothing picked: the button names itself and refuses.
    const idle = screen.getByRole("button", { name: "Delete Selected" });
    expect(idle).toBeDisabled();

    const rows = await screen.findAllByLabelText("Not picked");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    await act(async () => { fireEvent.click(rows[0]!); fireEvent.click(rows[1]!); });

    const del = await screen.findByRole("button", { name: "Delete 2" });
    await act(async () => { fireEvent.click(del); });
    await waitFor(() => expect(trashed).toHaveLength(2));

    // The toast is the only way back, and it has to put back what it took.
    const undo = await screen.findByRole("button", { name: "Undo" }, { timeout: 4000 });
    await act(async () => { fireEvent.click(undo); });
    await waitFor(() => expect(untrashed.sort()).toEqual(trashed.slice().sort()));
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
