import { describe, it, expect } from "vitest";
import { emailFilingPreview, emailFilingText, EMAIL_PREVIEW_CHARS } from "./emailFilingText";

// What "File It" opens with: subject, a blank line, a plain-text preview.

describe("emailFilingText", () => {
  it("is the subject, a blank line, then the preview", () => {
    expect(emailFilingText("Waiver", "Need it by Friday")).toBe("Waiver\n\nNeed it by Friday");
  });
  it("is the subject alone when there is no preview", () => {
    expect(emailFilingText("Waiver", "  ")).toBe("Waiver");
  });
  it("leaves out the screen's (no subject) placeholder", () => {
    expect(emailFilingText("(no subject)", "Need it by Friday")).toBe("Need it by Friday");
    expect(emailFilingText("(no subject)", "")).toBe("");
  });
  it("trims both parts", () => {
    expect(emailFilingText("  Waiver ", "  hi  ")).toBe("Waiver\n\nhi");
  });
});

describe("emailFilingPreview", () => {
  it("prefers the fetched latest message's snippet, then the row's cached one", () => {
    expect(emailFilingPreview({ lastSnippet: "fresh", rowSnippet: "stale", lastBody: "body" })).toBe("fresh");
    expect(emailFilingPreview({ lastSnippet: "", rowSnippet: "cached", lastBody: "body" })).toBe("cached");
  });
  it("decodes the entities Gmail leaves in a snippet", () => {
    expect(emailFilingPreview({ lastSnippet: "Don&#39;t forget &amp; sign" })).toBe("Don't forget & sign");
  });
  it("derives plain text from the body when there is no snippet", () => {
    expect(emailFilingPreview({ lastSnippet: "", rowSnippet: "", lastBody: "Haven't seen it yet.\n\nThanks" }))
      .toBe("Haven't seen it yet.\n\nThanks");
  });
  it("never lets markup through: a snippet that is raw HTML is skipped", () => {
    expect(emailFilingPreview({ lastSnippet: "<div>hi</div>", rowSnippet: "hi there" })).toBe("hi there");
    expect(emailFilingPreview({ lastSnippet: "<p>x</p>", rowSnippet: "<b>y</b>", lastBody: "<div>z</div>" })).toBe("");
  });
  it("cuts a long derived body at a word, and never cuts a snippet", () => {
    const body = Array.from({ length: 400 }, () => "word").join(" ");
    const out = emailFilingPreview({ lastBody: body });
    expect(out.length).toBeLessThanOrEqual(EMAIL_PREVIEW_CHARS + 1);
    expect(out.endsWith("…")).toBe(true);
    const snip = "s".repeat(700);
    expect(emailFilingPreview({ lastSnippet: snip })).toBe(snip);
  });
  it("is empty when nothing is available", () => {
    expect(emailFilingPreview({})).toBe("");
  });
});
