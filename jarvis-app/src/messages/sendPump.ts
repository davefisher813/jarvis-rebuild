// THE SEND ITSELF, OUT OF THE SCREEN (EMAIL-F-01, 2026-09-05).
//
// MessagesFlow's processSend did the actual Gmail send plus every side
// effect a send carries: open tracking, the chase timer, the nudge count,
// the commitment catcher, the handoff archive, the draft delete, the sent
// toast. All of it lived in a useCallback inside the Email tab, pumped by an
// effect inside the Email tab, and AppShell unmounts the Email tab on every
// tab switch. So a held send only ever left while he stayed on Email for
// twelve seconds, and a Schedule Send for "Tomorrow Morning" fired whenever
// Email was next opened after 8am.
//
// This module is that function with the screen taken out of it. It reads
// only from the queued item's own fields (outbox.ts carries chaseDays,
// nudge, handoffTo, editingDraftId, deckVerbatim on the item now) and from
// the live services the always-mounted pump hands it. It is the twin of
// TodayOutboxPump's processTodaySend, for the original queue; the two never
// touch the same item, because a Today send that fails graduates into this
// queue as FAILED and only a tap on Retry makes it due here again.
//
// Screen-local consequences (drop the sent draft from the Drafts list,
// refresh the nudge counts, drop a handed-off row) reach MessagesFlow
// through subscribeSent, so the tab stays honest when it is mounted and
// nothing breaks when it is not.

import type { GoogleApi } from "../connections/google/api";
import type { AIService } from "../ai/AIService";
import type { TasksService } from "../tasks/TasksService";
import { encodeEmail } from "../connections/google/map";
import { humanError } from "../connections/google/humanError";
import { getOutbox, patchOutbox, removeFromOutbox, enqueueOutbox, dueNow, INTERRUPTED_LINE, type OutboxItem } from "./outbox";
import { getTodayOutbox, removeTodaySend } from "./todayOutbox";
import { saveTrack, newTrackId, pixelUrlFor, registerTrack } from "./tracking";
import { setChase, clearChase } from "./followUp";
import { countNudge } from "./escalate";
import { COMMITMENT_SYSTEM, commitmentPrompt, parseCommitment, alreadyPromised, markPromised, commitmentLine } from "./commitments";
import { handoffLine } from "./handoff";
import { settleAll } from "./settle";
import { emit } from "../events";
import { showToast } from "../shared/toast";
import { madeBy } from "../shared/provenance";
import { todayISO } from "../schedule/calendar";

export interface SendDeps {
  /** The api for a specific account, falling back to any live one. */
  apiFor: (account?: string) => GoogleApi | null;
  ai: AIService;
  tasks: Pick<TasksService, "createTask"> | null;
  /** The open-tracking setting (profile.trackOpens, default on). */
  trackOpens: boolean;
  /** The Supabase token registerTrack posts with; undefined outside a session. */
  authToken?: string;
}

export interface SentReceipt { id: string; threadId?: string }

// What the pump tells whoever is listening once a message has ACTUALLY left.
// MessagesFlow subscribes for its own bookkeeping; the pump never needs a
// subscriber to exist.
type SentSub = (item: OutboxItem, sent: SentReceipt) => void;
const sentSubs = new Set<SentSub>();
export function subscribeSent(fn: SentSub): () => void {
  sentSubs.add(fn);
  return () => { sentSubs.delete(fn); };
}

// Ids currently in flight, module-level so that even two mounted pumps
// could never pick the same item up twice while its network call is still
// running (a double send is worse than a slow one).
const inFlight = new Set<string>();

