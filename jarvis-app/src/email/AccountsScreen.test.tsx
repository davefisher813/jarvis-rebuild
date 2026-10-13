// @vitest-environment jsdom
// THE SIGNATURE EDITOR ON ACCOUNTS (Email v1 spec 2026-10-08, section 6;
// Dave's locked decision L3). Reached from a quiet trailing door on the
// account row, never the row's own tap target (that still opens
// Connections). Opens with the account's current text, saves through
// email_signature_set, and an empty save is accepted as explicit (spec:
// "Empty is valid").
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import AccountsScreen from "./AccountsScreen";
import { CATCHING_UP, EDIT_SIGNATURE, RECONNECT, SIGNATURE_SAVED } from "./copy";
import { NOT_CONFIRMED, READY_TO_SEND, SENDING_LABEL, SIGNED_IN, SIGN_IN_LABEL, STATUS_SHEET_TITLE, SYNC_LABEL, UP_TO_DATE, sendFacts } from "./AccountStatusSheet";
import { RETRY_SYNC } from "./statusHeadline";
import { deriveStatus, viewOf, type AccountStatus } from "../connections/connectionStatus";
import type { EmailAccount, RpcClient } from "./emailClient";
import { subscribeToast, resetToasts, type ToastState } from "../shared/toast";

const DAVE = "dave@example.test";
const account = (o: Partial<EmailAccount> = {}): EmailAccount => ({
  id: "acct-dave", address: DAVE, state: "connected", last_sync_at: "2026-10-10T14:50:00Z", sync_error: null, capabilities: { archive: true, trash: true, read: true },
  connected_at: "2026-09-01T00:00:00Z", scopes: [], cached: 3, signature_text: "Dave Fisher", signature_revision: 1, ...o,
});

type Fn = (args: Record<string, unknown>) => unknown;
function rig(o: { rpc?: Partial<Record<string, Fn>> } = {}): { client: RpcClient; calls: Array<{ fn: string; args: Record<string, unknown> }> } {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const table: Record<string, Fn> = {
    email_signature_set: (a) => ({ account_id: a.p_account, signature_text: a.p_text, signature_revision: (a.p_expected_revision as number) + 1 }),
    ...o.rpc,
  };
  const client: RpcClient = { rpc: async (fn, args) => { calls.push({ fn, args: (args ?? {}) as Record<string, unknown> }); const f = table[fn]; if (!f) throw new Error("no fake for " + fn); return { data: f((args ?? {}) as Record<string, unknown>), error: null }; } };
  return { client, calls };
}

const openEditor = (a: EmailAccount = account()) => {
  fireEvent.click(screen.getByRole("button", { name: `More Actions for ${a.address}` }));
  fireEvent.click(screen.getByRole("button", { name: EDIT_SIGNATURE }));
};

let toasts: ToastState[] = [];
let unsub = () => {};
beforeEach(() => { resetToasts(); toasts = []; unsub = subscribeToast((t) => { if (t) toasts.push(t); }); });
afterEach(() => { unsub(); cleanup(); vi.restoreAllMocks(); });

