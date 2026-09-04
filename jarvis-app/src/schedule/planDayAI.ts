import { JARVIS_VOICE } from "../ai/voice";
import type { AIService, AIMessage } from "../ai/AIService";
import type { EventItem } from "./types";
import { fmtTime } from "./calendar";
import { effectiveLevel, aiCallAllowed, refusalMessage } from "../ai/aiGate";
import { getAIControl } from "../ai/levelStore";

// The AI's job: order the chosen tasks by priority and estimate a realistic
// length for each. Placement stays deterministic (planDay), so the model can
// never produce overlaps. Output is a tiny JSON array, well within the proxy's
// token cap.
export interface AIPlanItem { id: string; minutes: number }
export interface PlanPick { id: string; text: string; category: string; overdue: boolean }

// Extra planning context, all optional so a bare call behaves exactly as before.
// work: the user's work hours. energy: their inferred peak-focus window, so the
// hardest tasks land there (Phase 2). gentle: yesterday felt heavy, so keep
// today lighter (Phase 2). profile: the same assembled Brain context
// (contextToText output, Life Philosophy / Values / How You Write / habits /
// completion patterns / etc.) every other AI feature in JARVIS already reads
// (Brain Personalization Phase 1, 2026-08-06). timeoutMs: override the AI wait.
export interface AIPlanOpts {
  work?: { startMin: number; endMin: number };
  energy?: { chronotype: "morning" | "evening"; peakStartMin: number; peakEndMin: number };
  gentle?: boolean;
  profile?: string;
  timeoutMs?: number;
  // B5 (2026-09-04): this one function serves both a tap ("Plan It") and a
  // mount-effect auto-refine (PlanDaySheet.tsx's runAI, launched on open, no
  // tap at all) -- callers must say which, so aiCallAllowed can actually
  // refuse the auto-refine at "On Request" while still letting the tap
  // through. Defaults to false (a real request) so a caller that forgets
  // this fails toward permissive, matching AIService.complete's own default;
  // both current callers pass it explicitly regardless.
  background?: boolean;
  // Brain Layer 2 (item 04): the user's strands, each with its real id. When
  // present the model must say WHICH facts changed its plan (leaned_on), and
  // only cited ids that exist survive the parse. Honest attribution became
  // possible the day outputs were forced structured (item 12); before that,
  // asking a model for its reasons produced decoration, which is why the
  // design doc banned faking them.
  //
  // S4-Q24 (2026-09-04): strength rides along too, so the prompt can tell a
  // rule ("family dinner is non-negotiable") from an ordinary influence
  // ("brainstorms best at night") instead of rendering both as one flat
  // list of equally-weighted suggestions. Optional and defaults to an
  // influence, so a caller that has not read strength yet (there was none
  // to read before this) behaves exactly as it always did.
  strands?: { id: string; text: string; strength?: "influence" | "rule" }[];
}

export interface AIPlanResult {
  items: AIPlanItem[];
  // Texts of the strands the model says it leaned on, verified against the
  // ids it was given. Empty when no strands were sent or none were used.
  leanedOn: string[];
}

function label(hhmm: string): string { const t = fmtTime(hhmm); return `${t.time} ${t.ap}`; }
function fromMin(t: number): string { const m = Math.max(0, Math.min(1439, t)); return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; }

export function planDaySystem(): string {
  return [
    JARVIS_VOICE,
    "Task: you are, planning the user's working day.",
    "You are given a set of tasks to schedule and the events already fixed on their calendar.",
    "Your job: choose a smart ORDER for the tasks and estimate a realistic DURATION in minutes for each.",
    "Rules:",
    "- Order by what matters most: overdue and time-sensitive tasks first, then batch similar work together so the day flows.",
    "- Estimate honest durations from each task's wording. Quick admin, messages, or errands are short (10-20 min). Focused, creative, or writing work is longer (45-90 min). Do not be optimistic; people underestimate.",
    "- Durations must be whole multiples of 5, no less than 10 and no more than 180.",
    "- Include every task id you are given, exactly once. Do not invent ids.",
    "- Facts listed under \"Rules\" are constraints on this person's day, not preferences: never plan in a way that violates one, even if it means a less efficient order. Facts listed under \"Facts JARVIS has learned\" are optional context to lean on or ignore.",
    "- If facts about this person are listed with ids in brackets, and any fact changed your order or a duration, cite that fact's id in leaned_on. Cite only facts you actually used; an empty list is a fine answer.",
    "- Reply with ONLY JSON, no prose and no code fences, items in priority order:",
    '  {"items":[{"id":"THE_ID","minutes":45}],"leaned_on":[]}',
  ].join("\n");
}

