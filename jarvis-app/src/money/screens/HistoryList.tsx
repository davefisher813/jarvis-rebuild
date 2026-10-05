import { Group } from "../../shared/FormSheet";
import { lineCase } from "../../shared/casing";
import { fmtDay } from "../tracker";
import { historyLines } from "../historyLines";
import type { HistoryEntry } from "../ledger/types";

// A RECORD'S HISTORY, AS A GROUP OF A SHEET. Every money write lands a line in
// the record itself (history.ts); this is where the person reads them: the
// day, what was done, and for a correction the before and after. Oldest first,
// the order things happened. A record with none shows nothing.
export default function HistoryList({ history }: { history: HistoryEntry[] | undefined }) {
  const lines = historyLines(history);
  if (lines.length === 0) return null;
  return (
    <Group label="History">
      {lines.map((l) => (
        <div className="row xs-row" key={l.key}>
          <div className="row-grow">
            <div className="conn-name">{lineCase(l.what)}</div>
            {/* ONE GREY, AND NOTHING CLIPPED (2026-10-05, visual catalog gate,
                R1, R5 and the facts-never-clip ruling). Each changed field was
                its own grey fact on a nowrap .facts line, so a correction of
                two fields was two greys and the second was cut off. The day is
                the small-caps date on its own line and each change is ONE white
                fact on a line of its own (no grey at all, nothing clipped, and
                no separator left hanging at the end of a wrapped line). */}
            {l.day && <div className="conn-meta"><span className="fact date">{fmtDay(l.day)}</span></div>}
            {l.changes.map((c) => <div className="conn-meta" key={c}><span className="fact"><b>{lineCase(c)}</b></span></div>)}
          </div>
        </div>
      ))}
    </Group>
  );
}
