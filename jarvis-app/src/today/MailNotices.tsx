import { useEffect, useState } from "react";
import { Mail, Clock, CalendarClock, CornerUpLeft, CalendarCheck, BellRing, PenLine, CalendarPlus } from "../shared/icons";
import NoticeCard from "./NoticeCard";
import { showToast } from "../shared/toast";
import { haptics } from "../shared/haptics";
import {
  loadMailSnapshot, mailNotices, residualLine, loadDismissed, dismissNotice, setDismissed,
  type MailKind, type MailNotice,
} from "../messages/home";
import type { MailAct } from "../messages/mailAct";
import { loadSnoozes, snoozeNotice, sleepingNow, snoozeChoices } from "../messages/snoozeNotice";
import { quickAnswers } from "../messages/quickAnswers";
import { dayPhrase } from "../money/bills";

// Email on the home page, rebuilt (Dave 2026-08-20). The count is gone; what
// is left is the work itself. See messages/home.ts for the reasoning.
//
// U1/U2/U3 (2026-08-20): the card does the work too. A reply or a nudge is
// drafted here, on the card, and sent from here. Before this the card told
// him which email needed him and then sent him somewhere else to deal with
// it, which is the same trip the old count line made him take.
//
// Two of the four kinds finish HERE with a task. The other two now finish
// here with a message. Opening the thread stays available and is what happens
// when anything at all goes wrong.

const ICON: Record<MailKind, React.ReactNode> = {
  deadline: <CalendarClock className="ic" />,
  reply: <CornerUpLeft className="ic" />,
  promised: <Clock className="ic" />,
  nudge: <Mail className="ic" />,
  meeting: <CalendarCheck className="ic" />,
  chase: <BellRing className="ic" />,
  draft: <PenLine className="ic" />,
  act: <CalendarPlus className="ic" />,
};

export interface MailDraft { text: string; sending: boolean }

