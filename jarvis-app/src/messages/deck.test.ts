import { describe, it, expect } from "vitest";
import { buildPlanPrompt, parseDeckPlan, primaryLabel, laterTaskTitle } from "./deck";
import { cleanSentBody, voiceExamplesFor } from "./voiceExamples";
import { loadRules, saveRule, applyRules } from "./rules";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import type { ThreadFull, ThreadRow } from "../connections/google/map";
import type { TriageMap } from "./triage";

const THREAD: ThreadFull = {
  id: "t1", subject: "Waiver",
  messages: [{
    id: "m1", from: "Tucci", fromEmail: "t@x.com", to: "d@x.com", date: "Mon",
    subject: "Waiver", snippet: "", body: "Need the waiver by Friday", threadId: "t1", messageId: "<a@x>", attachments: [],
  }],
};

describe("parseDeckPlan", () => {
  it("parses each kind and keeps only the matching payload", () => {
    expect(parseDeckPlan(JSON.stringify({ kind: "reply", why: "Tucci wants the waiver.", reply: "On it tonight." })))
      .toEqual({ kind: "reply", why: "Tucci wants the waiver.", reply: "On it tonight." });
    expect(parseDeckPlan(JSON.stringify({ kind: "bill", why: "w", bill: { name: "Geico", amount: 214, due: "2026-08-12" } })))
      .toEqual({ kind: "bill", why: "w", bill: { name: "Geico", amount: 214, due: "2026-08-12" } });
    expect(parseDeckPlan(JSON.stringify({ kind: "event", why: "w", event: { title: "Dr. Patel", date: "2026-08-08", start: "14:30" } })))
      .toEqual({ kind: "event", why: "w", event: { title: "Dr. Patel", date: "2026-08-08", start: "14:30" } });
    expect(parseDeckPlan(JSON.stringify({ kind: "archive", why: "Nothing needed." })))
      .toEqual({ kind: "archive", why: "Nothing needed." });
  });

  it("never invents: missing amount, bad date, or empty reply kills the plan, not the truth", () => {
    expect(parseDeckPlan(JSON.stringify({ kind: "bill", why: "w", bill: { name: "Geico" } }))).toBeNull();
    expect(parseDeckPlan(JSON.stringify({ kind: "bill", why: "w", bill: { name: "Geico", amount: -5 } }))).toBeNull();
    expect(parseDeckPlan(JSON.stringify({ kind: "event", why: "w", event: { title: "X", date: "tomorrow", start: "14:30" } }))).toBeNull();
    expect(parseDeckPlan(JSON.stringify({ kind: "reply", why: "w", reply: "  " }))).toBeNull();
    expect(parseDeckPlan("I can't help with that.")).toBeNull();
    expect(parseDeckPlan(JSON.stringify({ kind: "urgent!!", why: "w" }))).toBeNull();
  });

  it("strips fences and clamps runaway numbers", () => {
    const p = parseDeckPlan("```json\n" + JSON.stringify({ kind: "bill", why: "w", bill: { name: "X", amount: 9999999 } }) + "\n```")!;
    expect(p.bill!.amount).toBe(100000);
  });

  it("primary label always names the action", () => {
    expect(primaryLabel({ kind: "reply", why: "" })).toBe("Send & Next");
    expect(primaryLabel({ kind: "bill", why: "" })).toBe("Add Bill & Next");
    expect(primaryLabel({ kind: "archive", why: "" })).toBe("Archive & Next");
  });

  it("later titles point back at the person and topic", () => {
    expect(laterTaskTitle("Sarah", "LLC docs")).toBe("Get back to Sarah: LLC docs");
  });
});

