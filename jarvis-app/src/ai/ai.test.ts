import { describe, it, expect, vi } from "vitest";
import { assembleContext, contextToText, voiceToText, identityToText } from "./context";
import { AIService } from "./AIService";

describe("AI context", () => {
  it("filters done tasks and shapes the context", () => {
    const ctx = assembleContext({
      name: "Alex",
      template: "personal",
      people: ["Sam"],
      categories: [{ name: "Work" }, { name: "Family" }],
      tasks: [{ text: "Email Sam", done: false }, { text: "Pay rent", done: true }],
      events: [{ title: "Standup", start: "09:00" }],
    });
    expect(ctx.openTasks).toEqual(["Email Sam"]);
    expect(ctx.categories).toEqual(["Work", "Family"]);
    const text = contextToText(ctx);
    expect(text).toContain("Alex");
    expect(text).toContain("Email Sam");
    expect(text).not.toContain("Pay rent");
  });

  it("uses safe defaults when empty", () => {
    const ctx = assembleContext({});
    expect(ctx.name).toBe("there");
    expect(contextToText(ctx)).toContain("there");
  });
});

describe("AIService", () => {
  it("is unavailable (and refuses) with no backend", async () => {
    const svc = new AIService({ available: false });
    expect(svc.available).toBe(false);
    await expect(svc.complete([{ role: "user", content: "hi" }])).rejects.toThrow(/not configured/);
  });

  it("posts to the endpoint with auth and returns text", async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ text: "Hello Alex" }), { status: 200 }));
    const svc = new AIService({ available: true, fetchImpl: fetchImpl as unknown as typeof fetch, getToken: () => "tok123" });
    const out = await svc.complete([{ role: "user", content: "hi" }], "be brief");
    expect(out).toBe("Hello Alex");
    const call = fetchImpl.mock.calls[0]!;
    const init = call[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok123");
  });

  it("throws on a non-ok response", async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response("nope", { status: 500 }));
    const svc = new AIService({ available: true, fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(svc.complete([{ role: "user", content: "hi" }])).rejects.toThrow(/failed/);
  });
});

describe("writing voice is scoped to close audiences", () => {
  it("attaches the limit whenever style notes are present", () => {
    const ctx = assembleContext({ voice: "drops punctuation, swears casually" });
    const text = contextToText(ctx);
    expect(text).toContain("drops punctuation");
    // The limit must travel with the notes, or a board email inherits them.
    expect(text).toMatch(/ONLY to messages aimed at people the user has marked casual or close friend/);
    expect(text).toMatch(/Never guess casual/);
    expect(text).toMatch(/No profanity/);
    // Friend mode loosens structure, never invents familiarity.
    expect(text).toMatch(/Never invent slang, inside jokes, or nicknames/);
  });

  it("renders each register readably, and flagged outranks friend", () => {
    const text = contextToText(assembleContext({
      peopleDetail: [
        { name: "Chris", register: "friend" },
        { name: "Sam", register: "casual" },
        { name: "Dana", register: "professional" },
        { name: "Lex", register: "friend", flagged: true },
      ],
    }));
    expect(text).toContain("Chris (write like a close friend)");
    expect(text).toContain("Sam (write casual)");
    expect(text).toContain("Dana (write professional)");
    // flagged wins: the friend register must not leak into the prompt
    expect(text).toContain("Lex (handle with care: always professional)");
    expect(text).not.toContain("Lex (write");
  });

  it("says nothing about style when the user has no notes", () => {
    const text = contextToText(assembleContext({ name: "Alex" }));
    expect(text).not.toMatch(/Writing voice/);
    expect(text).not.toMatch(/Never guess casual/);
  });
});

