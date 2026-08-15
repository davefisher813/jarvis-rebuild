// LAW (session addendum items 18-21): AI level Off produces ZERO proxy calls,
// including background pre-generation, and the enforcement exists in BOTH
// places: the client (AIService refuses before fetch) and the server proxy
// (api/ai.ts refuses against the stored profile). A client bug can never
// spend AI the user turned off.

import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { aiCallAllowed, effectiveLevel, normalizeLevel, DEFAULT_AI_LEVEL, type AILevel } from "../ai/aiGate";
import { setAIControl } from "../ai/levelStore";
import { AIService } from "../ai/AIService";

afterEach(() => setAIControl(undefined));

describe("law: the AI gate matrix is exact", () => {
  it("off refuses everything, foreground and background", () => {
    expect(aiCallAllowed("off", false)).toBe(false);
    expect(aiCallAllowed("off", true)).toBe(false);
  });

  it("on request refuses background pre-generation and allows asked-for calls", () => {
    expect(aiCallAllowed("request", true)).toBe(false);
    expect(aiCallAllowed("request", false)).toBe(true);
  });

  it("draft and everything allow background drafting", () => {
    expect(aiCallAllowed("draft", true)).toBe(true);
    expect(aiCallAllowed("everything", true)).toBe(true);
  });

  it("an unknown stored level falls back to the default, never to everything", () => {
    expect(normalizeLevel("banana")).toBe(DEFAULT_AI_LEVEL);
    expect(normalizeLevel(undefined)).toBe(DEFAULT_AI_LEVEL);
    expect(DEFAULT_AI_LEVEL).toBe("draft");
  });

  it("a pin overrides the master, and match follows it", () => {
    const ctrl = { level: "everything" as AILevel, pins: { emailDrafts: "off" as AILevel, morningPlan: "match" as const } };
    expect(effectiveLevel(ctrl, "emailDrafts")).toBe("off");
    expect(effectiveLevel(ctrl, "morningPlan")).toBe("everything");
    expect(effectiveLevel(ctrl)).toBe("everything");
  });
});

describe("law: Off means zero proxy calls from the client", () => {
  it("AIService never reaches fetch when the level is off", async () => {
    let fetched = 0;
    const svc = new AIService({
      available: true,
      fetchImpl: (async () => { fetched++; return new Response("{}"); }) as typeof fetch,
    });
    setAIControl({ level: "off" });
    await expect(svc.complete([{ role: "user", content: "hi" }])).rejects.toThrow();
    expect(fetched).toBe(0);
  });

  it("AIService never reaches fetch for background work below draft", async () => {
    let fetched = 0;
    const svc = new AIService({
      available: true,
      fetchImpl: (async () => { fetched++; return new Response("{}"); }) as typeof fetch,
    });
    setAIControl({ level: "request" });
    await expect(svc.complete([{ role: "user", content: "hi" }], undefined, { background: true })).rejects.toThrow();
    expect(fetched).toBe(0);
  });

  it("a pinned-off feature is refused even when the master allows it", async () => {
    let fetched = 0;
    const svc = new AIService({
      available: true,
      fetchImpl: (async () => { fetched++; return new Response("{}"); }) as typeof fetch,
    });
    setAIControl({ level: "everything", pins: { emailDrafts: "off" } });
    await expect(svc.complete([{ role: "user", content: "hi" }], undefined, { pin: "emailDrafts" })).rejects.toThrow();
    expect(fetched).toBe(0);
  });
});

describe("law: enforcement is server-side too", () => {
  const proxySrc = readFileSync(join(__dirname, "..", "..", "api", "ai.ts"), "utf8");

  it("the proxy imports the shared gate and refuses with it", () => {
    expect(proxySrc).toMatch(/from "\.\.\/src\/ai\/aiGate"/);
    expect(proxySrc).toMatch(/aiCallAllowed\(/);
    expect(proxySrc).toMatch(/refusalMessage\(/);
  });

  it("the proxy reads the stored profile, not a client-sent level", () => {
    expect(proxySrc).toMatch(/entity_type=eq\.profile/);
    // The level must come from the profile read; the request body's own
    // fields must not be trusted as the level.
    expect(proxySrc).not.toMatch(/body\.level/);
  });

  it("the gate runs before admission counting, so refused calls are never billed", () => {
    const gateAt = proxySrc.indexOf("aiCallAllowed(");
    const admissionAt = proxySrc.indexOf("ai_try_consume");
    expect(gateAt).toBeGreaterThan(0);
    expect(admissionAt).toBeGreaterThan(0);
    expect(gateAt).toBeLessThan(admissionAt);
  });
});
