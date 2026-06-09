import { describe, it, expect, vi } from "vitest";
import { assembleContext, contextToText } from "./context";
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
