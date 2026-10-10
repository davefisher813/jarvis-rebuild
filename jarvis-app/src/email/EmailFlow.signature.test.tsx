// @vitest-environment jsdom
// THE SAVED SIGNATURE, END TO END AGAINST A FAKE SESSION (Email v1 spec
// 2026-10-08, section 6; Dave's locked decision L3; AC17 to AC19). What this
// holds: a fresh compose or reply appends the account's current signature
// once, as its own block, and skips it entirely when the account's signature
// is empty; switching the From account on a still-untouched block replaces
// it in silence; switching it on a block the person edited leaves the body
// alone and offers an explicit Use Saved Signature instead.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import EmailFlow from "./EmailFlow";
import { COMPOSE_LABEL, FROM_LABEL, SIGNATURE_OFFER_NOTE, USE_SAVED_SIGNATURE } from "./copy";
import type { EmailAccount, InboxRow, RpcClient } from "./emailClient";
import type { DraftFields, DraftRow } from "./drafts";
import { subscribeToast, resetToasts, type ToastState } from "../shared/toast";

const NOW = new Date("2026-10-10T15:00:00Z");
const USER = "user-1";
const DAVE = "dave@example.test";
const WORK = "dave@work.test";

const account = (o: Partial<EmailAccount> = {}): EmailAccount => ({
  id: "acct-dave", address: DAVE, state: "connected", last_sync_at: "2026-10-10T14:50:00Z", sync_error: null, capabilities: { archive: true, trash: true, read: true },
  connected_at: "2026-09-01T00:00:00Z", scopes: [], cached: 0, signature_text: "Dave Fisher", signature_revision: 1, ...o,
});
const accounts: EmailAccount[] = [account({}), account({ id: "acct-work", address: WORK, signature_text: "Dave F. · Work", signature_revision: 3 })];
const rows: InboxRow[] = [];

type Fn = (args: Record<string, unknown>) => unknown;
interface Rig { client: RpcClient }

function rig(o: { accounts?: EmailAccount[] } = {}): Rig {
  const acc = o.accounts ?? accounts;
  let seq = 0;
  const drafts: Record<string, DraftRow> = {};
  const rowOf = (id: string, accountId: string, f: DraftFields, revision: number): DraftRow => ({
    id, account_id: accountId, account: acc.find((a) => a.id === accountId)?.address ?? DAVE, thread_id: f.thread_id, to_addresses: f.to_addresses, cc_addresses: f.cc_addresses,
    bcc_addresses: f.bcc_addresses, subject: f.subject, body_text: f.body_text, attachment_refs: f.attachment_refs, reply_headers: f.reply_headers, signature_revision: f.signature_revision,
    send_state: "draft", saved_at: NOW.toISOString(), revision, updated_at: NOW.toISOString(), sent_action_id: null, provider_message_id: null, action_state: null, action_verb: null,
    outbox_state: null, error_code: null, provider_ack: null,
  });
  const table: Record<string, Fn> = {
    email_accounts: () => acc,
    email_inbox: () => ({ rows, cached_total: 0, page: 30 }),
    substrate_readiness: () => ({ registered: ["money_bill", "money_receipt", "task", "event", "waiting"] }),
    candidates_for: () => [],
    draft_save: (a) => {
      const f = a.p_fields as DraftFields;
      const id = (a.p_draft as string | null) ?? `d-${++seq}`;
      const existing = drafts[id];
      const next = rowOf(id, a.p_account as string, f, (existing?.revision ?? 0) + 1);
      drafts[id] = next;
      return { draft_id: id, revision: next.revision, saved_at: next.saved_at, send_state: "draft" };
    },
  };
  const client: RpcClient = { rpc: async (fn, args) => { const f = table[fn]; if (!f) throw new Error("no fake for " + fn); return { data: f((args ?? {}) as Record<string, unknown>), error: null }; } };
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }) as Response));
  return { client };
}

