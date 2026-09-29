// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ensureThreadBrief, type ThreadBriefAI, type ThreadBriefArgs } from "./threadBrief";
import { briefFor, loadBriefs, isCurrentBrief } from "./brief";
import type { SourceInput } from "./briefSource";
import { resetInboxRefreshState } from "./inboxRefresh";
import { BRIEF_SCHEMA_VERSION } from "./mailContracts";

const ME = "dave@me.com";
const scope = { userId: "u1", account: ME };
const MON = Date.UTC(2026, 8, 21, 18, 0);

const msg = (id: string, fromEmail: string, body: string, dateMs = MON): SourceInput => ({ id, from: fromEmail.split("@")[0]!, fromEmail, dateMs, body });

// A fake model that answers the v4 call from what the prompt actually shows it,
// and counts every request. It never sees a network.
function fakeAI(over: { answer?: (prompt: string, n: number) => string; delayMs?: number } = {}) {
  const calls: string[] = [];
  const ai: ThreadBriefAI = {
    available: true,
    complete: vi.fn(async (messages) => {
      const prompt = messages[0]!.content;
      calls.push(prompt);
      if (over.delayMs) await new Promise((r) => setTimeout(r, over.delayMs));
      return over.answer
        ? over.answer(prompt, calls.length)
        : JSON.stringify({
          summary: "Coach wants a time",
          replies: ["Works", "Can't", "Later"],
          meetingCandidates: [{ messageId: "m2", quote: "See you Tuesday at 3 PM", title: "Practice", status: "agreed" }],
          replyRequirements: [{ messageId: "m2", quote: "Please send the waiver", kind: "request", label: "waiver", match: { kind: "attachment", topicTerms: ["waiver"] } }],
        });
    }),
  };
  return { ai, calls };
}

const thread = (): SourceInput[] => [
  msg("m1", ME, "Hi coach"),
  msg("m2", "coach@club.org", "See you Tuesday at 3 PM. Please send the waiver."),
];
const args = (ai: ThreadBriefAI, over: Partial<ThreadBriefArgs> = {}): ThreadBriefArgs => ({
  ai, scope, threadId: "t1", subject: "Practice", messages: thread(), selfEmails: [ME], zone: "America/New_York", ...over,
});

