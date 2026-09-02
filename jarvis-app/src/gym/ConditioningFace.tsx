import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CondBlock } from "./types";
import { COND_LABEL } from "./types";
import { intervalAt, intervalsDone, marksOwnRounds, mmss } from "./conditioning";
import { haptics } from "../shared/haptics";

// THE FACE (Check, Health, Stop, Dave 2026-09-02: "A ring that drains, and a
// Round button", plus "add ability to stop"; Closing Round, ruled 09-01:
// "while it runs, the timer owns the whole screen"; Landscape, ruled: "the
// number fills the width, everything else in the corners").
//
// One overlay, three moments. A three-second lead-in so the first rep is
// not spent finding the button. Then the clock: the ring drains around the
// number for every capped format, the round count under it, the last split
// under that; Round is the one big button on AMRAP and For Time, and
// interval formats (EMOM, Tabata) mark their own rounds on the beep. Stop is
// a slide, the SmartWOD move, because finishing is the one thing you never
// want to do by accident in round five. When the cap lands the clock ends
// itself. The screen stays awake while it runs and every boundary beeps, so
// nobody has to look.

const LEAD_SEC = 3;

export interface CondResult { elapsed: number; splits: number[] }

function beep(ctx: AudioContext | null, hz = 880, ms = 120, when = 0) {
  if (!ctx) return;
  try {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine"; o.frequency.value = hz;
    g.gain.value = 0.0001;
    o.connect(g); g.connect(ctx.destination);
    const t = ctx.currentTime + when;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    o.start(t); o.stop(t + ms / 1000 + 0.02);
  } catch { /* audio is a courtesy, never a crash */ }
}

