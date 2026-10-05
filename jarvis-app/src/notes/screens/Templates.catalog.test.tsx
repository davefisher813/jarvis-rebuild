// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import Templates from "./Templates";

// THE CATALOG HARD GATE (Dave 2026-10-05): the New Note picker's grey line
// under each template is a sub line, so it is a Title Case fragment, never a
// sentence ("An empty page." / "Date, attendees, agenda, decisions, action
// items."): no lowercase word, no sentence period.
describe("the New Note picker: the line under each template", () => {
  it("is Title Case with no trailing sentence period", () => {
    const { container } = render(<Templates />);
    const subs = [...container.querySelectorAll(".lib-sub")].map((e) => e.textContent!);
    expect(subs).toHaveLength(6);
    const SMALL = new Set(["a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);
    for (const s of subs) {
      expect(s, s).not.toMatch(/\.$/);
      const words = s.split(/\s+/);
      words.forEach((w, i) => {
        if (/^[a-z]/.test(w)) expect(i > 0 && i < words.length - 1 && SMALL.has(w), s).toBe(true);
      });
    }
    expect(subs[0]).toBe("An Empty Page");
  });
});