// Forced shape for the plan reply (item 12 structured outputs).
export const PLAN_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, minutes: { type: "integer" } },
        required: ["id", "minutes"],
      },
    },
    leaned_on: { type: "array", items: { type: "string" }, description: "ids of the listed personal facts that changed the plan; empty when none did" },
  },
  required: ["items"],
};

export function planDayUserMessage(picks: PlanPick[], events: EventItem[], startMin: number, endMin: number, opts: AIPlanOpts = {}): string {
  const { work, energy, gentle, profile } = opts;
  const taskLines = picks.map((p) => `- [id: ${p.id}] ${p.text}${p.category ? ` (${p.category})` : ""}${p.overdue ? " [OVERDUE]" : ""}`);
  const evLines = events.length
    ? events
        .slice()
        .sort((a, b) => a.data.start.localeCompare(b.data.start))
        .map((e) => `- ${label(e.data.start)}${e.data.end ? `-${label(e.data.end)}` : ""} ${e.data.title}`)
    : ["- (nothing scheduled yet)"];
  const profileLine = profile?.trim() ? `About this person, from their JARVIS profile:\n${profile.trim()}` : "";
  // S4-Q24: a rule and a preference no longer render as one flat list. Only
  // a strand the person deliberately marked (strength "rule") lands here;
  // everything else, including every derivation-authored strand, is an
  // influence, since nothing in the app is allowed to promote one on its own.
  const rules = (opts.strands ?? []).filter((s) => s.strength === "rule");
  const influences = (opts.strands ?? []).filter((s) => s.strength !== "rule");
  const ruleLines = rules.length
    ? `Rules about this person you MUST respect, no exceptions:\n${rules.map((s) => `- [${s.id}] ${s.text}`).join("\n")}`
    : "";
  const strandLines = influences.length
    ? `Facts JARVIS has learned about this person (cite an id in leaned_on ONLY if the fact changed your plan):\n${influences.map((s) => `- [${s.id}] ${s.text}`).join("\n")}`
    : "";
  const workLine = work
    ? `Work hours are ${label(fromMin(work.startMin))} to ${label(fromMin(work.endMin))}. Schedule focused, deep, or work-category tasks inside work hours (deep work earlier, admin midday) and personal tasks outside them.`
    : "";
  const energyLine = energy
    ? `The user's focus peaks ${energy.chronotype === "morning" ? "earlier" : "later"} in the day, around ${label(fromMin(energy.peakStartMin))} to ${label(fromMin(energy.peakEndMin))}. Put the hardest, most demanding tasks in that window, and keep light admin or quick errands out of it.`
    : "";
  const gentleLine = gentle
    ? "Yesterday was a heavy day for the user, so keep today gentle: lean toward shorter, realistic durations and do not fill every minute. A calmer day is the goal."
    : "";
  return [
    `Plan the window ${label(fromMin(startMin))} to ${label(fromMin(endMin))} today.`,
    ...(profileLine ? [profileLine] : []),
    ...(ruleLines ? [ruleLines] : []),
    ...(strandLines ? [strandLines] : []),
    ...(workLine ? [workLine] : []),
    ...(energyLine ? [energyLine] : []),
    ...(gentleLine ? [gentleLine] : []),
    "",
    "Tasks to schedule:",
    ...taskLines,
    "",
    "Already on the calendar (fixed, work around these):",
    ...evLines,
  ].join("\n");
}