export default function ConditioningFace({ name, cond, onFinish, onCancel }: {
  name: string;
  cond: CondBlock;
  onFinish: (r: CondResult) => void;
  onCancel: () => void;
}) {
  const [phase, setPhase] = useState<"lead" | "run">("lead");
  const [now, setNow] = useState(0);            // seconds since the phase began
  const [splits, setSplits] = useState<number[]>([]);
  const [pulse, setPulse] = useState(0);
  const startRef = useRef<number>(performance.now());
  const audioRef = useRef<AudioContext | null>(null);
  const lastBeepRef = useRef<number>(-1);
  const finishedRef = useRef(false);
  const own = marksOwnRounds(cond);

  // Audio and the wake lock both want a user gesture; the tap that opened
  // this face is one, so both are asked for on mount.
  useEffect(() => {
    try {
      const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) audioRef.current = new AC();
    } catch { audioRef.current = null; }
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock?.request("screen").then((l) => { lock = l; }).catch(() => {});
    return () => {
      lock?.release().catch(() => {});
      audioRef.current?.close().catch(() => {});
    };
  }, []);

  // The clock. 100ms is smooth enough for tenths nobody reads and cheap
  // enough to run for twenty minutes.
  useEffect(() => {
    startRef.current = performance.now();
    setNow(0);
    const t = setInterval(() => setNow((performance.now() - startRef.current) / 1000), 100);
    return () => clearInterval(t);
  }, [phase]);

  const finish = useCallback((elapsed: number) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    beep(audioRef.current, 660, 220, 0); beep(audioRef.current, 660, 220, 0.28); beep(audioRef.current, 990, 420, 0.56);
    haptics.success();
    onFinish({ elapsed: Math.min(elapsed, cond.capSec), splits });
  }, [cond.capSec, onFinish, splits]);

  // Lead-in: 3, 2, 1, go.
  useEffect(() => {
    if (phase !== "lead") return;
    const left = Math.ceil(LEAD_SEC - now);
    if (left !== lastBeepRef.current && left <= 3 && left >= 1) { lastBeepRef.current = left; beep(audioRef.current, 660, 110); }
    if (now >= LEAD_SEC) { lastBeepRef.current = -1; beep(audioRef.current, 990, 260); haptics.impact(); setPhase("run"); }
  }, [now, phase]);

  const elapsed = phase === "run" ? Math.min(now, cond.capSec) : 0;
  const capLeft = cond.capSec - elapsed;
  const iv = own ? intervalAt(cond, elapsed) : null;
  // The number that counts: the interval left on EMOM/Tabata, the cap left on
  // an AMRAP, the running time on a For Time.
  const shown = iv ? iv.left : cond.format === "for_time" ? elapsed : capLeft;
  const ringFrac = iv
    ? iv.left / Math.max(1, iv.phase === "work" ? (cond.intervalSec ?? 60) : (cond.restSec ?? 10))
    : capLeft / Math.max(1, cond.capSec);
  const roundNo = own ? (iv?.round ?? 1) : splits.length + 1;
  const roundsDone = own ? intervalsDone(cond, elapsed) : splits.length;
  const lastSplit = splits.length ? splits[splits.length - 1]! - (splits[splits.length - 2] ?? 0) : null;

  // Boundary beeps: the last three seconds of every interval and of the cap,
  // and the cap itself ends the clock.
  useEffect(() => {
    if (phase !== "run") return;
    const left = Math.ceil(iv ? iv.left : capLeft);
    const key = (iv ? iv.round * 1000 + (iv.phase === "rest" ? 500 : 0) : 0) + left;
    if (left <= 3 && left >= 1 && key !== lastBeepRef.current) { lastBeepRef.current = key; beep(audioRef.current, 660, 110); }
    if (iv && iv.left <= 0.11 && elapsed < cond.capSec) haptics.impact();
    if (now >= cond.capSec) finish(cond.capSec);
  }, [now, phase, iv, capLeft, elapsed, cond.capSec, finish]);

  const round = () => {
    if (phase !== "run" || own) return;
    setSplits((s) => [...s, elapsed]);
    setPulse((p) => p + 1);
    haptics.impact();
    beep(audioRef.current, 990, 90);
  };

  // SLIDE TO FINISH. Drag the knob across; release past the end and the
  // clock stops with what it has. Release short and it springs back.
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x0: number; dx: number } | null>(null);
  const knobMax = () => Math.max(0, (trackRef.current?.clientWidth ?? 230) - 50);
  const onKnobDown = (e: React.PointerEvent) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); setDrag({ x0: e.clientX, dx: 0 }); };
  const onKnobMove = (e: React.PointerEvent) => { if (drag) setDrag({ x0: drag.x0, dx: Math.max(0, Math.min(knobMax(), e.clientX - drag.x0)) }); };
  const onKnobUp = () => {
    if (drag && drag.dx >= knobMax() - 6) { setDrag(null); finish(elapsed); return; }
    setDrag(null);
  };

  const R = 122; const C = 2 * Math.PI * R;
  const body = (
    <div className={"cond-face" + (phase === "lead" ? " lead" : "") + (iv?.phase === "rest" ? " rest" : "")} role="dialog" aria-label={`${COND_LABEL[cond.format]} clock`}>
      <div className="cf-top">
        <button className="cf-cancel" onClick={onCancel}>Cancel</button>
        <span className="cf-fmt">{COND_LABEL[cond.format]} · {mmss(cond.capSec)}</span>
        <span className="cf-name">{name}</span>
      </div>

      <div className="cf-ring" onClick={round} role={own ? undefined : "button"} aria-label={own ? undefined : "Mark a round"}>
        <svg className="cf-svg" viewBox="0 0 260 260" aria-hidden="true">
          <circle cx="130" cy="130" r={R} className="cf-track" />
          <circle cx="130" cy="130" r={R} className="cf-arc" strokeDasharray={C} strokeDashoffset={C * (1 - Math.max(0, Math.min(1, phase === "lead" ? 1 : ringFrac)))} />
        </svg>
        <div className="cf-mid">
          {phase === "lead"
            ? <div className="cf-num cf-lead" key={"l" + Math.ceil(LEAD_SEC - now)}>{Math.max(1, Math.ceil(LEAD_SEC - now))}</div>
            : <div className={"cf-num" + (pulse ? " pulse" : "")} key={pulse}>{mmss(shown)}</div>}
          <div className="cf-round">
            {phase === "lead" ? "Ready" : iv ? `${iv.phase === "rest" ? "Rest · " : ""}Round ${roundNo}${cond.rounds ? ` of ${cond.rounds}` : ""}` : `Round ${roundNo}`}
          </div>
          <div className="cf-last">
            {phase === "lead" ? " " : iv ? `${mmss(elapsed)} of ${mmss(cond.capSec)}` : lastSplit != null ? `last ${mmss(lastSplit)}` : cond.format === "for_time" ? `cap ${mmss(cond.capSec)}` : " "}
          </div>
        </div>
      </div>

      {/* Landscape: the corners carry what the ring carried. */}
      <span className="cf-corner cf-tl">{COND_LABEL[cond.format]} · {mmss(cond.capSec)}</span>
      <span className="cf-corner cf-tr">{iv ? `Round ${roundNo}${cond.rounds ? ` of ${cond.rounds}` : ""}` : `Round ${roundNo}`}</span>
      <span className="cf-corner cf-bl">{lastSplit != null ? `last ${mmss(lastSplit)}` : `${roundsDone} done`}</span>

      {!own && phase === "run" && (
        <button className="cf-roundbtn" onClick={round}>Round</button>
      )}
      <div className="cf-slide" ref={trackRef}>
        <span className="cf-slide-t">slide to finish</span>
        <div
          className={"cf-knob" + (drag ? " dragging" : "")}
          style={{ transform: `translateX(${drag?.dx ?? 0}px)` }}
          onPointerDown={onKnobDown} onPointerMove={onKnobMove} onPointerUp={onKnobUp} onPointerCancel={onKnobUp}
          role="button" aria-label="Slide to finish" tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter") finish(elapsed); }}
        />
      </div>
    </div>
  );
  return createPortal(body, document.body);
}
