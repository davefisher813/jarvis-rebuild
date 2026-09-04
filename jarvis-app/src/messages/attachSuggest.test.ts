import { describe, it, expect } from "vitest";
import { asksIn, promisedAttachment, suggestAttachment, suggestLine, noteAsText, attachmentFilename, type Candidate } from "./attachSuggest";
import type { NoteData } from "../notes/types";

describe("asksIn + promisedAttachment", () => {
  it("finds what was asked for, lowercased and deduped", () => {
    expect(asksIn("Can you send the waiver? Please attach the waiver today.")).toEqual(["waiver"]);
  });

  it("ignores ordinary sentences with no ask verb", () => {
    expect(asksIn("Need the waiver by Friday")).toEqual([]);
  });

  it("recognises the ways a reply promises a file", () => {
    expect(promisedAttachment("Here's the waiver.")).toBe(true);
    expect(promisedAttachment("Attached is the waiver.")).toBe(true);
    expect(promisedAttachment("Sounds good, talk soon.")).toBe(false);
  });
});

describe("suggestAttachment", () => {
  const FILES: Candidate[] = [{ id: "n1", name: "Ridgeline Waiver 2026", kind: "note" }];

  it("matches an ask to something he owns, both directions of containment", () => {
    const hit = suggestAttachment("Can you send the waiver?", "Here's the waiver.", FILES);
    expect(hit).toEqual({ candidate: FILES[0], asked: "waiver" });
  });

  it("says nothing until the draft itself promises a file", () => {
    expect(suggestAttachment("Can you send the waiver?", "Sure, on it.", FILES)).toBeNull();
  });

  it("says nothing when nothing was asked for", () => {
    expect(suggestAttachment("Thanks for the update.", "Here's the waiver.", FILES)).toBeNull();
  });

  it("never matches a short, generic word against an unrelated file", () => {
    const hit = suggestAttachment("Can you send that over?", "Here's that.", FILES);
    expect(hit).toBeNull();
  });

  it("suggestLine names both the ask and the file", () => {
    expect(suggestLine({ candidate: FILES[0]!, asked: "waiver" })).toBe('They asked for the waiver. You have "Ridgeline Waiver 2026".');
  });
});

// S2-8 (2026-09-04): "You Have That File cannot attach it." What actually
// gets sent when he taps -- a plain-text rendering of the note he has, not
// a filename typed into the body.
describe("noteAsText", () => {
  const note = (blocks: NoteData["blocks"]): Pick<NoteData, "title" | "blocks"> => ({ title: "Ridgeline Waiver 2026", blocks });

  it("opens with the title, then renders text, heading and meta blocks verbatim", () => {
    const out = noteAsText(note([
      { id: "b1", type: "meta", text: "Aug 28 · Ridgeline" },
      { id: "b2", type: "heading", text: "Who needs to sign" },
      { id: "b3", type: "text", text: "Every player on the roster." },
    ]));
    expect(out).toBe("Ridgeline Waiver 2026\n\nAug 28 · Ridgeline\n\nWho needs to sign\n\nEvery player on the roster.\n");
  });

  it("renders a checklist as [x]/[ ], a bulleted list with dashes, a numbered list with digits", () => {
    const out = noteAsText(note([
      { id: "b1", type: "checklist", items: [{ text: "Sign", done: true }, { text: "Return", done: false }] },
      { id: "b2", type: "bulleted_list", items: ["Bring cleats", "Bring water"] },
      { id: "b3", type: "numbered_list", items: ["Warm up", "Scrimmage"] },
    ]));
    expect(out).toBe(
      "Ridgeline Waiver 2026\n\n" +
      "[x] Sign\n[ ] Return\n\n" +
      "- Bring cleats\n- Bring water\n\n" +
      "1. Warm up\n2. Scrimmage\n",
    );
  });

  it("renders a table as pipe-separated rows, header first", () => {
    const out = noteAsText(note([
      { id: "b1", type: "table", columns: ["Name", "Paid"], rows: [["Sarah", "Yes"], ["Bo", "No"]] },
    ]));
    expect(out).toBe("Ridgeline Waiver 2026\n\nName | Paid\nSarah | Yes\nBo | No\n");
  });

  it("names a photo or file block by its name instead of inventing content", () => {
    const out = noteAsText(note([
      { id: "b1", type: "photo", name: "team_photo.jpg" },
      { id: "b2", type: "file", name: "waiver_scan.pdf" },
    ]));
    expect(out).toBe("Ridgeline Waiver 2026\n\n[Photo: team_photo.jpg]\n\n[File: waiver_scan.pdf]\n");
  });

  it("skips a block with nothing to say rather than leaving a blank line for it", () => {
    const out = noteAsText(note([
      { id: "b1", type: "text", text: "  " },
      { id: "b2", type: "text", text: "Real content" },
    ]));
    expect(out).toBe("Ridgeline Waiver 2026\n\nReal content\n");
  });

  it("falls back to Untitled for a blank title, never an empty first line", () => {
    expect(noteAsText({ title: "  ", blocks: [] })).toBe("Untitled\n");
  });
});

describe("attachmentFilename", () => {
  it("uses the note's own title", () => {
    expect(attachmentFilename("Ridgeline Waiver 2026")).toBe("Ridgeline Waiver 2026.txt");
  });

  it("strips characters a filesystem or a mail header would choke on", () => {
    expect(attachmentFilename('Q3: "Final"/Report?')).toBe("Q3 FinalReport.txt");
  });

  it("falls back to Attachment for a blank title", () => {
    expect(attachmentFilename("  ")).toBe("Attachment.txt");
    expect(attachmentFilename("")).toBe("Attachment.txt");
  });

  it("caps a very long title so the filename stays a real filename", () => {
    const long = "x".repeat(200);
    expect(attachmentFilename(long)).toBe("x".repeat(80) + ".txt");
  });
});