export async function processOutboxSend(item: OutboxItem, deps: SendDeps): Promise<void> {
  const api = deps.apiFor(item.account);
  if (!api) {
    // Not connected right now is not necessarily final (a token refresh, a
    // moment offline): revert to held so the next tick tries again, rather
    // than leaving the item stuck showing "Sending" forever with no Undo,
    // Send Now, or Retry able to touch it (dueNow only ever looks at held
    // items).
    patchOutbox(item.id, { state: "held" });
    inFlight.delete(item.id);
    return;
  }
  try {
    const raw = encodeEmail({
      to: item.to, cc: item.cc, subject: item.subject, body: item.body, inReplyTo: item.inReplyTo,
      attachment: item.attachment,
      ...(deps.trackOpens ? { pixelUrl: pixelUrlFor(item.trackId ?? newTrackId()) } : {}),
    });
    const sent = await api.sendMessage(raw, item.threadId);
    if (deps.trackOpens && item.trackId) {
      saveTrack(item.trackId, { threadId: sent.threadId || item.threadId || sent.id, sentAt: Date.now() });
      void registerTrack(item.trackId, deps.authToken);
    }
    // The honest voice metric: sent exactly as drafted (deckVerbatim, from
    // DeckFlow's own Send & Next) gets flag: false; a deck draft that needed
    // editing before compose sent it gets flag: true. A send that fails or
    // gets Undone never counts either way.
    if (item.fromDeck) emit({ type: "email.deck_sent", props: { flag: !item.deckVerbatim } });
    emit({ type: "email.handled", props: { kind: "reply" } });
    if (item.editingDraftId) {
      const id = item.editingDraftId;
      void (async () => {
        const { failed } = await settleAll([id], () => api.deleteDraft(id));
        if (failed.length) showToast({ message: "Sent · The old draft is still in your drafts" });
      })();
    }
    // EMAIL-F-02 (2026-09-05): "Chase If No Reply is set and cleared in the
    // same breath." The clear is meant to retire an OLD chase when he acts
    // on a thread (N3's own law: any send on that thread answers it); it
    // used to run AFTER setChase on the same thread id, so the chase he had
    // just asked for was gone before the toast faded, whatever days he
    // picked. Retire first, then set, so Off clears and 3d survives.
    if (item.threadId) clearChase(item.threadId);
    if (item.threadId && (item.chaseDays ?? 0) > 0) {
      setChase({ threadId: item.threadId, to: item.to, subject: item.subject, setISO: todayISO(), days: item.chaseDays! });
    }
    if (item.nudge && item.threadId) countNudge(item.threadId);
    const threadForPromise = item.threadId || sent.threadId;
    if (deps.tasks && deps.ai.available && !item.handoffTo && threadForPromise && !alreadyPromised(threadForPromise)) {
      const tasks = deps.tasks;
      const today = todayISO();
      void (async () => {
        try {
          const raw2 = await deps.ai.complete([{ role: "user", content: commitmentPrompt(item.body, today) }], COMMITMENT_SYSTEM);
          const c = parseCommitment(raw2, today);
          if (!c) return;
          markPromised(threadForPromise);
          await tasks.createTask(c.text, { due: c.due ?? null, source: madeBy("email", threadForPromise) });
          emit({ type: "action", props: { name: "email.commitment.caught" } });
          showToast({ message: commitmentLine(c, todayISO()) }, 4000);
        } catch { /* a missed catch is silent; a wrong task is not */ }
      })();
    }
    if (item.handoffTo) {
      const tid = item.threadId || sent.threadId;
      if (tid) {
        void (async () => {
          const { failed } = await settleAll([tid], () => deps.apiFor(item.account)?.modifyThread(tid, [], ["INBOX"]));
          if (failed.length) showToast({ message: "Handed off · Still in your inbox" });
        })();
      }
      emit({ type: "action", props: { name: "email.handoff" } });
      showToast({ message: handoffLine(item.handoffTo) }, 3000);
    } else {
      showToast({ message: "Sent" }, 2000);
    }
    removeFromOutbox(item.id);
    sentSubs.forEach((s) => s(item, sent));
  } catch (e) {
    // Never silently lost: it stays in the outbox as failed, where the Email
    // tab renders it with Retry and Edit. The toast is for when that tab is
    // not the one on screen.
    patchOutbox(item.id, { state: "failed", error: humanError(e, "Could not send") });
    showToast({ message: "Couldn't send · In your email outbox to retry" });
  } finally {
    inFlight.delete(item.id);
  }
}

// EMAIL-F-05 (2026-09-05): the stale-sending sweep, run once when the pump
// mounts, which is once per app process. Anything still marked "sending"
// at that moment was in flight in a process that no longer exists, so it is
// an interrupted send, not a live one. The mail queue's own loader already
// maps that on read (outbox.ts); this covers the Today queue, which has no
// card of its own: an interrupted Today send graduates into the mail outbox
// as failed with the same line, where Retry, Edit and Discard live, instead
// of sitting in a store nothing will ever pick up again.
export function sweepInterruptedSends(): void {
  for (const item of getOutbox()) {
    if (item.state === "sending" && !inFlight.has(item.id)) {
      patchOutbox(item.id, { state: "failed", error: INTERRUPTED_LINE });
    }
  }
  for (const t of getTodayOutbox()) {
    if (t.state !== "sending") continue;
    enqueueOutbox({
      id: t.id, account: t.account, to: t.to, subject: t.subject, body: t.body,
      inReplyTo: t.inReplyTo, threadId: t.threadId, dueMs: t.dueMs, scheduled: false,
      state: "failed", error: INTERRUPTED_LINE,
    });
    removeTodaySend(t.id);
  }
}

// One tick of the pump: whatever is due (held past its dueMs, or a scheduled
// send whose moment arrived) is marked sending and handed to
// processOutboxSend. Exported so a test can drive it without a timer.
export function pumpOutbox(nowMs: number, deps: SendDeps): void {
  for (const item of dueNow(getOutbox(), nowMs)) {
    if (inFlight.has(item.id)) continue;
    inFlight.add(item.id);
    patchOutbox(item.id, { state: "sending" });
    void processOutboxSend(item, deps);
  }
}
