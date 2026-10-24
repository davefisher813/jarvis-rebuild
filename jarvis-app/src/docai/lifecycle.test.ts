import { describe, expect, it } from "vitest";
import { rowWords } from "./lifecycle";
import type { DocBlock } from "./types";

const w = (b: DocBlock | undefined, aiLevel: "everything" | "draft" | "request" | "off" = "draft") => rowWords(b, { aiLevel });

describe("the row's words (build order acceptance)", () => {
  it("a bill ready for review", () => {
    expect(w({ state: "proposed", kind: "bill" })).toEqual({ title: "Ready to Review", facts: ["Bill"], action: "open" });
  });
  it("Filed, and where", () => {
    expect(w({ state: "filed", filedTo: "Bill in Money" })).toMatchObject({ title: "Filed", facts: ["Bill in Money"] });
  });
  it("AI Off: read, page count shown, not reviewed, and no review offered", () => {
    expect(w({ state: "read", pages: 2, notReviewed: true }, "off")).toEqual({ title: "Read", facts: ["2 Pages", "Not Reviewed Yet"] });
  });
  it("On Request: read, not reviewed, and a tap reviews it", () => {
    expect(w({ state: "read", pages: 1, notReviewed: true }, "request")).toMatchObject({ title: "Read", facts: ["1 Page", "Not Reviewed Yet"], action: "review" });
  });
  it("credit exhausted is its own named state", () => {
    expect(w({ state: "read", errorCode: "CREDIT" })).toMatchObject({ title: "Saved, Not Read Yet", facts: ["The AI Account Needs Credit"], action: "retry" });
  });
  it("a cap or budget wait is waiting, not failing", () => {
    expect(w({ state: "read", waiting: true })).toMatchObject({ title: "Waiting", facts: ["AI Is Busy Right Now"] });
  });
  it("outcome unknown says reading didn't finish and offers the retry", () => {
    expect(w({ state: "failed", errorCode: "OUTCOME_UNKNOWN" })).toMatchObject({ title: "Reading Didn't Finish", facts: ["Tap to Try Again"], action: "retry" });
  });
  it("a partial read names the pages it is missing", () => {
    expect(w({ state: "read-partial", missingPages: [3, 4] })).toMatchObject({ title: "Partly Read", facts: ["Pages 3, 4 Missing"] });
    expect(w({ state: "read-partial", missingPages: [9] }).facts).toEqual(["Page 9 Missing"]);
  });
  it("a row never carries more than a title and two facts (cut off on the phone's width otherwise)", () => {
    expect(w({ state: "read-partial", kind: "bill", missingPages: [3], words: 300 }).facts).toEqual(["Page 3 Missing"]);
    expect(w({ state: "read", kind: "letter", pages: 1, words: 140 }).facts).toEqual(["Looks Like a Letter"]);
    expect(w({ state: "read", pages: 2, words: 140 }).facts).toEqual(["2 Pages"]);
  });
  it("working states say so", () => {
    expect(w(undefined)).toMatchObject({ title: "Saved", working: true });
    expect(w({ state: "reading" })).toMatchObject({ title: "Reading", working: true });
    expect(w({ state: "extracting" })).toMatchObject({ title: "Reviewing", working: true });
  });
  it("what cannot be read is said plainly", () => {
    expect(w({ state: "unreadable", errorCode: "ENCRYPTED" }).title).toBe("Password Protected");
    expect(w({ state: "unreadable", errorCode: "NO_TEXT", pages: 3 })).toMatchObject({ title: "No Text to Read", facts: ["3 Pages"] });
    expect(w({ state: "stored", errorCode: "NO_TEXT" }).facts).toEqual(["Photos Can't Be Read Yet"]);
  });
  it("every word is Title Case, no dot is typed into a string and no number leads a lowercase word", () => {
    const blocks: DocBlock[] = [
      { state: "proposed", kind: "bill" }, { state: "filed", filedTo: "Bill in Money" }, { state: "read", pages: 2, notReviewed: true }, { state: "read", errorCode: "CREDIT" },
      { state: "read", waiting: true }, { state: "failed", errorCode: "OUTCOME_UNKNOWN" }, { state: "read-partial", missingPages: [3, 4, 5, 6, 7] }, { state: "unreadable", errorCode: "PARSER" },
    ];
    for (const b of blocks) {
      const r = w(b);
      for (const s of [r.title, ...r.facts]) {
        expect(s).not.toMatch(/[.·—–]/);
        expect(s).not.toMatch(/\d [a-z]/);
        for (const word of s.split(" ")) if (/^[a-z]/.test(word)) expect(["and", "in", "to", "of", "a", "is"]).toContain(word);
      }
    }
  });
});
