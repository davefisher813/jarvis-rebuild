// UP-ATH-19 (2026-09-06): THE GYM REACHES THE ASSISTANT.
//
// The gym has held real facts about the athlete's week since the training
// track shipped, and no AI feature could see any of them: grep the ai/,
// schedule/planDayAI and dayloop/ folders for gym, workout or training and
// there was not one line. So the assistant that plans a Tuesday did not know
// the athlete lifts at six on Tuesdays, and Plan My Day filled the hour that
// a pinned Push Day was going to take.
//
// Nothing here is new data or new storage: every line is one of the pure
// derivations the gym pages already render (nextDayFor, trainingSummary,
// estimateDay, and the Season Link's next game), written out as a sentence.
//
// FACTS, NEVER PRESCRIPTIONS, and never a reading of the athlete. No deload
// language, no "you should", no readiness of any kind: those are banned in
// this app and they are exactly what a training context is tempted to
// invent. Every line here is something that happened or something that is
// planned, in the units it was logged in, the same restraint brain/pulse.ts
// keeps for the metric lines these sit beside.

import type { Program, Workout } from "./types";
import type { RackConfig } from "./ramp";
import { nextDayFor } from "./nextDay";
import { estimateDay } from "./fit";
import { trainingSummary } from "./summary";
import { shortDate } from "../shared/dateFormat";

export interface TrainingContextInput {
  /** The active program, or null when there is none. */
  program: Program | null;
  workouts: Workout[];
  today: string; // local ISO day
  dow: number;   // 0 = Sunday, JS getDay
  rack: RackConfig;
  /** The Season Link's answer: the next game inside the coming week, when
   *  the program is in-season AND the athlete has said which category means
   *  a game. Null otherwise; this never guesses at one. */
  nextGame?: string | null;
  /** The routine's own gym window today, in minutes from midnight, when the
   *  athlete keeps one. */
  gymWindow?: { startMin: number; endMin: number } | null;
  /** True when something on the calendar already marks training today, so
   *  the routine window is not worth stating twice. */
  hasGymEventToday?: boolean;
}

function hhmm(min: number): string {
  const m = Math.max(0, Math.min(1439, Math.round(min)));
  const h24 = Math.floor(m / 60);
  const h = h24 % 12 || 12;
  return h + ":" + String(m % 60).padStart(2, "0") + (h24 < 12 ? " AM" : " PM");
}

/** Three to five plain lines, or none at all when the athlete has no gym
 *  history and no program: an empty gym says nothing rather than saying it
 *  is empty. */
export function trainingLines(input: TrainingContextInput): string[] {
  const { program, workouts, today, dow, rack } = input;
  const lines: string[] = [];

  const next = nextDayFor(program, workouts, dow);
  if (next) {
    const est = estimateDay(next.day, workouts, rack);
    const when = next.when === "today" ? " today"
      : next.when === "tomorrow" ? " tomorrow"
        : next.when ? " on " + next.when
          : "";
    lines.push(
      "Next training day: " + next.day.name + when
      + (est.min > 0 ? ", about " + est.min + " min planned" : ""),
    );
  }

  const summary = trainingSummary(workouts, today);
  if (summary.last) {
    lines.push(
      "Last session: " + summary.last.dayName + ", " + shortDate(summary.last.date)
      + ", " + summary.last.minutes + " min",
    );
  }
  // A COUNT, NEVER A RUN. Days trained inside the Monday-to-Sunday week
  // holding today, which is what the week strip on the health page shows.
  // There is deliberately no streak here and there never will be.
  if (summary.sessionsThisWeek > 0) {
    lines.push(
      "Trained " + summary.sessionsThisWeek
      + (summary.sessionsThisWeek === 1 ? " day" : " days") + " so far this week",
    );
  }

  if (program?.data.inSeason) {
    lines.push(input.nextGame ? "In season, next game " + shortDate(input.nextGame) : "In season");
  }

  // The half Plan My Day needs: a pinned day with nowhere on the calendar to
  // happen. The routine block already protects the hour from the planner
  // (protectedRangesFor); this says what is going INTO it, so the assistant
  // stops treating a training evening as an empty one.
  if (input.gymWindow && !input.hasGymEventToday && next?.when === "today") {
    lines.push(
      "Their routine keeps " + hhmm(input.gymWindow.startMin) + " to " + hhmm(input.gymWindow.endMin)
      + " for the gym, and nothing on today's calendar marks it",
    );
  }

  return lines.slice(0, 5);
}
