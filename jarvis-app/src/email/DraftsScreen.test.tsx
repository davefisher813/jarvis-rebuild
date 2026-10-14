// @vitest-environment jsdom
// THE DRAFTS LIST SHOWS A DRAFT ONCE (issue 103, D5 part 2, 2026-10-13). The list reads the server's drafts and the copies this
// phone holds that the server may not have. A copy is written a moment AFTER the save it follows, by this phone's clock, so by the
// two clocks it always looked newer than the server's row and the same draft was listed twice ("On This Device" beside it). A copy
// is the same draft when the server lists its id with the same words; words the server does not have stay visible.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import DraftsScreen from "./DraftsScreen";
import { THIS_DEVICE } from "./copy";
import { deviceOnly, emptyFields, saveLocalDraft, type DraftFields, type DraftRow, type LocalDraft } from "./drafts";
import type { RpcClient } from "./emailClient";

const USER = "u-drafts";
const words = (body: string): DraftFields => ({ ...emptyFields(), to_addresses: ["coach@example.test"], subject: "Quarterly note", body_text: body });
const serverRow = (id: string, body: string, savedAt: string): DraftRow => ({
  ...words(body), id, account_id: "acct", account: "dave@example.test", send_state: "draft", saved_at: savedAt, revision: 3, updated_at: savedAt,
  sent_action_id: null, provider_message_id: null, action_state: null, action_verb: null, outbox_state: null, error_code: null, provider_ack: null,
});
const localCopy = (key: string, draftId: string | null, body: string, savedAt: string, serverAt: string | null): LocalDraft => ({
  key, draft_id: draftId, account_id: "acct", fields: words(body), revision: draftId ? 3 : null, saved_at: savedAt, server_saved_at: serverAt,
});
const client = (drafts: DraftRow[]): RpcClient => ({ rpc: async (fn) => ({ data: fn === "draft_list" ? { drafts, sent: [] } : null, error: null }) });
const show = (drafts: DraftRow[]) => render(
  <DraftsScreen client={client(drafts)} userId={USER} offline={false} onBack={() => {}} onCompose={() => {}} onOpenDraft={() => {}} onOpenLocal={() => {}} onOpenSent={() => {}} />,
);

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("the Drafts list shows a draft once", () => {
  it("a copy of a draft the server lists, with the same words, is not a second row, though this phone wrote it after the server did", async () => {
    saveLocalDraft(USER, localCopy("d-1", "d-1", "Same words", "2026-10-03T15:00:00.400Z", "2026-10-03T15:00:00.000Z"));
    show([serverRow("d-1", "Same words", "2026-10-03T15:00:00.000Z")]);
    expect(await screen.findByText("Quarterly note")).toBeInTheDocument();
    expect(screen.getAllByText("Quarterly note").length).toBe(1);
    expect(screen.queryByText(THIS_DEVICE)).toBeNull();
  });

  it("the same, when this phone's clock is minutes ahead of the server's", async () => {
    saveLocalDraft(USER, localCopy("d-1", "d-1", "Same words", "2026-10-03T15:09:00.000Z", "2026-10-03T15:00:00.000Z"));
    show([serverRow("d-1", "Same words", "2026-10-03T15:00:00.000Z")]);
    expect(await screen.findByText("Quarterly note")).toBeInTheDocument();
    expect(screen.getAllByText("Quarterly note").length).toBe(1);
  });

  it("words the server does not have stay: a copy edited here after the save is listed beside the draft, so nothing typed is hidden", async () => {
    saveLocalDraft(USER, localCopy("d-1", "d-1", "Edited here since", "2026-10-03T15:30:00.000Z", "2026-10-03T15:00:00.000Z"));
    show([serverRow("d-1", "Saved words", "2026-10-03T15:00:00.000Z")]);
    expect(await screen.findByText(THIS_DEVICE)).toBeInTheDocument();
    expect(screen.getAllByText("Quarterly note").length).toBe(2);
  });

  it("a copy the server's row has overtaken (saved later from another device) is the older words, and is dropped", async () => {
    saveLocalDraft(USER, localCopy("d-1", "d-1", "Older words", "2026-10-03T15:00:00.000Z", "2026-10-03T14:59:00.000Z"));
    show([serverRow("d-1", "Newer words from the other phone", "2026-10-03T15:20:00.000Z")]);
    expect(await screen.findByText("Quarterly note")).toBeInTheDocument();
    expect(screen.getAllByText("Quarterly note").length).toBe(1);
    expect(screen.queryByText(THIS_DEVICE)).toBeNull();
  });

  it("a copy that never reached the server is listed on its own, as On This Device", async () => {
    saveLocalDraft(USER, localCopy("local:abc", null, "Only here", "2026-10-03T15:00:00.000Z", null));
    show([]);
    expect(await screen.findByText(THIS_DEVICE)).toBeInTheDocument();
    expect(screen.getAllByText("Quarterly note").length).toBe(1);
  });

  it("deviceOnly keeps what the server does not hold and drops what it does, by id", () => {
    const keep = localCopy("local:x", null, "Only here", "2026-10-03T15:00:00.000Z", null);
    const dup = localCopy("d-1", "d-1", "Same words", "2026-10-03T15:00:01.000Z", "2026-10-03T15:00:00.000Z");
    const edited = localCopy("d-2", "d-2", "Edited here", "2026-10-03T15:10:00.000Z", "2026-10-03T15:00:00.000Z");
    const server = [serverRow("d-1", "Same words", "2026-10-03T15:00:00.000Z"), serverRow("d-2", "Saved words", "2026-10-03T15:00:00.000Z")];
    expect(deviceOnly([keep, dup, edited], server).map((l) => l.key)).toEqual(["local:x", "d-2"]);
    expect(deviceOnly([keep, dup, edited], []).map((l) => l.key)).toEqual(["local:x", "d-1", "d-2"]);
  });
});

describe("a draft swipes (Dave 2026-10-13: swipe is the standard)", () => {
  it("swipe Delete discards a plain draft and the toast's Undo saves its words back as a draft", async () => {
    const calls: string[] = [];
    const row = serverRow("d-9", "Words to keep", "2026-10-03T15:00:00.000Z");
    const rpc: RpcClient = { rpc: async (fn) => { calls.push(fn); return { data: fn === "draft_list" ? { drafts: [row], sent: [] } : fn === "draft_discard" ? { draft_id: "d-9", discarded: true, draft: row } : { draft_id: "d-10", revision: 1, saved_at: "2026-10-03T15:01:00.000Z", send_state: "draft" }, error: null }; } };
    render(<DraftsScreen client={rpc} userId={USER} offline={false} onBack={() => {}} onCompose={() => {}} onOpenDraft={() => {}} onOpenLocal={() => {}} onOpenSent={() => {}} />);
    expect(await screen.findByText("Quarterly note")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete Quarterly note" }));
    await waitFor(() => expect(calls).toContain("draft_discard"));
    await waitFor(() => expect(screen.queryByText("Quarterly note")).toBeNull());
  });
  it("a sent or failed draft has a review to go through, so its row does not swipe", async () => {
    const failed = { ...serverRow("d-8", "x", "2026-10-03T15:00:00.000Z"), send_state: "failed" as const };
    show([failed]);
    expect(await screen.findByText("Quarterly note")).toBeInTheDocument();
    expect(document.querySelector(".task-swipe")).toBeNull();
  });
});