describe("ensureThreadBrief: one reading per account, revision and schema", () => {
  beforeEach(() => { localStorage.clear(); resetInboxRefreshState(); });

  it("reads the thread once and caches it: the second ask costs no call", async () => {
    const { ai, calls } = fakeAI();
    const first = await ensureThreadBrief(args(ai));
    expect(first).toMatchObject({ source: "model", calls: 1, revision: "m2" });
    expect(first.brief?.meetingCandidates?.[0]).toMatchObject({ date: "2026-09-22", start: "15:00" });
    const again = await ensureThreadBrief(args(ai));
    expect(again).toMatchObject({ source: "cache", calls: 0 });
    expect(again.brief).toEqual(first.brief);
    expect(calls).toHaveLength(1);
  });

  it("openThread and startReply on the same thread are ONE call, even when they overlap", async () => {
    const { ai, calls } = fakeAI({ delayMs: 20 });
    // openThread asks first; the reader taps Reply while it is still in flight.
    const open = ensureThreadBrief(args(ai));
    const reply = ensureThreadBrief(args(ai));
    const [a, b] = await Promise.all([open, reply]);
    expect(calls).toHaveLength(1);
    expect(a.calls).toBe(1);
    expect(b.calls).toBe(0);
    expect(b.brief).toEqual(a.brief);
    // And Reply after the open finished reads the cache.
    expect((await ensureThreadBrief(args(ai))).source).toBe("cache");
    expect(calls).toHaveLength(1);
  });

  it("a new message is a new revision and reads again", async () => {
    const { ai, calls } = fakeAI();
    await ensureThreadBrief(args(ai));
    const more = [...thread(), msg("m3", "coach@club.org", "Also bring water.")];
    const r = await ensureThreadBrief(args(ai, { messages: more }));
    expect(r).toMatchObject({ source: "model", revision: "m3" });
    expect(calls).toHaveLength(2);
  });

  it("the same message id in another account is its own reading", async () => {
    const { ai, calls } = fakeAI();
    await ensureThreadBrief(args(ai));
    await ensureThreadBrief(args(ai, { scope: { userId: "u1", account: "other@x.com" }, selfEmails: ["other@x.com"] }));
    expect(calls).toHaveLength(2);
    expect(Object.keys(JSON.parse(localStorage.getItem("jarvis.mail.brief.v4")!))).toHaveLength(2);
  });

  it("a v3 entry still displays, is read again once, and is replaced by a v4 entry", async () => {
    localStorage.setItem("jarvis.mail.brief.v3", JSON.stringify({ m2: { summary: "Old summary", replies: ["Ok"], state: "waiting_on_you" } }));
    // Displays immediately, before any call.
    expect(briefFor("m2", loadBriefs(), scope)?.summary).toBe("Old summary");
    const { ai, calls } = fakeAI();
    const r = await ensureThreadBrief(args(ai));
    expect(calls).toHaveLength(1);
    expect(r.brief?.summary).toBe("Coach wants a time");
    expect(isCurrentBrief(briefFor("m2", loadBriefs(), scope))).toBe(true);
    // The v3 key is untouched.
    expect(JSON.parse(localStorage.getItem("jarvis.mail.brief.v3")!).m2.summary).toBe("Old summary");
    expect((await ensureThreadBrief(args(ai))).calls).toBe(0);
  });

  it("with no AI a v3 entry is returned as it is, and nothing is called", async () => {
    localStorage.setItem("jarvis.mail.brief.v3", JSON.stringify({ m2: { summary: "Old summary", replies: [] } }));
    const r = await ensureThreadBrief(args({ available: false, complete: vi.fn() }));
    expect(r).toMatchObject({ source: "cache", calls: 0 });
    expect(r.brief?.summary).toBe("Old summary");
  });

  it("a failed read shows nothing new, caches nothing, and the next ask tries again", async () => {
    let fail = true;
    const { ai, calls } = fakeAI({ answer: () => { if (fail) throw new Error("offline"); return JSON.stringify({ summary: "ok", replies: [] }); } });
    const bad = await ensureThreadBrief(args(ai));
    expect(bad).toMatchObject({ brief: null, source: "none" });
    expect(bad.error).toBeInstanceOf(Error);
    expect(localStorage.getItem("jarvis.mail.brief.v4")).toBeNull();
    fail = false;
    const good = await ensureThreadBrief(args(ai));
    expect(good.source).toBe("model");
    expect(calls).toHaveLength(2);
  });

  it("never throws, whatever goes wrong inside: it is a failed read with the error attached", async () => {
    const { ai } = fakeAI();
    const r = await ensureThreadBrief(args(ai, { selfEmails: null as unknown as string[] }));
    expect(r).toMatchObject({ brief: null, source: "none" });
    expect(r.error).toBeInstanceOf(Error);
    // And the single-flight slot is free again.
    expect((await ensureThreadBrief(args(ai))).source).toBe("model");
  });

  it("an answer that is not JSON is a failed read", async () => {
    const { ai } = fakeAI({ answer: () => "I cannot help with that" });
    expect(await ensureThreadBrief(args(ai))).toMatchObject({ brief: null, source: "none" });
  });

  it("the prompt is fenced, carries message ids and the zone, and no message text is cut to 1200 characters", async () => {
    const big = "Please read this. " + "Detail sentence goes here. ".repeat(100) + "THE LAST WORDS ARE HERE.";
    const { ai, calls } = fakeAI({ answer: () => JSON.stringify({ summary: "s", replies: [] }) });
    await ensureThreadBrief(args(ai, { messages: [msg("m1", "a@x.com", big)] }));
    const p = calls[0]!;
    expect(p).toContain("<<<BEGIN EMAIL>>>");
    expect(p).toContain("[message m1 | from them: a | Mon 2026-09-21 14:00 America/New_York]");
    expect(p).toContain("THE LAST WORDS ARE HERE.");
    expect(p).toContain("America/New_York");
  });

  it("a message from before the reader's reply is not asked about, but the read is still complete", async () => {
    const { ai } = fakeAI();
    const r = await ensureThreadBrief(args(ai));
    expect(r.brief?.replyRequirements).toMatchObject({ completeSource: true, sourceRevision: "m2" });
    expect(r.brief?.replyRequirements?.items.map((i) => i.label)).toEqual(["Waiver"]);
  });

  it("links: a caller that supplies them is not answered by an entry made without them", async () => {
    const { ai, calls } = fakeAI({ answer: () => JSON.stringify({ summary: "s", replies: [], notification: { kind: "open_share", linkId: "L1" } }) });
    await ensureThreadBrief(args(ai));
    const withLinks = await ensureThreadBrief(args(ai, { links: [{ id: "L1", host: "docs.example", text: "Open" }] }));
    expect(calls).toHaveLength(2);
    expect(withLinks.brief?.notification).toEqual({ kind: "open_share", linkId: "L1" });
    expect((await ensureThreadBrief(args(ai, { links: [{ id: "L1", host: "docs.example", text: "Open" }] }))).calls).toBe(0);
  });
});

