import { BATCH_MODIFY_MAX, GmailHttpError, type GoogleApi } from "../connections/google/api";
import { mapThread, type GmailThreadMeta, type ThreadRow } from "../connections/google/map";
import { pool, HYDRATE_CONCURRENCY } from "./inboxRefresh";

// MOVE MANY CONVERSATIONS TO TRASH, AND MEAN IT (2026-09-29).
//
// This used to be one thread-trash request per conversation, fired together,
// with `apiFor(row.account)?.trashThread(...)` so that a row whose account
// could not be found resolved to `undefined`, which the counting helper read
// as a success. Four hundred deletes was four hundred requests and, on a lost
// connection, an unknowable number of them had landed.
//
// Now: the selection is resolved into the actual MESSAGE ids first (frozen, so
// mail that arrives while this runs is not silently swept in), each account
// gets one preflight, ids go in chunks of at most 1000 through Gmail's
// batchModify with `add TRASH, remove INBOX`, and every conversation ends in
// exactly one of four honest states. Nothing here can permanently delete: the
// only writes are label changes, and Gmail keeps trashed mail for 30 days.
//
// Laws:
//   - NO ACCOUNT, NO WRITE. A selection whose account is unknown, or whose
//     session cannot be refreshed, is reported as blocked. It is never sent
//     through some other account.
//   - A TIMEOUT IS UNKNOWN, NOT FAILED. When an answer is lost the labels are
//     read back before anything is claimed, and the request is never simply
//     re-sent (a batch that landed would be applied twice, harmlessly, but
//     the claim would still have been a guess).
//   - AN AUTH FAILURE STOPS THAT ACCOUNT, and only that account.
//   - UNDO TOUCHES ONLY WHAT THIS ACTION CHANGED. It removes TRASH from the
//     messages this action trashed, restores INBOX only where the message was
//     in the inbox, and leaves every other label and every message that was
//     already in Trash exactly as it was.

export type EnsureApi = (account: string) => Promise<
  | { ok: true; api: GoogleApi }
  | { ok: false; message: string; code?: string; retryable?: boolean }
>;

export interface PlannedThread {
  threadId: string;
  /** Frozen: exactly the messages this action will touch, and no others. */
  messageIds: string[];
  /** Each touched message's INBOX and TRASH state when the plan was made. */
  before: Record<string, { inbox: boolean; trash: boolean }>;
  /** Messages left alone because they were already in Trash. */
  alreadyTrashed: string[];
}

export interface PlanAccount {
  account: string;
  api: GoogleApi;
  threads: PlannedThread[];
  /** Unique message ids across the account's threads. */
  messageIds: string[];
}

export interface TrashPlan {
  accounts: PlanAccount[];
  blocked: { account: string; message: string; code?: string; threadIds: string[] }[];
  /** Conversations with nothing to do: deleted, or every message already in Trash. */
  gone: string[];
  /** Conversations whose content moved since the row was read: reconfirm. */
  changed: string[];
  /** Conversations this will act on. */
  conversations: number;
  /** Unique messages this will act on. */
  messages: number;
}

export interface PlanDeps {
  ensure: EnsureApi;
  /**
   * True for a row whose metadata is current enough to trust without a read
   * (it was read moments ago). A single-message conversation that is trusted
   * needs no request at all: its one message id is the row's own. Anything
   * else is read.
   */
  trusted?: (row: ThreadRow) => boolean;
}

const UNKNOWN_ACCOUNT = "That mail's account isn't connected \u00b7 Nothing was moved";

/**
 * Resolves conversations into message ids and snapshots their labels.
 * Fetches metadata only (never a body), and only for what it cannot already
 * trust.
 */
