import { useEffect, useState } from "react";
import { Mail, Clock, CalendarClock, CornerUpLeft, CalendarCheck, BellRing, PenLine } from "../shared/icons";
import NoticeCard from "./NoticeCard";
import { showToast } from "../shared/toast";
import { haptics } from "../shared/haptics";
import {
  loadMailSnapshot, mailNotices, residualLine, loadDismissed, dismissNotice, setDismissed,
  type MailKind, type MailNotice,
} from "../messages/home";
import { loadSnoozes, snoozeNotice, sleepingNow, snoozeChoices } from "../messages/snoozeNotice";
import { quickAnswers } from "../messages/quickAnswers";

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
};

export interface MailDraft { text: string; sending: boolean }

export default function MailNotices({
  today,
  nowHHMM,
  onAddTask,
  onOpenThread,
  onOpenEmail,
  onEmptyChange,
  onDraft,
  onSend,
  onTakeMeeting,
  max = 3,
}: {
  today: string;
  nowHHMM: string;
  // Returns true when the task actually landed, so the receipt never claims
  // a save that failed.
  onAddTask: (text: string, due?: string) => Promise<boolean>;
  onOpenThread?: (threadId: string) => void;
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
  onTakeMeeting?: (threadId: string) => Promise<boolean>;
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
    if (n.task) {
      haptics.selection();
      void (async () => {
        const ok = await onAddTask(n.task!.text, n.task!.due);
        if (!ok) return;
        finish(n, n.task?.due ? "Added to your tasks · Due " + n.task.due : "Added to your tasks");
      })();
      return;
    }
    if (n.kind === "meeting" && onTakeMeeting) {
      haptics.selection();
      setBusy(n.key);
      void (async () => {
        const ok = await onTakeMeeting(n.threadId);
        setBusy(null);
        if (ok) finish(n, "Booked and replied");
        else showToast({ message: "Couldn't book it · Opening the thread" });
        if (!ok) onOpenThread?.(n.threadId);
      })();
      return;
    }
    if (writable(n)) { void write(n); return; }
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
      {/* CLEAR THEM ALL (Dave 2026-08-24). Every card already has its own
          dismiss; this is the stream at once, for the morning where none of
          it is going to happen. Checkboxes would be the wrong shape here:
          these are cards, not list rows, and ticking six of them to clear
          six of them is more work than dismissing six of them.

          Only from two up. At one notice this is a second control that does
          exactly what the dismiss on the card already does. */}
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
