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

export type OutboxState = "held" | "sending" | "failed";

export interface OutboxItem {
  id: string;
  account?: string;
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  threadId?: string;
  fromDeck?: boolean;
  trackId?: string;
  // When it should actually leave. Now + HOLD for a normal send; a chosen
  // moment for a scheduled one.
  dueMs: number;
  scheduled: boolean;
  state: OutboxState;
  error?: string;
}

const KEY = "jarvis.mail.outbox.v1";

export function loadOutbox(storage: Pick<Storage, "getItem"> = localStorage): OutboxItem[] {
  try {
    const raw = JSON.parse(storage.getItem(KEY) || "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((x): x is OutboxItem =>
      !!x && typeof x === "object" && typeof (x as OutboxItem).id === "string" && typeof (x as OutboxItem).dueMs === "number");
  } catch {
    return [];
  }
}

export function saveOutbox(items: OutboxItem[], storage: Pick<Storage, "setItem"> = localStorage): void {
  try { storage.setItem(KEY, JSON.stringify(items)); } catch { /* private mode */ }
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