// Tolerant parser: strips fences, accepts the structured object shape or the
// legacy bare array, keeps only known ids (once each), clamps minutes to
// 5-min steps within 10-180, and appends any task the model dropped so every
// chosen task always gets planned. leaned_on survives ONLY for strand ids
// that were actually offered: an invented citation is not attribution, it is
// decoration, and it dies here.
export function parsePlanReply(raw: string, validIds: string[], strandIds: string[] = []): { items: AIPlanItem[]; leanedOnIds: string[] } {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const valid = new Set(validIds);
  const seen = new Set<string>();
  const out: AIPlanItem[] = [];
  let leanedOnIds: string[] = [];
  try {
    const parsed: unknown = JSON.parse(cleaned);
    const arr = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { items?: unknown })?.items)
        ? (parsed as { items: unknown[] }).items
        : [];
    for (const it of arr) {
      const rec = it as { id?: unknown; minutes?: unknown };
      const id = typeof rec?.id === "string" ? rec.id : "";
      if (!valid.has(id) || seen.has(id)) continue;
      let m = Math.round(Number(rec?.minutes) / 5) * 5;
      if (!Number.isFinite(m) || m <= 0) m = 45;
      m = Math.max(10, Math.min(180, m));
      out.push({ id, minutes: m });
      seen.add(id);
    }
    const cited = (parsed as { leaned_on?: unknown })?.leaned_on;
    if (Array.isArray(cited)) {
      const offered = new Set(strandIds);
      leanedOnIds = [...new Set(cited.filter((c): c is string => typeof c === "string" && offered.has(c)))];
    }
  } catch {
    /* not JSON; fall through to defaults */
  }
  for (const id of validIds) if (!seen.has(id)) out.push({ id, minutes: 45 });
  return { items: out, leanedOnIds };
}

// Legacy shape, kept for existing callers and tests.
export function parseAIPlan(raw: string, validIds: string[]): AIPlanItem[] {
  return parsePlanReply(raw, validIds).items;
}

export const AI_PLAN_TIMEOUT_MS = 20000;

export async function aiPlanDay(
  ai: AIService,
  picks: PlanPick[],
  events: EventItem[],
  startMin: number,
  endMin: number,
  opts: AIPlanOpts = {},
): Promise<AIPlanResult> {
  // B3-9 (2026-09-04): AI Control offers five per-feature pins; this single
  // call is what BOTH "Morning Plan" and "Estimates" name (its own job
  // comment above: order the picks AND estimate a length for each), and
  // neither pin was ever passed to it, so turning either off still ran it
  // at the master level. One call, gated by the more restrictive of the two:
  // pin: "morningPlan" is what AIService and the What Ran log see this call
  // as, and the estimates pin is checked here first so it can refuse the
  // same call the ordering pin would allow.
  const estimatesLevel = effectiveLevel(getAIControl(), "estimates");
  if (!aiCallAllowed(estimatesLevel, false)) throw new Error(refusalMessage(estimatesLevel, false));
  const timeoutMs = opts.timeoutMs ?? AI_PLAN_TIMEOUT_MS;
  const messages: AIMessage[] = [{ role: "user", content: planDayUserMessage(picks, events, startMin, endMin, opts) }];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_res, rej) => { timer = setTimeout(() => rej(new Error("AI planning timed out")), timeoutMs); });
  try {
    const text = await Promise.race([
      ai.complete(messages, planDaySystem(), { kind: "plan", pin: "morningPlan", background: opts.background ?? false, schema: PLAN_SCHEMA }),
      timeout,
    ]);
    const strandIds = (opts.strands ?? []).map((s) => s.id);
    const { items, leanedOnIds } = parsePlanReply(text, picks.map((p) => p.id), strandIds);
    const textOf = new Map((opts.strands ?? []).map((s) => [s.id, s.text]));
    return { items, leanedOn: leanedOnIds.map((id) => textOf.get(id)!).filter(Boolean) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
