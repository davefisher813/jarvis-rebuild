import { useCallback, useEffect, useRef, useState } from "react";
import type { AIService } from "../ai/AIService";
import type { GoogleApi } from "../connections/google/api";
import { mapThreadFull, buildReply, encodeEmail, type ThreadRow, type ThreadFull } from "../connections/google/map";
import { useTasks, useSchedule, usePeople } from "../data/NotesProvider";
import { useAIContext } from "../ai/useAIContext";
import { useProfile } from "../data/NotesProvider";
import { voiceToText } from "../ai/context";
import { emit } from "../events";
import { fmtClock } from "./drain";
import { buildPlanPrompt, parseDeckPlan, primaryLabel, laterTaskTitle, type DeckPlan, type VoiceProfile } from "./deck";
import { voiceExamplesFor } from "./voiceExamples";
import { newTrackId, pixelUrlFor, saveTrack, registerTrack } from "./tracking";
import { showToast } from "../shared/toast";
import { settleAll } from "./settle";
import { capAfterNumber } from "../shared/casing";
import { quickAnswers } from "./quickAnswers";

// The Deal With It deck (email 2): one email at a time, the decision already
// prepared, a reply in the user's voice, a bill for Money, a slot for the
// Schedule, or a task. One tap closes the loop and advances. "Later" files a
// real task pointing back at the email, so deferring never means losing.
// Nothing sends, files, or schedules without the tap.
export default function DeckFlow({ ai, apiFor, threads, token, limitMs, onDone, onExit, onOpenThread, onEditReply, onHandled }: {
  ai: AIService;
  apiFor: (account?: string) => GoogleApi | null;
  threads: ThreadRow[];
  token?: string;
  onDone: (handled: number, ms: number) => void;
  // The drain: a hard stop the USER chose. Undefined means no timer at all.
  limitMs?: number;
  onExit: () => void;
  onOpenThread: (id: string) => void;
  onEditReply: (thread: ThreadFull, body: string) => void;
  onHandled: (threadId: string, archived: boolean) => void;
  }) {
  const tasks = useTasks();
  const schedule = useSchedule();
  const people = usePeople();
  // Required, not optional, unlike MessagesFlow: this component already calls
  // useTasks and useSchedule, so it cannot render without NotesProvider anyway.
  const gatherContext = useAIContext();
  const profileSvc = useProfile();
  const [trackOpens, setTrackOpens] = useState(true);
  useEffect(() => {
    let on = true;
    profileSvc.get().then((p) => { if (on) setTrackOpens(p?.trackOpens !== false); }).catch(() => {});
    return () => { on = false; };
  }, [profileSvc]);
  const [idx, setIdx] = useState(0);
  const [thread, setThread] = useState<ThreadFull | null>(null);
  const [plan, setPlan] = useState<DeckPlan | null>(null);
  const [preparing, setPreparing] = useState(true);
  const [busy, setBusy] = useState(false);
  const handled = useRef(0);
  const started = useRef(Date.now());
  const [left, setLeft] = useState<number | null>(limitMs ?? null);
  const done = useRef(false);
  // Generation counter for prepare (audit 2026-08-07). Later and Archive stay
  // enabled while a card is preparing, deliberately, so the user is never made
  // to wait on the AI to say "not this one." But that means card A's in-flight
  // prepare can resolve AFTER the deck has advanced to card B, and without
  // this guard its late setThread/setPlan landed on B: the card showed B's
  // sender with A's prepared reply, the primary button re-sent A's reply, and
  // B was archived without ever being decided, the exact silent skip the
  // snapshot comment in MessagesFlow calls this feature's worst failure. Every
  // await in prepare is followed by a staleness check; stale results are
  // dropped on the floor.
  const prepGen = useRef(0);
  const row = threads[idx];

  const prepare = useCallback(async (r: ThreadRow) => {
    const gen = ++prepGen.current;
    const live = () => gen === prepGen.current;
    setPreparing(true);
    setThread(null);
    setPlan(null);
    try {
      const api = apiFor(r.account);
      if (!api) throw new Error("not connected");
      const full = mapThreadFull(await api.getThread(r.id));
      if (!live()) return;
      if (full.messages.length === 0) throw new Error("empty");
      setThread(full);
      if (!ai.available) return; // honest degrade: read + reply, no prepared plan
      const person = (await people.list()).find(
        (p) => (p.data.email || "").toLowerCase() === r.fromEmail.toLowerCase(),
      );
      const voice: VoiceProfile = {
        register: person?.data.register,
        flagged: person?.data.flagged,
        examples: await voiceExamplesFor(api, r.fromEmail, Date.now()),
      };
      const today = new Date().toISOString().slice(0, 10);
      // styleRule: false because buildPlanPrompt already emits
      // STYLE_SCOPE_RULE unconditionally. Sending it twice is roughly 250
      // wasted tokens on every card in the deck.
      const userVoice = await gatherContext()
        .then((c) => voiceToText(c, { styleRule: false }))
        .catch(() => "");
      if (!live()) return;
      const { system, user } = buildPlanPrompt(full, voice, today, userVoice);
      const raw = await ai.complete([{ role: "user", content: user }], system, { tier: "write" });
      if (!live()) return;
      setPlan(parseDeckPlan(raw)); // null = honest fallback, card still works
    } catch {
      if (live()) setPlan(null);
    } finally {
      if (live()) setPreparing(false);
    }
  }, [ai, apiFor, people, gatherContext]);

  useEffect(() => {
    if (row) void prepare(row);
  }, [row, prepare]);

  // At zero it stops dead. Mid-card is fine: the card was a proposal, and an
  // undecided proposal costs nothing.
  useEffect(() => {
    if (!limitMs) return;
    const id = setInterval(() => {
      const remaining = limitMs - (Date.now() - started.current);
      setLeft(remaining);
      if (remaining <= 0 && !done.current) {
        done.current = true;
        clearInterval(id);
        onDone(handled.current, limitMs);
      }
    }, 250);
    return () => clearInterval(id);
  }, [limitMs, onDone]);

  const advance = (archivedRow: boolean) => {
    if (row) onHandled(row.id, archivedRow);
    handled.current += 1;
    if (idx + 1 >= threads.length) {
      done.current = true;
      onDone(handled.current, Date.now() - started.current);
    } else {
      setIdx(idx + 1);
    }
  };

  // AWAITED, AND ITS ANSWER USED (2026-08-25). This was detached and its
  // rejection discarded, then `advance(true)` reported the thread cleared and
  // the parent counted it. The surrounding try/catch could not catch it,
  // because the promise was never attached to anything.
  //
  // Returns whether the mail actually left the inbox. The callers pass that
  // straight into `advance`, so a thread that failed to archive is not counted
  // as cleared: the work still happened (the bill was filed, the reply was
  // sent), and the mail is simply still there.
  const archiveRemote = async (id: string, account?: string): Promise<boolean> => {
    const { ok } = await settleAll([id], () => apiFor(account)?.modifyThread(id, [], ["INBOX", "UNREAD"]));
    return ok.length > 0;
  };

  // E9 (2026-08-24): `shortReply` is a quick-answer chip standing in for the
  // drafted reply. Same send path, same tracking, same archive; the only
  // thing that changes is the words, so a chip can never behave differently
  // from the button beside it.
  const runPrimary = async (shortReply?: string) => {
    if (!row || !thread || busy) return;
    if (!plan) { onOpenThread(row.id); return; }
    const api = apiFor(row.account);
    if (!api) return;
    setBusy(true);
    // Whether the mail actually left the inbox. Only a true archive is
    // counted as cleared by the parent.
    let cleared = false;
    try {
      if (plan.kind === "reply" && (shortReply || plan.reply)) {
        const body = shortReply ?? plan.reply!;
        const last = thread.messages[thread.messages.length - 1]!;
        const r = buildReply(last, body);
        const trackId = newTrackId();
        const sent = await api.sendMessage(
          encodeEmail({ to: r.to, subject: r.subject, body, inReplyTo: r.inReplyTo, ...(trackOpens ? { pixelUrl: pixelUrlFor(trackId) } : {}) }),
          r.threadId,
        );
        if (trackOpens) {
          saveTrack(trackId, { threadId: sent.threadId || r.threadId || sent.id, sentAt: Date.now() });
          void registerTrack(trackId, token);
        }
        cleared = await archiveRemote(row.id, row.account);
        // The honest voice metric: sent exactly as drafted (edited sends are
        // logged from the compose path with flag: true). A real, durable
        // EventType since 2026-08-07; it was a device-local "action" before,
        // so the one measure of draft quality died with the device.
        emit({ type: "email.deck_sent", props: { flag: false } });
        showToast({ message: "Sent" });
      } else if (plan.kind === "bill" && plan.bill) {
        await tasks.createTask("Pay " + plan.bill.name, {
          due: plan.bill.due ?? null,
          bill: { amount: plan.bill.amount },
        });
        cleared = await archiveRemote(row.id, row.account);
        showToast({ message: "Bill added to Money" });
      } else if (plan.kind === "event" && plan.event) {
        await schedule.createEvent(plan.event.title, {
          date: plan.event.date,
          start: plan.event.start,
          end: plan.event.end,
        });
        cleared = await archiveRemote(row.id, row.account);
        showToast({ message: "On the schedule" });
      } else if (plan.kind === "task" && plan.task) {
        await tasks.createTask(plan.task.title, { due: plan.task.due ?? null });
        cleared = await archiveRemote(row.id, row.account);
        showToast({ message: "Task added" });
      } else {
        cleared = await archiveRemote(row.id, row.account);
      }
      emit({ type: "action", props: { name: "email.deck.handled", kind: plan.kind } });
      advance(cleared);
    } catch (e) {
      showToast({ message: (e as Error).message || "Didn't send · Nothing lost" });
    } finally {
      setBusy(false);
    }
  };

  const later = async () => {
    if (!row || busy) return;
    setBusy(true);
    try {
      await tasks.createTask(laterTaskTitle(row.from, row.subject), { due: new Date().toISOString().slice(0, 10) });
      emit({ type: "action", props: { name: "email.deck.later" } });
      advance(false); // stays in the inbox: the task is the reminder, the mail is the evidence
    } catch (e) {
      // Do NOT advance: Later without its task is a silent loss, and the whole
      // point of Later is that deferring never means losing.
      showToast({ message: (e as Error).message || "Couldn't save · Nothing lost" });
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    if (!row || busy) return;
    const cleared = await archiveRemote(row.id, row.account);
    if (!cleared) showToast({ message: "Couldn't archive it · Still in your inbox" });
    emit({ type: "action", props: { name: "email.deck.handled", kind: "archive" } });
    advance(cleared);
  };

  if (!row) return null;

  return (
    <div className="screen" key={"deck" + row.id}>
      <div className="nav-bar">
        <button className="nav-back" onClick={onExit}>Email</button>
        <span className="nav-title">{limitMs && left !== null ? fmtClock(left) : capAfterNumber(idx + 1 + " of " + threads.length)}</span>
        <span className="nav-action"></span>
      </div>
      {/* E7 (2026-08-23): the deck already knew where you were and only said
          it in words, and the clock REPLACED the count when a drain was
          running, so a timed deck showed no position at all. The bar carries
          position in both cases: it is the one thing that says "this ends"
          without you doing arithmetic between two numbers. */}
      <div className="deck-bar" role="presentation">
        <span className="deck-bar-fill" style={{ width: (threads.length ? (idx / threads.length) * 100 : 0) + "%" }} />
      </div>
      <div className="pad-x">
        <div className="card pad deck-card">
          <div className="msg-detail-subj">{row.from}</div>
          <div className="conn-meta truncate">{row.subject}</div>
          <div className="deck-why">{plan?.why || row.snippet}</div>

          {preparing ? (
            <div className="conn-status">Preparing...</div>
          ) : plan?.kind === "reply" && plan.reply ? (
            <div className="deck-prep">
              <div className="eyebrow">Reply ready · Your voice</div>
              <div className="deck-prep-text">{plan.reply}</div>
              {/* E9: the answer without the paragraph. A chip is a WHOLE
                  reply (quickAnswers' own law), it sends through the same
                  path as the big button, and it exists because half of these
                  threads want one word, not your voice. */}
              <div className="deck-chips">
                {quickAnswers(undefined).map((q) => (
                  <button key={q} className="chip" disabled={busy} onClick={() => void runPrimary(q)}>{q}</button>
                ))}
              </div>
            </div>
          ) : plan?.kind === "bill" && plan.bill ? (
            <div className="deck-prep">
              <div className="eyebrow">Bill prepped for Money</div>
              <div className="deck-prep-text">{plan.bill.name} · ${plan.bill.amount}{plan.bill.due ? " · Due " + plan.bill.due : ""}</div>
            </div>
          ) : plan?.kind === "event" && plan.event ? (
            <div className="deck-prep">
              <div className="eyebrow">Ready for the Schedule</div>
              <div className="deck-prep-text">{plan.event.title} · {plan.event.date} at {plan.event.start}</div>
            </div>
          ) : plan?.kind === "task" && plan.task ? (
            <div className="deck-prep">
              <div className="eyebrow">Task prepped</div>
              <div className="deck-prep-text">{plan.task.title}{plan.task.due ? " · Due " + plan.task.due : ""}</div>
            </div>
          ) : null}

          <div className="deck-actions">
            <button className="btn btn-primary btn-block" disabled={preparing || busy} onClick={() => void runPrimary()}>
              {preparing ? "..." : plan ? primaryLabel(plan) : "Open & Reply"}
            </button>
            <div className="deck-secondary">
              {plan?.kind === "reply" && plan.reply && thread && (
                <button className="btn btn-secondary" disabled={busy} onClick={() => onEditReply(thread, plan.reply!)}>Edit</button>
              )}
              <button className="btn btn-secondary" disabled={busy} onClick={() => onOpenThread(row.id)}>Open</button>
              <button className="btn btn-secondary" disabled={busy} onClick={() => void later()}>Later</button>
              <button className="btn btn-secondary" disabled={busy} onClick={() => void archive()}>Archive</button>
            </div>
          </div>
        </div>
      </div>
      <div className="screen-foot" />
    </div>
  );
}
