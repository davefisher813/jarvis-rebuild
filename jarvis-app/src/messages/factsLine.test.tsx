// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Facts, evidenceFact, ruleStateFact, dayTone } from "./factsLine";

// EM5 (2026-09-12): K.3, one coloured fact per line, enforced where the
// line is built rather than trusted at every call site.

describe("Facts", () => {
  it("draws each fact as a span in one .facts line and skips the empty ones", () => {
    const { container } = render(<Facts facts={[{ text: "12 threads" }, null, false, { text: "" }, { text: "Never needed you" }]} />);
    expect(container.querySelectorAll(".facts")).toHaveLength(1);
    expect(container.querySelectorAll(".fact")).toHaveLength(2);
  });

  it("renders nothing at all for an empty line, never an empty div", () => {
    const { container } = render(<Facts facts={[null, undefined]} />);
    expect(container.querySelector(".facts")).toBeNull();
  });

  it("keeps the first tone and drops every tone after it (K.3)", () => {
    const { container } = render(<Facts facts={[{ text: "a" }, { text: "b", tone: "warn" }, { text: "c", tone: "good" }, { text: "d", tone: "red" }]} />);
    const toned = container.querySelectorAll(".fact.warn, .fact.good, .fact.red");
    expect(toned).toHaveLength(1);
    expect(toned[0]).toHaveTextContent("b");
  });

  it("counts an estimate as the line's one colour", () => {
    const { container } = render(<Facts facts={[{ text: "a", tone: "est" }, { text: "b", tone: "warn" }]} />);
    expect(container.querySelectorAll(".fact.est")).toHaveLength(1);
    expect(container.querySelector(".fact.warn")).toBeNull();
  });

  it("draws a date as small caps that never spends the colour (caps, not a colour)", () => {
    const { container } = render(<Facts facts={[{ text: "Sep 30", tone: "date" }, { text: "Late", tone: "red" }, { text: "Oct 2", tone: "date" }]} />);
    expect(container.querySelectorAll(".fact.date")).toHaveLength(2);
    expect(container.querySelectorAll(".fact.red")).toHaveLength(1);
  });
});

describe("dayTone", () => {
  it("follows the reminder window: past red, today or tomorrow amber, later a date", () => {
    expect(dayTone("2026-09-25", "2026-09-26")).toBe("red");
    expect(dayTone("2026-09-26", "2026-09-26")).toBe("warn");
    expect(dayTone("2026-09-27", "2026-09-26")).toBe("warn");
    expect(dayTone("2026-09-28", "2026-09-26")).toBe("date");
  });
});

describe("the presets", () => {
  it("evidenceFact quotes the sender's words and carries no tone", () => {
    const f = evidenceFact({ sourceMsgId: "m", span: "need it by Friday", confidence: "high" });
    expect(f?.text).toBe("“need it by Friday”");
    expect(f?.tone).toBeUndefined();
    expect(evidenceFact(undefined)).toBeNull();
  });
  // §AM R1 (2026-09-26): the rule row spends its one grey on the bucket, so
  // the account (the chip row's to show) and Off (the dimmed name and the
  // Turn On capsule say it) are gone; On is the one fact, and it is green.
  it("ruleStateFact is a green On, and nothing at all for an off rule", () => {
    expect(ruleStateFact(true)).toEqual({ text: "On", tone: "good" });
    expect(ruleStateFact(false)).toBeNull();
  });
});
