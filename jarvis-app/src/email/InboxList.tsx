// THE LIST ITSELF (docs/jarvis-unified, slice 05; IMPLEMENTATION-SPEC.md 08
// E01, E02). Rows under their day, newest first, in the flat-list container
// every mail list uses, and a floor at the bottom (law L2): "That's
// everything." when the cache is exhausted, else the honest line with Load
// More, which is also the only way to reach row 31 (EMAIL-F-18).

import type { ReactNode } from "react";
import ListFloor from "../shared/ListFloor";
import MailRow from "./MailRow";
import { LOADED_SO_FAR, LOAD_MORE, LOADING_MORE } from "./copy";
import type { DayGroup } from "./format";
import type { InboxRow } from "./emailClient";

export default function InboxList({ groups, labels, now, onOpen, atEnd, moreBusy, onLoadMore, floorWords, renderBelow }: {
  groups: DayGroup[];
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
}) {
  return (
    <div className="pad-x">
      {groups.map((g) => (
        <div key={g.label}>
          <div className="sh2 sh2-quiet"><span className="t">{g.label}</span><span className="n">{g.rows.length}</span></div>
          <div className="list-flat">
            {g.rows.map((r) => (
              <div key={r.id}>
                <MailRow row={r} accountLabel={labels[r.account] ?? ""} now={now} onOpen={onOpen} />
                {renderBelow?.(r)}
              </div>
            ))}
          </div>
        </div>
      ))}
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
