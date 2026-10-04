// @vitest-environment jsdom
// COPY MESSAGE ID, AND SAY SO ONLY IF IT WORKED (2026-10-04). The More menu's
// Copy Message Id awaited `navigator.clipboard?.writeText`, which is undefined
// where there is no clipboard: the await passed and "Message Id Copied" went up
// over nothing. A refused write fell into an empty catch and said nothing.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import MessageScreen from "./MessageScreen";
import { COPIED_ID, COPY_ID } from "./copy";
import type { EmailAccount, InboxRow, MessageDetail, RpcClient } from "./emailClient";
import { subscribeToast, resetToasts } from "../shared/toast";

const row: InboxRow = {
  id: "u-m1", account_id: "acct-dave", account: "dave@example.test", provider_id: "18f2a9c4e1b7d3a1", thread_id: "t1",
  internal_date: "2026-10-03T10:00:00Z", from_address: "billing@conedison.test", from_name: "Con Edison",
  subject: "Subject m1", snippet: "Amount due", has_body: true, attachment_metadata: [], provider_labels: ["INBOX"], source_hash: "sh", read: true,
};
const detail: MessageDetail = {
  ...row, to_addresses: [{ address: "dave@example.test", name: "" }], cc_addresses: [], deleted: false,
  attachments: [], text: "Amount due", html: null,
};
const client: RpcClient = { rpc: async () => ({ data: detail, error: null }) };
const account = { id: "acct-dave", address: "dave@example.test", state: "connected", capabilities: { archive: true, trash: true, read: true } } as unknown as EmailAccount;

const setClipboard = (c: unknown) => Object.defineProperty(navigator, "clipboard", { value: c, configurable: true });
let said: string[] = [];
let unsub = () => {};
beforeEach(() => {
  localStorage.clear();
  resetToasts();
  said = [];
  unsub = subscribeToast((t) => { if (t) said.push(t.message); });
});
afterEach(() => { unsub(); cleanup(); setClipboard(undefined); });

async function copyId() {
  render(<MessageScreen client={client} token="jwt" userId="u1" row={row} account={account} offline={false} categories={[]} categoryId={null}
    onBack={() => {}} onRowChanged={() => {}} onLeftInbox={() => {}} onFileUnder={() => {}} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "More" })).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  fireEvent.click(await screen.findByRole("button", { name: COPY_ID }));
}

describe("MessageScreen: Copy Message Id", () => {
  it("copies the account and the id, and says it copied only after the clipboard took it", async () => {
    const writeText = vi.fn(async () => {});
    setClipboard({ writeText });
    await copyId();
    await waitFor(() => expect(said).toContain(COPIED_ID));
    expect(writeText).toHaveBeenCalledWith("dave@example.test · 18f2a9c4e1b7d3a1");
  });

  it("with no clipboard at all it says it could not, and shows the id to read off", async () => {
    setClipboard(undefined);
    await copyId();
    await waitFor(() => expect(said).toContain("Couldn't Copy · dave@example.test · 18f2a9c4e1b7d3a1"));
    expect(said).not.toContain(COPIED_ID);
  });

  it("a clipboard that refuses the write is not reported as a copy, and is not silent either", async () => {
    setClipboard({ writeText: async () => { throw new Error("denied"); } });
    await copyId();
    await waitFor(() => expect(said.some((m) => m.startsWith("Couldn't Copy"))).toBe(true));
    expect(said).not.toContain(COPIED_ID);
  });
});
