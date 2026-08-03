import { STYLE_SCOPE_RULE } from "./voice";
// Assembles the user's current context into a compact block the AI can reason
// over. Pure and synchronous: callers fetch the data, this shapes it. Keeping it
// pure means it is fully testable and has no I/O of its own.

export interface AIContextInput {
  name?: string;
  template?: string;
  people?: string[];
  // Person pass (2026-08-03): structured people so the writing guardrail
  // stops guessing who is close. label = who they are to the user;
  // register = how JARVIS writes to them (casual | professional | unset).
  peopleDetail?: { name: string; label?: string; register?: string; flagged?: boolean }[];
  categories?: { name: string }[];
  tasks?: { text: string; done: boolean; category?: string }[];
  events?: { title: string; start: string }[];
  voice?: string;
  values?: string;
  philosophy?: string;
  // Session 5, the Brain as the single context layer. All optional; every AI
  // feature gets the same full picture through this one assembler.
  routine?: { workStartMin: number; workEndMin: number };
  goals?: { name: string; status?: string }[];
  projects?: string[];
  habits?: string; // the app-writable Brain doc (topic "habits")
  completionSamples?: { h: number; t: number }[]; // Time Sense: hour + epoch ms
  money?: { name: string; balance: number }[];
}

export interface AIContext {
  name: string;
  template: string;
  people: string[];
  peopleDetail?: { name: string; label?: string; register?: string; flagged?: boolean }[];
  categories: string[];
  openTasks: string[];
  events: { title: string; start: string }[];
  voice: string;
  values: string;
  philosophy: string;
  routineLine: string;
  goals: string[];
  projects: string[];
  habits: string;
  patternLine: string;
  moneyLine: string;
}

function minTo12h(min: number): string {
  let h = Math.floor(min / 60);
  const ap = h < 12 ? "AM" : "PM";
  h = h % 12 || 12;
  const m = min % 60;
  return m === 0 ? `${h} ${ap}` : `${h}:${String(m).padStart(2, "0")} ${ap}`;
}

// Peak completion window from Time Sense samples, last 30 days: the 3-hour
// band holding the most completions, spoken only with real evidence (>= 10
// samples). Silence beats a guess.
function patternLineFrom(samples: { h: number; t: number }[] | undefined): string {
  if (!samples) return "";
  const cutoff = Date.now() - 30 * 86400000;
  const recent = samples.filter((s) => s.t >= cutoff);
  if (recent.length < 10) return "";
  let best = 0;
  let bestCount = -1;
  for (let start = 0; start <= 21; start++) {
    const count = recent.filter((s) => s.h >= start && s.h < start + 3).length;
    if (count > bestCount) { bestCount = count; best = start; }
  }
  return `Most tasks get done between ${minTo12h(best * 60)} and ${minTo12h((best + 3) * 60)}`;
}

export function assembleContext(input: AIContextInput): AIContext {
  const r = input.routine;
  return {
    name: input.name?.trim() || "there",
    template: input.template || "personal",
    people: input.people ?? [],
    peopleDetail: input.peopleDetail,
    categories: (input.categories ?? []).map((c) => c.name),
    openTasks: (input.tasks ?? []).filter((t) => !t.done).map((t) => t.text),
    events: (input.events ?? []).map((e) => ({ title: e.title, start: e.start })),
    voice: input.voice?.trim() ?? "",
    values: input.values?.trim() ?? "",
    philosophy: input.philosophy?.trim() ?? "",
    routineLine: r ? `Works ${minTo12h(r.workStartMin)} to ${minTo12h(r.workEndMin)}` : "",
    goals: (input.goals ?? []).map((g) => (g.status ? `${g.name} (${g.status})` : g.name)),
    projects: input.projects ?? [],
    habits: input.habits?.trim() ?? "",
    patternLine: patternLineFrom(input.completionSamples),
    moneyLine: (input.money ?? []).map((a) => `${a.name} ${a.balance < 0 ? "-" : ""}$${Math.abs(a.balance).toFixed(0)}`).join(", "),
  };
}


// "19:30" -> "7:30 PM". Local so this module stays dependency-free.
function to12h(hhmm: string): string {
  const [hRaw, mRaw] = hhmm.split(":");
  let h = Number(hRaw);
  const ap = h < 12 ? "AM" : "PM";
  h = h % 12 || 12;
  return `${h}:${(mRaw ?? "00").padStart(2, "0")} ${ap}`;
}

// A compact, deterministic text rendering for the system/context prompt.
export function contextToText(ctx: AIContext): string {
  const lines: string[] = [];
  lines.push(`User: ${ctx.name} (${ctx.template} template)`);
  if (ctx.peopleDetail?.length) {
    // "Mike Torres (brother-in-law; write casual)". flagged renders as
    // "handle with care" so every drafting feature inherits the precedence
    // without knowing the schema. "friend" renders as a sentence because
    // "write friend" is not English.
    const rendered = ctx.peopleDetail.map((p) => {
      const notes: string[] = [];
      if (p.label) notes.push(p.label.toLowerCase());
      if (p.flagged) notes.push("handle with care: always professional");
      else if (p.register === "friend") notes.push("write like a close friend");
      else if (p.register) notes.push(`write ${p.register}`);
      return notes.length ? `${p.name} (${notes.join("; ")})` : p.name;
    });
    lines.push(`Key people: ${rendered.join(", ")}`);
  } else if (ctx.people?.length) lines.push(`Key people: ${ctx.people.join(", ")}`);
  if (ctx.categories?.length) lines.push(`Life areas: ${ctx.categories.join(", ")}`);
  if (ctx.openTasks?.length) lines.push(`Open tasks: ${ctx.openTasks.join("; ")}`);
  if (ctx.events?.length) lines.push(`Today's schedule: ${ctx.events.map((e) => `${to12h(e.start)} ${e.title}`).join("; ")}`);
  // Every field below is optional at runtime: contexts are also hand-built in
  // tests and older callers, and a missing key must never crash a prompt.
  if (ctx.routineLine) lines.push(`Routine: ${ctx.routineLine}`);
  if (ctx.goals?.length) lines.push(`Goals: ${ctx.goals.join("; ")}`);
  if (ctx.projects?.length) lines.push(`Projects: ${ctx.projects.join(", ")}`);
  if (ctx.patternLine) lines.push(`Patterns: ${ctx.patternLine}`);
  if (ctx.habits) lines.push(`Known habits: ${ctx.habits}`);
  if (ctx.moneyLine) lines.push(`Money: ${ctx.moneyLine}`);
  if (ctx.philosophy) lines.push(`Philosophy: ${ctx.philosophy}`);
  if (ctx.values) lines.push(`Values: ${ctx.values}`);
  // The style notes and the limit on using them are emitted together, always.
  // Costs nothing when the user has no writing notes.
  if (ctx.voice) {
    lines.push(`Writing voice: ${ctx.voice}`);
    lines.push(STYLE_SCOPE_RULE);
  }
  return lines.join("\n");
}
