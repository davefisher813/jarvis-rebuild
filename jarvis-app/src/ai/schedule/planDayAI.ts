import type { AIService, AIMessage } from "../ai/AIService";
import type { EventItem } from "./types";
import { fmtTime } from "./calendar";

// The AI's job: order the chosen tasks by priority and estimate a realistic
// length for each. Placement stays deterministic (planDay), so the model can
// never produce overlaps. Output is a tiny JSON array, well within the proxy's
// token cap.
export interface AIPlanItem { id: string; minutes: number }
export interface PlanPick { id: string; text: string; category: string; overdue: boolean }

function label(hhmm: string): string { const t = fmtTime(hhmm); return `${t.time} ${t.ap}`; }
function fromMin(t: number): string { const m = Math.max(0, Math.min(1439, t)); return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; }

export function planDaySystem(): string {
  return [
    "You are JARVIS, planning the user's working day.",
    "You are given a set of tasks to schedule and the events already fixed on their calendar.",
    "Your job: choose a smart ORDER for the tasks and estimate a realistic DURATION in minutes for each.",
    "Rules:",
    "- Order by what matters most: overdue and time-sensitive tasks first, then batch similar work together so the day flows.",
    "- Estimate honest durations from each task's wording. Quick admin, messages, or errands are short (10-20 min). Focused, creative, or writing work is longer (45-90 min). Do not be optimistic; people underestimate.",
    "- Durations must be whole multiples of 5, no less than 10 and no more than 180.",
    "- Include every task id you are given, exactly once. Do not invent ids.",
    "- Reply with ONLY a JSON array, no prose and no code fences, in priority order:",
    '  [{"id":"THE_ID","minutes":45}]',
  ].join("\n");
}

export function planDayUserMessage(picks: PlanPick[], events: EventItem[], startMin: number, endMin: number): string {
  const taskLines = picks.map((p) => `- [id: ${p.id}] ${p.text}${p.category ? ` (${p.category})` : ""}${p.overdue ? " [OVERDUE]" : ""}`);
  const evLines = events.length
    ? events
        .slice()
        .sort((a, b) => a.data.start.localeCompare(b.data.start))
        .map((e) => `- ${label(e.data.start)}${e.data.end ? `-${label(e.data.end)}` : ""} ${e.data.title}`)
    : ["- (nothing scheduled yet)"];
  return [
    `Plan the window ${label(fromMin(startMin))} to ${label(fromMin(endMin))} today.`,
    "",
    "Tasks to schedule:",
    ...taskLines,
    "",
    "Already on the calendar (fixed, work around these):",
    ...evLines,
  ].join("\n");
}

// Tolerant parser: strips fences, keeps only known ids (once each), clamps
// minutes to 5-min steps within 10-180, and appends any task the model dropped
// so every chosen task always gets planned.
export function parseAIPlan(raw: string, validIds: string[]): AIPlanItem[] {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const valid = new Set(validIds);
  const seen = new Set<string>();
  const out: AIPlanItem[] = [];
  try {
    const arr = JSON.parse(cleaned);
    if (Array.isArray(arr)) {
      for (const it of arr) {
        const id = typeof it?.id === "string" ? it.id : "";
        if (!valid.has(id) || seen.has(id)) continue;
        let m = Math.round(Number(it?.minutes) / 5) * 5;
        if (!Number.isFinite(m) || m <= 0) m = 45;
        m = Math.max(10, Math.min(180, m));
        out.push({ id, minutes: m });
        seen.add(id);
      }
    }
  } catch {
    /* not JSON; fall through to defaults */
  }
  for (const id of validIds) if (!seen.has(id)) out.push({ id, minutes: 45 });
  return out;
}

export const AI_PLAN_TIMEOUT_MS = 20000;

export async function aiPlanDay(
  ai: AIService,
  picks: PlanPick[],
  events: EventItem[],
  startMin: number,
  endMin: number,
  timeoutMs: number = AI_PLAN_TIMEOUT_MS,
): Promise<AIPlanItem[]> {
  const messages: AIMessage[] = [{ role: "user", content: planDayUserMessage(picks, events, startMin, endMin) }];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_res, rej) => { timer = setTimeout(() => rej(new Error("AI planning timed out")), timeoutMs); });
  try {
    const text = await Promise.race([ai.complete(messages, planDaySystem()), timeout]);
    return parseAIPlan(text, picks.map((p) => p.id));
  } finally {
    if (timer) clearTimeout(timer);
  }
}