const mount = (r: Rig) => render(<EmailFlow client={r.client} token="jwt" userId={USER} categories={[]} now={() => NOW} zone="America/New_York" onOpenConnections={() => {}} onOpenModule={() => {}} />);
const byRole = (name: string) => screen.getByRole("button", { name });
const openCompose = async (r: Rig) => {
  mount(r);
  await waitFor(() => expect(byRole(COMPOSE_LABEL)).toBeInTheDocument());
  fireEvent.click(byRole(COMPOSE_LABEL));
  await waitFor(() => expect(screen.getByLabelText("Message")).toBeInTheDocument());
};
const messageValue = () => (screen.getByLabelText("Message") as HTMLTextAreaElement).value;
/** Opens the From dropdown and picks the account whose address is given, the way a person switches senders. */
const switchFrom = (address: string) => {
  fireEvent.click(screen.getByRole("button", { name: FROM_LABEL }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: address }));
};

let toasts: ToastState[] = [];
let unsub = () => {};
beforeEach(() => { localStorage.clear(); resetToasts(); toasts = []; unsub = subscribeToast((t) => { if (t) toasts.push(t); }); });
afterEach(() => { unsub(); cleanup(); vi.unstubAllGlobals(); });

describe("AC17: a fresh compose or reply shows the account's signature once, editable", () => {
  it("appends the connected account's current signature as its own block, at the end", async () => {
    const r = rig();
    await openCompose(r);
    expect(messageValue()).toBe("\n\n-- \nDave Fisher");
    // It is an ordinary part of the editable field, not a separate control.
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Thanks!" + messageValue() } });
    expect(messageValue()).toBe("Thanks!\n\n-- \nDave Fisher");
  });

  it("an empty signature appends nothing: not an empty block, nothing at all", async () => {
    const r = rig({ accounts: [account({ signature_text: "" })] });
    await openCompose(r);
    expect(messageValue()).toBe("");
  });
});

describe("AC19: switching the From account decides the signature", () => {
  it("replaces a still-untouched block in silence when the account changes", async () => {
    const r = rig();
    await openCompose(r);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Thanks!" + messageValue() } });
    expect(messageValue()).toBe("Thanks!\n\n-- \nDave Fisher");
    switchFrom(WORK);
    await waitFor(() => expect(messageValue()).toBe("Thanks!\n\n-- \nDave F. · Work"));
    expect(screen.queryByText(USE_SAVED_SIGNATURE)).toBeNull();
  });

  it("drops the block in silence when the new account has no signature, as long as the old one was untouched", async () => {
    const r = rig({ accounts: [account({}), account({ id: "acct-work", address: WORK, signature_text: "" })] });
    await openCompose(r);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Thanks!" + messageValue() } });
    switchFrom(WORK);
    await waitFor(() => expect(messageValue()).toBe("Thanks!"));
  });

  it("leaves an edited block alone and offers an explicit Use Saved Signature instead of a silent rewrite", async () => {
    const r = rig();
    await openCompose(r);
    // The person edits the signature itself.
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Thanks!\n\n-- \nDave Fisher, Esq." } });
    switchFrom(WORK);
    await waitFor(() => expect(screen.getByText(SIGNATURE_OFFER_NOTE)).toBeInTheDocument());
    // Nothing was rewritten on its own.
    expect(messageValue()).toBe("Thanks!\n\n-- \nDave Fisher, Esq.");
    fireEvent.click(byRole(USE_SAVED_SIGNATURE));
    await waitFor(() => expect(messageValue()).toContain("Dave F. · Work"));
    expect(screen.queryByText(SIGNATURE_OFFER_NOTE)).toBeNull();
  });

  it("offers nothing when there was never a managed block and the new account also has none to use", async () => {
    const r = rig({ accounts: [account({ signature_text: "" }), account({ id: "acct-work", address: WORK, signature_text: "" })] });
    await openCompose(r);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Thanks!" } });
    switchFrom(WORK);
    await waitFor(() => expect(screen.getByLabelText("Subject")).toBeInTheDocument());
    expect(screen.queryByText(SIGNATURE_OFFER_NOTE)).toBeNull();
    expect(messageValue()).toBe("Thanks!");
  });
});
