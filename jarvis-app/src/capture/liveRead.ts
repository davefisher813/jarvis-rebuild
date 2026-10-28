import { parsePaste, type CaptureContext } from "../paste/deterministic";
import { readPrefix } from "../paste/prefixes";
import type { SavedEntity } from "../paste/smartPaste";

// THE LIVE READ (the research standard, Beloved App Visuals section 5 rule 12, 2026-10-19: "natural-language chips as you type").
// The box saves on Return and the receipt then says what was read, which is after the fact: a wrong read (a Thursday that was meant as the
// next one, a bill that was an expense) is only seen once it is saved. This reads the line AS IT IS TYPED with the same deterministic rules
// the save uses (paste/deterministic, paste/prefixes), and hands back the receipt's own entity shape, so the facts drawn under the box are
// the facts the receipt will draw, by the same function (QuickCapture's receiptFacts), never a second set of words.
//
// It says only what it is sure of. A line the rules are not sure of (the model may improve it), a plain note, and a task with nothing read
// off it say NOTHING: a row with nothing to say shows nothing, and a guess drawn as a fact is worse than no chip. It also says only what
// the save can do: with no Money ledger a "$50 rent" is not a bill here, with no Brain a fact is not a fact (smartPaste closes the same
// lanes the same way, and a line falls to the ordinary reads).

/** The stores the save can reach. A lane that is closed here is closed in smartPaste too, so the line reads as it will land. */
export interface LiveLanes { strands: boolean; decisions: boolean; ledger: boolean; tracker: boolean }

export interface LiveRead {
  /** What the one line will be saved as, in the shape the receipt's facts are drawn from. */
  entity: SavedEntity;
  /** The person and project the line named, by name (matched against the same lists the save matches). */
  names: { person?: string; project?: string };
  /** The area a #tag named, as an id. */
  area?: string;
  /** More than one line: the save makes this many, and only the count is said (Return saves them all, so it is the one surprise worth a word). */
  items?: number;
}

const LIVE_ID = "live";
// A paste of an article is prose; reading it on every keystroke says nothing and costs a frame.
const MAX_CHARS = 2000;

export function liveRead(text: string, today: string, ctx: CaptureContext, lanes: LiveLanes): LiveRead | null {
  const t = text.trim();
  if (!t || t.length > MAX_CHARS) return null;

  // A stated destination beats a guessed one (smartPaste, C-49): these lanes read before the ordinary rules do.
  const pre = readPrefix(t);
  if (pre && pre.kind === "remember" && lanes.strands) return { entity: { id: LIVE_ID, kind: "fact", title: pre.text, factType: pre.type }, names: {} };
  if (pre && pre.kind === "rule" && lanes.strands) return { entity: { id: LIVE_ID, kind: "fact", title: pre.text, rule: true }, names: {} };
  if (pre && pre.kind === "decision" && lanes.decisions) return { entity: { id: LIVE_ID, kind: "decision", title: pre.decision }, names: {} };

  const { entities } = parsePaste(t, today, ctx);
  if (entities.length > 1) return { entity: { id: LIVE_ID, kind: "task", title: "" }, names: {}, items: entities.length };
  const e = entities[0];
  if (!e || !e.confident) return null;

  const kind: SavedEntity["kind"] = e.bill && lanes.ledger ? "bill" : e.expense && lanes.tracker ? "expense" : e.kind;
  if (kind === "note") return null;
  if (kind === "fact" && !lanes.strands) return null;
  if (kind === "decision" && !lanes.decisions) return null;

  // A payment with no tracker to file it in is not a payment here: the "today" it assumed goes with it, so no date is claimed.
  const guessedDay = !!e.expense && kind !== "expense" && e.inferred.includes("date");
  const entity: SavedEntity = {
    id: LIVE_ID, kind, title: e.title,
    ...(e.date && !guessedDay ? { date: e.date } : {}),
    ...(e.start ? { start: e.start } : {}),
    ...(e.recurrence ? { recurrence: e.recurrence } : {}),
    ...(e.reminder ? { reminder: e.reminder } : {}),
    ...(kind === "bill" && e.bill ? { bill: e.bill } : {}),
    ...(kind === "expense" && e.expense ? { expense: e.expense } : {}),
    ...(e.factCategory ? { factCategory: e.factCategory } : {}),
    inferred: e.inferred,
  };
  // A contact's exact name is in the line: nobody is filed and the receipt offers them, so the live line names nobody either.
  const asking = (e.personChoices?.length ?? 0) > 0;
  const person = !asking && e.personId ? ctx.people?.find((p) => p.id === e.personId)?.name : undefined;
  const project = e.projectId ? ctx.projects?.find((p) => p.id === e.projectId)?.title : undefined;
  return { entity, names: { ...(person ? { person } : {}), ...(project ? { project } : {}) }, ...(e.category ? { area: e.category } : {}) };
}
