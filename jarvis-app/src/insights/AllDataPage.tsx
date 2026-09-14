import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import HealthNav, { type HealthView } from "./HealthNav";
import { CATEGORIES, CATEGORY_LABEL, filterRecords, groupByDay, type DataCategory, type DataRecord, type RecordFilter } from "./records";
import { periodFor, type RangeKey } from "./analytics";
import { monthDay } from "../money/bills";
import { weekdayShortDate } from "../shared/dateFormat";
import { fmtTime } from "../schedule/calendar";
import { pressable } from "../shared/pressable";
import { capAfterNumber } from "../shared/casing";

// ALL DATA (2026-09-14, item 8). Every record, searchable and filterable
// by category, period and one day, grouped by day, each with its date,
// value, unit and source. A row opens its editor; a row that has no editor
// of its own offers Delete, and the caller's Undo puts it back. The filters
// and the scroll position live with the caller, so coming back from a
// record lands where the person left.
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
  const deletable = (r: DataRecord) => r.open.kind !== "workout" && r.open.kind !== "metric" && !("pending" in r.open && r.open.pending);

  return (
    <>
      <HealthNav view={view} onView={onView} />
      <div className="nav-large">All Data</div>
      <div className="pad-x">
        <input className="input" type="search" aria-label="Search records" placeholder="Search" value={filter.query} onChange={(e) => onFilter({ ...filter, query: e.target.value })} />
      </div>
      <div className="pad-x">
        <div className="chip-row chip-wrap-row" role="group" aria-label="Period">
          {(["7d", "28d", "90d", "all"] as (RangeKey | "all")[]).map((k) => (
            <div key={k} {...pressable(() => setRange(k))} className={"chip" + (filter.range === k && !filter.date ? " active" : "")} aria-pressed={filter.range === k && !filter.date}>
              {k === "7d" ? "7 Days" : k === "28d" ? "28 Days" : k === "90d" ? "90 Days" : "All Time"}
            </div>
          ))}
          {filter.date && (
            <div {...pressable(() => onFilter({ ...filter, date: null }))} className="chip active" aria-pressed>{`${monthDay(filter.date)} · Clear`}</div>
          )}
        </div>
      </div>
      <div className="pad-x">
        <div className="chip-row chip-wrap-row" role="group" aria-label="Kind of record">
          <div {...pressable(() => onFilter({ ...filter, category: "all" }))} className={"chip" + (filter.category === "all" ? " active" : "")} aria-pressed={filter.category === "all"}>All</div>
          {CATEGORIES.map((c) => {
            const n = counts.get(c) ?? 0;
            if (n === 0 && filter.category !== c) return null;
            return (
              <div key={c} {...pressable(() => onFilter({ ...filter, category: c }))} className={"chip" + (filter.category === c ? " active" : "")} aria-pressed={filter.category === c}>{`${CATEGORY_LABEL[c]} · ${n}`}</div>
            );
          })}
        </div>
      </div>
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
              <div className="row h-log-row" key={r.id}>
                <span className="h-log-ico ad-dot" data-hue={r.hue} aria-hidden="true"><i /></span>
                <div {...pressable(() => onOpen(r))} className="row-grow">
                  <div className="conn-name">{r.title}</div>
                  <div className="facts">
                    <span className={"fact " + r.hue}>{clock(r.at)}</span>
                    {r.value && <span className={"fact " + r.hue}>{r.value}</span>}
                    {r.detail && <span className="fact">{r.detail}</span>}
                    {r.source !== "Logged by hand" && <span className="fact">{r.source}</span>}
                  </div>
                </div>
                {deletable(r)
                  ? <button type="button" className="pill-act pill-quiet" aria-label={`Delete ${r.title}`} onClick={() => onDelete(r)}>Delete</button>
                  : <span {...pressable(() => onOpen(r))} aria-label={`Open ${r.title}`}>{CHEV}</span>}
              </div>
            ))}
          </div></div>
        </div>
      ))}
      <div className="pad-x h-foot-acts">
        <button type="button" className="btn btn-secondary" onClick={onExport}>Export Data</button>
      </div>
      <div className="screen-foot" />
    </>
  );
}
