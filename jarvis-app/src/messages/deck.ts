import type { ThreadFull } from "../connections/google/map";
import { JARVIS_VOICE, STYLE_SCOPE_RULE } from "../ai/voice";
import { noDashes } from "../ai/suggestions";

// The Deal With It deck (email 2): for each thread that needs the user, ONE
// AI pass prepares the decision so the card arrives with the work already
// done. The plan is a proposal: nothing sends, files, or schedules without
// the user's tap, and the parser is tolerant but never inventive, an
// unusable reply means NO plan (the card falls back to read-and-reply),
// never a fabricated bill or a made-up meeting.

export type PlanKind = "reply" | "bill" | "event" | "task" | "archive";

export interface DeckPlan {
  kind: PlanKind;
  why: string; // one line: what this email wants from the user
  reply?: string; // drafted in the user's voice, ready to send
  bill?: { name: string; amount: number; due?: string };
  event?: { title: string; date: string; start: string; end?: string };
  task?: { title: string; due?: string };
}

export interface VoiceProfile {
  register?: "casual" | "professional" | "friend";
  flagged?: boolean;
  examples: string[]; // the user's own past messages to this sender
}

const AMOUNT_MAX = 100000;

export function buildPlanPrompt(thread: ThreadFull, voice: VoiceProfile, todayISO: string): { system: string; user: string } {
  const convo = thread.messages
    .slice(-5)
    .map((m) => m.from + ": " + m.body.slice(0, 1200))
    .join("\n---\n");

  const voiceLines: string[] = [];
  if (voice.flagged) {
    voiceLines.push("Write guarded and neutral: polite, brief, commits to nothing.");
  } else if (voice.register === "friend") {
    voiceLines.push("Write like a close friend: loose structure, short.");
  } else if (voice.register === "casual") {
    voiceLines.push("Write casually.");
  } else if (voice.register === "professional") {
    voiceLines.push("Write professionally.");
  }
  if (voice.examples.length) {
    voiceLines.push(
      "Here is how the user ACTUALLY writes to this person. Match this voice exactly:\n" +
      voice.examples.map((e) => '"' + e.slice(0, 400) + '"').join("\n"),
    );
  }

  const system = [
    JARVIS_VOICE,
    STYLE_SCOPE_RULE,
    "You prepare ONE decision for an email so the user can handle it in a single tap.",
    "Reply with ONLY a JSON object, no prose:",
    '{"kind":"reply|bill|event|task|archive","why":"...","reply":"...","bill":{"name":"...","amount":0,"due":"YYYY-MM-DD"},"event":{"title":"...","date":"YYYY-MM-DD","start":"HH:MM","end":"HH:MM"},"task":{"title":"...","due":"YYYY-MM-DD"}}',
    "Include ONLY the field matching kind. Rules:",
    '- "reply": a real person expects an answer. Draft the reply in the USER\'S voice. Never invent facts, commitments, or dates the user has not stated; when the honest answer needs information you lack, the draft asks or says "I\'ll get back to you".',
    '- "bill": a bill or renewal with a real amount. Use the stated amount and due date only.',
    '- "event": an appointment to confirm or attend, with a real date and time. If the email asks for a confirmation reply too, prefer "reply" and mention the time in it.',
    '- "task": the email asks the user to DO something that is not a reply (sign, bring, upload). Title starts with a verb.',
    '- "archive": nothing is actually needed from the user.',
    '"why" is one sentence, under 15 words, concrete: who wants what, by when.',
    "Today is " + todayISO + ". Resolve relative dates to real dates. Never invent an amount, date, or time not present in the email.",
    ...voiceLines,
  ].join("\n");

  return { system, user: "EMAIL THREAD:\n" + convo };
}

// Tolerant, never inventive. Structural failure returns null and the card
// degrades to plain read-and-reply, which is always honest.
export function parseDeckPlan(raw: string): DeckPlan | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let p: unknown;
  try {
    p = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof p !== "object" || p === null) return null;
  const o = p as Record<string, unknown>;
  const kind = o.kind;
  if (kind !== "reply" && kind !== "bill" && kind !== "event" && kind !== "task" && kind !== "archive") return null;
  const why = typeof o.why === "string" && o.why.trim() ? o.why.trim().slice(0, 140) : "";
  const plan: DeckPlan = { kind, why: noDashes(why) };

  if (kind === "reply") {
    const r = o.reply;
    if (typeof r !== "string" || !r.trim()) return null;
    plan.reply = noDashes(r.trim()).slice(0, 2000);
  }
  if (kind === "bill") {
    const b = o.bill as Record<string, unknown> | undefined;
    const amount = typeof b?.amount === "number" && isFinite(b.amount) ? b.amount : NaN;
    const name = typeof b?.name === "string" ? b.name.trim() : "";
    if (!name || !(amount > 0)) return null; // an invented or absent amount is not a bill
    plan.bill = { name: name.slice(0, 80), amount: Math.min(amount, AMOUNT_MAX) };
    if (typeof b?.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.due)) plan.bill.due = b.due;
  }
  if (kind === "event") {
    const e = o.event as Record<string, unknown> | undefined;
    const title = typeof e?.title === "string" ? e.title.trim() : "";
    const date = typeof e?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? e.date : "";
    const startT = typeof e?.start === "string" && /^\d{2}:\d{2}$/.test(e.start) ? e.start : "";
    if (!title || !date || !startT) return null; // no invented times
    plan.event = { title: title.slice(0, 80), date, start: startT };
    if (typeof e?.end === "string" && /^\d{2}:\d{2}$/.test(e.end)) plan.event.end = e.end;
  }
  if (kind === "task") {
    const t = o.task as Record<string, unknown> | undefined;
    const title = typeof t?.title === "string" ? t.title.trim() : "";
    if (!title) return null;
    plan.task = { title: title.slice(0, 120) };
    if (typeof t?.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.due)) plan.task.due = t.due;
  }
  return plan;
}

// The primary button says exactly what one tap does. No mystery verbs.
export function primaryLabel(plan: DeckPlan): string {
  switch (plan.kind) {
    case "reply": return "Send & Next";
    case "bill": return "Add Bill & Next";
    case "event": return "Add to Schedule & Next";
    case "task": return "Add Task & Next";
    case "archive": return "Archive & Next";
  }
}

// "Later" is honest: it becomes a real task pointing back at the email, so
// deferring never means losing.
export function laterTaskTitle(from: string, subject: string): string {
  return ("Get back to " + from + ": " + subject).slice(0, 120);
}