export default function MailNotices({
  today,
  nowHHMM,
  onAddTask,
  onOpenThread,
  onOpenDraft,
  onOpenEmail,
  onEmptyChange,
  onDraft,
  onSend,
  onTakeMeeting,
  onTakeAct,
  onDelete,
  max = 3,
}: {
  today: string;
  nowHHMM: string;
  // Returns true when the task actually landed, so the receipt never claims
  // a save that failed.
  // Pick 26: the thread rides along, so the task can inherit what its
  // siblings from the same conversation were filed under.
  onAddTask: (text: string, due?: string, threadId?: string) => Promise<boolean>;
  onOpenThread?: (threadId: string) => void;
  // "Finish It" on an unsent draft. Separate from onOpenThread because a
  // draft with no thread has no thread to open.
  onOpenDraft?: (draftId: string) => void;
  onOpenEmail?: () => void;
  // Told to the parent so the section head can disappear with the content.
  onEmptyChange?: (empty: boolean) => void;
  // U1/U3: draft a reply or a nudge for this notice. Empty string means the
  // model gave us nothing usable, and the card says so rather than offering
  // a blank message to send over his name.
  onDraft?: (n: MailNotice) => Promise<string>;
  // U1/U2/U3: send it. Returns true only on a real send.
  onSend?: (n: MailNotice, body: string) => Promise<boolean>;
  // N1: book the slot, accept it in writing, and block the time. One tap for
  // what is otherwise three decisions.
  // Returns the receipt to show, or null when nothing was booked. A string
  // rather than a boolean because the booking is the only thing that knows
  // whether the acceptance reply actually sent.
  onTakeMeeting?: (threadId: string) => Promise<string | null>;
  // Dave 2026-08-25: the appointment, the bill, the package. Returns the
  // receipt to show and, when the write can be taken back, how to take it
  // back. null means nothing landed, and the card says so rather than
  // claiming a save.
  onTakeAct?: (a: MailAct, threadId: string) => Promise<{ receipt: string; undo?: () => Promise<void> } | null>;
  // Trashes the mail itself (2026-08-26, Dave: "I should be able to delete
  // from here"). Dismiss, above, only ever hid the card; the email stayed
  // in the inbox and this notice reappeared the next time the snapshot
  // refreshed. null means no account could be resolved for the thread.
  onDelete?: (n: MailNotice) => Promise<{ ok: boolean; undo?: () => Promise<void> } | null>;
  max?: number;
}) {
  const [hidden, setHidden] = useState<string[]>(() => loadDismissed(today));
  const [snoozed, setSnoozed] = useState<Record<string, string>>(() => loadSnoozes(today));
  const [done, setDone] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, MailDraft>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const snap = loadMailSnapshot();
  const asleep = sleepingNow(snoozed, nowHHMM);
  const notices = mailNotices(snap, today, new Date(), max, [...hidden, ...done, ...asleep]);
  const residual = residualLine(snap, notices.map((n) => n.threadId));
  // Reported from an EFFECT, never during render: telling a parent to set
  // state while rendering is how a render loop starts.
  const isEmpty = notices.length === 0 && !residual;
  useEffect(() => { onEmptyChange?.(isEmpty); }, [isEmpty, onEmptyChange]);
  const choices = snoozeChoices(nowHHMM);

  const canWrite = !!onDraft && !!onSend;
  const writable = (n: MailNotice) => canWrite && (n.kind === "reply" || n.kind === "nudge" || n.kind === "chase");

  const finish = (n: MailNotice, message: string) => {
    setDone((d) => [...d, n.key]);
    setDrafts((d) => { const x = { ...d }; delete x[n.key]; return x; });
    showToast({ message });
  };

  const act = (n: MailNotice) => {
    // BEFORE n.task, because a dated commitment is more specific than a task.
    // An appointment reminder that also names a deadline would otherwise land
    // as a to-do about an appointment instead of the appointment.
    if (n.act && onTakeAct) {
      haptics.selection();
      setBusy(n.key);
      void (async () => {
        const done = await onTakeAct(n.act!, n.threadId);
        setBusy(null);
        if (!done) {
          showToast({ message: "Couldn't add it · Opening the thread" });
          onOpenThread?.(n.threadId);
          return;
        }
        // Undo is not politeness here. This is the only card that writes to
        // the schedule without opening anything, so the wrong one has to be
        // one tap from gone, in the same place the receipt appears.
        setDone((d) => [...d, n.key]);
        setDrafts((d) => { const x = { ...d }; delete x[n.key]; return x; });
        showToast({
          message: done.receipt,
          ...(done.undo ? { actionLabel: "Undo", onAction: () => { void done.undo!(); setDone((d) => d.filter((k) => k !== n.key)); } } : {}),
        });
      })();
      return;
    }
    if (n.task) {
      haptics.selection();
      void (async () => {
        const ok = await onAddTask(n.task!.text, n.task!.due, n.threadId);
        // A tap that produced nothing used to say nothing (2026-08-25). The
        // act path beside this one already tells you and offers the thread.
        if (!ok) {
          showToast({ message: "Couldn't add it · Opening the thread" });
          onOpenThread?.(n.threadId);
          return;
        }
        finish(n, "Added to your tasks" + (n.task?.due ? " · Due " + dayPhrase(n.task.due, today) : ""));
      })();
      return;
    }
    if (n.kind === "meeting" && onTakeMeeting) {
      haptics.selection();
      setBusy(n.key);
      void (async () => {
        // The receipt comes back FROM the booking, because only the booking
        // knows whether the reply went out. This used to print "Booked and
        // replied" over the top of the handler's own "Couldn't send the
        // reply", in the same tick, and the toast holds one message.
        const receipt = await onTakeMeeting(n.threadId);
        setBusy(null);
        if (receipt) finish(n, receipt);
        else {
          showToast({ message: "Couldn't book it · Opening the thread" });
          onOpenThread?.(n.threadId);
        }
      })();
      return;
    }
    if (writable(n)) { void write(n); return; }
    // A draft opens the DRAFT. The thread view is read-only and the unsent
    // words are only ever loaded by openDraft.
    if (n.draftId && onOpenDraft) { onOpenDraft(n.draftId); return; }
    onOpenThread?.(n.threadId);
  };

  // U1/U3: draft it here. A failure is never silent and never fabricated: the
  // card says the draft did not come back and offers the thread instead.
  const write = async (n: MailNotice) => {
    if (drafts[n.key] || busy) return;
    haptics.selection();
    setBusy(n.key);
    try {
      const text = (await onDraft!(n)).trim();
      if (!text) {
        showToast({ message: "Couldn't draft that one · Opening it instead" });
        onOpenThread?.(n.threadId);
        return;
      }
      setDrafts((d) => ({ ...d, [n.key]: { text, sending: false } }));
    } finally {
      setBusy(null);
    }
  };

  // Same shape as onTakeAct just above it: a real receipt, undo where the
  // mutation supports one, and the card only clears on a confirmed success
  // so a failed trash never quietly disappears from Today while sitting
  // untouched in Gmail.
  const remove = (n: MailNotice) => {
    if (!onDelete) return;
    haptics.selection();
    setBusy(n.key);
    void (async () => {
      const done = await onDelete(n);
      setBusy(null);
      if (!done || !done.ok) {
        showToast({ message: "Couldn't delete it · Still in your inbox" });
        return;
      }
      setDone((d) => [...d, n.key]);
      setDrafts((d) => { const x = { ...d }; delete x[n.key]; return x; });
      showToast({
        message: "Deleted · In trash 30 days",
        ...(done.undo ? { actionLabel: "Undo", onAction: () => { void done.undo!(); setDone((d) => d.filter((k) => k !== n.key)); } } : {}),
      });
    })();
  };

  const send = async (n: MailNotice, body: string) => {
    if (!body.trim()) return;
    haptics.selection();
    setDrafts((d) => ({ ...d, [n.key]: { text: body, sending: true } }));
    const ok = await onSend!(n, body.trim());
    if (!ok) {
      setDrafts((d) => ({ ...d, [n.key]: { text: body, sending: false } }));
      showToast({ message: "Couldn't send · Nothing was lost" });
      return;
    }
    finish(n, n.kind === "nudge" ? "Nudge sent" : "Reply sent");
  };

  // EMPTINESS IS THE COMPONENT'S OWN FACT (2026-08-21). Email now sits under
  // its own head on Today, and a head with nothing under it is exactly the
  // dead-end surface the catalog bans. Rather than let the parent guess at
  // this rule and drift from it, the component reports it.
  const empty = notices.length === 0 && !residual;
  if (empty) return null;

  return (
    <>
      {/* Law 3E (2026-08-22): the band's summary sentence is gone. "One
          needs an answer and someone has been waiting 59 days on you" was a
          paragraph ABOUT the rows sitting directly above the rows; the rows
          say it themselves now, in one line each. */}
      {notices.map((n) => {
        const draft = drafts[n.key];
        const loading = busy === n.key;
        // U2: the quick answers this thread already has. One tap is a whole
        // reply; nothing here is a fragment he has to finish.
        const thread = snap.threads.find((t) => t.id === n.threadId);
        const chips = n.kind === "reply" && canWrite ? quickAnswers(thread?.replies) : [];
        // The wait's own thresholds put heat on the age: the same rungs the
        // Email tab's ladder always used.
        const days = snap.waiting.find((w) => w.threadId === n.threadId)?.days ?? 0;
        return (
          <NoticeCard
            key={n.key}
            /* Card, never vrow (2026-08-22). A mail notice's title is a
               SENDER, which is any length the world chooses, and its sub is
               a subject. On a 390px row the two shared one line with the
               capsule and Dave's phone rendered "nikestrength H… Missi…":
               two fragments carrying less than one whole sender. Stacked,
               the sender owns its line and the fact sits under it in the
               same card footprint. The vrow stays for producers whose sub
               is a short fused datum (Slid 3d, 9h ago), which is what the
               one-line contract was written for. */
            form="card"
            // Mail stays stacked (Dave 2026-08-25). A sender is any length
            // the world chooses; see the note on the prop.
            uniform={false}
            icon={ICON[n.kind]}
            tone={n.tone}
            title={n.title}
            sub={draft ? undefined : n.sub}
            heat={n.kind === "nudge" ? (days >= 21 ? "hot" : days >= 7 ? "warm" : null) : null}
            action={{
              label: loading
                ? (n.kind === "meeting" ? "Booking…" : "Writing…")
                : writable(n) && !draft ? (n.kind === "reply" ? "Draft It" : n.action) : n.action,
              onClick: () => act(n),
            }}
            // U4: "not right now" is not "not today". A snooze names a time
            // and the notice comes back once, at that time.
            alt={choices[0] ? {
              label: choices[0].label,
              onClick: () => { haptics.selection(); setSnoozed(snoozeNotice(n.key, choices[0]!.at, today)); },
            } : undefined}
            onDismiss={() => { haptics.selection(); setHidden(dismissNotice(n.key, today)); }}
            onDelete={onDelete ? () => remove(n) : undefined}
            onOpen={onOpenThread ? () => onOpenThread(n.threadId) : undefined}
            foot={
              <>
                {chips.length > 0 && !draft && (
                  <div className="row mail-chips">
                    {chips.map((c) => (
                      <button key={c} className="chip chip-act" onClick={(e) => { e.stopPropagation(); void send(n, c); }}>{c}</button>
                    ))}
                  </div>
                )}
                {draft && (
                  <div className="mail-draft" onClick={(e) => e.stopPropagation()}>
                    {/* His words before they go out over his name. Editable,
                        because a draft you cannot change is a draft you have
                        to leave the page to fix. */}
                    <textarea
                      className="mail-draft-text"
                      aria-label={n.kind === "nudge" ? "Nudge" : "Reply"}
                      value={draft.text}
                      disabled={draft.sending}
                      onChange={(e) => setDrafts((d) => ({ ...d, [n.key]: { ...draft, text: e.target.value } }))}
                    />
                    <div className="row mail-draft-acts">
                      <button className="pill-act" disabled={draft.sending} onClick={() => void send(n, draft.text)}>
                        {draft.sending ? "Sending…" : "Send"}
                      </button>
                      <button className="plan-drop" disabled={draft.sending} onClick={() => setDrafts((d) => { const x = { ...d }; delete x[n.key]; return x; })}>
                        Discard
                      </button>
                      {onOpenThread && (
                        <button className="plan-drop" disabled={draft.sending} onClick={() => onOpenThread(n.threadId)}>Open It</button>
                      )}
                    </div>
                  </div>
                )}
              </>
            }
          />
        );
      })}

      {/* CLEAR THEM ALL (Dave 2026-08-24), moved under the cards it clears
          (Dave 2026-08-26, from a screenshot: "Clear all should be under
          the email tabs not above it"). It used to sit between the EMAIL
          head and the first card -- an escape hatch offered before you had
          seen a single thing it was offering to clear. Every card already
          has its own dismiss; this is the stream at once, for the morning
          where none of it is going to happen, and it now reads the way any
          bulk action does: see the list, then act on the list.

          Only from two up. At one notice this is a second control that does
          exactly what the dismiss on the card already does. Above the
          residual line on purpose: residual is a fact about threads NOT
          shown here, which this button does not touch. */}
      {notices.length > 1 && (
        <div className="notice-clear-row">
          <button
            className="row-act"
            onClick={() => {
              haptics.selection();
              const was = hidden;
              const keys = notices.map((n) => n.key);
              setHidden(setDismissed([...was, ...keys], today));
              showToast({
                message: keys.length + " cleared",
                actionLabel: "Undo",
                // The list AS IT WAS, written back in one go. Removing the
                // keys one at a time would be the same thing said less
                // safely, and would drift if a dismiss landed in between.
                onAction: () => setHidden(setDismissed(was, today)),
              });
            }}
          >Clear All</button>
        </div>
      )}

      {/* The rest of the inbox is a receipt: it reports, it does not ask. */}
      {residual && (
        <button data-receipt className="receipt-line" onClick={onOpenEmail}>
          <span className="rl-t">{residual} · Nothing urgent</span>
          <span className="chev" />
        </button>
      )}
    </>
  );
}
