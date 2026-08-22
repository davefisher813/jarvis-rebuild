// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { handoffTargets, defaultNote, forwardSubject, handoffLine, handoffPrompt } from "./handoff";
import { parseCommitment, commitmentLine, alreadyPromised, markPromised } from "./commitments";
import { todayEmailLine, needsYouCount, type TriageMap } from "./triage";

const person = (name: string, email?: string, relationship?: string) =>
  ({ data: { name, ...(email ? { email } : {}), ...(relationship ? { relationship } : {}) } });

describe("hand off", () => {
  it("offers only people it can actually send to, deduped and sorted", () => {
    const got = handoffTargets([
      person("Marcus", "m@x.com", "ops"),
      person("Nobody"),                       // no email: cannot receive
      person("Jen", "J@X.com", "bookkeeper"),
      person("Jen again", "jen@x.com"),
      person("Dupe", "m@x.com"),              // same address as Marcus
    ]);
    expect(got.map((t) => t.name)).toEqual(["Jen", "Jen again", "Marcus"]);
    expect(got[0]!.email).toBe("j@x.com"); // normalised
    expect(got.find((t) => t.name === "Marcus")?.relationship).toBe("ops");
  });

  it("writes a short plain note when there is no AI", () => {
    const note = defaultNote({ name: "Jen", email: "j@x.com" }, "March invoice");
    expect(note).toBe("Jen, can you take this one? March invoice. Thanks.");
    expect(note.split(". ").length).toBeLessThanOrEqual(3);
  });

  it("forbids the apology and the signature in the written note", () => {
    const p = handoffPrompt({ name: "Jen", email: "j@x.com" }, "Invoice", "They need payment confirmed");
    expect(p.system).toContain("Never apologise");
    expect(p.system).toContain("no signature");
    expect(p.user).toContain("Jen");
  });

  // Brain Personalization Phase 3: the note goes out over the user's name.
  it("carries the JARVIS voice, which this prompt never had", () => {
    const p = handoffPrompt({ name: "Jen", email: "j@x.com" }, "Invoice", "");
    expect(p.system).toContain("You are JARVIS");
    expect(p.system).toContain("Never use em dashes");
  });

  it("is actually shown the voice it was already being told to imitate", () => {
    const p = handoffPrompt({ name: "Jen", email: "j@x.com" }, "Invoice", "", "User: Alex\nWriting voice: blunt, no filler");
    expect(p.system).toContain("Write it as this person would write it:");
    expect(p.system).toContain("blunt, no filler");
  });

  it("drafts fine with no voice context at all", () => {
    const p = handoffPrompt({ name: "Jen", email: "j@x.com" }, "Invoice", "", "");
    expect(p.system).not.toContain("Write it as this person would write it:");
    expect(p.system).toContain("Never apologise");
  });

  it("never stacks Fwd: on Fwd:", () => {
    expect(forwardSubject("Invoice")).toBe("Fwd: Invoice");
    expect(forwardSubject("Fwd: Invoice")).toBe("Fwd: Invoice");
    expect(forwardSubject("FW: Invoice")).toBe("FW: Invoice");
  });

  it("tells him who has it now", () => {
    // SPEC MOVED (short copy, 2026-08-15)
    expect(handoffLine("Jen")).toBe("Sent to Jen · Now in Waiting On");
  });
});

describe("commitment catcher", () => {
  beforeEach(() => localStorage.clear());

  it("takes the promise and the day he named", () => {
    const c = parseCommitment('{"text":"Send Ridgeley the roster","due":"2026-08-14"}', "2026-08-05");
    expect(c).toEqual({ text: "Send Ridgeley the roster", due: "2026-08-14" });
  });

  it("keeps the promise but drops a date in the past, which is a misread", () => {
    const c = parseCommitment('{"text":"Send the roster","due":"2020-01-01"}', "2026-08-05");
    expect(c).toEqual({ text: "Send the roster" });
  });

  it("returns nothing when nothing was promised, and on garbage", () => {
    expect(parseCommitment('{"text":""}', "2026-08-05")).toBeNull();
    expect(parseCommitment("I don't feel like JSON", "2026-08-05")).toBeNull();
    expect(parseCommitment('{"text":123}', "2026-08-05")).toBeNull();
  });

  it("catches a thread once and only once", () => {
    expect(alreadyPromised("t1")).toBe(false);
    markPromised("t1");
    markPromised("t1");
    expect(alreadyPromised("t1")).toBe(true);
    expect(JSON.parse(localStorage.getItem("jarvis.mail.promised.v1")!)).toEqual(["t1"]);
  });

  it("states the promise without a word of judgement", () => {
    const line = commitmentLine({ text: "Send the roster", due: "2026-08-14" });
    // SPEC MOVED (short copy, 2026-08-15)
    expect(line).toBe("Caught: Send the roster · By 2026-08-14");
    for (const w of ["forgot", "remember", "don't", "again", "promised you"]) {
      expect(line.toLowerCase()).not.toContain(w);
    }
  });
});

describe("today line", () => {
  beforeEach(() => localStorage.clear());

  it("says nothing at all when nothing needs him", () => {
    expect(todayEmailLine(0, 0)).toBe("");
  });

  it("counts people, and mentions the prepared replies when they exist", () => {
    // SPEC MOVED (short copy, 2026-08-15)
    expect(todayEmailLine(1, 0)).toBe("1 Email needs you");
    expect(todayEmailLine(2, 2)).toBe("2 Emails need you · replies written");
    expect(todayEmailLine(1, 1)).toBe("1 Email needs you · reply written");
  });

  it("reads the count straight off the cache so Today never waits", () => {
    const map: TriageMap = {
      a: { bucket: "needs_you", gist: "", lastMsgId: "1" },
      b: { bucket: "noise", gist: "", lastMsgId: "2" },
      c: { bucket: "needs_you", gist: "", lastMsgId: "3" },
    };
    expect(needsYouCount(map)).toBe(2);
    expect(needsYouCount({})).toBe(0);
  });
});