// Brain Personalization Phase 3: two narrower renderings of the SAME context.
// Not a second assembler, a second and third view of the one there already is.
describe("voiceToText (for prompts that write as the user)", () => {
  const full = assembleContext({
    name: "Alex",
    peopleDetail: [{ name: "Chris", register: "friend" }, { name: "Lex", register: "friend", flagged: true }],
    voice: "short sentences, no greetings",
    tasks: [{ text: "Pay rent", done: false }],
    events: [{ title: "Standup", start: "09:00" }],
    money: [{ name: "Checking", balance: 1200 }],
    goals: [{ name: "Ship JARVIS" }],
  });

  it("carries the user, the people guardrail, and the style scope rule", () => {
    const text = voiceToText(full);
    expect(text).toContain("User: Alex");
    expect(text).toContain("Chris (write like a close friend)");
    expect(text).toContain("Lex (handle with care: always professional)");
    expect(text).toContain("Writing voice: short sentences, no greetings");
    expect(text).toContain("Never guess casual"); // STYLE_SCOPE_RULE rides along
  });

  it("leaves out the operational noise a draft does not need", () => {
    const text = voiceToText(full);
    expect(text).not.toContain("Pay rent");
    expect(text).not.toContain("Standup");
    expect(text).not.toContain("Checking");
    expect(text).not.toContain("Ship JARVIS");
  });

  it("emits the style rule only alongside real notes, same law as contextToText", () => {
    const text = voiceToText(assembleContext({ name: "Alex" }));
    expect(text).not.toMatch(/Writing voice/);
    expect(text).not.toMatch(/Never guess casual/);
  });

  // The email deck emits STYLE_SCOPE_RULE itself, unconditionally. Sending it
  // twice is ~250 wasted tokens on the app's highest-frequency AI call.
  it("can omit the style rule while keeping the notes, for a caller that has its own", () => {
    const text = voiceToText(full, { styleRule: false });
    expect(text).toContain("Writing voice: short sentences, no greetings");
    expect(text).toContain("Chris (write like a close friend)"); // the guardrail data still ships
    expect(text).not.toContain("Never guess casual");
  });

  // S4-Q25 (2026-09-04): "facts about your writing never reach the drafting
  // prompt." voiceToText is the ONE renderer of the three (contextToText,
  // this one, identityToText) that carried no facts line at all.
  it("carries Writing-bucket facts, since this is the prompt that writes in the user's voice", () => {
    const text = voiceToText(assembleContext({ name: "Alex", writingFacts: ["Never opens with Hi there"] }));
    expect(text).toContain("Known about how they write");
    expect(text).toContain("Never opens with Hi there");
  });

  it("says nothing when there are no Writing facts, same silence-beats-a-guess law as everywhere else", () => {
    const text = voiceToText(assembleContext({ name: "Alex" }));
    expect(text).not.toContain("Known about how they write");
  });
});

describe("identityToText (for prompts that decide what to do)", () => {
  const full = assembleContext({
    name: "Alex",
    template: "personal",
    goals: [{ name: "Ship JARVIS", status: "active" }],
    projects: ["LLC formation"],
    habits: "Starts strong in the morning",
    values: "build things that last",
    philosophy: "small steps",
    routine: { workStartMin: 540, workEndMin: 1020 },
    tasks: [{ text: "Pay rent", done: false }],
    money: [{ name: "Checking", balance: 1200 }],
    voice: "short sentences",
  });

  it("carries what the person is working toward and what is known about them", () => {
    const text = identityToText(full);
    expect(text).toContain("User: Alex (personal template)");
    expect(text).toContain("Goals: Ship JARVIS (active)");
    expect(text).toContain("Projects: LLC formation");
    expect(text).toContain("Routine: Works 9 AM to 5 PM");
    expect(text).toContain("Known habits: Starts strong in the morning");
    expect(text).toContain("Values: build things that last");
    expect(text).toContain("Philosophy: small steps");
  });

  it("leaves out the full task list, money, and writing style", () => {
    const text = identityToText(full);
    expect(text).not.toContain("Pay rent");
    expect(text).not.toContain("Checking");
    expect(text).not.toContain("Writing voice");
  });

  it("degrades to just the user line when nothing else is known", () => {
    expect(identityToText(assembleContext({ name: "Alex" }))).toBe("User: Alex (personal template)");
  });
});

