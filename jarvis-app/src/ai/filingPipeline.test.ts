// Brain Manual v1 (Phase 1) — the chat filing pipeline, end to end of the
// pure half: trigger detection -> FILING_SCHEMA parse -> clarification.
// Flow doc §7, test 1 (filingParse). The unit cases for parseFiling and
// detectFilingTrigger live in filing.test.ts; this file covers the glue the
// spec names: each trigger phrase flows, a bad parse asks one clarifying
// question instead of filing, and a message with no trigger is never filed.

import { describe, it, expect } from "vitest";
import { detectFilingTrigger, parseFiling, needsClarification } from "./filing";
import { FILING_TRIGGERS } from "./brainMemory";

// What the chat caller does with a message and the small model's reply:
// strip the trigger, parse the reply, and either file it or ask one
// clarifying question. "not-filing" is the normal-chat path.
function fileChatMessage(
  message: string,
  modelReply: string,
): "filed" | "clarify" | "not-filing" {
  const remainder = detectFilingTrigger(message);
  if (remainder === null) return "not-filing";
  return needsClarification(parseFiling(modelReply)) ? "clarify" : "filed";
}

describe("filing pipeline: trigger -> parse -> clarify", () => {
  it("every trigger phrase strips and leaves the remainder", () => {
    for (const t of FILING_TRIGGERS) {
      expect(detectFilingTrigger(`${t}: the remainder`)).toBe("the remainder");
      expect(detectFilingTrigger(`${t} — the remainder`)).toBe("the remainder");
    }
  });

  it("a complete parse files", () => {
    const out = fileChatMessage(
      "log it: discipline beats motivation",
      JSON.stringify({ category: "philosophy", text: "Discipline beats motivation." }),
    );
    expect(out).toBe("filed");
  });

  it("missing fields ask one clarifying question instead of filing", () => {
    // No text: the caller asks what the memory is.
    expect(
      fileChatMessage("log it: ship it", JSON.stringify({ category: "decision" })),
    ).toBe("clarify");
    // Bad category: the caller asks which category.
    expect(
      fileChatMessage(
        "remember this: tucci ends sept 1",
        JSON.stringify({ category: "mood", text: "Tucci ends Sept 1." }),
      ),
    ).toBe("clarify");
    // Not JSON at all: the caller asks again.
    expect(fileChatMessage("file this as: x", "not json at all")).toBe("clarify");
  });

  it("no trigger means normal chat: never filed, never parsed", () => {
    const normals = [
      "how is the weather today",
      "remind me to call back tomorrow",
      "logarithms are fun",
      "I said log it yesterday",
    ];
    for (const m of normals) {
      expect(fileChatMessage(m, JSON.stringify({ category: "fact", text: "x" }))).toBe(
        "not-filing",
      );
    }
  });

  it("the remainder is what the parse call sees, not the trigger", () => {
    expect(detectFilingTrigger("log this decision: ship the release")).toBe(
      "ship the release",
    );
    expect(detectFilingTrigger("save this as value: family first")).toBe(
      "value: family first",
    );
  });
});
