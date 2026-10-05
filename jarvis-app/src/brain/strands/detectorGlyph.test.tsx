// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { detectorTone } from "./detectorGlyph";
import type { DerivationKey } from "./types";

// THE ROUND 2 REVIEW (2026-10-05): the Watching rows wore dull grey discs while Explore wore vivid bare glyphs. A detector's glyph is
// bare and in its SUBJECT's tone, so the same thing is the same colour on every screen (D5): a task's red, training's green, email's
// and a person's teal. Never a grey.
describe("a detector's glyph takes its subject's tone", () => {
  it("tasks are Task red, training Health green, email and people teal", () => {
    for (const k of ["completion_window", "completion_no_band", "slip_category", "slip_no_leader", "plan_rate", "task_timing"] as DerivationKey[]) {
      expect(detectorTone(k), k).toBe("cat-fg-red");
    }
    expect(detectorTone("training_window")).toBe("cat-fg-green");
    for (const k of ["email_window", "people_rhythm", "gone_quiet"] as DerivationKey[]) expect(detectorTone(k), k).toBe("cat-fg-teal");
  });
});
