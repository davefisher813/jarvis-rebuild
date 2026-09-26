import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import HealthNav, { type HealthView } from "./HealthNav";
import { CATEGORIES, CATEGORY_LABEL, filterRecords, groupByDay, type DataCategory, type DataRecord, type RecordFilter } from "./records";
import { periodFor, type RangeKey } from "./analytics";
import { monthDay } from "../money/bills";
import { weekdayShortDate } from "../shared/dateFormat";
import { fmtTime } from "../schedule/calendar";
import { pressable } from "../shared/pressable";
import { capAfterNumber } from "../shared/casing";
import RowMenuButton from "../shared/RowMenuButton";
import ActionSheet, { PickSheet } from "../gym/ActionSheet";

// ALL DATA (2026-09-14, item 8). Every record, searchable and filterable
// by category, period and one day, grouped by day, each with its date,
// value, unit and source. A row opens its editor; a row that has no editor
// of its own offers Delete, and the caller's Undo puts it back. The filters
// and the scroll position live with the caller, so coming back from a
// record lands where the person left.
//
// DELETE IS BEHIND THE ROW'S OPTIONS (health polish 2026-09-16; the handoff
// names this one: "Delete moves into entry options with existing confirmation
// and undo behavior. Do not expose accidental destructive pills in browsing
// lists"). It was a capsule in the trailing slot of a scrolling list, which is
// a thumb's width from the row it was scrolling past -- and the trailing slot
// is where every other list in the app puts a harmless verb. The undo is
// untouched: the caller still toasts with an Undo that puts the record back.
const CHEV = <div className="chev" />;

