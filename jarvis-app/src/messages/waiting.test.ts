import { describe, it, expect } from "vitest";
import { findWaiting, waitingLine, nudgePrompt } from "./waiting";
import { loadTracks, saveTrack, trackForThread } from "./tracking";
import { encodeEmail, type GmailMeta, type GmailThreadMeta } from "../connections/google/map";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";

const DAY = 86400e3;
const NOW = 100 * DAY;

const msg = (id: string, from: string, to: string, subject: string, dateMs: number): GmailMeta => ({
  id, snippet: "s", internalDate: String(dateMs),
  payload: { headers: [{ name: "From", value: from }, { name: "To", value: to }, { name: "Subject", value: subject }] },
});

const thread = (id: string, messages: GmailMeta[]): GmailThreadMeta => ({ id, messages });

function apiWith(threads: GmailThreadMeta[]) {
  return makeFakeGoogleApi({
    getProfile: async () => ({ emailAddress: "dave@x.com" }),
    searchThreads: async (q) => {
      expect(q).toContain("in:sent");
      return threads;
    },
  });
}

describe("findWaiting", () => {
  it("keeps only threads where MY message is last, old enough, to a human", async () => {
    const rows = await findWaiting(apiWith([
      thread("t_sarah", [msg("m1", "Dave <dave@x.com>", "Sarah <sarah@y.com>", "LLC docs", NOW - 4 * DAY)]),
      thread("t_replied", [
        msg("m2", "Dave <dave@x.com>", "Bo <bo@y.com>", "Gym", NOW - 5 * DAY),
        msg("m3", "Bo <bo@y.com>", "Dave <dave@x.com>", "Re: Gym", NOW - 4 * DAY), // they replied: out
      ]),
      thread("t_fresh", [msg("m4", "Dave <dave@x.com>", "Al <al@y.com>", "Quick q", NOW - 1 * DAY)]), // too fresh: out
      thread("t_robot", [msg("m5", "Dave <dave@x.com>", "no-reply@apple.com", "Enrollment", NOW - 6 * DAY)]), // machine: out
      thread("t_self", [msg("m6", "Dave <dave@x.com>", "Dave <dave@x.com>", "Note", NOW - 9 * DAY)]), // self: out
    ]), NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ threadId: "t_sarah", to: "Sarah", toEmail: "sarah@y.com", waitingDays: 4 });
  });

  it("sorts longest wait first and caps the list", async () => {
    const threads = Array.from({ length: 8 }, (_, i) =>
      thread("t" + i, [msg("m" + i, "Dave <dave@x.com>", "P" + i + " <p" + i + "@y.com>", "S" + i, NOW - (i + 2) * DAY)]));
    const rows = await findWaiting(apiWith(threads), NOW, 5);
    expect(rows).toHaveLength(5);
    expect(rows[0]!.waitingDays).toBe(9);
  });
});

describe("waitingLine", () => {
  const row = { threadId: "t", to: "Sarah", toEmail: "s@y.com", subject: "LLC", waitingDays: 4, lastMsgId: "m" };
  it("no open signal: states the wait, never claims 'not opened'", () => {
    const line = waitingLine(row, null);
    expect(line).toBe("4 days, no reply");
    expect(line.toLowerCase()).not.toContain("not opened");
  });
  it("a real open shows the date", () => {
    expect(waitingLine(row, "2026-08-02T10:00:00Z")).toMatch(/^Opened Aug 2 · no reply$/);
  });
});

describe("nudgePrompt", () => {
  it("never guilts and never leaks the tracking", () => {
    const { system, user } = nudgePrompt({ threadId: "t", to: "Sarah", toEmail: "s@y.com", subject: "LLC docs", waitingDays: 4, lastMsgId: "m" });
    expect(system).toContain("zero guilt");
    expect(system).toContain("Never mention tracking");
    expect(user).toContain("Sarah");
    expect(user).toContain("4 days");
  });
});

describe("tracking store", () => {
  it("round-trips, maps thread to its LATEST track, caps oldest-first", () => {
    let stored: Record<string, string> = {};
    const storage = { getItem: (k: string) => stored[k] ?? null, setItem: (k: string, v: string) => { stored[k] = v; } };
    saveTrack("aaaaaaaa-0000-4000-8000-000000000001", { threadId: "t1", sentAt: 100 }, storage);
    saveTrack("aaaaaaaa-0000-4000-8000-000000000002", { threadId: "t1", sentAt: 200 }, storage);
    const tracks = loadTracks(storage);
    expect(trackForThread("t1", tracks)).toBe("aaaaaaaa-0000-4000-8000-000000000002"); // a nudge re-tracks
    expect(trackForThread("ghost", tracks)).toBeNull();
    for (let i = 0; i < 105; i++) {
      saveTrack("bbbbbbbb-0000-4000-8000-" + String(i).padStart(12, "0"), { threadId: "t" + i, sentAt: 300 + i }, storage);
    }
    expect(Object.keys(loadTracks(storage)).length).toBe(100);
    expect(loadTracks({ getItem: () => "{broken" })).toEqual({});
  });
});

describe("encodeEmail with pixel", () => {
  const dec = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

  it("plain by default: no html, no pixel", () => {
    const raw = dec(encodeEmail({ to: "a@b.com", subject: "Hi", body: "Yo <friend>" }));
    expect(raw).toContain("text/plain");
    expect(raw).not.toContain("multipart");
    expect(raw).toContain("Yo <friend>");
  });

  it("with pixelUrl: multipart with IDENTICAL text, escaped html, one 1x1 img", () => {
    const raw = dec(encodeEmail({ to: "a@b.com", subject: "Hi", body: "Yo <friend>\nline2", pixelUrl: "https://x.app/api/open?t=abc" }));
    expect(raw).toContain("multipart/alternative");
    expect(raw).toContain("Yo <friend>\nline2"); // the plain part keeps the raw text verbatim
    expect(raw).toContain("Yo &lt;friend&gt;<br>line2"); // html part is escaped
    expect(raw).toContain('src="https://x.app/api/open?t=abc" width="1" height="1"');
    expect(raw).not.toContain("In-Reply-To"); // none was given
  });
});
