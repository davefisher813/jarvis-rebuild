// @vitest-environment jsdom
// THE GEICO LINE, IN THE MESSAGE (Dave 2026-10-13, issue 103). A message with
// no body yet falls back to its snippet. That fallback is the same cleaned
// preview the inbox row shows, never the encoded padding; and a snippet that
// is only padding draws nothing, not an empty note.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import MessageScreen from "./MessageScreen";
import type { EmailAccount, InboxRow, MessageDetail, RpcClient } from "./emailClient";

const PAD = "&#847;&zwnj;&nbsp;&#8203;&nbsp;\u034f\u200c \u034f\u200c ";
const account = { id: "acct-dave", address: "dave@example.test", state: "connected", capabilities: { archive: true, trash: true, read: true } } as unknown as EmailAccount;
const rowOf = (snippet: string, has_body: boolean): InboxRow => ({
  id: "u-m1", account_id: "acct-dave", account: "dave@example.test", provider_id: "18f2a9c4e1b7d3a1", thread_id: "t1",
  internal_date: "2026-10-13T10:00:00Z", from_address: "service@geico.test", from_name: "GEICO",
  subject: "Your policy renews soon", snippet, has_body, attachment_metadata: [], provider_labels: ["INBOX"], source_hash: "sh", read: true,
});
const calls = { n: 0 };
function open(snippet: string, has_body: boolean) {
  const row = rowOf(snippet, has_body);
  const detail: MessageDetail = { ...row, to_addresses: [{ address: "dave@example.test", name: "" }], cc_addresses: [], deleted: false, attachments: [], text: null, html: null };
  const client: RpcClient = { rpc: async () => { calls.n++; return { data: detail, error: null }; } };
  return render(<MessageScreen client={client} token="jwt" userId="u1" row={row} account={account} offline={false} categories={[]} categoryId={null}
    onBack={() => {}} onRowChanged={() => {}} onLeftInbox={() => {}} onFileUnder={() => {}} />);
}
afterEach(() => { cleanup(); calls.n = 0; });

describe("MessageScreen snippet fallback", () => {
  it("shows the cleaned preview when the message has no body", async () => {
    open("View in browser Your GEICO bill is ready, Dave&#39;s policy " + PAD + PAD, false);
    await waitFor(() => expect(screen.getByText("Your GEICO bill is ready, Dave's policy")).toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/[\u034f\u200c]|&#|&zwnj;/);
  });

  it("draws no empty note when the snippet is only padding", async () => {
    open("View in browser " + PAD + PAD, false);
    await waitFor(() => expect(calls.n).toBeGreaterThan(0)); // the message was asked for
    await new Promise((res) => setTimeout(res, 400)); // and the answer has been drawn
    expect(document.body.querySelector(".email-note")).toBeNull();
    expect(document.body.querySelector(".email-body")).toBeNull();
  });
});
