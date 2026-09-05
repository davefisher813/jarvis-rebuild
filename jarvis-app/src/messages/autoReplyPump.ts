import type { GoogleApi } from "../connections/google/api";
import { mapThread, mapThreadFull, buildReply, encodeEmail } from "../connections/google/map";
import { protectedRangesFor, isFocusRange, type RoutineData } from "../routine/types";
import { fmtTime, todayISO } from "../schedule/calendar";
import { autoReplyBody, autoReplyEnabled, loadAutoState, markAutoReplied, shouldAutoReply } from "./autoReply";
import { loadVips } from "./vip";
import { loadWaitingCache } from "./waiting";

// HEADS-DOWN AUTO-REPLY, THE BACKGROUND HALF (EMAIL-F-16, 2026-09-05).
//
// "Turns on Heads-Down Auto-Reply, starts a focus block, puts the phone down.
// Nothing auto-replies." The courtesy used to be a React effect inside the
// Email tab, over the `rows` that tab had loaded once at mount: it existed
// only while that screen was on the phone, and even then it never saw mail
// that arrived after the load. The one moment it is FOR is the moment he is
// not looking at his email.
//
// So the pass lives here, as a function over a Google api and a routine, and
// AutoReplyPump.tsx ticks it from AppShell where nothing unmounts. Every
// guard still lives in shouldAutoReply (autoReply.ts): off by default, VIPs
// only, once per person per block, never a machine, never himself, never a
// thread he already answered.

// How many threads a pass reads per account. The same 30 the inbox loads:
// an auto-reply is for what just landed, and what just landed is at the top.
export const AUTO_REPLY_SCAN = 30;

export interface AutoReplyDeps {
  /** Every mail account with a live token, same shape as the session's apis("mail"). */
  apis: () => { email: string; api: GoogleApi }[];
  /** The saved routine, for the focus block that is running right now. */
  routine: () => Promise<RoutineData | null>;
  /** His name, for the body. An empty string is fine: the copy says "I'm". */
  myName: () => Promise<string>;
  /** Fired once per mail that actually left, for the metrics stream. */
  onSent?: (threadId: string) => void;
  now?: () => Date;
}

/** The focus block covering this instant, or null. Nothing sends outside one. */
export function runningFocusBlock(r: RoutineData, now: Date): { s: number; e: number } | null {
  const min = now.getHours() * 60 + now.getMinutes();
  return protectedRangesFor(r, now.getDay()).find((b) => isFocusRange(b) && min >= b.s && min < b.e) ?? null;
}

// EMAIL-F-16: the id is a LOCAL day plus the block's start minute. It used to
// be toISOString().slice(0, 10), which is the UTC day: a 7pm to 8pm Eastern
// block is 23:00 to 00:00 UTC, so the id changed inside the block and every
// VIP already answered could be answered a second time.
export function blockIdOf(block: { s: number }, now: Date): string {
  return `${todayISO(now)}:${block.s}`;
}

/**
 * One pass. Returns how many auto-replies actually left, so a caller (and a
 * test) can tell "nothing was due" from "something was sent". Every failure
 * is swallowed per thread: this is a courtesy, not a job, and a broken one
 * must never take the rest of the pass with it.
 */
export async function runAutoReplyPass(deps: AutoReplyDeps): Promise<number> {
  const enabled = autoReplyEnabled();
  if (!enabled) return 0;
  const list = deps.apis();
  if (list.length === 0) return 0;
  const vips = loadVips();
  if (vips.length === 0) return 0;

  const now = deps.now?.() ?? new Date();
  const r = await deps.routine().catch(() => null);
  if (!r) return 0;
  const block = runningFocusBlock(r, now);
  if (!block) return 0; // no focus block running: nothing auto-sends, ever

  const blockId = blockIdOf(block, now);
  const backAt = fmtTime(`${String(Math.floor(block.e / 60)).padStart(2, "0")}:${String(block.e % 60).padStart(2, "0")}`);
  const name = await deps.myName().catch(() => "");
  // Every address he owns, so "never himself" holds across accounts.
  const mine = new Set(list.map((a) => a.email.toLowerCase()));
  // Threads he is waiting on are threads he already answered.
  const waitingOn = loadWaitingCache();

  let sent = 0;
  for (const { email, api } of list) {
    const metas = await api.listThreads(AUTO_REPLY_SCAN).catch(() => null);
    if (!metas) continue; // a failed read is not an empty inbox
    const rows = metas.map(mapThread).filter((t): t is NonNullable<ReturnType<typeof mapThread>> => t !== null);
    for (const row of rows.filter((t) => t.inInbox && t.unread)) {
      if (mine.has((row.fromEmail || "").toLowerCase())) continue;
      if (!shouldAutoReply({
        enabled, fromEmail: row.fromEmail, myEmail: email, vips,
        // Re-read per row: the pass marks as it goes, so the second thread
        // from the same VIP inside one pass is already covered.
        state: loadAutoState(blockId),
        alreadyRepliedThread: !!waitingOn[row.id],
      })) continue;
      try {
        const full = mapThreadFull(await api.getThread(row.id));
        const last = full.messages[full.messages.length - 1];
        if (!last) continue;
        const reply = buildReply(last, "");
        await api.sendMessage(encodeEmail({
          to: reply.to,
          subject: reply.subject,
          body: autoReplyBody(`${backAt.time} ${backAt.ap}`, name),
          inReplyTo: reply.inReplyTo,
        }), full.id);
        markAutoReplied(blockId, row.fromEmail);
        sent += 1;
        deps.onSent?.(row.id);
      } catch { /* an auto-reply that fails is silent; it is a courtesy, not a job */ }
    }
  }
  return sent;
}
