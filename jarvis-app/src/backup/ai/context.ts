// Assembles the user's current context into a compact block the AI can reason
// over. Pure and synchronous: callers fetch the data, this shapes it. Keeping it
// pure means it is fully testable and has no I/O of its own.

export interface AIContextInput {
  name?: string;
  template?: string;
  people?: string[];
  categories?: { name: string }[];
  tasks?: { text: string; done: boolean; category?: string }[];
  events?: { title: string; start: string }[];
  voice?: string;
  values?: string;
  philosophy?: string;
}

export interface AIContext {
  name: string;
  template: string;
  people: string[];
  categories: string[];
  openTasks: string[];
  events: { title: string; start: string }[];
  voice: string;
  values: string;
  philosophy: string;
}

export function assembleContext(input: AIContextInput): AIContext {
  return {
    name: input.name?.trim() || "there",
    template: input.template || "personal",
    people: input.people ?? [],
    categories: (input.categories ?? []).map((c) => c.name),
    openTasks: (input.tasks ?? []).filter((t) => !t.done).map((t) => t.text),
    events: (input.events ?? []).map((e) => ({ title: e.title, start: e.start })),
    voice: input.voice?.trim() ?? "",
    values: input.values?.trim() ?? "",
    philosophy: input.philosophy?.trim() ?? "",
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
  if (ctx.people.length) lines.push(`Key people: ${ctx.people.join(", ")}`);
  if (ctx.categories.length) lines.push(`Life areas: ${ctx.categories.join(", ")}`);
  if (ctx.openTasks.length) lines.push(`Open tasks: ${ctx.openTasks.join("; ")}`);
  if (ctx.events.length) lines.push(`Today's schedule: ${ctx.events.map((e) => `${to12h(e.start)} ${e.title}`).join("; ")}`);
  if (ctx.philosophy) lines.push(`Philosophy: ${ctx.philosophy}`);
  if (ctx.values) lines.push(`Values: ${ctx.values}`);
  if (ctx.voice) lines.push(`Writing voice: ${ctx.voice}`);
  return lines.join("\n");
}
