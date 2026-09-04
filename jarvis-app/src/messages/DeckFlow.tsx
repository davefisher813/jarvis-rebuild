import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { humanError } from "../connections/google/humanError";
import { dayPhrase } from "../money/bills";
import { displayName } from "./names";
import { fmtTime, todayISO } from "../schedule/calendar";
import { settleAll } from "./settle";
import { quickAnswers } from "./quickAnswers";
import { dealHand, estimateOf, EMPTY_RECEIPTS, handledOf, type SweepReceipts, SESSION_MS } from "./sweep";
import { Burst } from "../shared/Burst";
import { madeBy } from "../shared/provenance";


// THE SWEEP (Dave 2026-08-25, the Anti-Inbox catalog, every pick approved).
//
// This used to be the Deal With It deck: right engine, wrong posture. The
// engine stays exactly as it was: one email at a time, the decision already
// prepared, nothing sends or files without the tap, Later never loses. What
// changed is everything the research called an anxiety mechanism:
//
//   3A  It deals a HAND of at most nine. The pile is never on screen.
//   4A  The card leads with the VERB: the decision is the headline and the
//       email is the evidence beneath it. Reading becomes optional.
//   2A  The count runs DOWN: a ring that empties, never a total.
//   5A  Time is finite and visible: a five-minute session clock, and every
//       card wears its cost ("~5 sec"). Zero on the clock means DONE, and
//       the cards still in the hand go back to the deck without guilt,
//       because the deal was five minutes, not the pile.
//   6A  Every kill pays: the card flies, the burst fires, the counter ticks.
//   7A  It ends somewhere: the finish screen (rendered by the parent) gets
//       true receipts, counted as they happen and never estimated.
// 8A arrives properly in Wave 2, but the evidence disc is born warm: a
// stable color per sender, picked from the category fills so the on-color
// contrast is already law-tested. Stable so Ridgeley is always Ridgeley's
// color, never red (the slots here exclude it: red is a verb).
const DISC_SLOTS = ["yellow", "sky", "green", "orange", "teal", "pink", "purple", "blue"] as const;
function discSlot(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return DISC_SLOTS[h % DISC_SLOTS.length]!;
}

