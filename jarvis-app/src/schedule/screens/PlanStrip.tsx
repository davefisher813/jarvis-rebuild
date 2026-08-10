import type { EventItem } from "../types";
import type { PlanBlock } from "../planDay";
import type { PlanBlocked } from "./PlanDaySheet";
import { catColor } from "../../shared/categories";
import { fmtTime } from "../calendar";
import { isFocusRange } from "../../routine/types";

// The plan as a picture (2026-08-09). The sheet used to answer "what does my
// day look like" with a list of times to read; this strip answers it at a
// glance: one proportional bar from the planning window's start to its end,
// events and protected time as fixed shapes, picks as colored blocks, gaps
// as visible gaps. Pure and presentational; everything is derived from the
// same inputs the planner itself used, so the picture cannot disagree with
// the plan.

const toMin = (hhmm: string): number => {
  const p = hhmm.split(":");
  return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0);
};

function label12(min: number): string {
  const t = fmtTime(`${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`);
  return `${t.time} ${t.ap}`;
}

export default function PlanStrip({ startMin, endMin, events, blocked, blocks, onTapMin }: {
  startMin: number;
  endMin: number;
  events: EventItem[];
  blocked: PlanBlocked[];
  blocks: PlanBlock[];
  // Tap-to-place (2026-08-09): when set, tapping the bar reports the minute
  // under the finger, snapped to 15. The sheet uses it to drop the armed
  // pick where the user pointed.
  onTapMin?: (min: number) => void;
}) {
  const span = endMin - startMin;
  if (span <= 0) return null;
  const pct = (min: number) => Math.max(0, Math.min(100, ((min - startMin) / span) * 100));
  const seg = (s: number, e: number) => ({ left: pct(s) + "%", width: Math.max(1, pct(e) - pct(s)) + "%" });

  const tap = (ev: React.MouseEvent<HTMLDivElement>) => {
    if (!onTapMin) return;
    const rect = ev.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
    onTapMin(Math.round((startMin + ratio * span) / 15) * 15);
  };

  return (
    <div className="plan-strip" aria-hidden={onTapMin ? undefined : true}>
      <div
        className={"plan-strip-bar" + (onTapMin ? " strip-live" : "")}
        onClick={tap}
        {...(onTapMin ? { role: "button" as const, tabIndex: 0, "aria-label": "Tap where the pick should go" } : {})}
      >
        {blocked.map((b, i) => (
          // Focus zones draw as invitations (outline, no fill), not walls:
          // that time is FOR picks, and picks render on top of it.
          <div key={"b" + i} className={"plan-strip-seg " + (isFocusRange(b) ? "strip-focus" : "strip-protected" + (b.soft ? " strip-soft" : ""))} style={seg(b.s, b.e)} title={b.label} />
        ))}
        {events.map((e) => {
          const s = toMin(e.data.start);
          const en = e.data.end ? toMin(e.data.end) : s + 60;
          return <div key={e.id} className="plan-strip-seg strip-event" style={seg(s, en)} title={e.data.title} />;
        })}
        {blocks.map((b) => (
          <div key={b.taskId} className={"plan-strip-seg strip-pick cat-bg-" + catColor(b.category)} style={seg(toMin(b.start), toMin(b.end))} title={b.text} />
        ))}
      </div>
      <div className="plan-strip-scale">
        <span>{label12(startMin)}</span>
        <span>{label12(endMin)}</span>
      </div>
    </div>
  );
}
