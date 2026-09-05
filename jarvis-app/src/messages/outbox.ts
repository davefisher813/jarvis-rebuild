// THE OUTBOX: UNDO SEND AND SCHEDULE SEND (Dave 2026-08-20: "research the
// most complained about things email wise").
//
// Two of the most-requested features in every email survey, and the reason is
// the same in both cases: SEND IS THE ONLY IRREVERSIBLE BUTTON IN THE APP.
// Everything else can be undone, archived back, untrashed. Send cannot, and
// people carry that anxiety into every message they write. Apple only added
// undo-send to Mail recently; it was the single most-asked-for thing.
//
// So: nothing leaves immediately. Every send goes into a hold, visible, with
// one tap to pull it back. When the hold expires it goes. A scheduled send is
// the same machine with a longer hold.
//
// Laws:
//   - The hold is REAL, not a UI trick. The message has not been handed to
//     Gmail during it, so Undo genuinely un-sends rather than asking the
//     recipient nicely.
//   - It survives a reload. A queue that lives only in React state loses a
//     scheduled message the moment the tab is closed, which is worse than
//     not offering the feature.
//   - Nothing is silently dropped. An item that fails to send stays in the
//     outbox with its error, so the user always knows what did and did not go.
//   - The default hold is short. A long one is not extra safety, it is a
//     delay on every message you were happy with.

export const HOLD_SECONDS = 12;

import { weekdayShortDateFromMs } from "../shared/dateFormat";
import type { EmailAttachment } from "../connections/google/map";

export type OutboxState = "held" | "sending" | "failed";

export interface OutboxItem {
  id: string;
  account?: string;
  to: string;
  cc?: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  threadId?: string;
  fromDeck?: boolean;
  trackId?: string;
  // S2-8: the note he already has, riding along as a real attachment.
  attachment?: EmailAttachment;
  // When it should actually leave. Now + HOLD for a normal send; a chosen
  // moment for a scheduled one.
  dueMs: number;
  scheduled: boolean;
  state: OutboxState;
  error?: string;
  // EMAIL-F-01 (2026-09-05): everything the send's side effects need rides
  // ON the item now, because the pump that performs them no longer lives in
  // the screen that queued it (see sendPump.ts). These used to be read from
  // MessagesFlow's closure at send time, which only worked while that tab
  // was mounted.
  //   handoffTo: the person's name, when this is a Hand This to Someone;
  //     the thread archives once it has actually left.
  //   editingDraftId: the Gmail draft this compose started from; deleted
  //     once the message has actually left, never during the hold.
  //   deckVerbatim: DeckFlow's own Send & Next, sent exactly as drafted
  //     (the voice metric's honest flag; see MessagesFlow's S2-2 note).
  //   chaseDays: the Chase If No Reply setting at the moment he tapped Send.
  //     0 means off.
  //   nudge: the thread was on Waiting On when he sent, so this send climbs
  //     the escalation ladder; a plain reply does not.
  handoffTo?: string;
  editingDraftId?: string;
  deckVerbatim?: boolean;
  chaseDays?: number;
  nudge?: boolean;
}

const KEY = "jarvis.mail.outbox.v1";

// EMAIL-F-05 (2026-09-05): "A send interrupted mid-flight is stuck as
// Sending forever, with no controls." "sending" only ever means "in flight
// in a JS closure"; once the app is killed, reloaded, or the process is
// otherwise gone, that closure no longer exists and nothing can ever move
// the item on. So a stored "sending" is, on the next load, an INTERRUPTED
// send: whether the mail actually went is unknowable from here, which is
// why it comes back as failed with this line (Retry and Discard both on
// offer) rather than as held (an automatic retry is a possible double send,
// the one failure worse than a slow one).
export const INTERRUPTED_LINE = "Interrupted · Check Sent, then Retry";

export function loadOutbox(storage: Pick<Storage, "getItem"> = localStorage): OutboxItem[] {
  try {
    const raw = JSON.parse(storage.getItem(KEY) || "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((x): x is OutboxItem =>
        !!x && typeof x === "object" && typeof (x as OutboxItem).id === "string" && typeof (x as OutboxItem).dueMs === "number")
      .map((x) => (x.state === "sending" ? { ...x, state: "failed" as const, error: INTERRUPTED_LINE } : x));
  } catch {
    return [];
  }
}

