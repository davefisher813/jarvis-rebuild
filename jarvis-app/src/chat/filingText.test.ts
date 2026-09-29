import { describe, it, expect } from "vitest";
import { chatFilingText, CHAT_BOILERPLATE } from "./filingText";

// "Log It" prefills the words as they were said. The user's are untouched; the
// assistant's lose only whole stock lines at the very edges.

describe("chatFilingText: the user's words", () => {
  it("returns the text byte for byte, whitespace and all", () => {
    const t = "  Sure!\n\n  never move the Tuesday standup \t\n\nLet me know if you need anything else.  \n";
    expect(chatFilingText("user", t)).toBe(t);
  });
  it("never strips a user message that looks like boilerplate", () => {
    expect(chatFilingText("user", "Sure!")).toBe("Sure!");
    expect(chatFilingText("user", "Hope that helps")).toBe("Hope that helps");
  });
});

describe("chatFilingText: JARVIS's words", () => {
  it("leaves a message with no boilerplate exactly as it is", () => {
    const t = "  You have two things today.\n\n- Dentist at 3\n- Call Marco  \n";
    expect(chatFilingText("jarvis", t)).toBe(t);
    expect(chatFilingText("assistant", t)).toBe(t);
  });

  it("strips a stock opener and a stock closer at the edges", () => {
    expect(chatFilingText("jarvis", "Sure!\n\nThe dentist is Tuesday at 3.\n\nLet me know if you need anything else."))
      .toBe("The dentist is Tuesday at 3.");
  });

  it("strips several stacked lines at one edge", () => {
    expect(chatFilingText("jarvis", "Of course!\nHere you go:\nMarco prefers email.\nHope that helps!\nLet me know if you have any questions."))
      .toBe("Marco prefers email.");
  });

  it("matches whole lines only: a sentence that begins the same way is substance", () => {
    const a = "Sure, the plumber can come at 3 but not before.";
    expect(chatFilingText("jarvis", a)).toBe(a);
    const b = "The dentist is Tuesday.\nLet me know if you need anything else than the 3pm slot, because the 4pm is gone.";
    expect(chatFilingText("jarvis", b)).toBe(b);
  });

  it("strips at the edges only, never in the middle", () => {
    const t = "The dentist is Tuesday.\nSure!\nThe plumber is Friday.";
    expect(chatFilingText("jarvis", t)).toBe(t);
  });

  it("keeps meaningful Jarvis text whole, blank lines and lists included", () => {
    const t = "Sure!\n\nThree things:\n\n1. Waiver by Friday\n2. Cleats\n\n3. Water\n\nHope that helps!";
    expect(chatFilingText("jarvis", t)).toBe("Three things:\n\n1. Waiver by Friday\n2. Cleats\n\n3. Water");
  });

  it("folds case, curly apostrophes, spacing and trailing marks when matching", () => {
    expect(chatFilingText("jarvis", "SURE THING.\nHere’s what I found:\nThe answer is 4.")).toBe("The answer is 4.");
    expect(chatFilingText("jarvis", "Answer.\n  let me   know if you need anything else!  ")).toBe("Answer.");
  });

  it("uses the original when cleanup would leave nothing", () => {
    expect(chatFilingText("jarvis", "Sure!")).toBe("Sure!");
    expect(chatFilingText("jarvis", "Of course!\n\nHope that helps!")).toBe("Of course!\n\nHope that helps!");
  });

  it("pins every allowlist entry, at its own edge only", () => {
    for (const line of CHAT_BOILERPLATE.leading) {
      expect(chatFilingText("jarvis", line + "\nBody text.")).toBe("Body text.");
      // The same line at the far edge is not a closer, so it stays.
      expect(chatFilingText("jarvis", "Body text.\n" + line)).toBe("Body text.\n" + line);
    }
    for (const line of CHAT_BOILERPLATE.trailing) {
      expect(chatFilingText("jarvis", "Body text.\n" + line)).toBe("Body text.");
      expect(chatFilingText("jarvis", line + "\nBody text.")).toBe(line + "\nBody text.");
    }
  });

  it("does not summarise or shorten a long message", () => {
    const long = Array.from({ length: 200 }, (_, i) => "Line " + i).join("\n");
    expect(chatFilingText("jarvis", long)).toBe(long);
  });
});