export default function DeckFlow({ ai, apiFor, threads, token, limitMs, onDone, onOpenThread, onEditReply, onHandled }: {
  ai: AIService;
  apiFor: (account?: string) => GoogleApi | null;
  threads: ThreadRow[];
  token?: string;
  onDone: (handled: number, ms: number, receipts: SweepReceipts) => void;
  // A custom session length from the drain sheet. The default is a session
  // too now (SESSION_MS): an untimed sweep is an inbox with a nicer face.
  limitMs?: number;
  // There is no separate exit: leaving the sweep IS finishing it. Backing
  // out lands on the finish screen with whatever the session truly did,
  // because a session abandoned halfway still deserves its receipts.
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

  // 3A: the hand. At most nine, the rest stay face-down in the deck. The
  // ring, the progress bar, and "the deck keeps the rest" all speak about
  // the hand, never about the pile.
  const hand = useMemo(() => dealHand(threads), [threads]);
  const [idx, setIdx] = useState(0);
  const [thread, setThread] = useState<ThreadFull | null>(null);
  const [plan, setPlan] = useState<DeckPlan | null>(null);
  const [preparing, setPreparing] = useState(true);
  const [busy, setBusy] = useState(false);
  // 6A: the kill. While set, the visible card is mid-flight and the burst is
  // firing; the actual advance happens when the animation lands. Reduced
  // motion is handled in CSS (the transition collapses to a fade).
  const [killing, setKilling] = useState(false);
  const killTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { if (killTimer.current) clearTimeout(killTimer.current); }, []);

  // 7A: receipts, counted as the actions land. A session abandoned halfway
  // still reports exactly what it truly did.
  const receipts = useRef<SweepReceipts>({ ...EMPTY_RECEIPTS });
  const started = useRef(Date.now());
  const sessionMs = limitMs ?? SESSION_MS;
  const [left, setLeft] = useState<number>(sessionMs);
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
  const row = hand[idx];

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
      const today = todayISO();
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

  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    onDone(handledOf(receipts.current), Date.now() - started.current, receipts.current);
  }, [onDone]);

  // 5A: the session clock. At zero it stops dead and that IS done: the cards
  // still in the hand go back to the deck without guilt, because the deal was
  // five minutes, not the pile. Mid-card is fine: the card was a proposal,
  // and an undecided proposal costs nothing.
  useEffect(() => {
    const id = setInterval(() => {
      const remaining = sessionMs - (Date.now() - started.current);
      setLeft(remaining);
      if (remaining <= 0 && !done.current) {
        clearInterval(id);
        finish();
      }
    }, 250);
    return () => clearInterval(id);
  }, [sessionMs, finish]);

  // 6A then advance: the card dies on screen FIRST, then the deck moves. The
  // receipts were already counted by the caller; this is presentation.
  const advance = (archivedRow: boolean) => {
    if (row) onHandled(row.id, archivedRow);
    setKilling(true);
    killTimer.current = setTimeout(() => {
      setKilling(false);
      if (idx + 1 >= hand.length) finish();
      else setIdx(idx + 1);
    }, 340);
  };

  // AWAITED, AND ITS ANSWER USED (2026-08-25). This was detached and its
  // rejection discarded, then the advance reported the thread cleared and
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
    if (!row || !thread || busy || killing) return;
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
        receipts.current.sent += 1;
        // The honest voice metric: sent exactly as drafted (edited sends are
        // logged from the compose path with flag: true). A real, durable
        // EventType since 2026-08-07; it was a device-local "action" before,
        // so the one measure of draft quality died with the device.
        emit({ type: "email.deck_sent", props: { flag: false } });
      } else if (plan.kind === "bill" && plan.bill) {
        // B6-7 (2026-09-04): the Sweep wrote bills, events and tasks with no
        // source and no fromThread, unlike every other email-to-entity path
        // in the app (MessagesFlow, TodayFlow's addTaskFromMail). Without
        // them the row carries no "From an email" line and nothing to tap
        // back to the thread two days later. madeBy("email", row.id) is the
        // same stamp those paths already use; row.id is the thread id
        // (archiveRemote below sends it straight to modifyThread).
        await tasks.createTask("Pay " + plan.bill.name, {
          due: plan.bill.due ?? null,
          bill: { amount: plan.bill.amount },
          fromThread: row.id,
          source: madeBy("email", row.id),
        });
        cleared = await archiveRemote(row.id, row.account);
        receipts.current.bills += 1;
      } else if (plan.kind === "event" && plan.event) {
        await schedule.createEvent(plan.event.title, {
          date: plan.event.date,
          start: plan.event.start,
          end: plan.event.end,
          source: madeBy("email", row.id),
        });
        cleared = await archiveRemote(row.id, row.account);
        receipts.current.scheduled += 1;
      } else if (plan.kind === "task" && plan.task) {
        await tasks.createTask(plan.task.title, { due: plan.task.due ?? null, fromThread: row.id, source: madeBy("email", row.id) });
        cleared = await archiveRemote(row.id, row.account);
        receipts.current.tasks += 1;
      } else {
        cleared = await archiveRemote(row.id, row.account);
        receipts.current.archived += 1;
      }
      emit({ type: "action", props: { name: "email.deck.handled", kind: plan.kind } });
      advance(cleared);
    } catch (e) {
      showToast({ message: humanError(e, "Didn't send · Nothing lost") });
    } finally {
      setBusy(false);
    }
  };

  const later = async () => {
    if (!row || busy || killing) return;
    setBusy(true);
    try {
      // todayISO is LOCAL. toISOString().slice(0,10) is UTC, so tapping
      // Later after 5pm west of UTC filed the task due TOMORROW.
      await tasks.createTask(laterTaskTitle(displayName(row.from), row.subject), { due: todayISO(), fromThread: row.id, source: madeBy("email", row.id) });
      emit({ type: "action", props: { name: "email.deck.later" } });
      receipts.current.later += 1;
      advance(false); // stays in the inbox: the task is the reminder, the mail is the evidence
    } catch (e) {
      // Do NOT advance: Later without its task is a silent loss, and the whole
      // point of Later is that deferring never means losing.
      showToast({ message: humanError(e, "Couldn't save · Nothing lost") });
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    if (!row || busy || killing) return;
    const cleared = await archiveRemote(row.id, row.account);
    if (!cleared) showToast({ message: "Couldn't archive it · Still in your inbox" });
    else receipts.current.archived += 1;
    emit({ type: "action", props: { name: "email.deck.handled", kind: "archive" } });
    advance(cleared);
  };

  if (!row) return null;

  // 4A: THE VERB IS THE HEADLINE. The decision reads first and huge; the
  // email is the evidence card underneath, quiet, with the full thread one
  // tap away. Reading becomes optional because deciding was already done.
  const headline = preparing
    ? "Reading it..."
    : !plan
      ? "Open and reply"
      : plan.kind === "reply" && plan.reply
        ? "“" + plan.reply + "”"
        : plan.kind === "bill" && plan.bill
          ? "Pay " + plan.bill.name + " · $" + plan.bill.amount.toFixed(2) + (plan.bill.due ? " · Due " + dayPhrase(plan.bill.due, todayISO()) : "")
          : plan.kind === "event" && plan.event
            ? "Schedule " + plan.event.title + " · " + dayPhrase(plan.event.date, todayISO()) + " " + fmtTime(plan.event.start).time + " " + fmtTime(plan.event.start).ap
            : plan.kind === "task" && plan.task
              ? "Add task: " + plan.task.title + (plan.task.due ? " · Due " + dayPhrase(plan.task.due, todayISO()) : "")
              : "Let it go";
  const kicker = preparing ? "" :
    plan?.kind === "reply" ? "Reply ready · Your voice" :
    plan?.kind === "bill" ? "Bill prepped for Money" :
    plan?.kind === "event" ? "Ready for the Schedule" :
    plan?.kind === "task" ? "Task prepped" :
    plan ? "Nothing needed" : "No plan · You drive";

  // 2A: the ring counts DOWN. Remaining includes the card on screen.
  const remaining = hand.length - idx;
  const ringPct = hand.length ? (remaining / hand.length) * 360 : 0;

  return (
    <div className="screen ruled" key={"deck" + row.id}>
      <div className="nav-bar">
        <button className="nav-back" onClick={finish}>Email</button>
        {/* 5A: the clock is the title. It only runs down, and zero means
            done, never "you failed to finish". */}
        <span className="nav-title sweep-clock">{fmtClock(Math.max(0, left))}</span>
        {/* 2A: the countdown ring. Never a total: the hand is at most nine,
            so this number only ever shrinks toward the finish. */}
        <span className="nav-action sweep-ring-slot">
          {/* The angle is runtime state; everything painted with it lives in
              CSS. The inline style carries ONE custom property and nothing
              else, per the amended inline-style law. */}
          <span className="sweep-ring" style={{ "--sweep-arc": ringPct + "deg" } as React.CSSProperties} aria-label={remaining + " left in this hand"}>
            <span className="sweep-ring-n">{remaining}</span>
          </span>
        </span>
      </div>
      <div className="deck-bar" role="presentation">
        <span className="deck-bar-fill" style={{ width: (hand.length ? (idx / hand.length) * 100 : 0) + "%" }} />
      </div>
      <div className="pad-x sweep-hold">
        {/* The next card's edge, so the hand reads as a hand and the current
            card visibly has somewhere to go when it dies. */}
        {idx + 1 < hand.length && <div className="card sweep-under" aria-hidden="true" />}
        <div className={"card pad deck-card sweep-card" + (killing ? " sweep-kill" : "")}>
          <div className="sweep-burst"><Burst show={killing} /></div>
          <div className="sweep-kicker-row">
            <span className="eyebrow">{kicker}</span>
            {/* 5A: the cost, worn on the card. An honest ballpark beats the
                dread of "this might eat my hour". */}
            {!preparing && <span className="sweep-cost">{estimateOf(plan?.kind)}</span>}
          </div>
          <div className={"sweep-verb" + (plan?.kind === "reply" ? " sweep-verb-quote" : "")}>{headline}</div>

          {plan?.kind === "reply" && plan.reply && (
            <div className="deck-chips">
              {quickAnswers(undefined).map((q) => (
                <button key={q} className="chip" disabled={busy || killing} onClick={() => void runPrimary(q)}>{q}</button>
              ))}
            </div>
          )}

          <div className="deck-actions">
            <button className="btn btn-primary btn-block" disabled={preparing || busy || killing} onClick={() => void runPrimary()}>
              {preparing ? "..." : plan ? primaryLabel(plan) : "Open & Reply"}
            </button>
            <div className="deck-secondary">
              {plan?.kind === "reply" && plan.reply && thread && (
                <button className="btn btn-secondary" disabled={busy || killing} onClick={() => onEditReply(thread, plan.reply!)}>Edit</button>
              )}
              <button className="btn btn-secondary" disabled={busy || killing} onClick={() => onOpenThread(row.id)}>Open</button>
              <button className="btn btn-secondary" disabled={busy || killing} onClick={() => void later()}>Later</button>
              <button className="btn btn-secondary" disabled={busy || killing} onClick={() => void archive()}>Archive</button>
            </div>
          </div>

          {/* THE EVIDENCE, not the headline (4A). Sender, subject, and the
              one-line why. It sits under the decision because the decision
              is what he came here to make. */}
          <div className="sweep-evidence">
            <span className={"sweep-disc cat-bg-" + discSlot(row.fromEmail || row.from)} aria-hidden="true">
              {(displayName(row.from)[0] || "?").toUpperCase()}
            </span>
            <span className="sweep-ev-text">
              <span className="sweep-ev-from">{displayName(row.from)}</span>
              <span className="sweep-ev-why">{plan?.why || row.subject}</span>
            </span>
          </div>
        </div>
        {/* L2 arrives properly in Wave 2, but the Sweep is born obeying it:
            the hand has a floor and says so. */}
        <div className="sweep-floor">{threads.length > hand.length
          ? "The deck keeps the rest · this hand is " + hand.length
          : "That's everything."}</div>
      </div>
      <div className="screen-foot" />
    </div>
  );
}
