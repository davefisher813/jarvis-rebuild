// THE ONE HEADLINE'S ORDER (Email v1 spec 8.1, 2026-10-12): user Pause or Remove, then authorization, then an unknown send,
// then catch-up or staleness, then the healthy timestamp. Pure.
import { describe, it, expect } from "vitest";
import { statusHeadline, sendsNeedChecking, unknownSends, MAILBOX_REMOVED, SEND_NEEDS_CHECKING, SYNC_PAUSED, SYNC_FAILED, type HeadlineInput } from "./statusHeadline";
import type { EmailAccount } from "./emailClient";
import type { ClientView } from "../connections/connectionStatus";
import { emptyFields, type DraftRow } from "./drafts";

const A = "dave@example.test";
const B = "work@example.test";
const acct = (o: Partial<EmailAccount>): EmailAccount => ({ id: "a", address: A, state: "connected", last_sync_at: "2026-10-12T09:00:00Z", sync_error: null, capabilities: {}, connected_at: "2026-09-01T00:00:00Z", scopes: [], cached: 1, signature_text: "", signature_revision: 1, sync_state: "current", ...o });
const view = (o: Partial<ClientView>): ClientView => ({ state: "connected", headline: "Connected", detail: null, offerReconnect: false, ...o });
const draft = (o: Partial<DraftRow>): DraftRow => ({ ...emptyFields(), id: "d", account_id: "a", account: A, send_state: "unknown", saved_at: "", revision: 1, updated_at: "", sent_action_id: "act", provider_message_id: null, action_state: null, action_verb: null, outbox_state: null, error_code: null, provider_ack: null, ...o });
const h = (o: Partial<HeadlineInput>) => statusHeadline({ accounts: [acct({})], views: new Map(), sent: [], scope: null, ...o });
const lost = new Map([[A, view({ state: "pending_auth", headline: "Needs Reconnecting", offerReconnect: true })]]);

describe("the headline's order", () => {
  it("healthy: nothing to say beyond the header's Last Checked time", () => {
    expect(h({})).toEqual({ tier: "healthy", email: null, facts: [], action: null });
  });

  it("1. a mailbox the person paused outranks everything, and a removed one when it is the one in view", () => {
    const paused = h({ accounts: [acct({ sync_state: "paused" })], views: lost, sent: [draft({})] });
    expect(paused.tier).toBe("user");
    expect(paused.facts[0]).toEqual({ text: SYNC_PAUSED, tone: "warn" });
    const removed = h({ accounts: [acct({ state: "disconnected" }), acct({ id: "b", address: B })], scope: A, sent: [draft({})] });
    expect(removed).toMatchObject({ tier: "user", email: A, facts: [{ text: MAILBOX_REMOVED, tone: "warn" }, { text: A }], action: { kind: "connections" } });
    // A mailbox removed long ago does not hold All Accounts' headline over a live mailbox's problem.
    expect(h({ accounts: [acct({ state: "disconnected" }), acct({ id: "b", address: B })], sent: [draft({ account_id: "b" })] }).tier).toBe("send");
  });

  it("2. authorization outranks an unknown send, and offers the one-tap reconnect for that exact address", () => {
    expect(h({ views: lost, sent: [draft({})] })).toMatchObject({ tier: "auth", email: A, action: { kind: "reconnect", email: A } });
    // Before the first proof, the cache row's own state is the answer.
    expect(h({ accounts: [acct({ state: "reauth" })] })).toMatchObject({ tier: "auth", action: { kind: "reconnect", email: A } });
    // Gmail refusing the read is an authorization issue with nothing to reconnect.
    expect(h({ views: new Map([[A, view({ state: "error", headline: "Can't Read Mail", detail: "Gmail Refused the Last Check" })]]) })).toMatchObject({ tier: "auth", action: null });
  });

  it("3. an unknown send outranks a catch-up, and opens that draft's Check Again screen", () => {
    const d = draft({ id: "d-9" });
    const x = h({ accounts: [acct({ sync_state: "catching_up" })], sent: [draft({ id: "ok", send_state: "sent" }), d] });
    expect(x).toMatchObject({ tier: "send", facts: [{ text: SEND_NEEDS_CHECKING, tone: "warn" }], action: { kind: "check_send", draft: d } });
    expect(h({ sent: [d, draft({ id: "d-10" })] }).facts[0]!.text).toBe("2 Sends Need Checking");
    expect(sendsNeedChecking(1)).toBe(SEND_NEEDS_CHECKING);
    // The outbox's own word counts as unknown too.
    expect(unknownSends([draft({ send_state: "sending", outbox_state: "outcome_unknown" })])).toHaveLength(1);
    // Scoped to the picked mailbox.
    expect(h({ accounts: [acct({}), acct({ id: "b", address: B })], scope: B, sent: [d] }).tier).toBe("healthy");
  });

  it("4. catch-up or staleness, last: a limited service or a failed sync says so, with Retry Sync where it helps", () => {
    expect(h({ views: new Map([[A, view({ state: "warning", headline: "Service Unavailable", detail: "JARVIS Keeps Retrying" })]]) })).toMatchObject({ tier: "sync", facts: [{ text: "Service Unavailable", tone: "warn" }, { text: "JARVIS Keeps Retrying" }] });
    expect(h({ accounts: [acct({ sync_state: "failed" })] })).toMatchObject({ tier: "sync", facts: [{ text: SYNC_FAILED, tone: "warn" }, { text: A }], action: { kind: "retry_sync" } });
    // A catch-up in progress holds the tier but draws nothing: the header already says Catching Up on Mail.
    expect(h({ accounts: [acct({ sync_state: "catching_up" })] })).toMatchObject({ tier: "sync", facts: [] });
  });

  it("every line is facts: one coloured fact first, at most one grey after it, never a typed dot", () => {
    for (const x of [h({ views: lost }), h({ sent: [draft({})] }), h({ accounts: [acct({ sync_state: "stale" })] }), h({ accounts: [acct({ sync_state: "paused" })] })]) {
      expect(x.facts[0]!.tone).toBe("warn");
      expect(x.facts.filter((f) => !f.tone).length).toBeLessThanOrEqual(1);
      for (const f of x.facts) expect(f.text).not.toContain("·");
    }
  });
});
