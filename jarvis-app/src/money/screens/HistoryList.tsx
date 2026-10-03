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
            <div className="facts">
              {l.day && <span className="fact date">{fmtDay(l.day)}</span>}
              {l.changes.map((c) => <span className="fact" key={c}>{lineCase(c)}</span>)}
            </div>
          </div>
        </div>
      ))}
    </Group>
  );
}
