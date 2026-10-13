// @vitest-environment jsdom
// ISSUE 112 (ruling 18, Dave 2026-10-13): a task or an event Dave approves from an email is on Today, once, as a normal
// one. capture_approve writes it ON THE SERVER, not through the device Store, so the device's cached lists still describe
// the old day until a background refresh finds the change. EmailFlow.onCardSaved used to drop the cached lists only for a
// Waiting record (the Email tab's own list needed it at once); every kind is written the same way, so every saved card
// drops them now, and Today reads the new task or event the next time it opens. The rendered proof that Today then draws
// it once is today/TodayFlow.email.test.tsx; this is the half in the Email tab.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Store, InMemoryAdapter } from "@core";
import { NotesProvider } from "../data/NotesProvider";
import EmailFlow from "./EmailFlow";
import type { EmailAccount, InboxRow, MessageDetail, RpcClient } from "./emailClient";
import { EXTRACTOR_VERSION } from "../substrate/extract";
import type { Candidate } from "./candidates";
import { resetToasts } from "../shared/toast";

// The whole Email tab mounts in each case; a loaded machine (the full suite, several runs at once) needs more than 5 seconds.
vi.setConfig({ testTimeout: 20000 });

const NOW = new Date("2026-10-03T15:00:00Z");
const USER = "user-1";
const DAVE = "dave@example.test";
const account: EmailAccount = { id: "acct-dave", address: DAVE, state: "connected", last_sync_at: "2026-10-03T14:50:00Z", sync_error: null, capabilities: { archive: true, trash: true, read: true }, connected_at: "2026-09-01T00:00:00Z", scopes: [], cached: 1, signature_text: "", signature_revision: 1 };
const inboxRow: InboxRow = {
  id: "u-m9", account_id: "acct-dave", account: DAVE, provider_id: "m9", thread_id: "18f2a9c4e1b7d3a9", internal_date: "2026-10-03T11:00:00Z", from_address: "coach@example.test", from_name: "Coach Miller",
  subject: "Roster and a quick call", snippet: "Can you send the roster, and are you free for a quick call Monday?", has_body: true, attachment_metadata: [], provider_labels: ["INBOX"], source_hash: "sh-1", read: true,
};
const detail: MessageDetail = {
  id: inboxRow.id, account_id: inboxRow.account_id, account: inboxRow.account, provider_id: inboxRow.provider_id, thread_id: inboxRow.thread_id, internal_date: inboxRow.internal_date, from_address: inboxRow.from_address, from_name: inboxRow.from_name,
  to_addresses: [{ address: DAVE, name: "" }], cc_addresses: [], subject: inboxRow.subject, snippet: inboxRow.snippet, provider_labels: inboxRow.provider_labels, read: true, deleted: false, source_hash: inboxRow.source_hash,
  attachments: [], has_body: true, text: inboxRow.snippet, html: null,
};

// A card as the server holds it, ready to save. Fresh objects each time: the fake server changes them.
const card = (id: string, payload: Record<string, unknown>): Candidate => ({
  id, message_id: "u-m9", account_id: "acct-dave", kind: payload.kind as Candidate["kind"], origin: "rule", agent_name: null, status: "proposed", revision: 1,
  payload: payload as unknown as Candidate["payload"], payload_hash: "h-" + id, provenance_by_field: {}, missing_fields: [], fingerprint: "fp1:" + id, source_hash: "sh-1", message_source_hash: "sh-1",
  destination_id: null, action_id: null, proposal_id: null, extractor_version: EXTRACTOR_VERSION, created_at: NOW.toISOString(), updated_at: NOW.toISOString(), saved_sibling: null,
});
const TASK = { kind: "task", title: "Send the roster", due_date: "2026-10-30", notes: "" };
const EVENT = { kind: "event", title: "Quick Call With Coach Miller", time: { all_day: false, start_at: "2026-10-05T14:00:00.000Z", end_at: "2026-10-05T14:15:00.000Z", timezone: "America/New_York", selected_offset: "-04:00" }, location: null, external_uid: null };
const WAITING = { kind: "waiting", title: "The Roster Back", waiting_for: "the signed roster", counterparty_display: "Coach Miller", contact_id: null, follow_up_on: null };

function rig(cands: Candidate[]): { client: RpcClient; saved: string[] } {
  const saved: string[] = [];
  const table: Record<string, (a: Record<string, unknown>) => unknown> = {
    email_accounts: () => [account],
    email_inbox: (a) => ({ rows: [inboxRow].slice(0, a.p_limit as number), cached_total: 1, page: a.p_limit }),
    email_message_read: () => detail,
    substrate_readiness: () => ({ registered: ["money_bill", "money_receipt", "task", "event", "waiting"] }),
    candidates_for: (a) => cands.filter((c) => (a.p_messages as string[]).includes(c.message_id) && c.status !== "dismissed"),
    capture_approve: (a) => {
      const c = cands.find((x) => x.id === a.p_candidate)!;
      const prepared = a.p_prepared as { exact_effect: string };
      c.status = "saved"; c.destination_id = "item-" + c.id; c.action_id = "act-" + c.id;
      saved.push(c.kind);
      return { action_id: c.action_id, state: "confirmed", destination_id: c.destination_id, receipt_id: "r-" + c.id, safe_message: prepared.exact_effect, item_updated_at: "2026-10-03T15:00:00.000000+00:00", already: false };
    },
  };
  const client: RpcClient = { rpc: async (fn, args) => { const f = table[fn]; if (!f) throw new Error("no fake for " + fn); return { data: f((args ?? {}) as Record<string, unknown>), error: null }; } };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => (url.endsWith("/api/email/sync") ? { ok: true, synced: 0, removed: 0, next_page: null, complete: true, resynced: false } : { ok: true }) } as Response)));
  return { client, saved };
}

beforeEach(() => { localStorage.clear(); resetToasts(); Object.defineProperty(navigator, "onLine", { value: true, configurable: true }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function saveWith(c: Candidate, button: string) {
  const store = new Store(new InMemoryAdapter());
  const r = rig([c]);
  render(
    <NotesProvider userId={USER} store={store}>
      <EmailFlow client={r.client} token="jwt" userId={USER} categories={[]} now={() => NOW} zone="America/New_York" onOpenConnections={() => {}} onOpenModule={() => {}} />
    </NotesProvider>,
  );
  const el = () => document.querySelector(`.email-card.${c.kind}`) as HTMLElement | null;
  await waitFor(() => expect(el()).toBeTruthy());
  const spy = vi.spyOn(store, "invalidateAll");
  spy.mockClear();
  fireEvent.click(within(el()!).getByText(button));
  await waitFor(() => expect(r.saved).toEqual([c.kind]));
  await waitFor(() => expect(document.querySelector(".email-receipt-line")).toBeTruthy());
  return spy;
}

describe("a saved card drops the device's cached lists, whatever it made (issue 112)", () => {
  it("Add Task: the task is written on the server, so Today's cached lists are dropped and it reads the new task", async () => {
    const spy = await saveWith(card("cand-task", TASK), "Add Task");
    expect(spy).toHaveBeenCalled();
  });

  it("Add to Schedule: the event is written on the server, so Today's cached lists are dropped and it reads the new event", async () => {
    const spy = await saveWith(card("cand-event", EVENT), "Add to Schedule");
    expect(spy).toHaveBeenCalled();
  });

  it("Track This still drops them, as it did before", async () => {
    const spy = await saveWith(card("cand-waiting", WAITING), "Track This");
    expect(spy).toHaveBeenCalled();
    expect(screen.queryByText("Track This")).toBeNull();
  });
});
