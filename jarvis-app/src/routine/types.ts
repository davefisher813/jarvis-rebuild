// The single per-user routine record: JARVIS's model of the user's daily
// rhythm. Stored as a JSONB Store item (no Supabase migration). Read by both
// the deterministic planner (active hours = planning window) and the AI (work
// hours = sequencing context). The shape is built to extend: the Student
// template will add class and practice blocks on the same entity later, but
// only the Personal fields below are implemented now.
export const ENTITY_ROUTINE = "routine";

// What a block IS, so the AI can reason about the life it describes ("dinner"
// means something "block 3" does not) and the editor can offer honest
// presets. Closed vocabulary, optional: every existing block has none and
// keeps working. Routine enrichment, 2026-08-09 (Dave: "it should know your
// routine life... how can it plan your day when it doesn't know what your
// day is like").
export type BlockKind = "meal" | "gym" | "hobby" | "family" | "focus" | "errand" | "commute" | "work" | "other";

// WHAT A BLOCK DOES WITH YOUR LIST (2026-08-21, Dave's call: "should be able
// to edit any category like this... some people might be fine putting tasks
// during eating hours"). Three answers, editable on every block:
//
//   holds    - time set aside FOR the list. Picks land here first and render
//              INSIDE the block on the day view. Deep Work, Errands, Work Hours.
//   protects - nothing lands. Meals, family, hobby. The wall.
//   blends   - you are busy, but a channel is free. Driving frees your mouth
//              and ears and takes your hands; the gym frees your ears. The
//              planner still routes around it, but the blend engine may offer
//              work that fits the free channels.
//
// The mode was HARDCODED to the kind before this (only "focus" held tasks),
// which is wrong for thousands of users who are not Dave. It is now a per
// block setting with a sensible default, so nobody has to configure anything
// and anybody can change their mind.
export type BlockMode = "holds" | "protects" | "blends";

// What a blend block leaves free. This is not decoration: it is the whole
// difference between "phone call while driving" (fine) and "write the email
// while driving" (not fine). blend.ts already reasons in mouth-vs-hands
// terms; this is how a routine block tells it which.
export type FreeChannel = "mouth" | "hands" | "ears";
export const FREE_CHANNELS: FreeChannel[] = ["mouth", "hands", "ears"];

// A daily range in the user's routine: gym, meals, family, deep work, hobby
// time. Days use JS getDay (0=Sun ... 6=Sat) so a block can apply on any
// subset of the week. Times are minutes from midnight. Phase 2.
//
// soft (2026-08-09): the hard/soft split from Dave's block-time brainstorm.
// A hard block (default, and every pre-existing block) is a wall the planner
// routes around. A soft block is a preference: the planner avoids it while
// the day has room and schedules over it, labeled, when the day is tight.
// location feeds the AI's picture of the day; the deterministic planner
// ignores it (travel time is not modeled, and pretending otherwise would be
// a guess wearing math).
export interface ProtectedBlock {
  id: string;
  label: string;
  startMin: number;
  endMin: number;
  days: number[];
  kind?: BlockKind;
  soft?: boolean;
  location?: string;
  // Absent means "the default for this kind" (see defaultModeFor), so every
  // block written before 2026-08-21 keeps behaving exactly as it did.
  mode?: BlockMode;
  free?: FreeChannel[];
}

export interface RoutineData {
  wakeMin: number;      // start of the day, minutes from midnight
  sleepMin: number;     // bedtime, minutes from midnight
  workStartMin: number; // start of work hours (AI context only in Phase 1)
  workEndMin: number;   // end of work hours (AI context only in Phase 1)
  // Optional weekend overrides. When weekendDifferent is on, the planner uses
  // weekendWake/weekendSleep on Sat/Sun and skips work hours. Absent or off,
  // weekends use the weekday hours above (no behavior change for anyone who
  // does not opt in). Work hours intentionally have no weekend variant.
  weekendDifferent?: boolean;
  weekendWakeMin?: number;
  weekendSleepMin?: number;
  // Protected time the planner routes around. Absent means none: no behavior
  // change for anyone who has not set any. Phase 2.
  protectedBlocks?: ProtectedBlock[];
}

