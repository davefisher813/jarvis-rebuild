import { useState } from "react";
import type { Workout } from "./types";
import { exerciseHistory, trendLine } from "./history";
import { monthDay } from "../money/bills";

const CHEV_DOWN = (
  <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
);
const CHEV = (
  <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
);

// History (gym session 2): one row per exercise, the trend as plain numbers,
// tap to unfold the dated receipts. Gaps between dates are just gaps.
export default function HistoryScreen({ workouts, onBack }: { workouts: Workout[]; onBack: () => void }) {
  const rows = exerciseHistory(workouts);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="screen">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">History</div>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state"><div className="empty-title">No numbers yet</div></div>
      ) : (
        <div className="pad-x"><div className="card">
          {rows.map((r) => {
            const key = r.name + r.kind;
            const isOpen = open === key;
            return (
              <div key={key}>
                <div className="row" role="button" tabIndex={0} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : key)}>
                  <div className="row-grow">
                    <div className="conn-name truncate">{r.name}</div>
                    <div className="eyebrow">{trendLine(r)}</div>
                  </div>
                  {isOpen ? CHEV_DOWN : CHEV}
                </div>
                {isOpen && r.entries.map((e, i) => (
                  <div className="row" key={e.date + i}>
                    <div className="row-grow"><div className="conn-name">{e.text}</div><div className="eyebrow">{monthDay(e.date)}</div></div>
                  </div>
                ))}
              </div>
            );
          })}
        </div></div>
      )}
      <div className="screen-foot" />
    </div>
  );
}
