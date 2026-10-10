// @vitest-environment jsdom
// THE SIGNATURE EDITOR ON ACCOUNTS (Email v1 spec 2026-10-08, section 6;
// Dave's locked decision L3). Reached from a quiet trailing door on the
// account row, never the row's own tap target (that still opens
// Connections). Opens with the account's current text, saves through
// email_signature_set, and an empty save is accepted as explicit (spec:
// "Empty is valid").
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import AccountsScreen from "./AccountsScreen";
import { EDIT_SIGNATURE, SIGNATURE_SAVED } from "./copy";
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
    await waitFor(() => expect(onSignatureSaved).toHaveBeenCalledWith("acct-dave", "Dave Fisher\nSent from JARVIS", 2));
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
    await waitFor(() => expect(onSignatureSaved).toHaveBeenCalledWith("acct-dave", "", 2));
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