export async function buildTrashPlan(rows: readonly ThreadRow[], deps: PlanDeps): Promise<TrashPlan> {
  const byAccount = new Map<string, ThreadRow[]>();
  const unowned: ThreadRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    // One conversation once, however many times it was selected.
    const key = (r.account ?? "") + "\u001f" + r.id;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!r.account) { unowned.push(r); continue; }
    byAccount.set(r.account, [...(byAccount.get(r.account) ?? []), r]);
  }
  const plan: TrashPlan = { accounts: [], blocked: [], gone: [], changed: [], conversations: 0, messages: 0 };
  if (unowned.length) plan.blocked.push({ account: "", message: UNKNOWN_ACCOUNT, threadIds: unowned.map((r) => r.id) });

  await pool([...byAccount.entries()], 2, async ([account, mine]) => {
    const got = await deps.ensure(account);
    if (!got.ok) {
      plan.blocked.push({ account, message: got.message, ...(got.code ? { code: got.code } : {}), threadIds: mine.map((r) => r.id) });
      return;
    }
    const threads: PlannedThread[] = [];
    const needRead: ThreadRow[] = [];
    for (const r of mine) {
      if (r.count === 1 && deps.trusted?.(r)) {
        threads.push({
          threadId: r.id, messageIds: [r.lastMsgId],
          before: { [r.lastMsgId]: { inbox: r.inInbox, trash: false } }, alreadyTrashed: [],
        });
      } else needRead.push(r);
    }
    await pool(needRead, HYDRATE_CONCURRENCY, async (r) => {
      const meta: GmailThreadMeta | null = await got.api.getThreadMeta(r.id);
      const msgs = meta?.messages ?? [];
      if (!meta || msgs.length === 0) { plan.gone.push(r.id); return; }
      const before: PlannedThread["before"] = {};
      const touch: string[] = [];
      const already: string[] = [];
      for (const m of msgs) {
        const labels = m.labelIds ?? [];
        if (labels.includes("TRASH")) { already.push(m.id); continue; }
        touch.push(m.id);
        before[m.id] = { inbox: labels.includes("INBOX"), trash: false };
      }
      if (touch.length === 0) { plan.gone.push(r.id); return; }
      const mapped = mapThread(meta);
      if (mapped && mapped.lastMsgId !== r.lastMsgId) plan.changed.push(r.id);
      threads.push({ threadId: r.id, messageIds: touch, before, alreadyTrashed: already });
    });
    const ids = [...new Set(threads.flatMap((t) => t.messageIds))];
    if (threads.length) plan.accounts.push({ account, api: got.api, threads, messageIds: ids });
  });
  plan.conversations = plan.accounts.reduce((n, a) => n + a.threads.length, 0);
  plan.messages = plan.accounts.reduce((n, a) => n + a.messageIds.length, 0);
  return plan;
}

// ---------------------------------------------------------------------------
// The move
// ---------------------------------------------------------------------------

export type ThreadStatus = "trashed" | "partial" | "failed" | "unknown";

export interface ThreadOutcome {
  account: string;
  threadId: string;
  status: ThreadStatus;
  /** The planned messages Gmail confirmed are now in Trash. */
  applied: string[];
  reason?: string;
}

export interface AccountOutcome {
  account: string;
  /** "ok", or why this account stopped short. */
  status: "ok" | "stopped" | "blocked";
  message?: string;
  code?: string;
}

export interface TrashResult {
  outcomes: ThreadOutcome[];
  accounts: AccountOutcome[];
  /** batchModify requests actually sent (the number the cost tests watch). */
  requests: number;
  /** Conversations refused before any write (unknown account, dead session). */
  blocked: TrashPlan["blocked"];
  plan: TrashPlan;
}

