import type { EventItem } from "./types";

// BLENDING (Dave, 2026-08-21).
//
//   "It should also be much easier to blend things on the schedule. Should be
//    able to put tasks into certain blocks and the app should suggest that as
//    well and learn the user. It should know for example: deep work block off
//    should be where most work related tasks go. And example of blending
//    would be someone can make a phone call while traveling. Don't overthink
//    it, just make it very easy to do things like that."
//
// Attaching a task to a block already existed. It was just unusable: you had
// to open the event, scroll past six fields, and pick from the first four
// undone tasks in whatever order the list happened to be in. Nothing ranked
// them, nothing suggested anything, and nothing ever learned.
//
// Three ideas, and no more than three:
//
//   1. A BLOCK HAS A KIND. Driving is not the same container as deep work.
//      Kind comes from the words already on the event, so nobody configures
//      anything.
//   2. A TASK HAS A DEMAND. A phone call needs your mouth. Writing needs your
//      hands and your eyes. That single distinction is the whole of Dave's
//      "phone call while traveling": a moving block can hold anything you can
//      do with your mouth and nothing you need your hands for.
//   3. THE APP LEARNS WHERE THINGS GO. Every blend he actually makes is a
//      vote that this category belongs in this kind of block. Two votes and
//      it starts saying so out loud.
//
// Everything here is pure. Storage is one small counter map; the UI decides
// what to show.

export type BlockKind = "moving" | "waiting" | "deep" | "meeting" | "physical" | "other";

// A task's physical demand, which is what decides whether it can ride along
// with something else. Deliberately NOT a difficulty or priority rating:
// nobody should have to score their own to-do list.
export type Demand = "voice" | "hands" | "either";

// Whole words only, spelled out. An earlier draft used \w* suffixes and
// "Fall Clinic Walkthrough" came back as a WALK, which put a phone call
// under a site visit. A stem match is a wrong answer waiting for the right
// noun; the list is longer and it is right.
const MOVING = /\b(commute|commuting|drive|driving|drives|traffic|travel|traveling|travelling|flight|flying|airport|train|bus|ride|riding|carpool|pick ?up|drop ?off|en route|on the road)\b/i;
const WAITING = /\b(wait|waiting|appointment|appt|doctor|dentist|dmv|lobby|layover|standby)\b/i;
const DEEP = /\b(deep work|deep|focus|focused|focus block|writing|study|studying|heads ?down|work block|project time|coding)\b/i;
const MEETING = /\b(meeting|standup|stand-?up|sync|1:1|one on one|interview|huddle|zoom)\b|\bcall with\b|\bcheck-?in with\b/i;
const PHYSICAL = /\b(gym|workout|lift|lifting|run|running|swim|swimming|practice|training|yoga|cardio)\b/i;

// A block earns a kind from the words already on it. Order matters: "drive
// to practice" is a drive, because the drive is the part you are sitting
// through.
export function blockKind(e: Pick<EventItem["data"], "title" | "location">): BlockKind {
  const t = (e.title ?? "") + " " + (e.location ?? "");
  if (MOVING.test(t)) return "moving";
  if (WAITING.test(t)) return "waiting";
  if (PHYSICAL.test(t)) return "physical";
  if (MEETING.test(t)) return "meeting";
  if (DEEP.test(t)) return "deep";
  return "other";
}

// Things you do with your mouth. These are the only things that blend into a
// block you are already spending your body on.
const VOICE = /\b(call|calls|phone|ring|text|voicemail|listen|podcast|audiobook|dictate|brainstorm|decide)\b|\b(talk to|talk with|check in with|follow up with|catch up with|voice memo|think about)\b/i;
// Things that need your hands or your eyes. A moving block must never offer
// these: suggesting that someone answer email while driving is not a feature.
const HANDS = /\b(write|writing|draft|drafting|type|email|emails|reply|read|reading|review|edit|file|scan|print|pay|sign|upload|fix|clean|pack|build|code|design|photo|screenshot|spreadsheet|form|invoice|book|order|send)\b/i;

export function demandOf(text: string): Demand {
  const voice = VOICE.test(text);
  const hands = HANDS.test(text);
  if (voice && !hands) return "voice";
  if (hands && !voice) return "hands";
  // "Email Coach about the call" reads as both. Both means hands, because the
  // safe answer to an ambiguous task in a moving block is no.
  return hands ? "hands" : "either";
}

// --- What the app has learned -----------------------------------------------
// One counter per (block kind, task category). Not per block TITLE: "Deep
// Work" and "Focus Block" are the same habit wearing two names, and learning
// them separately means learning neither.

export type BlendMemory = Record<string, number>;
const KEY = "jarvis.schedule.blend.v1";

export function memKey(kind: BlockKind, categoryId: string): string {
  return kind + "|" + categoryId;
}

export function loadBlendMemory(storage: Pick<Storage, "getItem"> = localStorage): BlendMemory {
  try {
    const p = JSON.parse(storage.getItem(KEY) || "{}") as unknown;
    if (typeof p !== "object" || p === null || Array.isArray(p)) return {};
    const out: BlendMemory = {};
    for (const [k, v] of Object.entries(p as Record<string, unknown>)) if (typeof v === "number") out[k] = v;
    return out;
  } catch {
    return {};
  }
}

