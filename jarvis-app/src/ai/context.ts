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
  // The full routine as text (2026-08-09): wake/sleep, meals, gym, hobbies,
  // family time, locations, hard vs flexible. When present it REPLACES the
  // thin "Works 9 AM to 5 PM" line, because that one sentence was everything
  // the AI knew about the user's actual day, and it showed in the plans.
  routineDetail?: string;
  goals?: { name: string; status?: string }[];
  projects?: string[];
  habits?: string; // the app-writable Brain doc (topic "habits")
  completionSamples?: { h: number; t: number }[]; // Time Sense: hour + epoch ms
  money?: { name: string; balance: number }[];
  // The full money picture (2026-08-10, Dave's call: "feed the brain"). The
  // AI used to see a bill as just its task name ("Rent"): no amount, no due
  // date, and nothing about payday or what is actually spendable. bills and
  // cashFlow carry what the Money tab itself derives, so every AI feature
  // can reason about real cash flow instead of a word.
  bills?: { name: string; amount: number; due?: string | null; autopay?: boolean }[];
  cashFlow?: { paycheck: number; nextPayday: string; billsOut: number; setAside: number; left: number; short: boolean } | null;
  // Brain Layer 2 (item 04): active strands, one line each, already capped at
  // the genome cap. The bridge until relevance scoping ships: every feature
  // that reads the assembled context gets what JARVIS knows, unscoped.
  strands?: string[];
  // Settled decisions, read back (Brain handoff item 5). One line each,
  // newest first, the reason included because the reason is the record's
  // whole purpose. This is what stops JARVIS re-opening a question the user
  // already answered, and lets it say what has changed since.
  decisions?: string[];
  // A compressed line per sealed month (handoff item 8). Numbers and counts
  // from the seal, never a score and never the user's own words.
  months?: string[];
  // THE DAILY PULSE (handoff item 11). One line per health metric the user
  // logs, in that metric's own units, from brain/pulse.ts. Never a composite
  // score and never a verdict: the health doctrine forbids both, and this is
  // the surface most tempted to invent one.
  pulse?: string[];
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
  // Optional so hand-built contexts (tests, older callers) keep compiling;
  // the assembler always fills them, empty string when there is nothing.
  billsLine?: string;
  cashLine?: string;
  strands?: string[];
  // Settled decisions, read back (Brain handoff item 5). One line each,
  // newest first, the reason included because the reason is the record's
  // whole purpose. This is what stops JARVIS re-opening a question the user
  // already answered, and lets it say what has changed since.
  decisions?: string[];
  // A compressed line per sealed month (handoff item 8). Numbers and counts
  // from the seal, never a score and never the user's own words.
  months?: string[];
  // THE DAILY PULSE (handoff item 11). One line per health metric the user
  // logs, in that metric's own units, from brain/pulse.ts. Never a composite
  // score and never a verdict: the health doctrine forbids both, and this is
  // the surface most tempted to invent one.
  pulse?: string[];
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
    routineLine: input.routineDetail?.trim() || (r ? `Works ${minTo12h(r.workStartMin)} to ${minTo12h(r.workEndMin)}` : ""),
    goals: (input.goals ?? []).map((g) => (g.status ? `${g.name} (${g.status})` : g.name)),
    projects: input.projects ?? [],
    habits: input.habits?.trim() ?? "",
    patternLine: patternLineFrom(input.completionSamples),
    moneyLine: (input.money ?? []).map((a) => `${a.name} ${a.balance < 0 ? "-" : ""}$${Math.abs(a.balance).toFixed(0)}`).join(", "),
    billsLine: (input.bills ?? [])
      .map((b) => `${b.name} $${b.amount}${b.due ? ` due ${isoToMonthDay(b.due)}` : ""}${b.autopay ? ", autopay" : ""}`)
      .join("; "),
    strands: (input.strands ?? []).map((s) => s.trim()).filter(Boolean),
    decisions: (input.decisions ?? []).map((d) => d.trim()).filter(Boolean),
    months: (input.months ?? []).map((m) => m.trim()).filter(Boolean),
    pulse: (input.pulse ?? []).map((x) => x.trim()).filter(Boolean),
    cashLine: input.cashFlow
      ? `Next paycheck $${input.cashFlow.paycheck} on ${isoToMonthDay(input.cashFlow.nextPayday)}; bills before then $${input.cashFlow.billsOut}; set aside $${input.cashFlow.setAside}; left to spend $${input.cashFlow.left}${input.cashFlow.short ? " (bills exceed the paycheck)" : ""}`
      : "",
  };
}

// "2026-08-15" -> "Aug 15". Local (money/bills has one too) so this module
// stays dependency-free.
const MONTHS_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function isoToMonthDay(iso: string): string {
  const p = iso.split("-");
  const m = MONTHS_ABBR[Number(p[1]) - 1];
  return m ? `${m} ${Number(p[2])}` : iso;
}


// "19:30" -> "7:30 PM". Local so this module stays dependency-free.
function to12h(hhmm: string): string {
  const [hRaw, mRaw] = hhmm.split(":");
  let h = Number(hRaw);
  const ap = h < 12 ? "AM" : "PM";
  h = h % 12 || 12;
  return `${h}:${(mRaw ?? "00").padStart(2, "0")} ${ap}`;
}

