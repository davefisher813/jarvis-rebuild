// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Facts, waitingFor, evidenceFact, ruleAccountFact } from "./factsLine";

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
    const { container } = render(<Facts facts={[{ text: "a" }, { text: "b", tone: "warn" }, { text: "c", tone: "good" }, { text: "d", tone: "sky" }]} />);
    const toned = container.querySelectorAll(".fact.warn, .fact.good, .fact.sky, .fact.purp, .fact.red");
    expect(toned).toHaveLength(1);
    expect(toned[0]).toHaveTextContent("b");
  });
});

describe("the presets", () => {
  it("waitingFor names the thing owed, and nothing for a thread owed nothing", () => {
    expect(waitingFor("money_in")?.text).toBe("Waiting for: money");
    expect(waitingFor("goods")?.text).toBe("Waiting for: the order");
    expect(waitingFor("they_asked")?.text).toBe("Waiting for: a call");
    expect(waitingFor("answer")?.text).toBe("Waiting for: an answer");
    expect(waitingFor("nothing")).toBeNull();
  });
  it("evidenceFact quotes the sender's words and carries no tone", () => {
    const f = evidenceFact({ sourceMsgId: "m", span: "need it by Friday", confidence: "high" });
    expect(f?.text).toBe("“need it by Friday”");
    expect(f?.tone).toBeUndefined();
    expect(evidenceFact(undefined)).toBeNull();
  });
  it("ruleAccountFact keeps the account quiet and tones only On", () => {
    expect(ruleAccountFact(undefined, true)).toEqual([{ text: "Account: All" }, { text: "On", tone: "good" }]);
    expect(ruleAccountFact("gmail", false)).toEqual([{ text: "Account: gmail" }, { text: "Off" }]);
  });
});