describe("ensureThreadBrief: long conversations are chunked, never silently cut", () => {
  beforeEach(() => { localStorage.clear(); resetInboxRefreshState(); });

  const para = (tag: string, n: number) => Array.from({ length: n }, (_, i) => `${tag} sentence ${i} about the season and the fields.`).join(" ");
  const longThread = (): SourceInput[] => Array.from({ length: 10 }, (_, i) => msg("m" + i, "coach@club.org", para("msg" + i, 90)));

  it("reads at most three chunks, newest first, and sets completeSource false when relevant text was skipped", async () => {
    const { ai, calls } = fakeAI({ answer: () => JSON.stringify({ summary: "s", replies: [], meetingCandidates: [], replyRequirements: [] }) });
    const r = await ensureThreadBrief(args(ai, { messages: longThread() }));
    expect(calls.length).toBeLessThanOrEqual(3);
    expect(calls.length).toBeGreaterThan(1);
    // The newest message is in the first call.
    expect(calls[0]).toContain("msg9 sentence 89");
    expect(r.brief?.replyRequirements?.completeSource).toBe(false);
    expect(r.brief?.replyRequirements?.items).toEqual([]);
  });

  it("chunk results are cached: after a failed older chunk, only that chunk is asked again", async () => {
    let n = 0;
    let failSecond = true;
    const { ai, calls } = fakeAI({
      answer: () => {
        n++;
        if (n === 2 && failSecond) throw new Error("timeout");
        return JSON.stringify({ summary: "s" + n, replies: [], meetingCandidates: [], replyRequirements: [] });
      },
    });
    const first = await ensureThreadBrief(args(ai, { messages: longThread() }));
    // Newest chunk landed; the second failed. What was read is shown, marked incomplete, and NOT cached.
    expect(first.source).toBe("model");
    expect(first.error).toBeInstanceOf(Error);
    expect(first.brief?.replyRequirements?.completeSource).toBe(false);
    expect(localStorage.getItem("jarvis.mail.brief.v4")).toBeNull();
    const callsAfterFirst = calls.length;
    failSecond = false;
    const second = await ensureThreadBrief(args(ai, { messages: longThread() }));
    // The newest chunk came from the chunk cache; only the failed one (and any after it) went out.
    // The newest chunk is never asked for again.
    expect(calls.slice(callsAfterFirst).every((p) => !p.includes("msg9 sentence 89"))).toBe(true);
    expect(calls.length).toBeGreaterThan(callsAfterFirst);
    expect(second.error).toBeUndefined();
    expect(localStorage.getItem("jarvis.mail.brief.v4")).not.toBeNull();
  });

  it("requirements from an older chunk are merged with the newest, without duplicates", async () => {
    const answers = (prompt: string) => {
      const newest = prompt.includes("msg9 sentence 89");
      return JSON.stringify({
        summary: "s", replies: [],
        replyRequirements: [
          newest
            ? { messageId: "m9", quote: "msg9 sentence 3 about the season and the fields", kind: "question", label: "season", match: { kind: "free_text", topicTerms: ["season"] } }
            : { messageId: "m7", quote: "msg7 sentence 3 about the season and the fields", kind: "question", label: "fields", match: { kind: "free_text", topicTerms: ["fields"] } },
        ],
      });
    };
    const { ai } = fakeAI({ answer: answers });
    const r = await ensureThreadBrief(args(ai, { messages: longThread() }));
    const labels = r.brief!.replyRequirements!.items.map((i) => i.label).sort();
    expect(labels).toContain("Season");
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("the schema version rides on the entry", async () => {
    const { ai } = fakeAI();
    const r = await ensureThreadBrief(args(ai));
    expect(r.brief?.schema).toBe(BRIEF_SCHEMA_VERSION);
  });
});