export const DEFAULT_ROUTINE: RoutineData = {
  wakeMin: 7 * 60,    // 7:00 AM
  sleepMin: 22 * 60,  // 10:00 PM
  workStartMin: 9 * 60,  // 9:00 AM
  workEndMin: 17 * 60,   // 5:00 PM
  weekendDifferent: false,
  weekendWakeMin: 8 * 60,   // 8:00 AM default once enabled
  weekendSleepMin: 23 * 60, // 11:00 PM default once enabled
  protectedBlocks: [],
};

// A protected range resolved for one day: the busy window the planner blocks
// out, carrying its label for the preview. soft rides along so callers can
// split walls from preferences; kind (2026-08-10) so focus blocks can be
// told apart from time to protect. Phase 2, extended 2026-08-09/10.
// id (2026-08-28) rides along so a tap on a rendered range - on Today, on
// Schedule - can jump straight back to editing THAT block instead of
// dropping the user at the top of the whole routine list to hunt for it
// again. Dave: "I don't want to keep asking for the same thing."
export interface ProtectedRange { s: number; e: number; label: string; soft?: boolean; kind?: BlockKind; mode?: BlockMode; free?: FreeChannel[]; id?: string }

// The protected ranges that apply on a given day of week, as sorted busy
// ranges for the planner, hard and soft together. Malformed blocks (end at or
// before start, empty label, no days) are dropped so a bad entry can never
// wipe out a day. dow: 0=Sun ... 6=Sat (JS getDay).
export function protectedRangesFor(r: RoutineData, dow: number): ProtectedRange[] {
  return (r.protectedBlocks ?? [])
    .filter((b) => b.endMin > b.startMin && b.label.trim() !== "" && b.days.includes(dow))
    .map((b) => ({ s: b.startMin, e: b.endMin, label: b.label.trim(), id: b.id, ...(b.soft ? { soft: true } : {}), ...(b.kind ? { kind: b.kind } : {}), ...(b.mode ? { mode: b.mode } : {}), ...(b.free ? { free: b.free } : {}) }))
    .sort((a, b) => a.s - b.s || a.e - b.e);
}

// Focus blocks pull tasks IN (2026-08-10, Dave's call): a block like Deep
// Work is time set aside FOR tasks, so treating it like lunch (time to
// protect FROM tasks) sent picks to the evening while a four-hour block
// built exactly for them sat empty. kind === "focus" is the signal; blocks
// created before kinds existed fall back to the label, deterministically,
// so an existing "Deep Work" block starts working without being re-edited.
export function isFocusRange(x: { label: string; kind?: string; mode?: string }): boolean {
  return modeOf(x) === "holds";
}

// The default a kind carries when the user has not chosen. Blocks created
// before kinds existed fall back to the LABEL, deterministically, so an
// existing "Deep Work" keeps holding tasks without being re-edited.
export function defaultModeFor(kind?: string, label = ""): BlockMode {
  switch (kind) {
    case "focus": case "errand": case "work": return "holds";
    case "commute": case "gym": return "blends";
    case "meal": case "family": case "hobby": return "protects";
    default:
      // An explicit kind is a DECISION and outranks the label, even when the
      // decision is "other" on a block called Deep Work (law-tested since
      // 2026-08-10). The label is consulted only when no kind was ever set.
      if (kind != null) return "protects";
      if (/\b(deep work|focus|study hall)\b/i.test(label)) return "holds";
      if (/\b(errands?|shopping)\b/i.test(label)) return "holds";
      if (/\b(commute|drive|driving|carpool)\b/i.test(label)) return "blends";
      return "protects";
  }
}

// One resolver, used by every surface, so "what does this block do" can never
// drift between the planner, the day list and the editor.
export function modeOf(x: { label?: string; kind?: string; mode?: string }): BlockMode {
  const m = x.mode;
  if (m === "holds" || m === "protects" || m === "blends") return m;
  return defaultModeFor(x.kind, x.label ?? "");
}

