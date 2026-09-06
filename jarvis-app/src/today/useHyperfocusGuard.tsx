import { useEffect, useState } from "react";
import { useOptionalSchedule } from "../data/NotesProvider";
import type { EventItem } from "../schedule/types";
import { hyperfocusGuard, type GuardLine } from "./nowContext";
import { nowHHMM } from "./todayData";
import { todayISO } from "../tasks/grouping";

// HYPERFOCUS GUARD, WHEREVER THE HOURS GO (UP-CORE-06, 2026-09-05).
//
// The guard has existed since Group B item 12 and was mounted on exactly one
// surface, the Up Next card (UpNextFlow), which is the one place a person is
// already being handed a single task and told to go. The two places someone
// with ADHD actually loses two hours are a note and a workout, and neither
// had it.
//
// The whole thing is one line of fact, so the mounting cost should be one
// line too. This hook is the data half (today's events, refreshed on a
// minute tick so "in 9 min" is true when it says so) and HyperfocusLine is
// the render half, identical on every surface by construction.
//
// It is NEVER a modal and never stops anything: it informs, and the person
// decides. Inside the warn window it flips tone, which is the only escalation
// there is.
// `now` is injectable for the same reason sourceLine's and gapFill's clocks
// are: a test that has to be run before half past eleven at night is not a
// test. Every caller in the app takes the default.
export function useHyperfocusGuard(now: () => string = nowHHMM): GuardLine | null {
  // Optional so a surface can mount outside the provider (a preview, a test
  // harness) and simply get no line rather than throwing.
  const schedule = useOptionalSchedule();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!schedule) return;
    let on = true;
    void schedule.eventsOn(todayISO()).then((e) => { if (on) setEvents(e); }).catch(() => undefined);
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => { on = false; clearInterval(id); };
  }, [schedule]);
  return hyperfocusGuard(events, now());
}

// The line itself, in the same quiet meta ink and the same warn tone Up Next
// has used since the guard shipped.
export function HyperfocusLine({ guard }: { guard: GuardLine | null }) {
  if (!guard) return null;
  return (
    <div className="conn-meta">
      {guard.warn ? <span className="urgency urgency-warn">{guard.text}</span> : guard.text}
    </div>
  );
}
