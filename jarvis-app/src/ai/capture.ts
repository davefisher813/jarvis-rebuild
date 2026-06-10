import type { AIContext } from "./context";
import { contextToText } from "./context";
import type { Category } from "../categories/types";
import type { TasksService } from "../tasks/TasksService";
import type { ScheduleService } from "../schedule/ScheduleService";
import type { NotesService } from "../notes/NotesService";

export interface CaptureResult {
  kind: "task" | "event" | "note";
  title: string;
  date?: string; // yyyy-mm-dd
  start?: string; // HH:MM 24h
  category?: string; // category NAME
  notes?: string;
}

// System prompt: route a quick note to task/event/note, return ONLY JSON.
export function captureSystemPrompt(ctx: AIContext, today: string): string {
  const cats = ctx.categories.length ? ctx.categories.join(", ") : "none";
  return [
    "You are JARVIS, a personal assistant that files quick notes.",
    `Today is ${today} (ISO). Resolve relative dates ("tomorrow", "Friday") against it.`,
    "Decide if the input is a task, an event (has a time or specific day), or a note (a thought to keep).",
    `Pick a category by NAME from this list when one clearly fits: ${cats}.`,
    'Reply with ONLY a JSON object, no prose, no code fences: {"kind":"task|event|note","title":string,"date":"yyyy-mm-dd"(optional),"start":"HH:MM"(optional, 24h),"category":string(optional),"notes":string(optional)}.',
    "",
    "User context:",
    contextToText(ctx),
  ].join("\n");
}

export function parseCapture(raw: string): CaptureResult | null {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    const o = JSON.parse(cleaned) as Partial<CaptureResult>;
    if (o && (o.kind === "task" || o.kind === "event" || o.kind === "note") && typeof o.title === "string" && o.title.trim()) {
      return o as CaptureResult;
    }
  } catch {
    /* not JSON */
  }
  return null;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

// Offline fallback used when the AI layer is not configured (e.g. the in-memory
// demo). A light heuristic: a time or day word makes it an event, else a task.
export function localParse(text: string, today: string): CaptureResult {
  const t = text.trim();
  const lower = t.toLowerCase();
  const timeMatch = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/) || lower.match(/\b(\d{1,2}):(\d{2})\b/);
  const hasDay = /\b(today|tomorrow|mon|tue|wed|thu|fri|sat|sun)/.test(lower);
  if (timeMatch || hasDay) {
    let start: string | undefined;
    if (timeMatch) {
      let h = parseInt(timeMatch[1] ?? "9", 10);
      const m = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      const ap = timeMatch[3];
      if (ap === "pm" && h < 12) h += 12;
      if (ap === "am" && h === 12) h = 0;
      start = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
    return { kind: "event", title: t, date: dayToISO(lower, today), start: start ?? "09:00" };
  }
  return { kind: "task", title: t };
}

function dayToISO(lower: string, today: string): string {
  const base = new Date(today + "T00:00:00");
  if (lower.includes("tomorrow")) { base.setDate(base.getDate() + 1); return iso(base); }
  if (lower.includes("today")) return iso(base);
  for (let i = 0; i < WEEKDAYS.length; i++) {
    if (lower.includes(WEEKDAYS[i]!.slice(0, 3))) {
      const diff = (i - base.getDay() + 7) % 7 || 7;
      base.setDate(base.getDate() + diff);
      return iso(base);
    }
  }
  return today;
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

interface ApplyServices {
  tasks: TasksService;
  schedule: ScheduleService;
  notes: NotesService;
}

export async function applyCapture(
  r: CaptureResult,
  svc: ApplyServices,
  categories: Category[],
  today: string,
): Promise<void> {
  const catId = r.category
    ? categories.find((c) => c.data.name.toLowerCase() === r.category!.toLowerCase())?.id
    : undefined;
  if (r.kind === "event") {
    await svc.schedule.createEvent(r.title, { date: r.date ?? today, start: r.start ?? "09:00", category: catId });
  } else if (r.kind === "note") {
    await svc.notes.createNote(r.title, catId ?? "");
  } else {
    await svc.tasks.createTask(r.title, { category: catId, due: r.date ?? null });
  }
}
