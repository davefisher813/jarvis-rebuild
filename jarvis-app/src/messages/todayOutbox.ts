// THE TODAY CARD'S OWN HOLD (S2-2, 2026-09-04): "Undo Send covers one of
// three send paths." The Sweep's Send & Next is safe now (it queues through
// MessagesFlow's own outbox, since DeckFlow only ever renders as a child of
// it). The Today card's Send is the other AI-drafted path, and it cannot
// reuse that same queue directly: the Today tab and the Email tab are never
// both mounted (AppShell renders exactly one active tab), so whichever one
// owned the hold would lose it the moment the user switched tabs mid-hold --
// exactly the failure S2-1 exists to end, just relocated.
//
// So this is a second, small, dedicated queue, not a second copy of the
// first one's logic: it holds a Today card's send for the same window, with
// its own tiny always-alive pump (TodayOutboxPump, mounted in AppShell,
// which does not unmount on a tab switch). Framework-free module-level
// state, same idiom as shared/toast.ts, because the pump and whichever
// screen calls enqueueTodaySend are never the same React subtree and must
// still see the one true queue rather than two independent copies of it.
//
// Its own nudge-count and chase-clear are applied directly in the pump,
// since neither needs any screen to be mounted. A send that ultimately
// FAILS graduates into the real outbox (outbox.ts's own store) as a failed
// item, so it surfaces with Retry and Edit the next time Email is opened --
// the same recovery S2-1 already built and tested, reused rather than
// reinvented.
//
// Laws, same as outbox.ts: nothing leaves immediately, and nothing that
// fails is silently dropped.

import type { OutboxItem, OutboxState } from "./outbox";
import { holdUntil } from "./outbox";

const KEY = "jarvis.today.outbox.v1";

export type TodayKind = "nudge" | "chase" | "reply";

export type TodaySend = OutboxItem & { todayKind: TodayKind };

function load(storage: Pick<Storage, "getItem"> = localStorage): TodaySend[] {
  try {
    const raw = JSON.parse(storage.getItem(KEY) || "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((x): x is TodaySend =>
      !!x && typeof x === "object" && typeof (x as TodaySend).id === "string" && typeof (x as TodaySend).dueMs === "number");
  } catch {
    return [];
  }
}

function persistTo(items: TodaySend[], storage: Pick<Storage, "setItem"> = localStorage): void {
  try { storage.setItem(KEY, JSON.stringify(items)); } catch { /* private mode */ }
}

let items: TodaySend[] = load();
const subs = new Set<(items: TodaySend[]) => void>();

function commit(next: TodaySend[]): void {
  items = next;
  persistTo(items);
  subs.forEach((s) => s(items));
}

export function getTodayOutbox(): TodaySend[] {
  return items;
}

export function subscribeTodayOutbox(fn: (items: TodaySend[]) => void): () => void {
  subs.add(fn);
  fn(items);
  return () => { subs.delete(fn); };
}

let seq = 0;
function newId(): string {
  seq += 1;
  return "today-" + Date.now().toString(36) + "-" + seq;
}

export function enqueueTodaySend(input: {
  to: string; subject: string; body: string; inReplyTo?: string; threadId?: string; account?: string; todayKind: TodayKind;
}): void {
  const item: TodaySend = {
    id: newId(),
    account: input.account,
    to: input.to,
    subject: input.subject,
    body: input.body,
    inReplyTo: input.inReplyTo,
    threadId: input.threadId,
    dueMs: holdUntil(Date.now()),
    scheduled: false,
    state: "held",
    todayKind: input.todayKind,
  };
  commit([...items, item]);
}

export function removeTodaySend(id: string): void {
  commit(items.filter((i) => i.id !== id));
}

export function markTodaySendState(id: string, state: OutboxState): void {
  commit(items.map((i) => (i.id === id ? { ...i, state } : i)));
}

// Test-only: resets the module-level store between tests so one test's
// queued items cannot leak into the next.
export function resetTodayOutboxForTest(): void {
  items = [];
  persistTo(items);
  subs.forEach((s) => s(items));
}
