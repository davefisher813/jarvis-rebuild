// THE LIST ITSELF (docs/jarvis-unified, slice 05; IMPLEMENTATION-SPEC.md 08
// E01, E02; Email v1 spec 3.1 and 11). Rows under their heading, newest first
// within it, in one card per heading, and a floor at the bottom (law L2):
// "That's everything." when the cache is exhausted, else the honest line with
// Load More, which is also the only way to reach row 31 (EMAIL-F-18).
//
// A heading is a day (All by Date) or one of the five sections (Grouped, its
// name in the section's colour and "12 Loaded" beside it). In select mode a
// heading carries Select (or Deselect) for its own rows, and a row's tap is
// its selection circle's.

import { Fragment, type ReactNode } from "react";
import ListFloor from "../shared/ListFloor";
import MailRow from "./MailRow";
import { DESELECT_SECTION, LOADED_SO_FAR, LOAD_MORE, LOADING_MORE, SELECT_SECTION } from "./copy";
import type { InboxRow } from "./emailClient";

export interface ListGroup {
  label: string;
  rows: InboxRow[];
  /** The count beside the heading; the row count when absent. */
  count?: string;
  /** A category slot that colours the heading's name (a section); none keeps the heading grey (a day). */
  slot?: string | null;
}

export default function InboxList({ groups, labels, now, onOpen, atEnd, moreBusy, onLoadMore, floorWords, renderBelow, selecting = false, isPicked, onPick, onPickGroup, sameContent, threads, onContact }: {
  groups: ListGroup[];
  /** The label each mailbox wears on its rows; empty labels when there is one mailbox. */
  labels: Record<string, string>;
  now: Date;
  onOpen: (row: InboxRow) => void;
  /** Every cached row is on screen: the floor says so. */
  atEnd: boolean;
  moreBusy?: boolean;
  onLoadMore?: () => void;
  /** The complete list's own words, when the default is not the truth (search results). */
  floorWords?: string;
  /** What sits under a row: its cards (slice 06). */
  renderBelow?: (row: InboxRow) => ReactNode;
  /** Select mode (spec 11). */
  selecting?: boolean;
  isPicked?: (id: string) => boolean;
  onPick?: (row: InboxRow) => void;
  /** A heading's own Select: every row under it, or none of them when all are picked. */
  onPickGroup?: (rows: InboxRow[], pick: boolean) => void;
  /** Rows whose exact Message-ID another connected mailbox also holds (3.3). */
  sameContent?: Record<string, string[]>;
  /** Rows whose thread has two or more loaded messages, with the count (the Grouped view). */
  threads?: Record<string, number>;
  /** A sender's circle was tapped: the contact sheet (issue 112, item 14). Keep it stable, or every row redraws. */
  onContact?: (row: InboxRow) => void;
}) {
  return (
    <div className="pad-x">
      {groups.map((g) => {
        const all = selecting && !!isPicked && g.rows.every((r) => isPicked(r.id));
        return (
          <div key={g.label}>
            <div className="sh2 sh2-quiet">
              <span className="t">{g.slot ? <span className={"email-sec-name cat-fg-" + g.slot}>{g.label}</span> : g.label}</span>
              <span className="n">{g.count ?? g.rows.length}</span>
              {selecting && onPickGroup && (
                <button className="email-sec-pick" onClick={() => onPickGroup(g.rows, !all)}>{all ? DESELECT_SECTION : SELECT_SECTION}</button>
              )}
            </div>
            <div className="card email-list">
              {g.rows.map((r) => (
                // A fragment, not a wrapper: the card's hairline is drawn between two adjacent rows.
                <Fragment key={r.id}>
                  <MailRow row={r} accountLabel={labels[r.account] ?? ""} now={now} onOpen={onOpen}
                    selecting={selecting} picked={selecting && !!isPicked?.(r.id)} onPick={onPick} sameContent={!!sameContent?.[r.id]} threadCount={threads?.[r.id]} onContact={onContact} />
                  {!selecting && renderBelow?.(r)}
                </Fragment>
              ))}
            </div>
          </div>
        );
      })}
      {atEnd ? (
        <ListFloor>{floorWords}</ListFloor>
      ) : (
        <ListFloor>
          <>
            <div>{LOADED_SO_FAR}</div>
            <button className="quiet-action" disabled={!!moreBusy} onClick={onLoadMore}>{moreBusy ? LOADING_MORE : LOAD_MORE}</button>
          </>
        </ListFloor>
      )}
    </div>
  );
}
