import { useRef, useState } from "react";
import { fmtTime, minToHHMM } from "../calendar";
import { useSwipe } from "../../shared/useSwipe";
import { useChipInView } from "../../shared/useChipInView";
import { DUR_CHOICES, durLabel } from "../durations";
import { LockGlyph } from "../../shared/glyphs";
import { modeOf, freeOf } from "../../routine/types";
import type { ReactNode } from "react";

// THE PROTECTED-TIME ROW, EDITABLE THE SAME WAY AN EVENT IS (2026-08-28).
//
// Dave: "When I click on them it brings me to the protected times module.
// It should allow me to edit ALL schedule items THE FUCKING SAME." He was
// right - a protected block was the one row on Schedule and Today that
// could not be touched in place. Every adjustment, even moving it fifteen
// minutes, meant leaving the screen for Your Routine, finding the same
// block again, and coming back.
//
// Same three moves DayRow gives an event - swipe to shift, tap the time to
// retime, tap "Until" to resize - now live here too, writing straight to
// the routine record instead of an event. Skip Today and Push Tomorrow do
// NOT appear: a protected block is a weekly RULE (Mon/Wed/Fri, say), not a
// single dated thing, and there is no per-occurrence override in the data
// model to skip or push just one day of it. Tapping the row still opens
// the full Routine editor, for the edits that stay there: renaming it,
// changing which days it runs, its kind, Flexible, deleting it.
//
// One component, both surfaces, on purpose: SchedulePage and YourDay each
// had their own hand-built locked-row markup before this, and the mode-
// aware kicker text ("Focus time - 2 tasks", "Can blend - ears free") only
// existed on Schedule's copy. Today gets it for free now instead of a
// second one having to be built and, eventually, drift.

export interface LockedRowRange {
  s: number;
  e: number;
  label: string;
  id?: string;
  kind?: string;
  mode?: string;
  soft?: boolean;
  free?: string[];
}

export default function LockedRow({
  l, past, onOpen, onShift, onRetime, onResize, heldCount, onFillBlock, children,
}: {
  l: LockedRowRange;
  past: boolean;
  onOpen?: () => void;
  onShift?: (mins: number) => void;
  onRetime?: (startMin: number) => void;
  onResize?: (endMin: number) => void;
  // "Focus time - N tasks" only makes sense once something is counted; the
  // caller (who already builds the held-tasks list for `children`) counts.
  heldCount?: number;
  onFillBlock?: () => void;
  children?: ReactNode;
}) {
  const m = modeOf(l);
  const holds = m === "holds";
  const t = fmtTime(minToHHMM(l.s));
  const end = fmtTime(minToHHMM(l.e));
  const kicker = holds
    ? (heldCount === 1 ? "Focus time · 1 task" : heldCount ? `Focus time · ${heldCount} tasks` : "Focus time · Tasks land here")
    : m === "blends" ? "Can blend · " + freeOf(l).join(" and ") + " free"
    : "Protected";

  const swipeable = !past && !!onShift;
  const { dx, open, dragging, handlers, closeThen, toggle } = useSwipe({ revealW: 232, enabled: swipeable });
  const [picking, setPicking] = useState(false);
  const [sizing, setSizing] = useState(false);
  const durs = useRef<HTMLDivElement>(null);
  useChipInView(durs, sizing);
  const mins = l.e - l.s;

  return (
    <div className="sched-swipe-wrap">
      <div className="sched-strip">
        {swipeable && (
          <div className="sched-actions" aria-hidden={!open}>
            {onShift && <button className="sched-act" tabIndex={open ? 0 : -1} onClick={() => closeThen(() => onShift(-15))}>&minus;15m</button>}
            {onShift && <button className="sched-act" tabIndex={open ? 0 : -1} onClick={() => closeThen(() => onShift(15))}>+15m</button>}
            {onShift && <button className="sched-act" tabIndex={open ? 0 : -1} onClick={() => closeThen(() => onShift(60))}>+1h</button>}
          </div>
        )}
        <div
          className={"sched-row sched-locked" + (holds ? " sched-holds" : "") + (past ? " past" : "") + (dragging ? " swiping" : "")}
          style={swipeable ? { transform: `translateX(${dx}px)` } : undefined}
          role="button"
          tabIndex={0}
          onClick={() => (open ? closeThen() : onOpen?.())}
          {...handlers}
        >
          {onRetime ? (
            <button
              type="button"
              className="sched-time sched-time-btn"
              aria-label={"Change time, currently " + t.time + " " + t.ap}
              onClick={(ev) => { ev.stopPropagation(); setPicking(true); }}
            >{t.time}<span className="ampm">{t.ap}</span></button>
          ) : (
            <div className="sched-time">{t.time}<span className="ampm">{t.ap}</span></div>
          )}
          <div className="sched-body">
            <div className="sched-title sched-lock-title">
              {!holds && <LockGlyph className="ic lock-ic" />}
              {l.label}
            </div>
            <div className="sched-cat">
              {kicker}
              <span className="sched-sep">&middot;</span>
              {onResize ? (
                <button
                  type="button"
                  className="sched-until sched-until-btn"
                  aria-label={"Change length, currently " + mins + " minutes"}
                  aria-expanded={sizing}
                  onClick={(ev) => { ev.stopPropagation(); setSizing(!sizing); }}
                >Until {end.time} {end.ap}</button>
              ) : (
                <span className="sched-until">Until {end.time} {end.ap}</span>
              )}
            </div>
            {children}
            {/* THE HALF THAT WAS UNREACHABLE: blending only ever attached to
                real calendar events, so the one block built to receive tasks
                had no way to receive one. */}
            {holds && onFillBlock && (
              <button type="button" className="block-add" onClick={(ev) => { ev.stopPropagation(); onFillBlock(); }}>+ Put a Task in This Block</button>
            )}
          </div>
          {swipeable && (
            <button
              type="button"
              className={"sched-grip" + (open ? " open" : "")}
              aria-label={open ? "Hide quick actions" : "Quick actions"}
              aria-expanded={open}
              onClick={(ev) => { ev.stopPropagation(); toggle(); }}
            >
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
          )}
        </div>
      </div>
      {sizing && onResize && (
        <div className="draft-edit-body" onClick={(ev) => ev.stopPropagation()}>
          <div className="plan-controls">
            <div className="chip-row plan-durs" ref={durs}>
              {DUR_CHOICES.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={"chip" + (mins === d ? " chip-on" : "")}
                  aria-label={l.label + ": " + d + " minutes"}
                  onClick={() => { setSizing(false); onResize(l.s + d); }}
                >{durLabel(d)}</button>
              ))}
            </div>
            <div className="plan-when">
              <button type="button" className="btn-sm" onClick={() => setSizing(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
      {picking && onRetime && (
        <>
          <div className="time-pop-scrim" onClick={() => setPicking(false)} />
          <div className="time-pop">
            <input
              className="input time-pop-input"
              type="time"
              aria-label="New time"
              defaultValue={minToHHMM(l.s)}
              onChange={(ev) => {
                const v = ev.target.value;
                if (!v) return;
                setPicking(false);
                const p = v.split(":");
                onRetime(Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0));
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}
