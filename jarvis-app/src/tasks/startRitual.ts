import { shortenToResponse, responseIsUsable } from "./ifThen";
import { capAfterNumber } from "../shared/casing";

// THE START RITUAL (C1, approved 2026-08-20).
//
// Body doubling is the most-reported thing that actually helps task
// initiation, and it is finally being studied properly. The mechanism looks
// like three parts: presence, accountability, and a SCHEDULED CONTAINER for
// the moment of starting. Formal effect sizes do not exist yet, so this
// builds the honest part: the container, which needs nobody else.
//
// It is not a focus timer. A focus timer starts when you are already working,
// which is the problem solved. This exists for the minute before.
//
// Laws:
//   - A NAMED FIRST MOVE, five words or fewer, borrowed straight from the
//     if-then research. "Work on the invoice" is not a first move; "open the
//     invoice template" is. You cannot start a category.
//   - A HARD START TIME, because the container is the point. "Whenever you're
//     ready" is the state he is already stuck in.
//   - IT ENDS. An open-ended session is another thing to manage.
//   - Nothing about it is a commitment to finish. Finishing is not the
//     problem being solved and pretending otherwise adds dread to a feature
//     built to remove it.

export const DEFAULT_MINUTES = 25;
export const LENGTHS = [10, 25, 45];

export interface Ritual {
  taskId: string;
  text: string;
  firstMove: string;
  startHHMM: string;
  minutes: number;
}

// The first move, proposed. Seeded from the task's own words so the field is
// never blank, and always short enough to be a move rather than a project.
export function proposeFirstMove(taskText: string): string {
  // shortenToResponse lowercases the lead, because it is built to complete
  // "then I'll ___". Here the move stands alone in its own field, so it gets
  // its capital back or it reads like a typo.
  const t = shortenToResponse(taskText);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function ritualIsReady(r: Partial<Ritual>): boolean {
  return !!r.taskId && !!r.startHHMM && responseIsUsable(r.firstMove ?? "");
}

export function whyNotReady(r: Partial<Ritual>): string | null {
  if (!r.startHHMM) return "Pick a start time";
  if (!responseIsUsable(r.firstMove ?? "")) return "Name the first move · Five words or fewer";
  return null;
}

// The line on the card, once it is set. States the container and the move,
// and says nothing about finishing.
export function ritualLine(r: Ritual): string {
  return capAfterNumber(`${r.minutes} minutes`) + ` · ${r.firstMove}`;
}

const toMin = (t: string) => Number(t.split(":")[0] ?? 0) * 60 + Number(t.split(":")[1] ?? 0);
const fromMin = (m: number) =>
  `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// The soonest sensible start: the next quarter hour, never right now. A
// container that begins this second is not a container, it is a demand.
export function nextStart(nowHHMM: string): string {
  return fromMin((Math.floor(toMin(nowHHMM) / 15) + 1) * 15);
}

export function endsAt(r: Pick<Ritual, "startHHMM" | "minutes">): string {
  return fromMin(toMin(r.startHHMM) + r.minutes);
}

// How long until it begins, for the countdown on the card. Negative means it
// has started, which the UI shows as running rather than as late: this thing
// never scolds.
export function minutesUntil(startHHMM: string, nowHHMM: string): number {
  return toMin(startHHMM) - toMin(nowHHMM);
}