// "Mike Torres (brother-in-law; write casual)". flagged renders as "handle
// with care" so every drafting feature inherits the precedence without knowing
// the schema. "friend" renders as a sentence because "write friend" is not
// English. Shared by every renderer below so the guardrail wording cannot
// drift between one prompt and another.
function renderPeople(people: NonNullable<AIContext["peopleDetail"]>): string[] {
  return people.map((p) => {
    const notes: string[] = [];
    if (p.label) notes.push(p.label.toLowerCase());
    if (p.flagged) notes.push("handle with care: always professional");
    else if (p.register === "friend") notes.push("write like a close friend");
    else if (p.register) notes.push(`write ${p.register}`);
    return notes.length ? `${p.name} (${notes.join("; ")})` : p.name;
  });
}

// A compact, deterministic text rendering for the system/context prompt.
export function contextToText(ctx: AIContext): string {
  const lines: string[] = [];
  lines.push(`User: ${ctx.name} (${ctx.template} template)`);
  if (ctx.peopleDetail?.length) {
    lines.push(`Key people: ${renderPeople(ctx.peopleDetail).join(", ")}`);
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
  if (ctx.strands?.length) lines.push(`Known about the user (watched or confirmed by them): ${ctx.strands.join("; ")}`);
  if (ctx.decisions?.length) lines.push(`Already decided (do not re-open unless asked): ${ctx.decisions.join("; ")}`);
  if (ctx.months?.length) lines.push(`Recent months: ${ctx.months.join(" | ")}`);
  if (ctx.pulse?.length) lines.push(`How they have been (their own logs, facts not judgments): ${ctx.pulse.join("; ")}`);
  if (ctx.habits) lines.push(`Known habits: ${ctx.habits}`);
  if (ctx.moneyLine) lines.push(`Money: ${ctx.moneyLine}`);
  if (ctx.billsLine) lines.push(`Bills: ${ctx.billsLine}`);
  if (ctx.cashLine) lines.push(`Cash flow: ${ctx.cashLine}`);
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

// Two narrower renderings of the SAME assembled context (Brain Personalization
// Phase 3). Not a second assembler: `useAIContext()` stays the one place data
// is gathered, exactly as before. These pick which of its fields a given kind
// of prompt actually needs, which is the pattern suggestionsSystemPrompt and
// captureSystemPrompt already follow.
//
// Why not just use contextToText everywhere: it carries every open task, the
// day's schedule, and account balances. Sending all of that to draft a two
// sentence forwarding note costs tokens on an AI proxy that still has no per
// user rate limit, and none of it makes the note better.

// For prompts that write something the USER will send. Who they are, who they
// are writing to, how they write, and the hard limit on when that style
// applies. The people list is the load-bearing part: without it the model
// cannot tell a close friend from someone marked handle with care, and
// STYLE_SCOPE_RULE has nothing to key on.
// `styleRule: false` is for the one caller that already emits STYLE_SCOPE_RULE
// itself, unconditionally: buildPlanPrompt in the email deck. Sending it twice
// costs about 250 tokens on the app's highest-frequency AI call and says
// nothing new. That caller keeps its own copy rather than inheriting this
// one, because its copy is unconditional and this one only appears when the
// user has written style notes: dropping it there would quietly remove a
// guardrail from every draft by anyone who has not filled that doc in.
export function voiceToText(ctx: AIContext, { styleRule = true }: { styleRule?: boolean } = {}): string {
  const lines: string[] = [];
  lines.push(`User: ${ctx.name}`);
  if (ctx.peopleDetail?.length) {
    lines.push(`Key people: ${renderPeople(ctx.peopleDetail).join(", ")}`);
  } else if (ctx.people?.length) lines.push(`Key people: ${ctx.people.join(", ")}`);
  if (ctx.voice) {
    lines.push(`Writing voice: ${ctx.voice}`);
    if (styleRule) lines.push(STYLE_SCOPE_RULE);
  }
  return lines.join("\n");
}

// For prompts that decide what this person should DO. What they are working
// toward and what is already known about how they work. Deliberately excludes
// the open task list: a feature that picks a first step is looking at one
// specific task already, and the other fifty are noise. Bills and cash flow
// ARE included (2026-08-10): "pay the electric before Friday" is exactly a
// what-should-I-do decision, and a due date with an amount changes it.
export function identityToText(ctx: AIContext): string {
  const lines: string[] = [];
  lines.push(`User: ${ctx.name} (${ctx.template} template)`);
  if (ctx.goals?.length) lines.push(`Goals: ${ctx.goals.join("; ")}`);
  if (ctx.projects?.length) lines.push(`Projects: ${ctx.projects.join(", ")}`);
  if (ctx.routineLine) lines.push(`Routine: ${ctx.routineLine}`);
  if (ctx.patternLine) lines.push(`Patterns: ${ctx.patternLine}`);
  if (ctx.strands?.length) lines.push(`Known about the user (watched or confirmed by them): ${ctx.strands.join("; ")}`);
  if (ctx.decisions?.length) lines.push(`Already decided (do not re-open unless asked): ${ctx.decisions.join("; ")}`);
  if (ctx.months?.length) lines.push(`Recent months: ${ctx.months.join(" | ")}`);
  if (ctx.pulse?.length) lines.push(`How they have been (their own logs, facts not judgments): ${ctx.pulse.join("; ")}`);
  if (ctx.habits) lines.push(`Known habits: ${ctx.habits}`);
  if (ctx.billsLine) lines.push(`Bills: ${ctx.billsLine}`);
  if (ctx.cashLine) lines.push(`Cash flow: ${ctx.cashLine}`);
  if (ctx.philosophy) lines.push(`Philosophy: ${ctx.philosophy}`);
  if (ctx.values) lines.push(`Values: ${ctx.values}`);
  return lines.join("\n");
}
