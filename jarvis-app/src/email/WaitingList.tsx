// WAITING (docs/jarvis-unified, slice 08; IMPLEMENTATION-SPEC.md 08 E12,
// 09 M4, 12). Only approved records, in two views: Open, with the overdue
// and today's follow-ups first, and Resolved, newest first. Each row says
// who it waits on, how long in the person's own dates, the follow-up date
// when one was chosen, and New Reply when the thread moved. No red urgency
// without a chosen date. Tapping opens the record; nothing here sends.

import { rowDoor } from "../shared/rowDoor";
import { monthDay } from "../money/bills";
import type { WaitingItem } from "../substrate/waiting/types";
import { EMPTY_RESOLVED, EMPTY_WAITING, FOLLOW_UP_TODAY, NEW_REPLY, OPEN_VIEW, RESOLVED_VIEW, RESOLVED_WORD, WAITING_ON, followUpOnWord, followUpWas } from "./copy";
import EmailFacts from "./EmailFacts";
import type { EmailFact } from "./format";
import EmptyState from "./EmptyState";
import ListFloor from "../shared/ListFloor";
import { ageWord, followUpState, newReply, orderWaiting, windowTone, type LatestInThread } from "./waiting";

export type WaitingView = "open" | "resolved";

/**
 * The follow-up date in the key's colour (2026-10-05): late is red, today or tomorrow amber, later a neutral
 * date in small caps. It was amber for "was due" and a plain grey for everything later, which drew a missed
 * follow-up in the colour of a due one and a due one in the colour of nothing.
 */
export function followUpWord(followUpOn: string | undefined, today: string): { word: string; tone: "red" | "warn" | "date" } | null {
  const s = followUpState(followUpOn, today);
  if (s === "none" || !followUpOn) return null;
  if (s === "today") return { word: FOLLOW_UP_TODAY, tone: "warn" };
  if (s === "overdue") return { word: followUpWas(monthDay(followUpOn)), tone: "red" };
  return { word: followUpOnWord(monthDay(followUpOn)), tone: windowTone(followUpOn, today) };
}

export default function WaitingList({ items, latest, own, today, zone, view, onView, onOpen, onShowInbox }: {
  items: WaitingItem[];
  /** The newest cached message per thread, for New Reply. */
  latest: Record<string, LatestInThread>;
  own: readonly string[];
  today: string;
  zone: string;
  view: WaitingView;
  onView: (v: WaitingView) => void;
  onOpen: (item: WaitingItem) => void;
  onShowInbox: () => void;
}) {
  const { open, resolved } = orderWaiting(items, today);
  const list = view === "open" ? open : resolved;
  return (
    <>
      <div className="chip-row email-waiting-chips" role="group" aria-label={WAITING_ON}>
        <button className={"chip" + (view === "open" ? " active" : "")} onClick={() => onView("open")}>{OPEN_VIEW} <span className="email-chip-n">{open.length}</span></button>
        <button className={"chip" + (view === "resolved" ? " active" : "")} onClick={() => onView("resolved")}>{RESOLVED_VIEW} <span className="email-chip-n">{resolved.length}</span></button>
      </div>
      {list.length === 0 ? (
        view === "open"
          ? <EmptyState copy={EMPTY_WAITING} onAction={onShowInbox} />
          : <EmptyState copy={EMPTY_RESOLVED} onAction={() => onView("open")} />
      ) : (
        <div className="pad-x">
          <div className="card list-card-ruled">
            {list.map((it) => {
              const d = it.data;
              const fu = view === "open" ? followUpWord(d.followUpOn, today) : null;
              const reply = newReply(d, d.threadId ? latest[d.threadId] : undefined, own);
              // ONE facts line, the colour first and the free-text name last (2026-10-05): the follow-up date wears
              // its key colour, the age is a neutral small-caps fact, "Waiting On" is the line's one grey. New
              // Reply is amber too, so it sits on its own line (one coloured fact per line), and only when there is one.
              const line: EmailFact[] = [
                ...(fu ? [{ text: fu.word, tone: fu.tone }] : []),
                view === "open" ? { text: ageWord(d.startedAt, today, zone), tone: "date" as const } : { text: `${RESOLVED_WORD}${d.resolvedAt ? " " + monthDay(d.resolvedAt.slice(0, 10)) : ""}`, tone: "good" as const },
                { text: `${WAITING_ON} ${d.counterpartyDisplay || "Someone"}` },
              ];
              return (
                <div className="row" key={it.id} {...rowDoor(() => onOpen(it))} data-waiting={it.id}>
                  <div className="row-grow">
                    <div className="conn-name truncate">{d.title}</div>
                    <EmailFacts wrap facts={line} />
                    {reply && <EmailFacts wrap facts={[{ text: NEW_REPLY, tone: "warn" }]} />}
                  </div>
                  <div className="chev"></div>
                </div>
              );
            })}
          </div>
          <ListFloor />
        </div>
      )}
    </>
  );
}
