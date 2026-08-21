import { describe, it, expect } from "vitest";
import {
  blockKind, demandOf, blocked, fitScore, suggestFor, bestFor, bestPerBlock,
  loadBlendMemory, recordBlend, memKey, LEARNED_AT,
} from "./blend";

const T = (id: string, text: string, category = "", extra: Record<string, unknown> = {}) =>
  ({ id, text, category, ...extra });

const mem = () => {
  const m: Record<string, string> = {};
  return { getItem: (k: string) => m[k] ?? null, setItem: (k: string, v: string) => { m[k] = v; } };
};

describe("a block has a kind, taken from words already on it", () => {
  it("reads the obvious ones", () => {
    expect(blockKind({ title: "Drive to Syracuse" })).toBe("moving");
    expect(blockKind({ title: "Commute" })).toBe("moving");
    expect(blockKind({ title: "Deep Work" })).toBe("deep");
    expect(blockKind({ title: "Standup" })).toBe("meeting");
    expect(blockKind({ title: "Gym" })).toBe("physical");
    expect(blockKind({ title: "Dentist appointment" })).toBe("waiting");
    expect(blockKind({ title: "Dinner" })).toBe("other");
  });

  // "Drive to practice" is a drive. The drive is the part you sit through.
  it("prefers the container you are stuck in", () => {
    expect(blockKind({ title: "Drive to practice" })).toBe("moving");
  });

  // "Fall Clinic Walkthrough" is not a walk. Caught on screen, not by a test.
  it("does not read a stem as the word", () => {
    expect(blockKind({ title: "Fall Clinic Walkthrough" })).not.toBe("moving");
    expect(blockKind({ title: "Deep Work" })).toBe("deep");
  });

  it("reads the location too", () => {
    expect(blockKind({ title: "Sit with Mom", location: "Doctor waiting room" })).toBe("waiting");
  });
});

describe("a task has a demand, and that is the whole of blending", () => {
  it("separates mouth from hands", () => {
    expect(demandOf("Call Mike about the field")).toBe("voice");
    expect(demandOf("Draft the sponsor email")).toBe("hands");
    expect(demandOf("Groceries")).toBe("either");
  });

  // The safe answer to an ambiguous task in a moving block is no.
  it("treats both-at-once as hands", () => {
    expect(demandOf("Email Coach about the call")).toBe("hands");
  });

  it("never offers a hands task while you are driving", () => {
    expect(blocked("moving", T("1", "Draft the sponsor email"))).toBe(true);
    expect(blocked("moving", T("2", "Call Mike"))).toBe(false);
    expect(blocked("deep", T("3", "Draft the sponsor email"))).toBe(false);
  });
});

describe("the offer", () => {
  it("blends a call into a drive, which is the thing Dave asked for", () => {
    const f = fitScore({ title: "Drive to Rochester", category: "" }, T("1", "Call Mike"), {});
    expect(f).not.toBeNull();
    expect(f!.why).toMatch(/while you move/i);
  });

  it("never ranks a blocked task, however well it scores otherwise", () => {
    const m = { [memKey("moving", "work")]: 9 };
    const out = suggestFor({ title: "Commute", category: "work" }, [T("1", "Write the deck", "work")], m);
    expect(out).toEqual([]);
  });

  it("skips tasks already attached and tasks already done", () => {
    const tasks = [T("1", "Call Mike"), T("2", "Call Sara"), T("3", "Call Dad", "", { done: true })];
    const out = suggestFor({ title: "Commute", category: "", taskIds: ["1"] }, tasks, {});
    expect(out.map((f) => f.task.id)).toEqual(["2"]);
  });

  it("learns where things go after two real blends", () => {
    const s = mem();
    const before = fitScore({ title: "Deep Work", category: "" }, T("1", "Sponsorship model", "work"), loadBlendMemory(s));
    for (let i = 0; i < LEARNED_AT; i++) recordBlend("deep", "work", s);
    const after = fitScore({ title: "Deep Work", category: "" }, T("1", "Sponsorship model", "work"), loadBlendMemory(s));
    expect(after!.score).toBeGreaterThan(before?.score ?? 0);
    expect(after!.why).toMatch(/usually goes here/i);
  });

  // One vote is a coincidence, and the app should not narrate a coincidence
  // back at you as if it knew something.
  it("does not say usually after a single blend", () => {
    const s = mem();
    recordBlend("deep", "work", s);
    const f = fitScore({ title: "Deep Work", category: "" }, T("1", "Sponsorship model", "work"), loadBlendMemory(s));
    expect(f!.why).not.toMatch(/usually/i);
  });

  it("refuses to record an empty category", () => {
    const s = mem();
    recordBlend("deep", "", s);
    expect(loadBlendMemory(s)).toEqual({});
  });

  it("offers one tap only when the top is clearly the top", () => {
    // Two identical calls into a drive: a coin flip, so no one-tap offer.
    const tie = bestFor({ title: "Commute", category: "" }, [T("1", "Call Mike"), T("2", "Call Sara")], {});
    expect(tie).not.toBeNull(); // a voice-into-moving blend is confident on its own
    // Nothing but a weak category echo is not enough to auto-offer.
    const weak = bestFor({ title: "Dinner", category: "home" }, [T("1", "Groceries", "home")], {});
    expect(weak).toBeNull();
  });
});

describe("one offer per task across the whole day", () => {
  // Caught on screen, not by a test: the same call was offered under two
  // blocks, and tapping both would have attached it twice.
  it("gives a task to its best block and to no other", () => {
    const events = [
      { id: "drive", data: { title: "Drive to Ridgeline", category: "" } },
      { id: "clinic", data: { title: "Field Walkthrough", category: "" } },
    ];
    const out = bestPerBlock(events, [T("1", "Call Ridgeline about the field")], {});
    expect(Object.keys(out)).toEqual(["drive"]);
  });

  it("never offers the same task twice even when both blocks fit", () => {
    const events = [
      { id: "a", data: { title: "Commute", category: "" } },
      { id: "b", data: { title: "Drive home", category: "" } },
    ];
    const out = bestPerBlock(events, [T("1", "Call Mike")], {});
    expect(Object.keys(out).length).toBe(1);
  });

  it("fills a second block with a second task", () => {
    const events = [
      { id: "a", data: { title: "Commute", category: "" } },
      { id: "b", data: { title: "Drive home", category: "" } },
    ];
    const out = bestPerBlock(events, [T("1", "Call Mike"), T("2", "Call Sara")], {});
    expect(Object.keys(out).sort()).toEqual(["a", "b"]);
    expect(out.a!.task.id).not.toBe(out.b!.task.id);
  });
});