describe("the signature editor (AC17, AC18, AC19's own settings half)", () => {
  it("offers no menu at all without a client: a row with nothing that can work is not offered one", () => {
    render(<AccountsScreen accounts={[account()]} onBack={() => {}} onOpenConnections={() => {}} />);
    expect(screen.queryByRole("button", { name: `More Actions for ${DAVE}` })).toBeNull();
  });

  it("the row's own tap still opens Connections; the menu is a separate door", () => {
    const onOpenConnections = vi.fn();
    const r = rig();
    render(<AccountsScreen accounts={[account()]} client={r.client} userId="u1" onBack={() => {}} onOpenConnections={onOpenConnections} />);
    fireEvent.click(screen.getByText(DAVE));
    expect(onOpenConnections).toHaveBeenCalledTimes(1);
  });

  it("opens with the account's current text, saves the edit, and reports the new text and revision", async () => {
    const onSignatureSaved = vi.fn();
    const r = rig();
    render(<AccountsScreen accounts={[account()]} client={r.client} userId="u1" onBack={() => {}} onOpenConnections={() => {}} onSignatureSaved={onSignatureSaved} />);
    openEditor();
    expect(screen.getByLabelText("Signature")).toHaveValue("Dave Fisher");
    fireEvent.change(screen.getByLabelText("Signature"), { target: { value: "Dave Fisher\nSent from JARVIS" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSignatureSaved).toHaveBeenCalledWith("acct-dave", "Dave Fisher\nSent from JARVIS", 2, { accountId: "acct-dave", text: "Dave Fisher\nSent from JARVIS", revision: 2, kind: "text", fields: {}, image: null }));
    expect(r.calls).toEqual([{ fn: "email_signature_set", args: { p_owner: "u1", p_account: "acct-dave", p_text: "Dave Fisher\nSent from JARVIS", p_expected_revision: 1 } }]);
    expect(toasts.some((t) => t.message === SIGNATURE_SAVED)).toBe(true);
    // The sheet closed on its own.
    expect(screen.queryByLabelText("Signature")).toBeNull();
  });

  it("an empty signature is a valid, explicit save", async () => {
    const onSignatureSaved = vi.fn();
    const r = rig();
    render(<AccountsScreen accounts={[account()]} client={r.client} userId="u1" onBack={() => {}} onOpenConnections={() => {}} onSignatureSaved={onSignatureSaved} />);
    openEditor();
    fireEvent.change(screen.getByLabelText("Signature"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSignatureSaved).toHaveBeenCalledWith("acct-dave", "", 2, { accountId: "acct-dave", text: "", revision: 2, kind: "text", fields: {}, image: null }));
    expect(r.calls[0]!.args.p_text).toBe("");
  });

  it("a refusal shows the line and keeps the sheet open with the person's words", async () => {
    const r = rig({ rpc: { email_signature_set: () => ({ error: "SIGNATURE_CONFLICT", signature_revision: 9, signature_text: "Someone Else's Edit" }) } });
    render(<AccountsScreen accounts={[account()]} client={r.client} userId="u1" onBack={() => {}} onOpenConnections={() => {}} />);
    openEditor();
    fireEvent.change(screen.getByLabelText("Signature"), { target: { value: "Mine" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Signature Changed Elsewhere · Reload and Try Again")).toBeInTheDocument();
    expect(screen.getByLabelText("Signature")).toHaveValue("Mine");
  });

  it("Cancel closes without saving", () => {
    const r = rig();
    render(<AccountsScreen accounts={[account()]} client={r.client} userId="u1" onBack={() => {}} onOpenConnections={() => {}} />);
    openEditor();
    fireEvent.change(screen.getByLabelText("Signature"), { target: { value: "Changed my mind" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Signature")).toBeNull();
    expect(r.calls).toEqual([]);
  });
});

// V09 (2026-10-12): the per-account status sheet (spec 2.5, 8.1) and the one-tap reconnect from the head.
describe("the account's status sheet and the head's Reconnect", () => {
  const proven = (o: Partial<AccountStatus> = {}): AccountStatus => ({
    ...deriveStatus({ email: DAVE, refresh: { ok: true, scope: "https://www.googleapis.com/auth/gmail.modify" }, read: { ok: true, status: 200, emailAddress: DAVE }, lastSyncAt: "2026-10-12T09:00:00Z", now: new Date() }), ...o,
  });
  const lostStatus = () => deriveStatus({ email: DAVE, refresh: { ok: false, error: "invalid_grant" }, read: null, lastSyncAt: "2026-10-12T09:00:00Z", now: new Date() });
  const openStatus = () => {
    fireEvent.click(screen.getByRole("button", { name: `More Actions for ${DAVE}` }));
    fireEvent.click(screen.getByRole("button", { name: STATUS_SHEET_TITLE }));
    return screen.getByRole("dialog", { name: `${STATUS_SHEET_TITLE} ${DAVE}` });
  };
  const dims = (sheet: HTMLElement) => Object.fromEntries([...sheet.querySelectorAll("[data-dimension]")].map((r) => [r.getAttribute("data-dimension"), [...r.querySelectorAll(".fact")].map((f) => [f.textContent, f.className])]));

  it("shows Sign-In, Sync and Sending as three separate rows: a healthy, current mailbox, with no action to take", () => {
    const st = proven();
    render(<AccountsScreen accounts={[account({ sync_state: "current", verified_through_at: "2026-10-12T09:00:00Z" })]} views={new Map([[DAVE, viewOf(st, new Date(), true)]])} statuses={[st]} onBack={() => {}} onOpenConnections={() => {}} onReconnect={vi.fn()} onRetrySync={vi.fn()} />);
    const sheet = openStatus();
    const d = dims(sheet);
    expect(Object.keys(d)).toEqual([SIGN_IN_LABEL, SYNC_LABEL, SENDING_LABEL]);
    expect(d[SIGN_IN_LABEL]![0]).toEqual([SIGNED_IN, "fact good"]);
    expect(d[SYNC_LABEL]![0]).toEqual([UP_TO_DATE, "fact good"]);
    expect(d[SYNC_LABEL]![1]![0]).toMatch(/^Last Checked/);
    expect(d[SENDING_LABEL]![0]).toEqual([READY_TO_SEND, "fact good"]);
    expect(within(sheet).queryByRole("button", { name: RECONNECT })).toBeNull();
    expect(within(sheet).queryByRole("button", { name: RETRY_SYNC })).toBeNull();
    // One grey per row at most.
    for (const r of sheet.querySelectorAll("[data-dimension]")) expect(r.querySelectorAll(".fact:not(.good):not(.warn):not(.red):not(.date)").length).toBeLessThanOrEqual(1);
  });

  it("a lost sign-in offers Reconnect (one tap, that address); a mailbox still catching up says so and offers Retry Sync", () => {
    const st = lostStatus();
    const onReconnect = vi.fn();
    const onRetrySync = vi.fn();
    render(<AccountsScreen accounts={[account({ state: "reauth", sync_state: "catching_up" })]} views={new Map([[DAVE, viewOf(st, new Date(), true)]])} statuses={[st]} onBack={() => {}} onOpenConnections={() => {}} onReconnect={onReconnect} onRetrySync={onRetrySync} />);
    let sheet = openStatus();
    const d = dims(sheet);
    expect(d[SIGN_IN_LABEL]![0]).toEqual(["Needs Reconnecting", "fact warn"]);
    expect(d[SYNC_LABEL]![0]).toEqual([CATCHING_UP, "fact warn"]);
    expect(d[SENDING_LABEL]![0]![1]).toBe("fact warn");
    fireEvent.click(within(sheet).getByRole("button", { name: RECONNECT }));
    expect(onReconnect).toHaveBeenCalledWith(DAVE);
    sheet = openStatus();
    fireEvent.click(within(sheet).getByRole("button", { name: RETRY_SYNC }));
    expect(onRetrySync).toHaveBeenCalledTimes(1);
  });

  it("the head's Reconnect reconnects that exact mailbox in one tap, through the same path as the banner", () => {
    const st = lostStatus();
    const onReconnect = vi.fn();
    const onOpenConnections = vi.fn();
    render(<AccountsScreen accounts={[account({ state: "reauth" })]} views={new Map([[DAVE, viewOf(st, new Date(), true)]])} statuses={[st]} onBack={() => {}} onOpenConnections={onOpenConnections} onReconnect={onReconnect} />);
    fireEvent.click(screen.getByRole("button", { name: RECONNECT }));
    expect(onReconnect).toHaveBeenCalledWith(DAVE);
    expect(onOpenConnections).not.toHaveBeenCalled();
  });

  it("sending reasons are Title Case words, never the raw sentence", () => {
    expect(sendFacts(proven({ sendReady: { ready: false, reason: "Send permission missing" } }))).toEqual([{ text: "Send Permission Missing", tone: "warn" }]);
    expect(sendFacts(undefined)).toEqual([{ text: NOT_CONFIRMED, tone: "warn" }]);
  });
});
