// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import ThreadStateCard from "./ThreadStateCard";
import type { Brief } from "./brief";

// ONE DEADLINE RULE (§AM R8). Where This Stands reads the sender's phrase
// through the same deadlineTone the Today deadline card reads, so a deadline
// is never amber on Today and small caps here. The case that disagreed was
// the bare clock: "by 3 PM" means today, and today is due.
describe("Where This Stands: the deadline's colour", () => {
  const brief = (deadline: string): Brief => ({ summary: "", replies: [], deadline });
  const deadlineFact = () => document.querySelector(".msg-stands-facts .fact")!;

  it("a bare clock is today, so it is due, amber", () => {
    render(<ThreadStateCard brief={brief("3 PM")} />);
    expect(deadlineFact()).toHaveClass("warn");
    expect(deadlineFact()).not.toHaveClass("date");
    expect(deadlineFact().textContent).toContain("By 3 PM");
  });

  it("today and tomorrow are due, amber", () => {
    const { unmount } = render(<ThreadStateCard brief={brief("today")} />);
    expect(deadlineFact()).toHaveClass("warn");
    unmount();
    render(<ThreadStateCard brief={brief("tomorrow")} />);
    expect(deadlineFact()).toHaveClass("warn");
  });

  it("a later day, or a phrase no one can place, is a neutral date in small caps", () => {
    const { unmount } = render(<ThreadStateCard brief={brief("next week")} />);
    expect(deadlineFact()).toHaveClass("date");
    expect(deadlineFact()).not.toHaveClass("warn");
    unmount();
    render(<ThreadStateCard brief={brief("sometime soon")} />);
    expect(deadlineFact()).toHaveClass("date");
  });
});
