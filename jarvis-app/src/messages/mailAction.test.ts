import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { askKindOf, decide, toneFor } from "./mailAction";

// The bug this file exists to prevent: four rows, four identical buttons.
describe("askKindOf", () => {
  it("reads what the sender actually wants", () => {
    expect(askKindOf("CALL ME")).toBe("they_asked");
    expect(askKindOf("Invoice", "amount due 400")).toBe("money_in");
    expect(askKindOf("Missing Items From Order #D2565")).toBe("goods");
    expect(askKindOf("Reservation Receipt", "no reply needed")).toBe("nothing");
    expect(askKindOf("Are we still on for Thursday?")).toBe("answer");
  });

  it("a named channel outranks the topic", () => {
    // He wrote CALL ME about an invoice. He told you the channel.
    expect(askKindOf("Invoice", "call me about this")).toBe("they_asked");
  });

  it("[edge] a receipt with a problem is a problem, not a receipt", () => {
    expect(askKindOf("Receipt", "item missing from this order")).toBe("goods");
  });
});

describe("Dave's actual inbox: four rows, four different buttons", () => {
  const rows = [
    { name: "nikestrength", subject: "Missing Items From Order #D2565", days: 58 },
    { name: "wei@bffsa.org", subject: "Invoice", days: 53 },
    { name: "Joseph T. Pareres", subject: "CALL ME", days: 51 },
    { name: "Elieserhenry0", subject: "Reservation Receipt", days: 49 },
  ];
  it("no two rows carry the same primary action", () => {
    const labels = rows.map((r) => decide(r.subject, "", r.days).primary.label);
    expect(new Set(labels).size).toBe(4);
    expect(labels).toEqual(["Open a Dispute", "Ask For Status", "Ask To Call", "Stop Tracking"]);
  });

  it("the one that owes nothing leaves the waiting list", () => {
    const d = decide("Reservation Receipt", "", 49);
    expect(d.ask).toBe("nothing");
    expect(d.primary.family).toBe("close");
  });

  it("a stored phone turns the call into a real dial", () => {
    const withPhone = decide("CALL ME", "", 51, 0, { hasPhone: true });
    expect(withPhone.primary.label).toBe("Call Them");
    expect(withPhone.primary.channel).toBe("call");
    // Without one the label admits it is writing an email.
    const without = decide("CALL ME", "", 51);
    expect(without.primary.channel).toBe("email");
    expect(without.primary.label).toBe("Ask To Call");
  });
});

describe("the wait sets the tone, not the words on the button", () => {
  it("same ask at three ages keeps the same action", () => {
    const labels = [2, 10, 60].map((d) => decide("Invoice", "", d).primary.label);
    expect(new Set(labels).size).toBe(1);
  });
  it("but the drafter is told something different each time", () => {
    const notes = [2, 10, 60].map((d) => decide("Invoice", "", d).primary.instruction);
    expect(new Set(notes).size).toBe(3);
  });
  it("tone thresholds are unchanged from the old ladder", () => {
    expect(toneFor(1)).toBe("gentle");
    expect(toneFor(7)).toBe("direct");
    expect(toneFor(21)).toBe("firm");
    expect(toneFor(1, 2)).toBe("firm");
  });
});

describe("route around", () => {
  it("offers another human at the same org once a thread is dead", () => {
    const d = decide("Invoice", "", 53, 0, { altContact: "Marcus" });
    expect(d.alternates.map((a) => a.label)).toContain("Ask Marcus Instead");
  });
  it("[edge] never invents a person when we have nobody", () => {
    const d = decide("Invoice", "", 53);
    expect(d.alternates.every((a) => a.family !== "route" || a.key === "forward")).toBe(true);
  });
});

describe("shape laws", () => {
  it("the primary is never repeated in the alternates", () => {
    for (const s of ["Invoice", "CALL ME", "Missing item", "Receipt", "Question?"]) {
      for (const days of [1, 30]) {
        const d = decide(s, "", days, 0, { altContact: "Sam", hasPhone: true, billable: true });
        expect(d.alternates.find((a) => a.key === d.primary.key)).toBeUndefined();
        expect(new Set(d.alternates.map((a) => a.key)).size).toBe(d.alternates.length);
      }
    }
  });
  it("every label is Title Case (catalog H2)", () => {
    const small = new Set(["a", "an", "the", "to", "of", "in", "with", "for", "as", "at", "on"]);
    for (const s of ["Invoice", "CALL ME", "Missing item", "Receipt", "Question?"]) {
      const d = decide(s, "", 40, 0, { altContact: "Sam", billable: true });
      for (const act of [d.primary, ...d.alternates]) {
        act.label.split(" ").forEach((w, i) => {
          if (i > 0 && small.has(w)) return;
          expect(w[0], act.label).toBe(w[0]!.toUpperCase());
        });
      }
    }
  });
  it("a tap only ever promises what it performs", () => {
    // The old bug: a button reading "Try Calling" that opened a compose window.
    const d = decide("CALL ME", "", 51);
    for (const act of [d.primary, ...d.alternates]) {
      if (/^Call\b/.test(act.label)) expect(act.channel).toBe("call");
      if (act.label === "Ask To Call") expect(act.channel).toBe("email");
    }
  });
});

