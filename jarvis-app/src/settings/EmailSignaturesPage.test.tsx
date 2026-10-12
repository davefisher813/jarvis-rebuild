// @vitest-environment jsdom
// EMAIL SIGNATURES IN SETTINGS (fix order item 2, 2026-10-11): one row per mailbox with its saved signature's first line,
// Not Set when there is none, and the editor on a tap; a save updates the row and is announced to the Email tab.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import EmailSignaturesPage, { LOAD_FAILED_TITLE, NO_MAILBOXES_SUB, NO_MAILBOXES_TITLE, OPEN_CONNECTIONS, TRY_AGAIN, signaturePreview } from "./EmailSignaturesPage";
import { onSignatureSaved, type SignatureSaved } from "../email/signatureBus";
import { NO_SIGNATURE, SIGNATURE_LABEL } from "../email/copy";
import type { EmailAccount, RpcClient } from "../email/emailClient";

const acct = (o: Partial<EmailAccount>): EmailAccount => ({
  id: "a1", address: "dave@example.test", state: "connected", last_sync_at: null, sync_error: null, capabilities: { archive: true, trash: true, read: true },
  connected_at: "2026-09-01T00:00:00Z", scopes: [], cached: 0, signature_text: "", signature_revision: 1, ...o,
});

afterEach(() => cleanup());

describe("Email Signatures page", () => {
  it("lists each connected mailbox with its signature or Not Set, and saves through the editor", async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const client: RpcClient = { rpc: async (fn, args) => {
      calls.push({ fn, args: (args ?? {}) as Record<string, unknown> });
      if (fn === "email_accounts") return { data: [acct({}), acct({ id: "a2", address: "dave@work.test", signature_text: "\nDave F.\nWork" }), acct({ id: "a3", address: "old@example.test", state: "disconnected" })], error: null };
      if (fn === "email_signature_set") return { data: { account_id: (args as Record<string, unknown>).p_account, signature_text: (args as Record<string, unknown>).p_text, signature_revision: 2 }, error: null };
      return { data: null, error: null };
    } };
    const heard: SignatureSaved[] = [];
    const off = onSignatureSaved((s) => heard.push(s));
    render(<EmailSignaturesPage onBack={() => {}} client={client} userId="u1" />);
    await waitFor(() => expect(screen.getByText("dave@example.test")).toBeInTheDocument());
    expect(screen.getByText(NO_SIGNATURE)).toBeInTheDocument();
    expect(screen.getByText("Dave F.")).toBeInTheDocument();
    expect(screen.queryByText("old@example.test")).toBeNull();
    fireEvent.click(screen.getByText("dave@example.test"));
    fireEvent.change(screen.getByLabelText(SIGNATURE_LABEL), { target: { value: "Dave Fisher" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText("Dave Fisher")).toBeInTheDocument());
    expect(calls.find((c) => c.fn === "email_signature_set")!.args).toMatchObject({ p_owner: "u1", p_account: "a1", p_text: "Dave Fisher", p_expected_revision: 1 });
    expect(heard).toEqual([{ accountId: "a1", text: "Dave Fisher", revision: 2 }]);
    off();
  });

  it("draws skeleton rows while it asks, never a blank page", async () => {
    let answer: (v: { data: unknown; error: null }) => void = () => {};
    const client: RpcClient = { rpc: () => new Promise((r) => { answer = r; }) };
    const { container } = render(<EmailSignaturesPage onBack={() => {}} client={client} userId="u1" />);
    expect(container.querySelectorAll(".skel-row").length).toBeGreaterThan(0);
    answer({ data: [acct({})], error: null });
    await waitFor(() => expect(screen.getByText("dave@example.test")).toBeInTheDocument());
    expect(container.querySelector(".skel-row")).toBeNull();
  });

  it("with no connected mailbox: a glyph, a title, one line and the door to Connections", async () => {
    const client: RpcClient = { rpc: async () => ({ data: [acct({ state: "disconnected" })], error: null }) };
    let opened = 0;
    const { container } = render(<EmailSignaturesPage onBack={() => {}} onOpenConnections={() => { opened++; }} client={client} userId="u1" />);
    await waitFor(() => expect(screen.getByText(NO_MAILBOXES_TITLE)).toBeInTheDocument());
    expect(container.querySelector(".empty-state .empty-icon")).not.toBeNull();
    expect(screen.getByText(NO_MAILBOXES_SUB)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: OPEN_CONNECTIONS }));
    expect(opened).toBe(1);
  });

  it("a read that failed says so with Try Again, which asks again", async () => {
    let n = 0;
    const client: RpcClient = { rpc: async () => (++n === 1 ? { data: null, error: { message: "down" } } : { data: [acct({})], error: null }) };
    render(<EmailSignaturesPage onBack={() => {}} client={client} userId="u1" />);
    await waitFor(() => expect(screen.getByText(LOAD_FAILED_TITLE)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: TRY_AGAIN }));
    await waitFor(() => expect(screen.getByText("dave@example.test")).toBeInTheDocument());
  });

  it("the row shows the first line that has words", () => {
    expect(signaturePreview("\n  \nDave\nBFFSA")).toBe("Dave");
    expect(signaturePreview("")).toBe("");
  });
});