export function saveOutbox(items: OutboxItem[], storage: Pick<Storage, "setItem"> = localStorage): void {
  try { storage.setItem(KEY, JSON.stringify(items)); } catch { /* private mode */ }
}

// THE ONE TRUE QUEUE (EMAIL-F-01, 2026-09-05): "Send and Schedule Send only
// leave while the Email tab is open." The queue used to be React state
// inside MessagesFlow, pumped by an effect there, and AppShell unmounts that
// component on every tab switch: tap Send, see "Sending in 12", tap Today,
// and the mail sat in localStorage until the Email tab was next opened.
// todayOutbox.ts diagnosed exactly this a day earlier and built its own
// always-mounted pump for the Today card's sends; this is the same idiom
// (module-level state, subscribers, same as shared/toast.ts) applied to the
// original queue, so the pump (MailOutboxPump, mounted once in AppShell) and
// the screen that renders the hold cards (MessagesFlow) see one list rather
// than two copies of it. Every write goes through commit, which persists and
// notifies in the same breath.
let items: OutboxItem[] | null = null;
const subs = new Set<(items: OutboxItem[]) => void>();

function commit(next: OutboxItem[]): void {
  items = next;
  saveOutbox(next);
  subs.forEach((s) => s(next));
}

export function getOutbox(): OutboxItem[] {
  if (items === null) items = loadOutbox();
  return items;
}

export function subscribeOutbox(fn: (items: OutboxItem[]) => void): () => void {
  subs.add(fn);
  fn(getOutbox());
  return () => { subs.delete(fn); };
}

export function enqueueOutbox(item: OutboxItem): void {
  commit([...getOutbox(), item]);
}

export function removeFromOutbox(id: string): void {
  commit(getOutbox().filter((i) => i.id !== id));
}

// A partial write to one item. `error: undefined` in the patch clears the
// field (Retry uses it); JSON drops the key on the way to storage.
export function patchOutbox(id: string, patch: Partial<OutboxItem>): void {
  commit(getOutbox().map((i) => (i.id === id ? { ...i, ...patch } : i)));
}

// Test-only: forgets the in-memory list so one test's queued sends cannot
// leak into the next (localStorage.clear() alone cannot reach this cache).
export function resetOutboxForTest(): void {
  items = null;
  subs.forEach((s) => s(getOutbox()));
}

export function holdUntil(nowMs: number, seconds = HOLD_SECONDS): number {
  return nowMs + seconds * 1000;
}

// Which items are ready to actually leave. A "sending" item is already in
// flight and must never be picked up twice: a double send is the one failure
// mode worse than a slow one.
export function dueNow(items: OutboxItem[], nowMs: number): OutboxItem[] {
  return items.filter((i) => i.state === "held" && i.dueMs <= nowMs);
}

export function secondsLeft(item: OutboxItem, nowMs: number): number {
  return Math.max(0, Math.ceil((item.dueMs - nowMs) / 1000));
}

// The line on the hold banner. Counts down for a normal send; names the time
// for a scheduled one, because "sending in 47000 seconds" is not information.
export function holdLine(item: OutboxItem, nowMs: number): string {
  if (item.scheduled) return "Scheduled · " + whenLabel(item.dueMs);
  const s = secondsLeft(item, nowMs);
  return s <= 0 ? "Sending" : `Sending in ${s}`;
}

export function whenLabel(ms: number, now = new Date()): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return time;
  const tmr = new Date(now.getTime() + 86400e3);
  if (d.toDateString() === tmr.toDateString()) return "Tomorrow " + time;
  return weekdayShortDateFromMs(ms) + " " + time;
}

export interface SendSlot { label: string; at: number }

// The offered times. Deliberately few and deliberately human: a picker with
// every minute of the week in it is a decision, and the whole point is to
// remove one.
export function sendSlots(nowMs: number): SendSlot[] {
  const now = new Date(nowMs);
  const at = (dayOffset: number, hour: number): number => {
    const d = new Date(now);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, 0, 0, 0);
    return d.getTime();
  };
  const out: SendSlot[] = [];
  const laterToday = at(0, 16);
  if (laterToday > nowMs + 3600e3) out.push({ label: "Later Today", at: laterToday });
  out.push({ label: "Tomorrow Morning", at: at(1, 8) });
  // Monday morning: the classic "do not land in their inbox on a Sunday".
  const daysToMonday = (8 - now.getDay()) % 7 || 7;
  out.push({ label: "Monday Morning", at: at(daysToMonday, 8) });
  return out;
}
