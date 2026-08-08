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
