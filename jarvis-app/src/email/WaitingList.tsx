// WAITING (docs/jarvis-unified, slice 08; IMPLEMENTATION-SPEC.md 08 E12,
// 09 M4, 12). Only approved records, in two views: Open, with the overdue
// and today's follow-ups first, and Resolved, newest first. Each row says
// who it waits on, how long in the person's own dates, the follow-up date
// when one was chosen, and New Reply when the thread moved. No red urgency
// without a chosen date. Tapping opens the record; nothing here sends.

import { rowDoor } from "../shared/rowDoor";
import { monthDay } from "../money/bills";
import type { WaitingItem } from "../substrate/waiting/types";
import { EMPTY_RESOLVED, EMPTY_WAITING, FOLLOW_UP_TODAY, NEW_REPLY, OPEN_VIEW, RESOLVED_VIEW, RESOLVED_WORD, WAITING_ON, countWord, followUpOnWord, followUpWas } from "./copy";
import EmptyState from "./EmptyState";
import ListFloor from "../shared/ListFloor";
import { ageWord, followUpState, newReply, orderWaiting, type LatestInThread } from "./waiting";

export type WaitingView = "open" | "resolved";

export function followUpWord(followUpOn: string | undefined, today: string): { word: string; warn: boolean } | null {
  const s = followUpState(followUpOn, today);
  if (s === "none" || !followUpOn) return null;
  if (s === "today") return { word: FOLLOW_UP_TODAY, warn: true };
  if (s === "overdue") return { word: followUpWas(monthDay(followUpOn)), warn: true };
  return { word: followUpOnWord(monthDay(followUpOn)), warn: false };
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
              return (
                <div className="row" key={it.id} {...rowDoor(() => onOpen(it))} data-waiting={it.id}>
                  <div className="row-grow">
                    <div className="conn-name truncate">{d.title}</div>
                    <div className="facts">
                      <span className="fact">{WAITING_ON} {d.counterpartyDisplay || "Someone"}</span>
                      <span className="fact">{view === "open" ? ageWord(d.startedAt, today, zone) : `${RESOLVED_WORD} ${d.resolvedAt ? monthDay(d.resolvedAt.slice(0, 10)) : ""}`.trim()}</span>
                    </div>
                    {(fu || reply) && (
                      <div className="facts">
                        {fu && <span className={"fact" + (fu.warn ? " warn" : "")}>{fu.word}</span>}
                        {reply && <span className="fact warn">{NEW_REPLY}</span>}
                      </div>
                    )}
                  </div>
                  <div className="chev"></div>
                </div>
              );
            })}
          </div>
          <div className="email-note quiet"><span>{countWord(list.length, "Record", "Records")}</span></div>
          <ListFloor />
        </div>
      )}
    </>
  );
}
