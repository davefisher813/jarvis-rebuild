import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AIService } from "../ai/AIService";
import type { GoogleApi } from "../connections/google/api";
import { mapThreadFull, buildReply, type ThreadRow, type ThreadFull } from "../connections/google/map";
import { useTasks, useSchedule, usePeople } from "../data/NotesProvider";
import { makePersonIdFor, noPersonId, type PersonIdFor } from "./personFor";
import { useAIContext } from "../ai/useAIContext";
import { voiceToText } from "../ai/context";
import { emit } from "../events";
import { fmtClock } from "./drain";
import { buildPlanPrompt, parseDeckPlan, primaryLabel, laterTaskTitle, threadSourceText, type DeckPlan, type VoiceProfile } from "./deck";
import { voiceExamplesFor } from "./voiceExamples";
import { showToast } from "../shared/toast";
import { humanError } from "../connections/google/humanError";
import { dayPhrase } from "../money/bills";
import { displayName } from "./names";
import { fmtTime, todayISO } from "../schedule/calendar";
import { settleAll } from "./settle";
import { quickAnswers } from "./quickAnswers";
import { dealHand, estimateOf, EMPTY_RECEIPTS, handledOf, type SweepReceipts, SESSION_MS } from "./sweep";
import { loadSweepSession, saveSweepSession, clearSweepSession, isFreshSession, resumeHand, type SweepSession } from "./sweepSession";
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

// E-21 (Push D): the clock hitting zero is a question now, not a verdict.
const MORE_MS = 5 * 60_000;

