import { MEASURE_KINDS, defaultUnit, unitsFor, type MeasureKind, type ProgramData, type ProgramDay, type Exercise } from "./types";
import { uniformStrip } from "./strip";

// Program upload (gym session 2). The standard distillation pipeline: parse a
// coach's screenshot or pasted text -> show the extracted program for review
// -> the user keeps or fixes each piece -> the RAW FILE IS NOT RETAINED.
// Nothing here commits anything; the review screen owns that.
//
// The model still speaks the old, simple vocabulary ("sets": 3, "target":
// {w,r,v,t}) because that is what a coach's sheet or text actually says --
// nobody writes a photo of a set strip. The parser expands that INPUT into a
// uniform strip on the way in (catalog Q6), so every program this pipeline
// produces is already in the real storage shape: one week, real chips.

export const EXTRACT_PROMPT = [
  "Extract the training program from this content.",
  "Reply with ONLY a JSON object, no prose, no code fences, in exactly this shape:",
  '{"name":"program name","days":[{"name":"day name","exercises":[{"name":"exercise name","kind":"...","unit":"...","sets":3,"target":{"w":135,"r":8,"v":0,"t":0},"note":""}]}]}',
  `"kind" must be one of: ${MEASURE_KINDS.join(", ")}.`,
  "weight_reps is a lift (w=weight, r=reps). reps is bodyweight reps (r). rounds is circuits (r).",
  "time_faster is a timed effort where faster wins, like a sprint (v=time). time_longer is a hold, like a plank (v=time).",
  "distance uses v. distance_time uses v=distance and t=time. height uses v, like a vertical jump. done has no numbers, like stretching.",
  "Units: weight lb|kg, time sec|min, distance yd|m|mi|ft, height in|cm.",
  "Use the user's own words for every name. Do not invent exercises that are not in the content.",
  "If sets or targets are unreadable, use sets 3 and omit the target rather than guessing numbers.",
  "If the program is written as multiple weeks (a wave, a 4-week block), extract only the FIRST week's days here; weeks are added by the athlete afterward.",
].join("\n");

let seq = 0;
const nid = (p: string) => `${p}x${(seq++).toString(36)}${Math.abs(hash(p + seq)) % 1000}`;
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

const MAX_DAYS = 14;
const MAX_EXERCISES = 30;
const MAX_NAME = 80;

function num(x: unknown, cap: number): number | undefined {
  const n = typeof x === "number" ? x : typeof x === "string" ? Number(x) : NaN;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(n, cap);
}

function cleanName(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const t = x.trim().slice(0, MAX_NAME);
  return t.length ? t : null;
}

/**
 * Coerce a raw kind plus whatever numbers came with it into a valid kind. An
 * unknown kind falls back by evidence (weight present -> weight_reps, reps
 * present -> reps, a lone magnitude -> distance, nothing -> done), never by
 * guessing a direction for time.
 */
export function coerceKind(kind: unknown, target: { w?: number; r?: number; v?: number; t?: number }): MeasureKind {
  if (typeof kind === "string" && (MEASURE_KINDS as string[]).includes(kind)) return kind as MeasureKind;
  if (target.w) return "weight_reps";
  if (target.r) return "reps";
  if (target.v && target.t) return "distance_time";
  if (target.v) return "distance";
  return "done";
}

/**
 * Parse the model's reply into a ProgramData, tolerantly but never inventively:
 * fences stripped, bad entries dropped, numbers clamped, unknown units replaced
 * with the kind's default. The sets+target the model wrote is expanded into a
 * uniform strip on the way in, and the single extracted day becomes "Week 1".
 * Null when nothing usable survives.
 */
export function parseProgramExtract(raw: string): ProgramData | null {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1]!.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const root = obj as { name?: unknown; days?: unknown };
  const days: ProgramDay[] = [];
  for (const d of Array.isArray(root.days) ? root.days.slice(0, MAX_DAYS) : []) {
    const dd = d as { name?: unknown; exercises?: unknown };
    const dayName = cleanName(dd.name) ?? `Day ${days.length + 1}`;
    const exercises: Exercise[] = [];
    for (const e of Array.isArray(dd.exercises) ? dd.exercises.slice(0, MAX_EXERCISES) : []) {
      const ee = e as { name?: unknown; kind?: unknown; unit?: unknown; sets?: unknown; target?: unknown; note?: unknown };
      const name = cleanName(ee.name);
      if (!name) continue; // an exercise with no name is noise, not data
      const t = (ee.target ?? {}) as { w?: unknown; r?: unknown; v?: unknown; t?: unknown };
      const target = { w: num(t.w, 2000), r: num(t.r, 500), v: num(t.v, 100000), t: num(t.t, 100000) };
      const kind = coerceKind(ee.kind, target);
      const units = unitsFor(kind);
      const unit = typeof ee.unit === "string" && units.includes(ee.unit) ? ee.unit : defaultUnit(kind);
      const count = num(ee.sets, 20) ?? 3;
      const sets = kind === "done" ? uniformStrip(count, {}) : uniformStrip(count, target);
      exercises.push({
        id: nid("e"),
        name,
        kind,
        ...(unit ? { unit } : {}),
        ...(kind === "distance_time" ? { timeUnit: "min" } : {}),
        sets,
        ...(cleanName(ee.note) ? { note: cleanName(ee.note)! } : {}),
      });
    }
    if (exercises.length) days.push({ id: nid("d"), name: dayName, exercises });
  }
  if (!days.length) return null;
  return { name: cleanName(root.name) ?? "My Program", weeks: [{ id: nid("w"), label: "Week 1", days }] };
}