export function recordBlend(
  kind: BlockKind,
  categoryId: string,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): BlendMemory {
  if (!categoryId) return loadBlendMemory(storage);
  const cur = loadBlendMemory(storage);
  const k = memKey(kind, categoryId);
  const next = { ...cur, [k]: (cur[k] ?? 0) + 1 };
  try { storage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}

// Two is the threshold for saying "usually". Once is a coincidence and the
// app should not narrate a coincidence back at you as if it knew something.
export const LEARNED_AT = 2;

// --- The fit ----------------------------------------------------------------

export interface BlendTask {
  id: string;
  text: string;
  category: string;
  done?: boolean;
  due?: string | null;
  projectId?: string;
}

export interface Fit {
  task: BlendTask;
  score: number;
  // One short line saying WHY, in the app's voice. Never a percentage and
  // never "87% match": a confidence number is a thing you argue with.
  why: string;
}

// Hard no. Separate from scoring on purpose: a low score means "probably not
// this one", and a block that is unsafe or absurd for a task is not a low
// score, it is an exclusion.
export function blocked(kind: BlockKind, task: BlendTask): boolean {
  const d = demandOf(task.text);
  if ((kind === "moving" || kind === "physical") && d === "hands") return true;
  return false;
}

export function fitScore(
  e: Pick<EventItem["data"], "title" | "location" | "category">,
  task: BlendTask,
  mem: BlendMemory,
): Fit | null {
  const kind = blockKind(e);
  if (blocked(kind, task)) return null;
  const d = demandOf(task.text);
  let score = 0;
  let why = "";

  // The blend Dave named. A call rides along with a drive, and that is worth
  // more than any category bookkeeping, because it is time he would not have
  // spent otherwise.
  if ((kind === "moving" || kind === "waiting") && d === "voice") {
    score += 6;
    why = kind === "moving" ? "You can do this while you move" : "Fits the wait";
  } else if (kind === "physical" && d === "voice") {
    score += 3;
    why = "Hands free";
  }

  // Learned: this category has landed in this kind of block before.
  const seen = mem[memKey(kind, task.category)] ?? 0;
  if (seen >= LEARNED_AT) {
    score += 4;
    if (!why) why = "This usually goes here";
  } else if (seen === 1) {
    score += 1;
  }

  // Same category as the block itself. Weakest signal of the three, because
  // it is bookkeeping rather than observation, but it is right often enough
  // to be worth a point.
  if (task.category && e.category && task.category === e.category) {
    score += 3;
    if (!why) why = "Same as this block";
  }

  // A deep block is for things that take a head, which is exactly the set
  // that is NOT a two-minute phone call.
  if (kind === "deep" && d === "hands") {
    score += 3;
    if (!why) why = "Real work, real block";
  }

  if (score <= 0) return null;
  return { task, score, why: why || "Fits here" };
}

// The ranked offer. Excluded tasks never appear; done tasks and tasks already
// attached never appear; ties break toward the one with a due date, then the
// shorter one, because the short one is the one he will actually do.
export function suggestFor(
  e: Pick<EventItem["data"], "title" | "location" | "category" | "taskIds">,
  tasks: BlendTask[],
  mem: BlendMemory,
  max = 3,
): Fit[] {
  const already = new Set(e.taskIds ?? []);
  return tasks
    .filter((t) => !t.done && !already.has(t.id))
    .map((t) => fitScore(e, t, mem))
    .filter((f): f is Fit => !!f)
    .sort((a, b) =>
      b.score - a.score ||
      Number(!!b.task.due) - Number(!!a.task.due) ||
      a.task.text.length - b.task.text.length ||
      a.task.text.localeCompare(b.task.text))
    .slice(0, max);
}

// The single best offer, and only when it is clearly the best. A one-tap
// suggestion that is a coin flip between two tasks is worse than no
// suggestion, because tapping it becomes a gamble instead of a shortcut.
export const CONFIDENT_AT = 5;

export function bestFor(
  e: Pick<EventItem["data"], "title" | "location" | "category" | "taskIds">,
  tasks: BlendTask[],
  mem: BlendMemory,
): Fit | null {
  const top = suggestFor(e, tasks, mem, 2);
  const first = top[0];
  if (!first || first.score < CONFIDENT_AT) return null;
  return first;
}


// ONE OFFER PER TASK, ACROSS THE WHOLE DAY (caught on screen 2026-08-21: the
// same call was offered under two different blocks, and tapping both would
// have attached it twice). A task belongs to its best block; every other
// block offering it is noise pretending to be a suggestion.
//
// Blocks are considered in the order given (which is the order of the day),
// and a tie goes to the earlier block, because the earlier block is the one
// he reaches first.
export function bestPerBlock(
  events: { id: string; data: Parameters<typeof bestFor>[0] }[],
  tasks: BlendTask[],
  mem: BlendMemory,
): Record<string, Fit> {
  const claimed = new Set<string>();
  const out: Record<string, Fit> = {};
  // Whoever fits best wins the task, not whoever is asked first.
  const ranked = events
    .map((e) => ({ e, fits: suggestFor(e.data, tasks, mem, 4) }))
    .flatMap(({ e, fits }) => fits.map((f) => ({ eventId: e.id, f })))
    .sort((a, b) => b.f.score - a.f.score);
  for (const { eventId, f } of ranked) {
    if (out[eventId] || claimed.has(f.task.id)) continue;
    if (f.score < CONFIDENT_AT) continue;
    out[eventId] = f;
    claimed.add(f.task.id);
  }
  return out;
}
