import { useEffect, useRef, useState } from "react";
import { beepDone, openAudio } from "./beep";
import { haptics } from "../shared/haptics";

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Whole seconds left before `endsAt`, never negative. Ceil, so a fresh
 *  2:00 rest reads 2:00 for its first second and 0:00 only once the
 *  deadline has actually passed. */
export function restRemainingSec(endsAt: number, now: number = Date.now()): number {
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}

/**
 * THE REST TIMER (catalog §4.3), with THE FILLER offered inside it (catalog
 * §4.2): "Rest 2:00 -- or do your T-Spine Rotations." Counts down on the
 * session screen; no notification needed while in-app. An inline card, not a
 * blocking sheet -- the athlete can keep logging while it runs.
 *
 * GYM-F-01 (2026-09-05): the countdown is a function of the CLOCK, not of
 * how many ticks fired. WKWebView suspends JS timers while the app is not
 * foreground, so a timer that decremented state once per tick sat at 2:00
 * through a 90-second glance at Music and then counted the whole rest again
 * from there. Now the caller hands in a wall-clock deadline (`endsAt`,
 * stamped on the live session so a killed app resumes the same rest), every
 * tick re-reads `endsAt - Date.now()`, and `visibilitychange` forces a
 * re-read the moment the app is foregrounded again. At zero it plays the
 * same three-note cue and success haptic the conditioning clock plays when
 * its cap lands, so a pocketed phone gets a cue at all.
 *
 * `key`-remounted by the caller on every new deadline (React resets all
 * state on a key change), which is how the countdown restarts clean each
 * time rather than this component tracking which set it belongs to.
 */
export default function RestTimer({ endsAt, fillerName, onLogFiller, onDismiss }: {
  endsAt: number;
  fillerName?: string;
  onLogFiller?: () => void;
  onDismiss: () => void;
}) {
  const [remaining, setRemaining] = useState(() => restRemainingSec(endsAt));
  // A timer that mounts already over (the app came back long after the rest
  // ended) has nothing to announce: the athlete is looking at it.
  const hadTimeRef = useRef(restRemainingSec(endsAt) > 0);
  const firedRef = useRef(false);
  const audioRef = useRef<AudioContext | null>(null);

  // Audio wants a user gesture; the tap that logged the set is one.
  useEffect(() => {
    audioRef.current = openAudio();
    return () => { audioRef.current?.close().catch(() => {}); };
  }, []);

  useEffect(() => {
    const tick = () => setRemaining(restRemainingSec(endsAt));
    tick();
    const t = setInterval(tick, 500);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [endsAt]);

  useEffect(() => {
    if (remaining > 0 || firedRef.current || !hadTimeRef.current) return;
    firedRef.current = true;
    beepDone(audioRef.current);
    haptics.success();
  }, [remaining]);

  const over = remaining <= 0;

  return (
    <div className="pad-x"><div className="card pad rest-timer">
      <div className="eyebrow">{over ? "Rest Over" : "Resting"}</div>
      <div className="p3-q rest-clock">{mmss(remaining)}</div>
      {fillerName && !over && (
        <button className="row-create rest-filler-btn" onClick={onLogFiller}>
          Or Do {fillerName}
        </button>
      )}
      <button className="row-create" onClick={onDismiss}>{over ? "Continue" : "Skip Rest"}</button>
    </div></div>
  );
}
