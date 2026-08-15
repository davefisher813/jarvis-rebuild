// The V2 information anatomy (approved 2026-08-15), built ONCE like the
// editing primitives. Three pieces every list surface composes:
//
//   RowIcon    - the leading TYPE tile: what a row IS before you read it.
//                App-colored (nav-tile palette); the user's category dot
//                keeps its own meaning and its own spot.
//   StatTiles  - numbers as tinted tiles, big enough to read at a glance.
//                Tint carries meaning: green done, sky events, amber pushed.
//   DayDivide  - one day label above a group instead of the same word
//                repeated on every row.
//
// A surface that hand-rolls any of these is drifting; use these.

import type { ReactNode } from "react";

export type RowKind = "task" | "event" | "note" | "money" | "person" | "project" | "goal" | "gym" | "insight" | "mail";

const TILE: Record<RowKind, string> = {
  task: "nav-tile-blue",
  event: "nav-tile-sky",
  note: "nav-tile-yellow",
  money: "nav-tile-green",
  person: "nav-tile-teal",
  project: "nav-tile-indigo",
  goal: "nav-tile-purple",
  gym: "nav-tile-orange",
  insight: "nav-tile-purple",
  mail: "nav-tile-teal",
};

const svg = (children: ReactNode) => (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);

const ICON: Record<RowKind, ReactNode> = {
  task: svg(<><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>),
  event: svg(<><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>),
  note: svg(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></>),
  money: svg(<><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></>),
  person: svg(<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>),
  project: svg(<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />),
  goal: svg(<><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></>),
  gym: svg(<path d="M6.5 6.5h11v11h-11zM2 12h2m16 0h2M12 2v2m0 16v2" />),
  insight: svg(<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />),
  mail: svg(<><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></>),
};

export function RowIcon({ kind }: { kind: RowKind }) {
  return <div className={"row-ico " + TILE[kind]}>{ICON[kind]}</div>;
}

export interface Stat {
  num: string | number;
  label: string;
  tint?: "good" | "sky" | "warn" | "plain";
}

export function StatTiles({ stats }: { stats: Stat[] }) {
  if (stats.length === 0) return null;
  return (
    <div className="stat-row">
      {stats.map((s) => (
        <div key={s.label} className={"stat-tile stat-" + (s.tint ?? "plain")}>
          <div className="stat-num">{s.num}</div>
          <div className="stat-label">{s.label}</div>
        </div>
      ))}
    </div>
  );
}

export function DayDivide({ label }: { label: string }) {
  return <div className="day-divide">{label}</div>;
}