function chunksOf<T>(items: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

type Kind = "auth" | "refused" | "unknown";

/** What a failed batch request means for what happened to the mail. */
function classify(e: unknown): Kind {
  if (e instanceof GmailHttpError) {
    if (e.status === 401 || e.status === 403) return "auth";
    // A 5xx may or may not have been applied; a 4xx (bad request, rate limit)
    // was refused outright.
    return e.status >= 500 ? "unknown" : "refused";
  }
  // No status: the request may have left and the answer been lost.
  return "unknown";
}

/**
 * Moves the plan to Trash. One preflight per account, chunks of at most 1000
 * message ids, sequential within an account, at most two accounts at once.
 */
export async function trashSelection(plan: TrashPlan, deps: { ensure: EnsureApi }): Promise<TrashResult> {
  const outcomes: ThreadOutcome[] = [];
  const accounts: AccountOutcome[] = [];
  let requests = 0;

  await pool(plan.accounts, 2, async (acct) => {
    // The session is checked again at the moment of writing: the plan may have
    // sat behind a confirmation, and the token has a lifetime.
    const got = await deps.ensure(acct.account);
    if (!got.ok) {
      accounts.push({ account: acct.account, status: "blocked", message: got.message, ...(got.code ? { code: got.code } : {}) });
      for (const t of acct.threads) outcomes.push({ account: acct.account, threadId: t.threadId, status: "failed", applied: [], reason: got.message });
      return;
    }
    const applied = new Set<string>();
    const unknown = new Set<string>();
    let stop: { message: string; code?: string } | null = null;

    for (const chunk of chunksOf(acct.messageIds, BATCH_MODIFY_MAX)) {
      if (stop) break;
      try {
        requests++;
        await got.api.batchModifyMessages(chunk, ["TRASH"], ["INBOX"]);
        for (const id of chunk) applied.add(id);
      } catch (e) {
        const kind = classify(e);
        if (kind === "auth") {
          // This account's session is no good for writing. The rest of its
          // chunks are not attempted, and other accounts carry on.
          stop = { message: "Google refused the change \u00b7 Reconnect " + acct.account, code: "GOOGLE_SIGNIN_REVOKED" };
        } else if (kind === "refused") {
          stop = { message: "Gmail refused the change \u00b7 Try again in a moment" };
        } else {
          // Unknown: read the labels back before claiming anything.
          const read = await readBack(got.api, acct, chunk);
          if (read === null) {
            for (const id of chunk) unknown.add(id);
            stop = { message: "Couldn't confirm what happened \u00b7 Check your Trash" };
          } else {
            for (const id of read.applied) applied.add(id);
          }
        }
      }
    }

    accounts.push(stop
      ? { account: acct.account, status: "stopped", message: stop.message, ...(stop.code ? { code: stop.code } : {}) }
      : { account: acct.account, status: "ok" });
    for (const t of acct.threads) {
      const done = t.messageIds.filter((id) => applied.has(id));
      const status: ThreadStatus = done.length === t.messageIds.length ? "trashed"
        : done.length > 0 ? "partial"
        : t.messageIds.some((id) => unknown.has(id)) ? "unknown" : "failed";
      outcomes.push({ account: acct.account, threadId: t.threadId, status, applied: done, ...(stop && status !== "trashed" ? { reason: stop.message } : {}) });
    }
  });

  return { outcomes, accounts, requests, blocked: plan.blocked, plan };
}

/**
 * After a lost answer: which of a chunk's messages are in Trash now?
 * Null when even that could not be read (the outcome stays unknown).
 */
async function readBack(api: GoogleApi, acct: PlanAccount, chunk: readonly string[]): Promise<{ applied: string[] } | null> {
  const inChunk = new Set(chunk);
  const threads = acct.threads.filter((t) => t.messageIds.some((id) => inChunk.has(id)));
  const applied: string[] = [];
  try {
    await pool(threads, HYDRATE_CONCURRENCY, async (t) => {
      const meta = await api.getThreadMeta(t.threadId);
      for (const m of meta?.messages ?? []) {
        if (inChunk.has(m.id) && (m.labelIds ?? []).includes("TRASH")) applied.push(m.id);
      }
    });
    return { applied };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

export interface UndoResult {
  /** Conversations put back completely. */
  restored: string[];
  /** Conversations that could not be put back (still in Trash). */
  failed: string[];
  requests: number;
  message?: string;
}

/**
 * Puts back exactly what `trashSelection` confirmed it moved. Removes TRASH
 * from those messages; restores INBOX only for the ones that were in the
 * inbox; changes nothing else. A message that was already in Trash before, or
 * that arrived after the plan, is not in the plan and so is never touched.
 */
export async function undoTrashSelection(result: TrashResult, deps: { ensure: EnsureApi }): Promise<UndoResult> {
  const restored: string[] = [];
  const failed: string[] = [];
  let requests = 0;
  let message: string | undefined;

  const planned = new Map<string, PlannedThread>();
  for (const a of result.plan.accounts) for (const t of a.threads) planned.set(a.account + "\u001f" + t.threadId, t);

  const byAccount = new Map<string, ThreadOutcome[]>();
  for (const o of result.outcomes) {
    if (o.status !== "trashed" && o.status !== "partial") continue;
    byAccount.set(o.account, [...(byAccount.get(o.account) ?? []), o]);
  }

  await pool([...byAccount.entries()], 2, async ([account, outs]) => {
    const got = await deps.ensure(account);
    if (!got.ok) { for (const o of outs) failed.push(o.threadId); message = got.message; return; }
    const backToInbox: string[] = [];
    const justOutOfTrash: string[] = [];
    for (const o of outs) {
      const t = planned.get(account + "\u001f" + o.threadId);
      if (!t) continue;
      for (const id of o.applied) (t.before[id]?.inbox ? backToInbox : justOutOfTrash).push(id);
    }
    let ok = true;
    for (const [ids, add] of [[backToInbox, ["INBOX"]], [justOutOfTrash, []]] as [string[], string[]][]) {
      for (const chunk of chunksOf([...new Set(ids)], BATCH_MODIFY_MAX)) {
        try {
          requests++;
          await got.api.batchModifyMessages(chunk, add, ["TRASH"]);
        } catch {
          ok = false;
          message = "Couldn't put it all back \u00b7 What's left is in your Trash";
        }
      }
    }
    for (const o of outs) {
      // A conversation is restored only if every message this action moved is back.
      if (ok && o.status === "trashed") restored.push(o.threadId); else failed.push(o.threadId);
    }
  });

  return { restored, failed, requests, ...(message ? { message } : {}) };
}

// ---------------------------------------------------------------------------
// What the person is told
// ---------------------------------------------------------------------------

/** The counts a receipt needs, by conversation. */
export function summarize(result: TrashResult): { trashed: number; partial: number; failed: number; unknown: number; blocked: number } {
  const c = { trashed: 0, partial: 0, failed: 0, unknown: 0, blocked: 0 };
  for (const o of result.outcomes) c[o.status]++;
  c.blocked = result.blocked.reduce((n, b) => n + b.threadIds.length, 0);
  return c;
}

/**
 * The confirmation, asked ONCE for the whole batch (never per chunk), and only
 * when it needs asking: when the selection includes conversations that may
 * need him. A batch of things already judged safe goes straight through with
 * an Undo.
 */
export function confirmCopy(conversations: number, mayNeedYou: number): { title: string; confirm: string; cancel: string } | null {
  if (mayNeedYou <= 0) return null;
  const noun = conversations === 1 ? "conversation" : "conversations";
  return {
    title: `Move ${conversations} ${noun} to Trash? ${mayNeedYou} may need you.`,
    confirm: "Move to Trash",
    cancel: "Cancel",
  };
}

/**
 * The receipt line. States only what Gmail confirmed, precisely, and promises
 * only what the operation provides: Gmail keeps trashed mail for 30 days.
 */
export function receiptLine(result: TrashResult): string {
  const s = summarize(result);
  const noun = (n: number) => (n === 1 ? "conversation" : "conversations");
  const parts: string[] = [];
  // Dave's own words (2026-09-28): "N conversations moved to Trash. Gmail
  // keeps them for 30 days." Everything after it is a fragment.
  if (s.trashed > 0) parts.push(`${s.trashed} ${noun(s.trashed)} moved to Trash. Gmail keeps them for 30 days.`);
  if (s.partial > 0) parts.push(`${s.partial} ${noun(s.partial)} only partly moved`);
  if (s.failed + s.blocked > 0) parts.push(`${s.failed + s.blocked} not moved`);
  if (s.unknown > 0) parts.push(`${s.unknown} unconfirmed \u00b7 Check your Trash`);
  return parts.join(" \u00b7 ") || "Nothing to move";
}