// THE OTHER HALF OF THE CONTRACT.
//
// decide() has returned an `alternates` list since the day it was written and
// for one build nothing could reach them: the sheet did not exist and the
// swipe revealed a single button that CSS had been hiding since it shipped.
// Both halves are wired now, and this law is what stops them drifting apart:
// an action offered in the sheet with no handler behind it is a button that
// does nothing, which is the same class of lie as "Try Calling" opening a
// compose window.
describe("LAW: every action decide() can emit is actually performed", () => {
  // Every shape of decision the app can produce, not a hand-picked sample.
  const everyAction = () => {
    const out = new Map<string, ReturnType<typeof decide>["primary"]>();
    const subjects = ["Invoice", "CALL ME", "Missing item from order #1", "Reservation Receipt", "Question?"];
    for (const s of subjects) {
      for (const days of [1, 8, 40]) {
        for (const hasPhone of [true, false]) {
          for (const altContact of ["Marcus", null]) {
            for (const billable of [true, false]) {
              const d = decide(s + " $40.00", "", days, 0, { hasPhone, altContact, billable });
              const e = decide(s, "", days, 0, { hasPhone, altContact, billable });
              for (const a of [d.primary, ...d.alternates, e.primary, ...e.alternates]) out.set(a.key, a);
            }
          }
        }
      }
    }
    return [...out.values()];
  };

  const flow = readFileSync(join(process.cwd(), "src/messages/MessagesFlow.tsx"), "utf8");
  // Scoped to runAction's own body. A whole-file scan would let a `case`
  // in any unrelated switch satisfy the law.
  const at = flow.indexOf("const runAction =");
  const body = flow.slice(at, flow.indexOf("\n  };\n", at));
  const cases = new Set([...body.matchAll(/case "([a-z_]+)":/g)].map((m) => m[1]!));

  it("an action that opens no channel has an explicit handler", () => {
    // channel "none" means the tap changes something in the app rather than
    // reaching the person, so startNudge cannot cover it by drafting.
    const missing = everyAction()
      .filter((a) => a.channel === "none")
      .filter((a) => !cases.has(a.key))
      .map((a) => a.key + " (" + a.label + ")");
    expect(missing).toEqual([]);
  });

  it("an action that opens a channel is a draft, a dial, or a text", () => {
    // Anything not explicitly cased falls through to startNudge, which reads
    // the CHANNEL to decide what to do. A fourth channel would fall through
    // silently, so the set is pinned.
    for (const a of everyAction()) {
      if (cases.has(a.key)) continue;
      expect(["email", "call", "text"], a.key).toContain(a.channel);
    }
  });

  it("no handler exists for an action nothing can offer", () => {
    const offered = new Set(everyAction().map((a) => a.key));
    const dead = [...cases].filter((k) => !offered.has(k));
    expect(dead).toEqual([]);
  });
});

describe("a texting button needs a number, same as a calling one", () => {
  it("no phone, no Text Them", () => {
    const withPhone = decide("CALL ME", "", 30, 0, { hasPhone: true });
    expect(withPhone.alternates.map((a) => a.key)).toContain("text");
    const without = decide("CALL ME", "", 30, 0, { hasPhone: false });
    expect(without.alternates.map((a) => a.key)).not.toContain("text");
  });
});

describe("capability gates", () => {
  it("no task service, no Add as Task", () => {
    const on = decide("Question?", "", 5, 0, {});
    expect(on.alternates.map((a) => a.key)).toContain("block_time");
    const off = decide("Question?", "", 5, 0, { canTask: false, canSchedule: false });
    expect(off.alternates.map((a) => a.family)).not.toContain("convert");
  });
  it("[edge] two buttons never do one thing", () => {
    // Stop Tracking and Mark Handled both take the row off the list without
    // touching the mail, so they must never appear together.
    for (const s of ["Invoice", "CALL ME", "Missing item", "Receipt", "Question?"]) {
      for (const days of [1, 40]) {
        const d = decide(s, "", days, 0, { hasPhone: true, altContact: "Sam", billable: true });
        const keys = [d.primary, ...d.alternates].map((a) => a.key);
        expect(keys.includes("stop") && keys.includes("handled"), s + " " + days).toBe(false);
      }
    }
  });
});
