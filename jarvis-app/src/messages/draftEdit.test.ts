import { describe, it, expect } from "vitest";
import { classifyDraftEdit, DRAFT_EDIT_KINDS, DRAFT_EDIT_SENTENCE } from "./draftEdit";

// C-56 (Astra, 2026-09-12): the closed set, and that only a kind comes out.
const DRAFT = "Hi Marco,\n\nThanks for sending the revised pricing over. I have gone through it and it looks close to what we discussed, with a couple of small changes I would like to flag below.\n\nCould you confirm the delivery window?\n\nBest,\nDave";

describe("classifyDraftEdit", () => {
  it("names the greeting and sign-off drops, and the three words", () => {
    expect(classifyDraftEdit(DRAFT, DRAFT.replace(/^Hi Marco,\n\n/, ""))).toBe("dropped_greeting");
    expect(classifyDraftEdit(DRAFT, DRAFT.replace(/\n\nBest,\nDave$/, ""))).toBe("dropped_signoff");
    expect(classifyDraftEdit("Please advise on timing.\nThanks", "Let me know on timing.\nThanks")).toBe("removed_please_advise");
    expect(classifyDraftEdit("Kindly send the file.", "Send the file.")).toBe("removed_kindly");
    expect(classifyDraftEdit("I just wanted to check in.", "I wanted to check in.")).toBe("removed_just");
  });

  it("reads a shortened opening, a shortened whole, and a register change", () => {
    const shortOpen = DRAFT.replace("Thanks for sending the revised pricing over. I have gone through it and it looks close to what we discussed, with a couple of small changes I would like to flag below.", "Pricing looks close, two small changes below.");
    expect(classifyDraftEdit(DRAFT, shortOpen)).toBe("shortened_opening");
    expect(classifyDraftEdit(DRAFT, "Hi Marco,\n\nPricing looks close.\n\nBest,\nDave")).toBe("shortened_overall");
    expect(classifyDraftEdit("Dear Marco,\n\nPlease find the file attached. I would like to confirm the date.\n\nSincerely,\nDave", "Hey Marco,\n\nFile attached. Can you confirm the date? Thanks!\n\nDave")).toBe("formal_to_casual");
    expect(classifyDraftEdit("Hey Marco, file attached, thanks! Talk soon", "Dear Marco, please find the file attached. Sincerely, Dave")).toBe("casual_to_formal");
  });

  it("says nothing for an unchanged draft or an edit outside the set", () => {
    expect(classifyDraftEdit(DRAFT, DRAFT)).toBeNull();
    expect(classifyDraftEdit(DRAFT, DRAFT.replace("Marco", "Marco Rossi"))).toBeNull();
    expect(classifyDraftEdit("", "x")).toBeNull();
  });

  it("every kind fits the event sink's gate and has a sentence", () => {
    for (const k of DRAFT_EDIT_KINDS) {
      expect(k).toMatch(/^[a-z0-9_]{1,24}$/);
      expect(DRAFT_EDIT_SENTENCE[k].length).toBeGreaterThan(0);
    }
  });
});