export default function AllDataPage({ view, onView, records, filter, onFilter, today, scrollRef, onOpen, onDelete, onExport, pendingCount = 0 }: {
  view: HealthView;
  onView: (v: HealthView) => void;
  records: DataRecord[];
  filter: RecordFilter & { range: RangeKey | "all" };
  onFilter: (f: RecordFilter & { range: RangeKey | "all" }) => void;
  today: string;
  /** The list's scroll position, kept by the caller across a record. */
  scrollRef: MutableRefObject<number>;
  onOpen: (r: DataRecord) => void;
  /** Absent for a record whose editor carries its own delete. */
  onDelete: (r: DataRecord) => void;
  onExport: () => void;
  pendingCount?: number;
}) {
  const rows = useMemo(() => filterRecords(records, filter), [records, filter]);
  const groups = useMemo(() => groupByDay(rows), [rows]);
  const counts = useMemo(() => {
    const m = new Map<DataCategory, number>();
    for (const r of filterRecords(records, { ...filter, category: "all" })) m.set(r.category, (m.get(r.category) ?? 0) + 1);
    return m;
  }, [records, filter]);
  const scroller = useRef<HTMLElement | null>(null);
  useEffect(() => {
    scroller.current = document.querySelector<HTMLElement>(".screen");
    if (scroller.current && scrollRef.current > 0) scroller.current.scrollTop = scrollRef.current;
    const el = scroller.current;
    return () => { if (el) scrollRef.current = el.scrollTop; };
  }, [scrollRef]);
  const setRange = (range: RangeKey | "all") => onFilter({ ...filter, range, period: range === "all" ? null : periodFor(range, today), date: null });
  const clock = (at: number) => { const d = new Date(at); const t = fmtTime(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`); return `${t.time} ${t.ap}`; };
  // The row's one grey: the detail, and "imported" beside it when the record
  // came from elsewhere. A lift's detail is its set table, drawn below.
  const quietLine = (r: DataRecord) => {
    const detail = r.detail && !r.sets ? r.detail : null;
    if (r.source !== "Imported") return detail;
    return detail ? `${detail}, imported` : "Imported";
  };
  const deletable = (r: DataRecord) => r.open.kind !== "workout" && r.open.kind !== "metric" && !("pending" in r.open && r.open.pending);
  // The row whose options are open. One at a time; the sheet is the app's own.
  const [menuFor, setMenuFor] = useState<DataRecord | null>(null);
  const [pickKind, setPickKind] = useState(false);

  return (
    <>
      <HealthNav view={view} onView={onView} />
      <div className="nav-large">All Data</div>
      <div className="pad-x">
        <input className="input" type="search" aria-label="Search records" placeholder="Search" value={filter.query} onChange={(e) => onFilter({ ...filter, query: e.target.value })} />
      </div>
      <div className="pad-x">
        <div className="chip-row chip-wrap-row" role="group" aria-label="Period">
          {(["7d", "30d", "90d", "all"] as (RangeKey | "all")[]).map((k) => (
            <div key={k} {...pressable(() => setRange(k))} className={"chip" + (filter.range === k && !filter.date ? " active" : "")} aria-pressed={filter.range === k && !filter.date}>
              {k === "7d" ? "7 Days" : k === "30d" ? "30 Days" : k === "90d" ? "90 Days" : "All Time"}
            </div>
          ))}
          {filter.date && (
            <div {...pressable(() => onFilter({ ...filter, date: null }))} className="chip active" aria-pressed>{`${monthDay(filter.date)} · Clear`}</div>
          )}
        </div>
      </div>
      {/* THE KIND FILTER IS A SELECTOR, NOT A CLOUD (health polish 2026-09-16:
          "Two compact filters: date range and entry type. Counts can appear
          inside selection menu rather than a large wrapping cloud").

          Every category with a record in it was a chip carrying its own count,
          so a person who logs a few different things pushed the records they
          came to read two or three rows down the screen -- and the row grew
          the more they used the app, which is exactly backwards. The counts
          are not lost: they are the sub line of each choice in the sheet,
          where there is room to read them.

          The period filter above stays chips. Four fixed options on one line
          is a real segmented selection, which rule 2 says to keep distinct. */}
      <div className="pad-x"><div className="card list-card-ruled">
        <div {...pressable(() => setPickKind(true))} className="row" aria-label="Filter by kind of record">
          <div className="row-grow"><div className="conn-name">{filter.category === "all" ? "All Entries" : CATEGORY_LABEL[filter.category]}</div></div>
          <span className="row-value">{capAfterNumber(`${rows.length} ${rows.length === 1 ? "entry" : "entries"}`)}</span>
          {CHEV}
        </div>
      </div></div>
      {pickKind && (
        <PickSheet
          title="Kind of Record"
          items={[
            { id: "all", label: "All Entries", sub: capAfterNumber(`${records.length} in all`) },
            ...CATEGORIES.filter((c) => (counts.get(c) ?? 0) > 0 || filter.category === c)
              .map((c) => ({ id: c, label: CATEGORY_LABEL[c], sub: capAfterNumber(`${counts.get(c) ?? 0} recorded`) })),
          ]}
          onPick={(ids) => { const id = ids[0]; if (id) onFilter({ ...filter, category: id as DataCategory | "all" }); setPickKind(false); }}
          onCancel={() => setPickKind(false)}
        />
      )}
      {pendingCount > 0 && <div className="pad-x h-sync">{capAfterNumber(`${pendingCount} waiting to sync`)}</div>}
      {groups.length === 0 ? (
        <div className="empty-state">
          <div className="empty-title">{records.length === 0 ? "Nothing Recorded Yet" : "Nothing Matches"}</div>
          <div className="empty-sub">{records.length === 0 ? "Workouts, sleep, meals, doses and your metrics collect here" : "Try a wider period or another category"}</div>
        </div>
      ) : groups.map((g) => (
        <div key={g.date}>
          <div className="sh2 sh2-quiet"><span className="t">{g.date === today ? "Today" : weekdayShortDate(g.date)}</span><span className="n">{g.rows.length}</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {g.rows.map((r) => (
              // Row tap (Dave 2026-09-15, "I want all rows clickable"): the whole
              // row opens the record, not only its words; Delete keeps its pill.
              <div {...pressable(() => onOpen(r))} className="row h-log-row" key={r.id}>
                <span className="h-log-ico ad-dot" data-hue={r.hue} aria-hidden="true"><i /></span>
                <div className="row-grow">
                  <div className="conn-name">{r.title}</div>
                  {/* THE KEY, NOT THE KIND (§AM, 2026-09-26). The time and the
                      reading both wore the record's kind hue -- violet for
                      sleep, pink for discomfort, amber for a meal -- which is
                      a category colour on words, and the dot beside the name
                      already carries the kind. Now: the time is a neutral
                      time, so small caps; logged work is lime and a duration
                      that needs review amber, the gym's own meanings; any
                      other reading is a number with no state, so white. The
                      detail is the row's one grey, and a record that is not
                      synced yet says so in amber (stalled, per the key). An
                      imported record says so inside the grey rather than as
                      a second one. */}
                  <div className="facts">
                    <span className="fact date">{clock(r.at)}</span>
                    {r.value && (r.open.kind === "workout"
                      ? <span className={"fact " + (r.review ? "amber" : "lime")} aria-label={r.review ? `${r.value}, ${r.review.toLowerCase()}` : undefined}>{r.value}</span>
                      : <span className="fact"><b>{r.value}</b></span>)}
                    {/* A LIFT'S SETS ARE A TABLE, NOT A SENTENCE (health polish
                        2026-09-16: "All Data: expandable set tables"). Five
                        sets of a pyramid joined by commas wrapped three grey
                        lines in a list whose whole job is scanning, and the
                        count beside them already said how many. The lines are
                        behind the row's own disclosure now, one per set, each
                        named -- the same exp-more this pass put the counting
                        method and the edit-effects note behind.
                        Everything else keeps its one-fact detail. */}
                    {quietLine(r) && <span className="fact">{quietLine(r)}</span>}
                    {r.source === "Waiting to sync" && <span className="fact amber">{r.source}</span>}
                  </div>
                  {r.sets && (
                    // own(): the disclosure is its own control, and opening it
                    // must not also open the record behind the row.
                    <details className="exp-more ad-sets" onClick={(e) => e.stopPropagation()}>
                      <summary>{`The ${r.sets.length === 1 ? "Set" : "Sets"}`}</summary>
                      <div className="ins-rows">
                        {/* A ramp and a drop wear the quiet key, so the work
                            is what the eye lands on and neither is mistaken
                            for it. Both are still here: a session is a record
                            of what happened, not only of what counted. */}
                        {r.sets.map((x, i) => (
                          <div className="ins-row" key={x.label + i}>
                            <span className={"ins-k" + (x.warm ? " ad-warm" : "")}>{x.label}</span>
                            <span className="ins-sub">{x.text}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
                {deletable(r)
                  ? <RowMenuButton what={r.title} onMenu={() => setMenuFor(r)} />
                  : CHEV}
              </div>
            ))}
          </div></div>
        </div>
      ))}
      <div className="pad-x h-foot-acts">
        <button type="button" className="btn btn-secondary" onClick={onExport}>Export Data</button>
      </div>
      <div className="screen-foot" />
      {menuFor && (
        <ActionSheet
          title={menuFor.title}
          actions={[{ label: "Delete", onClick: () => { const r = menuFor; setMenuFor(null); onDelete(r); } }]}
          onClose={() => setMenuFor(null)}
        />
      )}
    </>
  );
}