// What a blend block leaves free, defaulted by kind when unset. Driving takes
// your hands and leaves your mouth and ears; the gym leaves your ears only.
export function freeOf(x: { kind?: string; free?: string[]; label?: string }): FreeChannel[] {
  // Filter FIRST, then decide. Returning the filtered list directly would let
  // a block whose stored channels are all unrecognised report that nothing is
  // free, which silently makes it un-blendable forever instead of falling
  // back to something sane.
  const kept = (x.free ?? []).filter((f): f is FreeChannel => (FREE_CHANNELS as string[]).includes(f));
  if (kept.length) return kept;
  if (x.kind === "gym") return ["ears"];
  return ["mouth", "ears"];
}

export const MODE_LABEL: Record<BlockMode, string> = {
  holds: "Holds Tasks",
  protects: "Protected",
  blends: "Can Blend",
};

// One sentence saying what the chosen mode actually means, shown under the
// control. A three-way switch with no explanation is a guess.
export const MODE_HELP: Record<BlockMode, string> = {
  holds: "Your list lands here first",
  protects: "Nothing gets scheduled here",
  blends: "Busy, but a channel is free",
};

// One classification, shared by the plan sheet, the planner tests, and any
// future caller, so "what counts as focus time" can never drift apart.
export function splitProtectedRanges(ranges: ProtectedRange[]): {
  hard: { s: number; e: number; label: string }[];
  soft: { s: number; e: number; label: string }[];
  focus: { s: number; e: number; label: string }[];
  blend: { s: number; e: number; label: string; free: FreeChannel[] }[];
} {
  const bucket = (x: ProtectedRange) => modeOf(x);
  const focus = ranges.filter((x) => bucket(x) === "holds").map((x) => ({ s: x.s, e: x.e, label: x.label }));
  // A blend block is a WALL for ordinary placement (you really are driving),
  // and an opening for the blend engine only. Both facts are true at once,
  // which is why it rides in hard AND is returned separately.
  const blends = ranges.filter((x) => bucket(x) === "blends");
  const prot = ranges.filter((x) => bucket(x) === "protects");
  return {
    hard: [...prot.filter((x) => !x.soft), ...blends].map((x) => ({ s: x.s, e: x.e, label: x.label })),
    soft: prot.filter((x) => x.soft).map((x) => ({ s: x.s, e: x.e, label: x.label })),
    focus,
    blend: blends.map((x) => ({ s: x.s, e: x.e, label: x.label, free: freeOf(x) })),
  };
}

// The wake/sleep pair that applies on a given date, honoring weekend overrides.
// dow: 0=Sun ... 6=Sat (JS getDay). Falls back to weekday hours when weekend
// mode is off or the override values are missing.
export function activeHoursFor(r: RoutineData, dow: number): { wakeMin: number; sleepMin: number } {
  const isWeekend = dow === 0 || dow === 6;
  if (isWeekend && r.weekendDifferent) {
    return {
      wakeMin: r.weekendWakeMin ?? r.wakeMin,
      sleepMin: r.weekendSleepMin ?? r.sleepMin,
    };
  }
  return { wakeMin: r.wakeMin, sleepMin: r.sleepMin };
}

// Soft, non-blocking UI hints derived from a routine. These never block a save;
// they only let the editor confirm it understood an unusual setup.
export function isOvernight(r: RoutineData): boolean {
  return r.sleepMin <= r.wakeMin;
}
export function isWorkOutsideActive(r: RoutineData): boolean {
  return r.workStartMin < r.wakeMin || r.workEndMin > r.sleepMin;
}

// Convert a "HH:MM" brief time into a wake time in minutes. Used to seed a
// smarter routine from the morning-brief choice during onboarding.
export function wakeFromBrief(briefTime: string): number {
  const p = briefTime.split(":");
  return Number(p[0] ?? 7) * 60 + Number(p[1] ?? 0);
}

// Minutes to stop scheduling before bedtime, so nothing lands right at sleep.
export const WIND_DOWN_MIN = 30;