export default function DeckFlow({ ai, apiFor, threads, queueSend, limitMs, onDone, onPark, onOpenThread, onEditReply, onHandled, now = Date.now }: {
  ai: AIService;
  apiFor: (account?: string) => GoogleApi | null;
  threads: ThreadRow[];
  // S2-2 (2026-09-04): Send & Next used to call api.sendMessage directly,
  // with no hold and no Undo -- the one send in the app a mistap could not
  // take back. It now queues through the same outbox MessagesFlow's own
  // compose send uses (S2-1): the card still advances immediately (the Sweep
  // stays fast), but the mail itself sits in the same 12-second hold, with
  // the same Retry-on-failure and the same Undo, discoverable back on the
  // Email list.
  queueSend: (input: { to: string; subject: string; body: string; inReplyTo?: string; threadId?: string; account?: string }) => void;
  onDone: (handled: number, ms: number, receipts: SweepReceipts) => void;
  // E-19 (Push D): backing out PARKS the session instead of finishing it.
  // The parent leaves the Sweep without the finish screen; the hand and the
  // receipts wait in the session store for the next visit. `handled` is
  // what this sitting truly did, so the day can still colour in (10A).
  onPark: (handled: number) => void;
  // A custom session length from the drain sheet. The default is a session
  // too now (SESSION_MS): an untimed sweep is an inbox with a nicer face.
  limitMs?: number;
  // There is no separate exit: leaving the sweep IS finishing it. Backing
  // out lands on the finish screen with whatever the session truly did,
  // because a session abandoned halfway still deserves its receipts.
  onOpenThread: (id: string) => void;
  onEditReply: (thread: ThreadFull, body: string) => void;
  onHandled: (threadId: string, archived: boolean) => void;
  // Tests only: the clock the session store is judged fresh against.
  now?: () => number;
  }) {
  const tasks = useTasks();
  const schedule = useSchedule();
  const people = usePeople();
  // UP-MIND-10 (2026-09-05): the Sweep writes bills, events and tasks off a
  // thread whose sender the app often knows. Rebuilt when Contacts change;
  // address equality only, never a name match.
  const [personIdFor, setPersonIdFor] = useState<PersonIdFor>(() => noPersonId);
  useEffect(() => {
    let live = true;
    void people.list()
      .then((list) => {
        if (!live) return;
        const fn = makePersonIdFor(list.map((p) => ({ id: p.id, ...(p.data.email ? { email: p.data.email } : {}) })));
        setPersonIdFor(() => fn);
      })
      .catch(() => { /* no ids: the rows read exactly as they did before */ });
    return () => { live = false; };
  }, [people]);
  // Required, not optional, unlike MessagesFlow: this component already calls
  // useTasks and useSchedule, so it cannot render without NotesProvider anyway.
  const gatherContext = useAIContext();

  // 3A: the hand. At most nine, the rest stay face-down in the deck. The
  // ring, the progress bar, and "the deck keeps the rest" all speak about
  // the hand, never about the pile.
  //
  // E-19: a parked session, if one is fresh and any of its cards are still
  // in the deck, is offered first. Continue re-deals the PARKED hand (the
  // same cards in the same seats, minus any handled elsewhere since); Start
  // Over deals a fresh one from the top of the pile.
  const [parked] = useState<{ session: SweepSession; hand: ThreadRow[]; idx: number } | null>(() => {
    const s = loadSweepSession();
    if (!isFreshSession(s, now(), limitMs ?? SESSION_MS)) return null;
    const r = resumeHand(s, threads);
    return r ? { session: s, ...r } : null;
  });
  const [resumeChoice, setResumeChoice] = useState<"continue" | "fresh" | null>(parked ? null : "fresh");
  const hand = useMemo(
    () => (resumeChoice === "continue" && parked ? parked.hand : dealHand(threads)),
    [threads, resumeChoice, parked],
  );
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
  const started = useRef(now());
  // What an earlier sitting of this same session already did (E-19).
  const carried = useRef<{ receipts: SweepReceipts; elapsedMs: number }>({ receipts: { ...EMPTY_RECEIPTS }, elapsedMs: 0 });
  // E-21: 5 More Minutes stretches the session; Finish This One stops the
  // clock for exactly one card. Both are choices he makes at zero, never
  // something the app does for him.
  const [extraMs, setExtraMs] = useState(0);
  const [timeUp, setTimeUp] = useState(false);
  const [lastOne, setLastOne] = useState(false);
  const sessionMs = (limitMs ?? SESSION_MS) + extraMs;
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
  const planTextRef = useRef<string | undefined>(undefined);

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
      // UP-MIND-23 (2026-09-05): scoped to the situation. The card is about
      // THIS thread and THIS sender, so the context walks one hop from them
      // instead of carrying every strand, decision and bill in the app.
      const userVoice = await gatherContext({
        threadId: r.id,
        ...(person ? { personId: person.id, personName: person.data.name } : {}),
      })
        .then((c) => voiceToText(c, { styleRule: false }))
        .catch(() => "");
      if (!live()) return;
      const { system, user } = buildPlanPrompt(full, voice, today, userVoice);
      // PLUMB-F-13 (2026-09-05): a deck card is prepared with a reply in it,
      // so this rides the Email Drafts pin like cardDraftJob already did.
      // Tapping into the Sweep used to bypass the pin entirely.
      const raw = await ai.complete([{ role: "user", content: user }], system, { tier: "write", pin: "emailDrafts" });
      if (!live()) return;
      // S2-3: verbatim-anchored against the same text the model was shown,
      // not the model's own say-so -- a bill or an event with no anchor in
      // the email falls back to the honest read-and-reply card.
      setPlan(parseDeckPlan(raw, threadSourceText(full)));
    } catch {
      if (live()) setPlan(null);
    } finally {
      if (live()) setPreparing(false);
    }
  }, [ai, apiFor, people, gatherContext]);

  // EMAIL-F-10 (2026-09-05): "The Sweep re-prepares the card on screen on
  // every parent re-render." This effect was keyed on [row, prepare], and
  // prepare's deps carried apiFor, which MessagesFlow passed as a fresh arrow
  // every render: Send & Next (a queue write), the pump marking the item
  // sending, "Sent" toasting, the toast clearing, each one refetched the
  // thread and re-drafted the reply for a card he was already reading. The
  // prepGen guard made the late results harmless but not free. A card is
  // prepared when it BECOMES the card, so the effect keys on the card's id
  // alone and reads the latest prepare through a ref.
  const prepareRef = useRef(prepare);
  prepareRef.current = prepare;
  const rowRef = useRef(row);
  rowRef.current = row;
  const rowId = row?.id;
  useEffect(() => {
    // E-19: nothing is prepared while the resume offer is up; the card that
    // gets prepared is the one he chose to see.
    if (resumeChoice !== null && rowId && rowRef.current) void prepareRef.current(rowRef.current);
  }, [rowId, resumeChoice]);

  const totalReceipts = () => {
    const c = carried.current.receipts;
    const r = receipts.current;
    return { sent: c.sent + r.sent, bills: c.bills + r.bills, scheduled: c.scheduled + r.scheduled, tasks: c.tasks + r.tasks, archived: c.archived + r.archived, later: c.later + r.later };
  };

  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    // A natural finish is one of the two things that clears the parked
    // session (E-19); the other is Start Over.
    clearSweepSession();
    const all = totalReceipts();
    onDone(handledOf(all), carried.current.elapsedMs + (now() - started.current), all);
  }, [onDone]);

  // E-19: what the store holds for this hand. Written on every advance and
  // whenever the card's plan lands (the plan text is what the resume card
  // shows as "where you were"). Never an event: law 8.
  const writeSession = (at: number, planText?: string) => {
    if (done.current) return;
    saveSweepSession({
      handIds: hand.map((h) => h.id),
      idx: at,
      ...(planText ? { planText } : {}),
      savedAt: now(),
      receipts: totalReceipts(),
      elapsedMs: carried.current.elapsedMs + (now() - started.current),
    });
  };

  // Parking: the back button. A session with nothing done and nothing
  // advanced is not worth offering back, so it leaves quietly and the store
  // stays clear; anything else is written and offered next time.
  const park = () => {
    if (done.current) return;
    const all = totalReceipts();
    const touched = idx > 0 || handledOf(all) > 0;
    if (touched && idx < hand.length) writeSession(idx, planTextRef.current);
    else clearSweepSession();
    done.current = true;
    onPark(handledOf(receipts.current));
  };

  const continueParked = () => {
    if (!parked) return;
    carried.current = { receipts: parked.session.receipts ?? { ...EMPTY_RECEIPTS }, elapsedMs: parked.session.elapsedMs ?? 0 };
    started.current = now();
    setIdx(parked.idx);
    setResumeChoice("continue");
  };
  const startOver = () => {
    clearSweepSession();
    started.current = now();
    setResumeChoice("fresh");
  };

  // 5A: the session clock. Zero still means the deal is over: the cards
  // still in the hand go back to the deck without guilt, because the deal
  // was five minutes, not the pile. E-21 (Push D): but zero used to end the
  // session DEAD, mid-card, with a reply he had already read and was about
  // to send. Zero is now a question with three honest answers: finish just
  // this card (no clock), five more minutes, or stop. The clock does not
  // run while the resume offer is up, and not at all once he chose to
  // finish this one.
  useEffect(() => {
    if (resumeChoice === null || lastOne) return;
    const id = setInterval(() => {
      const remaining = sessionMs - (now() - started.current);
      setLeft(remaining);
      if (remaining <= 0 && !done.current) {
        clearInterval(id);
        setTimeUp(true);
      }
    }, 250);
    return () => clearInterval(id);
  }, [sessionMs, resumeChoice, lastOne]);

  // 6A then advance: the card dies on screen FIRST, then the deck moves. The
  // receipts were already counted by the caller; this is presentation.
  const advance = (archivedRow: boolean) => {
    if (row) onHandled(row.id, archivedRow);
    setKilling(true);
    // E-19: persisted on every advance, so a park (or a killed tab) after
    // this card resumes at the next one.
    if (idx + 1 < hand.length) writeSession(idx + 1);
    killTimer.current = setTimeout(() => {
      setKilling(false);
      // E-21: Finish This One means this one, and then the finish screen.
      if (idx + 1 >= hand.length || lastOne) finish();
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
    if (!row || !thread || busy || killing || timeUp) return;
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
        // S2-2: queued, not sent -- the same 12-second hold and Undo compose
        // gets, discoverable on the Email list. The card still advances now;
        // pixel tracking, and the "sent exactly as drafted" voice metric
        // (flag: false, vs. compose's flag: true for an edited send), fire
        // from the shared outbox pump once the hold actually releases, so a
        // send that gets Undone or that fails never counts as either.
        queueSend({ to: r.to, subject: r.subject, body, inReplyTo: r.inReplyTo, threadId: r.threadId, account: row.account });
        cleared = await archiveRemote(row.id, row.account);
        receipts.current.sent += 1;
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
          ...(personIdFor(row.fromEmail) ? { personId: personIdFor(row.fromEmail)! } : {}),
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
        await tasks.createTask(plan.task.title, { due: plan.task.due ?? null, fromThread: row.id, source: madeBy("email", row.id), ...(personIdFor(row.fromEmail) ? { personId: personIdFor(row.fromEmail)! } : {}) });
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
    if (!row || busy || killing || timeUp) return;
    setBusy(true);
    try {
      // todayISO is LOCAL. toISOString().slice(0,10) is UTC, so tapping
      // Later after 5pm west of UTC filed the task due TOMORROW.
      await tasks.createTask(laterTaskTitle(displayName(row.from), row.subject), { due: todayISO(), fromThread: row.id, source: madeBy("email", row.id), ...(personIdFor(row.fromEmail) ? { personId: personIdFor(row.fromEmail)! } : {}) });
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
    if (!row || busy || killing || timeUp) return;
    const cleared = await archiveRemote(row.id, row.account);
    if (!cleared) showToast({ message: "Couldn't archive it · Still in your inbox" });
    else receipts.current.archived += 1;
    emit({ type: "action", props: { name: "email.deck.handled", kind: "archive" } });
    advance(cleared);
  };

  // E-19: the resume offer, before any card. The hand behind it is the
  // parked one, so "4 of 9" is the seat he left, not a fresh deal's.
  if (resumeChoice === null && parked) {
    return (
      <div className="screen ruled" key="deck-resume">
        <div className="nav-bar">
          <button className="nav-back" onClick={() => { done.current = true; onPark(0); }}>Email</button>
          <span className="nav-title">The Sweep</span>
          <span className="nav-action" />
        </div>
        <div className="pad-x sweep-hold">
          <div className="card pad deck-card sweep-card">
            <div className="sweep-kicker-row"><span className="eyebrow">{"Parked \u00b7 " + (parked.idx + 1) + " of " + parked.hand.length}</span></div>
            <div className="sweep-verb">Continue Where You Left Off</div>
            {parked.session.planText && <div className="sweep-resume-plan">{parked.session.planText}</div>}
            <div className="deck-actions">
              <button className="btn btn-primary btn-block" onClick={continueParked}>Continue</button>
              <div className="deck-secondary">
                <button className="btn btn-secondary" onClick={startOver}>Start Over</button>
              </div>
            </div>
          </div>
        </div>
        <div className="screen-foot" />
      </div>
    );
  }

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
  // E-19: the store remembers the headline once it is known, so the resume
  // card can say where he was in his own prepared words.
  planTextRef.current = preparing ? undefined : headline;

  // 2A: the ring counts DOWN. Remaining includes the card on screen.
  const remaining = hand.length - idx;
  const ringPct = hand.length ? (remaining / hand.length) * 360 : 0;

  return (
    <div className="screen ruled" key={"deck" + row.id}>
      <div className="nav-bar">
        {/* E-19: leaving parks; it no longer finishes. */}
        <button className="nav-back" onClick={park}>Email</button>
        {/* 5A: the clock is the title. It only runs down, and zero means
            done, never "you failed to finish". E-21: on Finish This One the
            clock is gone and the title says what is left instead. */}
        <span className="nav-title sweep-clock">{lastOne ? "Last One" : fmtClock(Math.max(0, left))}</span>
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
        {/* E-21: time's up, as a card over the one he was on. The card behind
            stays visible so the choice is about a thing he can see. */}
        {timeUp && (
          <div className="card pad deck-card sweep-timeup" role="dialog" aria-label="Time's up">
            <div className="sweep-kicker-row"><span className="eyebrow">Session over</span></div>
            <div className="sweep-verb">{"Time\u2019s up \u00b7 " + (idx + 1) + " of " + hand.length}</div>
            <div className="deck-actions">
              <button className="btn btn-primary btn-block" onClick={() => { setTimeUp(false); setLastOne(true); }}>Finish This One</button>
              <div className="deck-secondary">
                <button className="btn btn-secondary" onClick={() => { setTimeUp(false); setExtraMs((e) => e + MORE_MS); }}>5 More Minutes</button>
                <button className="btn btn-secondary" onClick={finish}>Stop</button>
              </div>
            </div>
          </div>
        )}
        <div className={"card pad deck-card sweep-card" + (killing ? " sweep-kill" : "") + (timeUp ? " sweep-behind" : "")} aria-hidden={timeUp || undefined}>
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

          {/* E-21: behind the time's-up card the actions are gone, not
              dimmed: one filled red on screen (the law), and the question
              on top is the only thing to answer. */}
          {!timeUp && <div className="deck-actions">
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
          </div>}

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
