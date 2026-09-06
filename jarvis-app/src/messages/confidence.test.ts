import { describe, it, expect } from "vitest";
import { confidenceOf, hedge, labelFor, isHigh, noiseConfidence, autoArchivable } from "./confidence";
import { shouldAutoReply } from "./autoReply";
import { mailNotices, type MailSnapshot } from "./home";
import type { Evidence } from "./evidence";

// UP-MIND-18. Two states, both grounded in something the app can check, and
// the thresholds all live in one file. A model that scores itself says 0.9
// about a sentence it invented, which is why nothing here reads a
// self-reported number.

const anchored: Evidence = { sourceMsgId: "m1", span: "Get it back to me by Friday.", confidence: "high" };

describe("where confidence comes from", () => {
  it("is high only when there is a verbatim sentence behind the claim", () => {
    expect(confidenceOf(anchored)).toBe("high");
    expect(confidenceOf(null)).toBe("low");
    expect(confidenceOf(undefined)).toBe("low");
    expect(confidenceOf({ ...anchored, span: "  " })).toBe("low");
    expect(confidenceOf({ ...anchored, confidence: "low" })).toBe("low");
  });

  it("hedges a label it cannot back, and leaves one it can alone", () => {
    expect(labelFor("Friday", anchored)).toBe("Friday");
    expect(labelFor("Friday", null)).toBe("Looks like friday");
    expect(hedge("")).toBe("");
    expect(hedge("Looks like Friday")).toBe("Looks like Friday");
    expect(isHigh("high")).toBe(true);
  });
});

describe("the card", () => {
  const snap = (byEv?: Evidence): MailSnapshot => ({
    ts: Date.now(), needsYou: 1, waiting: [], promises: [],
    threads: [{
      id: "t1", from: "Nadia", fromEmail: "n@x.com", subject: "Roster", gist: "needs it", by: "today",
      ...(byEv ? { byEv } : {}),
    }],
  });

  it("states a deadline it can show, and hedges one it cannot", () => {
    const now = new Date("2026-08-15T09:00:00");
    expect(mailNotices(snap(anchored), "2026-08-15", now)[0]!.sub).toBe("From Nadia · Due today");
    expect(mailNotices(snap(), "2026-08-15", now)[0]!.sub).toBe("From Nadia · Looks like today");
  });

  it("hedges a dated commitment it cannot show, because that card writes on one tap", () => {
    const now = new Date("2026-08-15T09:00:00");
    const withAct = (actEv?: Evidence): MailSnapshot => ({
      ts: Date.now(), needsYou: 1, waiting: [], promises: [],
      threads: [{
        id: "t1", from: "Clinic", fromEmail: "c@x.com", subject: "Appt", gist: "appointment", by: "",
        act: { kind: "appointment", title: "Video appointment", date: "2026-08-18" },
        ...(actEv ? { actEv } : {}),
      }],
    });
    expect(mailNotices(withAct(anchored), "2026-08-15", now)[0]!.sub).toBe("Tuesday");
    expect(mailNotices(withAct(), "2026-08-15", now)[0]!.sub).toBe("Looks like tuesday");
  });
});

describe("what may happen with nobody looking", () => {
  // A bucket has no span, so noise is grounded outside the model: a machine
  // address, or the user's own sender rule.
  it("only archives noise it can corroborate", () => {
    expect(noiseConfidence({ fromEmail: "no-reply@shop.com" })).toBe("high");
    expect(noiseConfidence({ fromEmail: "jane@realperson.com" })).toBe("low");
    expect(noiseConfidence({ fromEmail: "jane@realperson.com", byRule: true })).toBe("high");
  });

  it("leaves a person's mail in the pile for the unattended sweep", () => {
    const rows = [
      { id: "a", fromEmail: "noreply@shop.com" },
      { id: "b", fromEmail: "jane@realperson.com" },
      { id: "c", fromEmail: "bob@realperson.com" },
    ];
    expect(autoArchivable(rows, (id) => id === "c").map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("refuses to auto-reply on a low-confidence read, whatever else passes", () => {
    const base = {
      enabled: true, fromEmail: "vip@x.com", myEmail: "me@x.com",
      vips: ["vip@x.com"], state: { blockId: "b", repliedTo: [] }, alreadyRepliedThread: false,
    };
    expect(shouldAutoReply(base)).toBe(true);
    expect(shouldAutoReply({ ...base, confidence: "high" })).toBe(true);
    expect(shouldAutoReply({ ...base, confidence: "low" })).toBe(false);
  });
});