// End-of-day for the planner, overnight-safe (2026-08-10). A bedtime past
// midnight (sleep 1:00 AM = 60 minutes) used to make `sleep - wind-down`
// tiny, so the wake+60 floor kicked in and the WHOLE PLANNING DAY collapsed
// to one hour after waking: every pick read "No room" over a completely open
// day (Dave's 2:41 AM screenshot: "gaps before 9:30 AM" on an 8:30 wake).
// The editor even detects overnight schedules and promises "JARVIS plans
// your daytime hours", but this function never honored that promise. Now a
// bedtime at or before the wake time means the day runs to late night: the
// planner's day ends at 11:30 PM (midnight minus wind-down), and the 1 AM
// tail belongs to the single-day model's tomorrow, honestly.
function endOfDayFor(wakeMin: number, sleepMin: number): number {
  const sleepAdj = sleepMin <= wakeMin ? 24 * 60 : sleepMin;
  // Outer clamp (found by the invariant stress test): a wake time near
  // midnight would push the wake+60 floor past 24h into invalid clock time.
  // The single-day model ends at 11:59 PM, whatever the routine claims.
  return Math.min(24 * 60 - 1, Math.max(wakeMin + 60, Math.min(sleepAdj - WIND_DOWN_MIN, 24 * 60 - 1)));
}

// The planner's end-of-day cutoff derived from the routine: a wind-down buffer
// before bedtime, floored so it can never cross before the wake time.
export function planEndMin(r: RoutineData): number {
  return endOfDayFor(r.wakeMin, r.sleepMin);
}

// Day-aware planning window: the wake floor and the wind-down end for a given
// day of week, honoring weekend overrides. This is what the flows use so a
// Saturday plan respects weekend hours when enabled.
export function planWindowFor(r: RoutineData, dow: number): { wakeMin: number; endMin: number } {
  const { wakeMin, sleepMin } = activeHoursFor(r, dow);
  return { wakeMin, endMin: endOfDayFor(wakeMin, sleepMin) };
}

// ---- Routine as text (2026-08-09) ----
// The AI used to know exactly one sentence about the user's day: "Works 9 AM
// to 5 PM." Wake, meals, gym, hobbies, family time, and where any of it
// happens never reached a single prompt, and Dave's complaint was the direct
// consequence: "how can it plan your day when it doesn't know what your day
// is like." This renders the WHOLE routine record compactly for the one
// assembler. Deterministic, no free text beyond what the user typed into
// their own routine.

const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function daysSummary(days: number[]): string {
  const s = [...new Set(days)].sort((a, b) => a - b);
  if (s.length === 7) return "every day";
  if (s.length === 5 && [1, 2, 3, 4, 5].every((d) => s.includes(d))) return "weekdays";
  if (s.length === 2 && s.includes(0) && s.includes(6)) return "weekends";
  return s.map((d) => DAY_ABBR[d]).join(" ");
}

function min12h(min: number): string {
  let h = Math.floor(min / 60);
  const ap = h < 12 ? "AM" : "PM";
  h = h % 12 || 12;
  const m = min % 60;
  return m === 0 ? `${h} ${ap}` : `${h}:${String(m).padStart(2, "0")} ${ap}`;
}

export function routineToText(r: RoutineData): string {
  const parts: string[] = [];
  parts.push(`Awake ${min12h(r.wakeMin)} to ${min12h(r.sleepMin)}; works ${min12h(r.workStartMin)} to ${min12h(r.workEndMin)}`);
  if (r.weekendDifferent && r.weekendWakeMin != null && r.weekendSleepMin != null) {
    parts.push(`weekends awake ${min12h(r.weekendWakeMin)} to ${min12h(r.weekendSleepMin)}`);
  }
  for (const b of r.protectedBlocks ?? []) {
    if (b.endMin <= b.startMin || !b.label.trim() || b.days.length === 0) continue;
    const bits = [`${b.label.trim()} ${daysSummary(b.days)} ${min12h(b.startMin)} to ${min12h(b.endMin)}`];
    if (b.location?.trim()) bits.push(`at ${b.location.trim()}`);
    if (b.soft) bits.push("flexible");
    parts.push(bits.join(", "));
  }
  return parts.join(". ") + ".";
}
