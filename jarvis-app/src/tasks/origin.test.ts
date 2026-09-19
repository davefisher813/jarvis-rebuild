import { describe, it, expect } from "vitest";
import { isFromEmail, originLabel } from "./origin";
import { madeBy } from "../shared/provenance";

// WHERE A TASK CAME FROM (Dave 2026-09-19: "these are emails and it says no
// category"). A row states facts. An area is a fact, an origin is a fact,
// and "No category" is neither.
describe("isFromEmail", () => {
  it("is true for a thread behind it, email as its source, or the deck's own title", () => {
    expect(isFromEmail({ text: "Anything", fromThread: "t1" })).toBe(true);
    expect(isFromEmail({ text: "Anything", source: madeBy("email", "t1") })).toBe(true);
    // The deck wrote tasks under this title before the thread link was ever
    // recorded, which is how one walked back onto Your Move after the first
    // filter shipped.
    expect(isFromEmail({ text: "Get back to Vercel: Production deploy" })).toBe(true);
    expect(isFromEmail({ text: "get back to apple" })).toBe(true);
  });
  it("is false for a task that is only a task", () => {
    expect(isFromEmail({ text: "Set up wallet card" })).toBe(false);
    expect(isFromEmail({ text: "Get back on the bike" })).toBe(false);
    expect(isFromEmail({ text: "Anything", source: madeBy("paste") })).toBe(false);
  });
});

describe("originLabel", () => {
  it("names the origin worth naming", () => {
    expect(originLabel({ text: "Get back to Apple: Your receipt" })).toBe("Email");
    expect(originLabel({ text: "Read it", fromNote: "n1" })).toBe("Note");
    expect(originLabel({ text: "x", source: madeBy("paste") })).toBe("Smart Paste");
    expect(originLabel({ text: "x", source: madeBy("recorder") })).toBe("Recording");
    expect(originLabel({ text: "x", source: madeBy("chat") })).toBe("Chat");
    expect(originLabel({ text: "x", source: madeBy("file") })).toBe("File");
  });
  it("is null for a plain task, so the line says nothing rather than announcing an absence", () => {
    expect(originLabel({ text: "Set up wallet card" })).toBeNull();
    expect(originLabel({ text: "x", source: madeBy("plan") })).toBeNull();
  });
  it("email wins over the note it also carries, because email is the stronger fact", () => {
    expect(originLabel({ text: "x", fromThread: "t1", fromNote: "n1" })).toBe("Email");
  });
});
