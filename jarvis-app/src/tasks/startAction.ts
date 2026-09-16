import type { TaskData } from "../notes/types";
import { isMachineAddress } from "../messages/noReply";

// START MEANS SOMETHING IS OPEN (Dave 2026-09-16, on the Start button: "a
// large Start button implies useful assistance, yet it merely starts a
// clock. The existing First Step logic is more valuable").
//
// He is right twice. Start booked a fifteen-minute block and called that
// help, and First Step, which works out the smallest real opening move, was
// wired to one row in the app: the task that had already been overdue five
// days. The good logic was reachable only once you were already failing.
//
// This module is the one resolver behind every start surface. It answers a
// single question about a task, a project or a goal: WHAT IS ALREADY
// OPENABLE HERE? The answer is a structured action. The surface that
// renders it is free to be a row, a card or a screen, and a clock is not
// one of the answers it can give.
//
// Laws, each held by laws/start.test.ts:
//   - It never returns a timer and never books a block. A clock is optional
//     support, chosen after the work is on screen (today/liveFifteen.ts is
//     still the clock; it is simply no longer what Start means).
//   - It never invents a document, a recipient, a URL or a result. Every
//     fact it carries is handed in by a caller that read a real record, and
//     anything genuinely absent is named in `missing` rather than filled in.
//   - Opening is not finishing. `completion.completesTask` is false on
//     every action this module can return.
//   - A blocked thing stays blocked, and "blocked" only ever means somebody
//     said so: the blocker is written by Something's in the Way and by
//     nothing else in the app.
//   - Deterministic first. The AI enhancement in startDraft.ts improves an
//     action that already works without it.

export type StartKind =
  | "resume"
  | "open_child_task"
  | "open_resource"
  | "prepare_draft"
  | "capture_next_action"
  | "resolve_blocker";

/** Where a fact on the working surface came from. The screen renders these
 *  as the facts line, so a person can see what the app actually read. */
export interface StartSource {
  kind: "note" | "thread" | "event" | "project" | "person" | "url" | "step" | "saved" | "blocker";
  /** The record's own id, when there is one to open. */
  id?: string;
  /** What the facts line says. A fragment, never a sentence. */
  label: string;
}

/** Where the primary action lands when it navigates rather than writes.
 *  Every kind here is one AppShell's navigateToEntity already knows, except
 *  `url`, which is a real link the user themselves stored. */
export interface StartDestination {
  kind: "note" | "task" | "event" | "thread" | "project" | "url";
  id: string;
}

/** What pressing the primary button does to stored records. The point of
 *  the type is that `completesTask` cannot be true. */
export interface StartCompletion {
  /** Exactly which write the primary performs. Split finer than it was
   *  (2026-09-16, the Mark It Done audit): "step" covered both TICKING a
   *  step and INVENTING one, and the line under the button could not tell
   *  the truth about both. */
  saves: "draft" | "note" | "step_new" | "step_tick" | "none";
  completesTask: false;
}

export interface StartAction {
  kind: StartKind;
  /** The eyebrow over the work area: what this opening move IS. */
  headline: string;
  /** The one primary button's exact verb. */
  verb: string;
  /** The row and card launch label. */
  launchLabel: "Start" | "Resume" | "Unblock";
  /** One line under the name saying what is ready, for the list and the top
   *  card. A fragment, and never a promise the action cannot keep. */
  ready: string;
  /** Present when the primary action navigates to a real record. */
  destination?: StartDestination;
  /** Present when the work area is a text box: the one focused question. */
  prompt?: string;
  /** Seed text for the work area, from saved work or a deterministic
   *  template. Never model output at this layer. */
  seed?: string;
  /** What the app actually read. */
  sources: StartSource[];
  /** Named holes, rendered as explicit placeholders and never filled in. */
  missing: string[];
  completion: StartCompletion;
}

/** The thing being started. Projects and goals arrive here too: they start
 *  through a real child, never through a plan invented on the spot. */
export interface StartTarget {
  kind: "task" | "project" | "goal";
  id: string;
  title: string;
  /** Present for a task. */
  data?: TaskData;
}

/** A child the user already wrote. The caller owns the ordering and the
 *  dependency filtering; this module never re-sorts what they arranged. */
export interface StartChild {
  id: string;
  title: string;
}

/** The resume point and the work in progress, as stored by startStore.ts. */
export interface SavedStart {
  entityId: string;
  kind: StartKind;
  /** What they had typed. */
  draft?: string;
  /** Where they said they stopped, in their words. */
  stopPoint?: string;
  savedAt: number;
}

