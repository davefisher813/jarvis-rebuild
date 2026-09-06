import { describe, it, expect } from "vitest";
import { cleanHardLines, heldBy, heldLine, MAX_HARD_LINES, type HardLine } from "./hardLines";
import { shouldAutoReply } from "../messages/autoReply";

// UP-MIND-20, chosen option B. "Never auto-archive anything from the school"
// is a hard line, not a tone note. Deterministic, no AI call, and never
// written by the app: every line here was typed by the user.

const school: HardLine = { kind: "never_file", match: "school.org" };
const family: HardLine = { kind: "always_ask", match: "Family" };
const gym: HardLine = { kind: "protect", match: "Gym" };

describe("reading what the user stored", () => {
  it("keeps well-formed lines and drops everything else", () => {
    expect(cleanHardLines([school, { kind: "nonsense", match: "x" }, { kind: "protect" }, "no"])).toEqual([school]);
  });

  it("drops duplicates and stays capped", () => {
    expect(cleanHardLines([school, { ...school }])).toHaveLength(1);
    const many = Array.from({ length: 40 }, (_, i) => ({ kind: "protect" as const, match: "b" + i }));
    expect(cleanHardLines(many)).toHaveLength(MAX_HARD_LINES);
  });

  it("survives a store that holds nothing at all", () => {
    expect(cleanHardLines(undefined)).toEqual([]);
    expect(cleanHardLines(null)).toEqual([]);
  });
});

describe("what a line holds", () => {
  it("holds an automatic file from a matching domain", () => {
    expect(heldBy([school], { action: "file", fromEmail: "office@school.org" })).toEqual(school);
    expect(heldBy([school], { action: "file", fromEmail: "sales@other.com" })).toBeNull();
  });

  it("holds only the kinds of action it is about", () => {
    expect(heldBy([school], { action: "reply", fromEmail: "office@school.org" })).toBeNull();
    expect(heldBy([family], { action: "reply", category: "Family" })).toEqual(family);
    expect(heldBy([gym], { action: "reflow", blockTitle: "Gym session" })).toEqual(gym);
    expect(heldBy([gym], { action: "file", category: "Gym" })).toBeNull();
  });

  // "art" must not hold "start", and a rule about school must not catch
  // "schoolyard" inside another word.
  it("matches a whole word, never a substring", () => {
    expect(heldBy([{ kind: "protect", match: "art" }], { action: "reflow", blockTitle: "Start the deck" })).toBeNull();
    expect(heldBy([{ kind: "protect", match: "art" }], { action: "reflow", blockTitle: "Art class" })).not.toBeNull();
  });

  it("says which line held it, so a held action is never silence", () => {
    expect(heldLine(school)).toBe("Held: your Values say school.org is never filed");
    expect(heldLine(gym)).toBe("Held: your Values say Gym is never moved");
  });
});

describe("the gate order: confidence, then Values", () => {
  const base = {
    enabled: true, fromEmail: "head@school.org", myEmail: "me@x.com",
    vips: ["head@school.org"], state: { blockId: "b", repliedTo: [] }, alreadyRepliedThread: false,
  };

  it("sends when nothing objects", () => {
    expect(shouldAutoReply(base)).toBe(true);
  });

  it("stops at a low-confidence read before it ever looks at Values", () => {
    expect(shouldAutoReply({ ...base, confidence: "low", hardLines: [] })).toBe(false);
  });

  it("stops a confident reply at a hard line", () => {
    expect(shouldAutoReply({ ...base, confidence: "high", hardLines: [{ kind: "always_ask", match: "school.org" }] })).toBe(false);
  });

  it("is unchanged for a caller that states no lines", () => {
    expect(shouldAutoReply({ ...base, hardLines: [] })).toBe(true);
  });
});