// The full money picture (2026-08-10, Dave: "shouldn't it feed the brain?").
// The AI used to see a bill as just a task name. Now bills carry amounts,
// due dates, and autopay, and cash flow carries the same derivation the
// Money tab shows, so what the AI says can never disagree with the screen.
describe("money picture in the assembled context", () => {
  const withMoney = assembleContext({
    name: "Dave",
    bills: [
      { name: "Rent", amount: 1850, due: "2026-08-15", autopay: true },
      { name: "Electric", amount: 120, due: "2026-08-12" },
      { name: "Gym", amount: 40 },
    ],
    cashFlow: { paycheck: 2500, nextPayday: "2026-08-14", billsOut: 470, setAside: 300, left: 1730, short: false },
  });

  it("renders bills with amounts, due dates, and autopay", () => {
    expect(withMoney.billsLine).toBe("Rent $1850 due Aug 15, autopay; Electric $120 due Aug 12; Gym $40");
  });

  it("renders the cash-flow line with payday and left-to-spend", () => {
    expect(withMoney.cashLine).toBe("Next paycheck $2500 on Aug 14; bills before then $470; set aside $300; left to spend $1730");
  });

  it("flags when bills exceed the paycheck, in words", () => {
    const short = assembleContext({
      cashFlow: { paycheck: 800, nextPayday: "2026-08-14", billsOut: 1200, setAside: 0, left: -400, short: true },
    });
    expect(short.cashLine).toContain("(bills exceed the paycheck)");
  });

  it("contextToText and identityToText both carry Bills and Cash flow", () => {
    for (const render of [contextToText, identityToText]) {
      const text = render(withMoney);
      expect(text).toContain("Bills: Rent $1850");
      expect(text).toContain("Cash flow: Next paycheck $2500");
    }
  });

  it("absent money data renders nothing: no empty Bills or Cash flow lines", () => {
    const bare = contextToText(assembleContext({ name: "Alex" }));
    expect(bare).not.toContain("Bills:");
    expect(bare).not.toContain("Cash flow:");
  });
});

// THE BRAIN READS BACK WHAT IT KNOWS (Brain build handoff items 5, 8 and 9,
// built 2026-09-04). Three stores that were written and never read now reach
// the one assembler every AI feature funnels through.
describe("read-back: decisions, sealed months, and strand order", () => {
  it("carries settled decisions with their reasons, and tells the model not to re-open them", () => {
    const ctx = assembleContext({
      decisions: ["Went with Supabase (because native delete kills the tombstone bug)"],
    });
    const text = contextToText(ctx);
    expect(text).toContain("Already decided");
    expect(text).toContain("do not re-open unless asked");
    expect(text).toContain("native delete kills the tombstone bug");
  });

  it("carries the compressed months", () => {
    const text = contextToText(assembleContext({ months: ["August 2026: 84 finished"] }));
    expect(text).toContain("Recent months");
    expect(text).toContain("84 finished");
  });

  it("says nothing at all when there is nothing to say", () => {
    const text = contextToText(assembleContext({ decisions: [], months: [] }));
    expect(text).not.toContain("Already decided");
    expect(text).not.toContain("Recent months");
  });

  it("keeps the strand order it was handed, because recall decides it upstream", () => {
    // rankForRecall orders by strength before the lines get here; the
    // assembler must not re-sort them or the strengthen half is undone.
    const ctx = assembleContext({ strands: ["strongest", "middle", "weakest"] });
    expect(ctx.strands).toEqual(["strongest", "middle", "weakest"]);
  });

  // S4-Q25: writingFacts rides beside strands, not instead of it -- the
  // general list stays unscoped for the prompts that already read it.
  it("carries writingFacts as its own field, independent of the general strands list", () => {
    const ctx = assembleContext({ strands: ["a", "b"], writingFacts: ["Never opens with Hi there"] });
    expect(ctx.strands).toEqual(["a", "b"]);
    expect(ctx.writingFacts).toEqual(["Never opens with Hi there"]);
  });

  it("writingFacts is empty, not undefined, when none are given", () => {
    expect(assembleContext({}).writingFacts).toEqual([]);
  });
});