/** Everything a caller read from real records, handed in so this module
 *  stays pure and cannot reach for anything that is not really there. */
export interface StartContext {
  /** Work already in progress on this exact entity. */
  saved?: SavedStart | null;
  /** Unfinished children, already ordered and already filtered by the
   *  caller for dependencies and access. */
  children?: StartChild[];
  /** A linked record the caller confirmed exists. Never a guess. */
  resource?: { kind: StartDestination["kind"]; id: string; label: string } | null;
  /** The address a mail-born task came from, so an automated sender is
   *  never turned into somebody to write back to. */
  fromEmailAddress?: string;
  /** Verified grounding for a draft: lines that came out of real records. */
  grounding?: { lines: string[]; sources: StartSource[]; missing: string[] };
}

// ---------------------------------------------------------------------------
// The blocker
// ---------------------------------------------------------------------------

/** What is in the way, in the user's own words, with the day they said it.
 *  Nothing in the app infers this. It is written by Something's in the Way
 *  and cleared by the user, so "blocked" always means somebody said so. */
export interface BlockedBy {
  what: string;
  since: string;
}

export function blockerOf(data: TaskData | undefined): BlockedBy | null {
  const b = data?.blockedBy;
  if (!b || typeof b !== "object") return null;
  if (typeof b.what !== "string" || !b.what.trim()) return null;
  return { what: b.what.trim(), since: typeof b.since === "string" ? b.since : "" };
}

// ---------------------------------------------------------------------------
// Task-type templates
// ---------------------------------------------------------------------------

// A CLASSIFIER MAY CHOOSE A QUESTION, NEVER AN INSTRUCTION (2026-09-16,
// after Dave photographed "Put what you need for set up wallet card within
// reach" and asked how that was a first step).
//
// It was not one. It was the task's own title pasted into a sentence frame,
// which is a mad-lib: confident, grammatical and empty. Reading a verb off
// a title is a GUESS, and the rule this file now keeps is that a guess is
// only ever allowed to pick which question gets asked. Get the guess wrong
// and the cost is a slightly-off question, which a person answers in their
// own words anyway. Get an invented instruction wrong and the app has
// asserted nonsense and asked to be believed.
//
// So there are two shapes, not four, and both only decide a prompt: mail
// is worth knowing because it also gates a grounded draft, and a thing to
// go and look at gets a sharper question than the general one.
const INSPECT = /^(clean up|clean out|review|check|audit|inspect|look at|go through|read|sort out|triage|assess|figure out|work out|decide|research|compare)\b/i;
const COMMS = /^(send|email|e-mail|reply|respond|write|text|message|call|ring|ask|tell|invite|confirm|follow up|follow-up|check in|check-in|remind|thank|update|notify|ping|share|forward)\b/i;

export type TaskShape = "comms" | "inspect" | "vague";

export function shapeOf(title: string): TaskShape {
  const t = title.trim();
  if (INSPECT.test(t)) return "inspect";
  if (COMMS.test(t)) return "comms";
  return "vague";
}

/** The one question a thing with nothing linked gets asked. One at a time,
 *  always about the work, never about mood, energy, or difficulty. The
 *  answer is the user's, in their words, and it becomes the task's first
 *  step, which is the whole of the value here: the app does not know what
 *  the first move is, and asking beats inventing. */
export function promptFor(shape: TaskShape, kind: StartTarget["kind"]): string {
  if (kind === "project" || kind === "goal") return "What is one job this needs done?";
  switch (shape) {
    case "comms": return "Who needs to hear it, and what do they need to know?";
    case "inspect": return "What is the first thing to look at?";
    default: return "What is the first thing you would do?";
  }
}

// ---------------------------------------------------------------------------
// The resolver
// ---------------------------------------------------------------------------

/**
 * The one opening move for this thing, right now.
 *
 * Order, and the reason for each place in it:
 *   0. A blocker the user named beats everything. Presenting a blocked
 *      thing as ready is the lie this whole feature exists to stop telling.
 *   1. Their own saved work, because the best opening move is the one they
 *      already made.
 *   2. A child they wrote, in their order. A project starts through a real
 *      child, never through a plan the app made up.
 *   3. A linked record, because opening the actual thing beats describing it.
 *   4. Grounded assistance, only where a caller verified real facts.
 *   5. The task-type template.
 *   6. One concrete question.
 */
