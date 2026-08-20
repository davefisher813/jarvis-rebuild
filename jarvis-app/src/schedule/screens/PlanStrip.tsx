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

export default function PlanStrip({ startMin, endMin, events, blocked, blocks, onTapMin, onDragBlock }: {
  startMin: number;
  endMin: number;
  events: EventItem[];
  blocked: PlanBlocked[];
  blocks: PlanBlock[];
  // Tap-to-place (2026-08-09): when set, tapping the bar reports the minute
  // under the finger, snapped to 15. The sheet uses it to drop the armed
  // pick where the user pointed.
  onTapMin?: (min: number) => void;
  // Drag-to-place (P10, Dave 2026-08-20). The strip already took a tap; a
  // drag sets the time by feel instead of by typing into a time field. The
  // block reports the minute its LEADING EDGE should sit at, so what you
  // grab is what lands where you let go.
  onDragBlock?: (taskId: string, min: number) => void;
}) {
  const span = endMin - startMin;
  if (span <= 0) return null;
  const pct = (min: number) => Math.max(0, Math.min(100, ((min - startMin) / span) * 100));
  const seg = (s: number, e: number) => ({ left: pct(s) + "%", width: Math.max(1, pct(e) - pct(s)) + "%" });

  // One conversion from a screen x to a minute, snapped to the same 15 the
  // rest of the planner uses. Shared by tap and drag so they cannot disagree.
  const minAtX = (clientX: number, rect: DOMRect): number => {
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round((startMin + ratio * span) / 15) * 15;
  };

  const dragBlock = (taskId: string) => (down: React.PointerEvent<HTMLDivElement>) => {
    if (!onDragBlock) return;
    const bar = down.currentTarget.parentElement;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    if (rect.width <= 0) return;
    // The finger did not necessarily land on the block's leading edge. Keep
    // the offset so the block does not jump under the thumb on the first move.
    const grabbed = down.currentTarget.getBoundingClientRect();
    const grabOffset = down.clientX - grabbed.left;
    down.stopPropagation();
    down.currentTarget.setPointerCapture?.(down.pointerId);
    let moved = false;
    const move = (e: PointerEvent) => {
      moved = true;
      e.preventDefault();
      onDragBlock(taskId, minAtX(e.clientX - grabOffset, rect));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      // A press with no movement is a tap, and taps on the bar mean "place
      // the armed pick here". Swallowing it would break the older gesture.
      if (!moved && onTapMin) onTapMin(minAtX(down.clientX, rect));
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const tap = (ev: React.MouseEvent<HTMLDivElement>) => {
    if (!onTapMin) return;
    const rect = ev.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
    onTapMin(Math.round((startMin + ratio * span) / 15) * 15);
  };

  return (
    <div className="plan-strip" aria-hidden={onTapMin || onDragBlock ? undefined : true}>
      <div
        className={"plan-strip-bar" + (onTapMin ? " strip-live" : "") + (onDragBlock ? " strip-drag" : "")}
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
          <div
            key={b.taskId}
            className={"plan-strip-seg strip-pick cat-bg-" + catColor(b.category) + (onDragBlock ? " strip-draggable" : "")}
            style={seg(toMin(b.start), toMin(b.end))}
            title={b.text}
            onPointerDown={onDragBlock ? dragBlock(b.taskId) : undefined}
          />
        ))}
      </div>
      <div className="plan-strip-scale">
        <span>{label12(startMin)}</span>
        <span>{label12(endMin)}</span>
      </div>
    </div>
  );
}
