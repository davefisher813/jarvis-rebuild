import { JARVIS_VOICE } from "./voice";
import { noDashes } from "./suggestions";
import type { AIContext } from "./context";
import { contextToText } from "./context";
import type { Category } from "../categories/types";
import type { TasksService } from "../tasks/TasksService";
import type { ScheduleService } from "../schedule/ScheduleService";
import type { NotesService } from "../notes/NotesService";
import { suggestCategory } from "../schedule/memory";
import { todayISO as isoOf } from "../schedule/calendar";
import type { Recurrence } from "../notes/types";

const RECURRENCES: Recurrence[] = ["daily", "weekly", "monthly", "weekdays"];

export interface CaptureResult {
  kind: "task" | "event" | "note";
  title: string;
  date?: string; // yyyy-mm-dd
  start?: string; // HH:MM 24h
  // A category NAME from the AI path, or a category ID from a learned rule
  // (smartPaste.ts categoryFromRule). applyCapture accepts either; see
  // SHELL-F-06 below.
  category?: string;
  notes?: string;
  // UP-CORE-01 (2026-09-05): the four shapes the deterministic layer can now
  // read and the AI fallback is allowed to fill in. Every one is a field
  // TasksService already takes; applyCapture passes them straight through.
  recurrence?: Recurrence;
  reminder?: { time: string; days?: number[] };
  bill?: { amount: number };
  personId?: string;
  projectId?: string;
}

// Structured-output schema (item 12): sent with the capture call so the proxy
// forces a tool reply in exactly this shape. parseCapture stays as the belt to
// this suspender: it still validates and still applies noDashes.
export const CAPTURE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["task", "event", "note"] },
    title: { type: "string" },
    date: { type: "string", description: "yyyy-mm-dd" },
    start: { type: "string", description: "HH:MM 24h" },
    category: { type: "string", description: "category NAME from the provided list" },
    notes: { type: "string" },
    // UP-CORE-01: the model may only fill these from words the person wrote.
    // The person and project links are NOT offered to it: those are ids, and
    // a model guessing at an id is the one failure mode this whole pipeline
    // is built to avoid. The deterministic layer matches them, or nobody does.
    recurrence: { type: "string", enum: ["daily", "weekly", "monthly", "weekdays"], description: "only when the text says it repeats" },
    reminder: {
      type: "object",
      description: "only when the text asks to be reminded at a clock time",
      properties: {
        time: { type: "string", description: "HH:MM 24h" },
        days: { type: "array", items: { type: "number" }, description: "weekdays 0=Sun..6=Sat; omit for every day" },
      },
      required: ["time"],
    },
    bill: {
      type: "object",
      description: "only when the text names a money amount to pay",
      properties: { amount: { type: "number" } },
      required: ["amount"],
    },
  },
  required: ["kind", "title"],
};

// System prompt: route a quick note to task/event/note, return ONLY JSON.
export function captureSystemPrompt(ctx: AIContext, today: string): string {
  const cats = ctx.categories.length ? ctx.categories.join(", ") : "none";
  return [
    JARVIS_VOICE,
    "Task: you are, a personal assistant that files quick notes.",
    `Today is ${today} (ISO). Resolve relative dates ("tomorrow", "Friday") against it.`,
    "Decide if the input is a task, an event (has a time or specific day), or a note (a thought to keep).",
    `Pick a category by NAME from this list when one clearly fits: ${cats}.`,
    'Reply with ONLY a JSON object, no prose, no code fences: {"kind":"task|event|note","title":string,"date":"yyyy-mm-dd"(optional),"start":"HH:MM"(optional, 24h),"category":string(optional),"notes":string(optional),"recurrence":"daily|weekly|monthly|weekdays"(optional),"reminder":{"time":"HH:MM","days":[0-6]}(optional),"bill":{"amount":number}(optional)}.',
    "Only fill recurrence, reminder or bill from words the person actually wrote. Never invent a repeat, a time, or an amount.",
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
      // Model-authored, human-read, persisted as a title: the noDashes
      // invariant in suggestions.ts applies. This parser skipped it until the
      // 2026-08-07 audit, so an em-dash title could land in the DB and every
      // list view with no way for the voice rules to stop it.
      const out = o as CaptureResult;
      out.title = noDashes(out.title);
      if (typeof out.notes === "string") out.notes = noDashes(out.notes);
      // UP-CORE-01 (2026-09-05): the same belt-and-suspenders the title gets.
      // A reply carrying a malformed reminder or a nonsense amount drops
      // that field rather than writing a reminder with no time or a bill for
      // NaN; the capture still lands, one fact lighter.
      if (out.recurrence && !RECURRENCES.includes(out.recurrence)) delete out.recurrence;
      if (out.reminder && !/^\d{2}:\d{2}$/.test(out.reminder.time ?? "")) delete out.reminder;
      if (out.reminder?.days && !out.reminder.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) delete out.reminder.days;
      if (out.bill && !(Number.isFinite(out.bill.amount) && out.bill.amount > 0)) delete out.bill;
      return out;
    }
  } catch {
    /* not JSON */
  }
  return null;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

