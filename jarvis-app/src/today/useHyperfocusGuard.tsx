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
export function HyperfocusLine({ guard, variant = "line" }: { guard: GuardLine | null; variant?: "line" | "chip" }) {
  if (!guard) return null;
  // THE CHIP (2026-09-21, Dave on a live Push Day: "the notification that I
  // have an interview looks awful").
  //
  // It did, and on that screen specifically. The line is right where it grew
  // up -- Up Next and the note editor are quiet surfaces and a meta line
  // belongs on them -- but the session screen speaks entirely in coloured
  // chips: EQUIPMENT violet, BEST lime, LAST cyan. A sentence in .conn-meta
  // dropped into that row read as unstyled text somebody forgot, and it drew
  // the one fact on the screen with a deadline attached to it quieter than
  // his best set of chest flys.
  //
  // Same guard, same words, same warn escalation, same never-a-modal. It
  // wears the room's own language, and takes the row to itself because the
  // value is a calendar title and will not fit beside anything.
  if (variant === "chip") {
    return (
      <div className="se-chips">
        <span className={"se-chip se-guard" + (guard.warn ? " se-guard-warn" : "")}>
          <em>{guard.when}</em>{guard.title}
        </span>
      </div>
    );
  }
  return (
    <div className="conn-meta">
      {guard.warn ? <span className="urgency urgency-warn">{guard.text}</span> : guard.text}
    </div>
  );
}