export function startAction(target: StartTarget, ctx: StartContext = {}): StartAction {
  const title = target.title.trim();

  // 0. Blocked.
  const blocked = blockerOf(target.data);
  if (blocked) {
    return {
      kind: "resolve_blocker",
      headline: "What is in the way",
      verb: "Save Draft",
      launchLabel: "Unblock",
      ready: blocked.what,
      prompt: "Who can move this, and what do you need from them?",
      sources: [{ kind: "blocker", label: blocked.what }],
      missing: [],
      // A nudge is a draft. It does not clear the blocker, and the screen
      // says so: only the real prerequisite landing does that.
      completion: { saves: "draft", completesTask: false },
    };
  }

  // 1. Saved work. A box he opened and typed nothing into is not work; a
  // stopping point with no draft still is, because it is where he left off.
  const saved = ctx.saved;
  if (saved && (saved.draft?.trim() || saved.stopPoint?.trim())) {
    return {
      kind: "resume",
      headline: "Where you left off",
      verb: verbForSaved(saved.kind),
      launchLabel: "Resume",
      ready: saved.stopPoint?.trim() || "Your draft is waiting",
      ...(saved.draft ? { seed: saved.draft } : {}),
      prompt: promptFor(shapeOf(title), target.kind),
      sources: [{ kind: "saved", label: "Saved on this device" }],
      missing: [],
      completion: { saves: savesForSaved(saved.kind), completesTask: false },
    };
  }

  // 2. A child the user wrote. Steps ride the task; children ride a project
  // or a goal. Either way the first unfinished one in THEIR order is it.
  const step = firstOpenStep(target.data);
  if (step) {
    return {
      kind: "open_child_task",
      // It is HIS step: either he wrote it on the task, or he answered the
      // question below and this is the answer coming back. The app never
      // authors one, which is what makes offering to tick it honest.
      headline: "Your next step",
      verb: "Mark It Done",
      launchLabel: "Start",
      ready: step.text,
      sources: [{ kind: "step", label: "Step " + (step.index + 1) + " of " + (target.data?.steps?.length ?? 1) }],
      missing: [],
      // Ticking a step ticks the step. The task it belongs to is untouched,
      // which is already the rule in TasksService.setSteps and stays true
      // when the tick happens from here.
      completion: { saves: "step_tick", completesTask: false },
    };
  }
  const child = ctx.children?.[0];
  if (child) {
    return {
      kind: "open_child_task",
      headline: target.kind === "goal" ? "The next thing under it" : "Your next task",
      verb: "Open This Task",
      launchLabel: "Start",
      ready: child.title,
      destination: { kind: "task", id: child.id },
      sources: [{ kind: "project", id: target.id, label: target.title }],
      missing: [],
      completion: { saves: "none", completesTask: false },
    };
  }

  // 3. A linked record somebody can open.
  const res = ctx.resource;
  if (res) {
    return {
      kind: "open_resource",
      headline: "What this is linked to",
      verb: verbForResource(res.kind),
      launchLabel: "Start",
      ready: res.label,
      destination: { kind: res.kind, id: res.id },
      sources: [{ kind: sourceKindFor(res.kind), id: res.id, label: res.label }],
      missing: [],
      completion: { saves: "none", completesTask: false },
    };
  }

  const shape = shapeOf(title);
  // A build that failed is a thing to go look at, not a correspondent. An
  // automated address never becomes somebody to write back to, whatever the
  // subject line it arrived under says.
  const machine = !!ctx.fromEmailAddress && isMachineAddress(ctx.fromEmailAddress);

  // 4 and 5. A draft, grounded where a caller verified the grounding and
  // running off the template where it did not.
  if (shape === "comms" && !machine && target.kind === "task") {
    const g = ctx.grounding;
    const lines = g?.lines.filter((l) => l.trim()) ?? [];
    return {
      kind: "prepare_draft",
      headline: "Review a prepared message",
      verb: "Save Draft",
      launchLabel: "Start",
      ready: lines.length > 0 ? "Editable message ready" : "Start the message",
      seed: lines.join("\n\n"),
      prompt: promptFor("comms", target.kind),
      sources: g?.sources ?? [],
      missing: g?.missing ?? [],
      // Saving a draft saves a draft. Choosing who it goes to, and sending
      // it, stay exactly where they already live.
      completion: { saves: "draft", completesTask: false },
    };
  }

  // 6. One concrete question, and nothing else asked.
  //
  // This is the honest floor of the whole feature. When the app knows
  // nothing about a task, the valuable thing it can do is ask one good
  // question and KEEP the answer, so the next visit opens on a first step
  // its owner wrote. The thing it must not do is manufacture a first step
  // and ask to be believed.
  return {
    kind: "capture_next_action",
    headline: "Name the first step",
    verb: "Save First Step",
    launchLabel: "Start",
    ready: machine ? "Capture the error to look at" : "Start by naming the first step",
    prompt: machine ? "Which error do you need to look at?" : promptFor(shape, target.kind),
    sources: [],
    missing: [],
    // It becomes step one, in his words, and comes back as the opening move
    // next time. Undone, because naming a step is not doing it.
    completion: { saves: "step_new", completesTask: false },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function firstOpenStep(data: TaskData | undefined): { text: string; index: number } | null {
  const steps = data?.steps ?? [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    if (!s.done && s.text.trim()) return { text: s.text.trim(), index: i };
  }
  return null;
}

function verbForSaved(kind: StartKind): string {
  if (kind === "capture_next_action") return "Save First Step";
  if (kind === "open_child_task") return "Mark It Done";
  return "Save Draft";
}

function savesForSaved(kind: StartKind): StartCompletion["saves"] {
  if (kind === "capture_next_action") return "step_new";
  if (kind === "open_child_task") return "step_tick";
  return "draft";
}

function verbForResource(kind: StartDestination["kind"]): string {
  switch (kind) {
    case "note": return "Open Note";
    case "thread": return "Open the Email";
    case "event": return "Open the Event";
    case "project": return "Open the Project";
    case "url": return "Open the Page";
    default: return "Open It";
  }
}

function sourceKindFor(kind: StartDestination["kind"]): StartSource["kind"] {
  switch (kind) {
    case "note": return "note";
    case "thread": return "thread";
    case "event": return "event";
    case "project": return "project";
    default: return "url";
  }
}


// ---------------------------------------------------------------------------
// Make This Smaller
// ---------------------------------------------------------------------------

/**
 * Simplify THIS action, never the whole task again (Dave 2026-09-16: "A
 * message draft can begin by filling one missing detail; a vague project can
 * begin by naming one repeated job").
 *
 * It returns null when there is nothing honest left to shrink, and the
 * screen then offers direct editing or a blocker note instead of looping
 * into ever tinier instructions. Two things it deliberately never does:
 * invent a smaller step that is not really smaller, and hand somebody a
 * two-minute chore they did not ask to be given.
 */
export function smallerAction(a: StartAction, target: StartTarget): StartAction | null {
  const shrunk = (over: Partial<StartAction>): StartAction => ({ ...a, ...over });

  switch (a.kind) {
    case "prepare_draft": {
      // The hole the draft already named is the smallest real move on it.
      const hole = a.missing[0];
      if (hole) {
        return shrunk({
          kind: "capture_next_action",
          headline: "One detail first",
          prompt: hole,
          verb: "Save Draft",
          seed: "",
          completion: { saves: "draft", completesTask: false },
        });
      }
      return shrunk({
        kind: "capture_next_action",
        headline: "One line first",
        prompt: "Write the first line only",
        verb: "Save Draft",
        completion: { saves: "draft", completesTask: false },
      });
    }
    case "open_resource":
      return shrunk({
        kind: "capture_next_action",
        headline: "Name what you are looking for",
        prompt: "Name one thing to look at first",
        verb: "Save First Step",
        seed: "",
        destination: undefined,
        completion: { saves: "step_new", completesTask: false },
      });
    case "resolve_blocker":
      return shrunk({
        kind: "capture_next_action",
        headline: "Name who can move it",
        prompt: "Who can move this?",
        verb: "Save First Step",
        seed: "",
        completion: { saves: "step_new", completesTask: false },
      });
    case "resume":
    case "open_child_task":
    case "capture_next_action":
    default:
      // One step the user wrote, one question already asked, and work
      // already in progress are all as small as this honestly gets. Void
      // the argument rather than pretending it was consulted.
      void target;
      return null;
  }
}

/** The four answers to Something's in the Way. A short list on purpose: a
 *  diagnostic questionnaire in front of somebody who is stuck is the thing
 *  this feature exists to remove. */
export const IN_THE_WAY = ["Too Big", "Missing Information", "Different Task", "Stop Here"] as const;
export type InTheWay = (typeof IN_THE_WAY)[number];