// PLUMB-F-06 (2026-09-05): the day-word test used to be
// /\b(today|tomorrow|mon|tue|wed|thu|fri|sat|sun)/ with no closing boundary,
// so "monthly", "money", "wedding" and "sunlight" all read as a weekday and a
// new user's first priority ("Finish the monthly report") landed as an event
// next Monday. One bounded pattern, used by the detector and the resolver
// alike, so the two cannot disagree about what counts as a day word.
const DAY_WORD = /\b(today|tomorrow|sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs|rsday)?|fri(?:day)?|sat(?:urday)?)\b/;

// Offline fallback used when the AI layer is not configured (e.g. the in-memory
// demo). A light heuristic: a time or day word makes it an event, else a task.
export function localParse(text: string, today: string): CaptureResult {
  const t = text.trim();
  const lower = t.toLowerCase();
  const timeMatch = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/) || lower.match(/\b(\d{1,2}):(\d{2})\b/);
  const hasDay = DAY_WORD.test(lower);
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

// The date is formatted from local getters (calendar.ts todayISO). It used to
// go through toISOString(), which reads the UTC day; in Berlin "Ship it
// today" came out as yesterday and the very first Today showed it Overdue.
function dayToISO(lower: string, today: string): string {
  const base = new Date(today + "T00:00:00");
  const word = DAY_WORD.exec(lower)?.[1];
  if (!word) return today;
  if (word === "tomorrow") { base.setDate(base.getDate() + 1); return isoOf(base); }
  if (word === "today") return today;
  const i = WEEKDAYS.findIndex((w) => w.startsWith(word.slice(0, 3)));
  const diff = (i - base.getDay() + 7) % 7 || 7;
  base.setDate(base.getDate() + diff);
  return isoOf(base);
}

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
  source?: import("../shared/provenance").Source,
): Promise<{ id: string | null; kind: CaptureResult["kind"] }> {
  // SHELL-F-06 (2026-09-05): the AI path fills `category` with a NAME (the
  // prompt asks for one), a learned rule fills it with an ID (rules key on
  // ids so a renamed area keeps its rule). This matched by name only, so a
  // rule announced itself, lit the receipt chip, and the stored task still
  // had no category. Either convention resolves here.
  const want = r.category?.toLowerCase();
  let catId = want
    ? categories.find((c) => c.id === r.category || c.data.name.toLowerCase() === want)?.id
    : undefined;
  // Memory layer (Session 3): when nothing chose a category, learn one from
  // history (exact-title match, then shared significant words across past
  // events and tasks). A default at creation, never a silent edit later.
  if (!catId && r.kind !== "note") {
    try {
      const [events, tasks] = await Promise.all([svc.schedule.listEvents(), svc.tasks.listTasks()]);
      const learned = suggestCategory(events, tasks.map((t) => ({ text: t.data.text, category: t.data.category })), r.title);
      if (learned && categories.some((c) => c.id === learned)) catId = learned;
    } catch {
      /* memory is best-effort; capture must never fail because of it */
    }
  }
  let id: string | null = null;
  if (r.kind === "event") {
    // UP-CORE-01: a repeating event ("practice every Tuesday at 5") keeps its
    // repeat. EventRecurrence has no "weekdays", so that one stays a task's
    // word and is not translated into something the calendar would misread.
    const evRepeat = r.recurrence && r.recurrence !== "weekdays" ? r.recurrence : undefined;
    id = await svc.schedule.createEvent(r.title, { date: r.date ?? today, start: r.start ?? "09:00", category: catId, source, recurrence: evRepeat });
  } else if (r.kind === "note") {
    // UP-CORE-05 (2026-09-05): a captured note carries the same provenance
    // stamp a captured task and event have carried since item 8.
    id = await svc.notes.createNote(r.title, catId ?? "", [], source);
    // A paste-born note keeps the copied text VERBATIM as its body (Smart
    // Paste law: copied text is never rewritten).
    if (id && r.notes) await svc.notes.addBlock(id, { type: "text", text: r.notes });
  } else {
    // UP-CORE-01 (2026-09-05): the reminder, the repeat, the money and the
    // links ride through to the fields TasksService has always had. A
    // reminder is a task wearing reminder facts (notes/types.ts), so this is
    // one call either way.
    id = await svc.tasks.createTask(r.title, {
      category: catId,
      due: r.date ?? null,
      source,
      ...(r.recurrence ? { recurrence: r.recurrence } : {}),
      ...(r.reminder ? { reminder: r.reminder } : {}),
      ...(r.bill ? { bill: r.bill } : {}),
      ...(r.personId ? { personId: r.personId } : {}),
      ...(r.projectId ? { projectId: r.projectId } : {}),
    });
  }
  return { id, kind: r.kind };
}