describe("buildPlanPrompt", () => {
  it("carries the register, the guardrails, and the user's real examples", () => {
    const { system, user } = buildPlanPrompt(THREAD, { register: "casual", examples: ["yo got it, tonight"] }, "2026-08-04");
    expect(system).toContain("Write casually.");
    expect(system).toContain("yo got it, tonight");
    expect(system).toContain("Never invent");
    expect(system).toContain("2026-08-04");
    expect(user).toContain("Need the waiver by Friday");
  });

  it("flagged outranks any register: guarded, commits to nothing", () => {
    const { system } = buildPlanPrompt(THREAD, { register: "friend", flagged: true, examples: [] }, "2026-08-04");
    expect(system).toContain("commits to nothing");
    // The friend-loosening line must NOT be added (STYLE_SCOPE_RULE's general
    // register text is fine; it is the per-person instruction that must not).
    expect(system).not.toContain("Write like a close friend:");
  });
});

describe("voiceExamples", () => {
  it("cleanSentBody drops quoted history and signatures, keeps the user's words", () => {
    expect(cleanSentBody("On it, sending tonight.\n\nOn Mon, Tucci wrote:\n> where is it")).toBe("On it, sending tonight.");
    expect(cleanSentBody("Sounds good.\n--\nDave Fisher")).toBe("Sounds good.");
    expect(cleanSentBody("> all quoted")).toBe("");
  });

  it("fetches the USER'S turns to a sender, caches per sender", async () => {
    let searches = 0;
    const api = makeFakeGoogleApi({
      searchThreads: async (q) => {
        searches++;
        expect(q).toBe("in:sent to:t@x.com");
        return [{ id: "s1", messages: [] }];
      },
      getThread: async () => ({
        id: "s1",
        messages: [
          { id: "a", threadId: "s1", snippet: "", payload: { mimeType: "text/plain", body: { data: btoa("where is the waiver") },
            headers: [{ name: "From", value: "Tucci <t@x.com>" }] } },
          { id: "b", threadId: "s1", snippet: "", payload: { mimeType: "text/plain", body: { data: btoa("My bad, sending it tonight") },
            headers: [{ name: "From", value: "Dave <d@x.com>" }] } },
        ],
      }),
    });
    let stored: Record<string, string> = {};
    const storage = { getItem: (k: string) => stored[k] ?? null, setItem: (k: string, v: string) => { stored[k] = v; } };
    const ex1 = await voiceExamplesFor(api, "T@x.com", 1000, storage);
    expect(ex1).toEqual(["My bad, sending it tonight"]); // the sender's own turn is excluded
    await voiceExamplesFor(api, "t@x.com", 2000, storage);
    expect(searches).toBe(1); // second call is a cache hit
  });

  it("failure returns [] and drafting proceeds without examples", async () => {
    const api = makeFakeGoogleApi({ searchThreads: async () => { throw new Error("offline"); } });
    const storage = { getItem: () => null, setItem: () => {} };
    expect(await voiceExamplesFor(api, "x@y.com", 1, storage)).toEqual([]);
  });
});

describe("sender rules", () => {
  const row = (id: string, fromEmail: string): ThreadRow =>
    ({ id, from: "X", fromEmail, subject: "s", snippet: "", unread: false, inInbox: true, dateMs: 1, count: 1, lastMsgId: id });

  it("an override beats the model, forever, case-insensitively", () => {
    let stored: Record<string, string> = {};
    const storage = { getItem: (k: string) => stored[k] ?? null, setItem: (k: string, v: string) => { stored[k] = v; } };
    const rules = saveRule("Promo@DD.com", "noise", storage);
    const map: TriageMap = { t1: { bucket: "needs_you", gist: "promo!", lastMsgId: "m" } };
    const after = applyRules(map, [row("t1", "promo@dd.com")], rules);
    expect(after.t1!.bucket).toBe("noise");
    expect(after.t1!.gist).toBe("promo!"); // the gist is still true, only the bucket moves
    expect(loadRules(storage)).toEqual({ "promo@dd.com": "noise" });
  });

  it("no rule, no change; garbage storage loads as no rules", () => {
    const map: TriageMap = { t1: { bucket: "worth_knowing", gist: "g", lastMsgId: "m" } };
    expect(applyRules(map, [row("t1", "a@b.com")], {})).toEqual(map);
    expect(loadRules({ getItem: () => "{broken" })).toEqual({});
    expect(loadRules({ getItem: () => JSON.stringify({ "a@b.com": "explode" }) })).toEqual({});
  });
});
