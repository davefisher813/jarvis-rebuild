import { describe, it, expect, beforeEach } from "vitest";
import { readiness, CLOSE_SHARE, type Readiness } from "./readiness";
import { MIN_COMPLETIONS, MIN_PLAN_PICKS, MIN_SLIPS_LEADER, MIN_PERSON_HANDLED, type DerivePerson } from "./derive";
import { setCategoryRegistry } from "../shared/categories";
import type { WindowRow } from "./window";
import type { Strand, DerivationKey } from "./strands/types";

// THE INSTRUMENT (2026-09-06). Four failures used to render identically on
// What JARVIS Knows: not enough evidence, enough evidence with a second
// condition open, a muted detector, and a fact already known. These prove
// each one comes back as a DIFFERENT reading, because a panel that says
// "waiting" for all four would be the same empty screen with more furniture.

const NOW = Date.parse("2026-09-06T12:00:00");

const row = (over: Partial<WindowRow>): WindowRow => ({
  type: "task.completed", day: "2026-08-20", h: 10, category: null, n: null, flag: null, kind: null, ...over,
});

// n rows at hour h, spread over distinct days so the evidence is real.
const many = (n: number, over: Partial<WindowRow>, h = 10): WindowRow[] =>
  Array.from({ length: n }, (_, i) => row({ ...over, h, day: `2026-08-${String((i % 20) + 1).padStart(2, "0")}` }));

// task_timing is the one detector that filters on the row's own moment (it
// reads plan.duration_corrected through planningPatternObservation, which
// carries its own 30-day cutoff), so its rows have to be inside that window.
const recent = (n: number, over: Partial<WindowRow>): WindowRow[] =>
  Array.from({ length: n }, (_, i) => row({ ...over, h: 10, day: `2026-09-0${(i % 5) + 1}` }));

const strand = (derivation: DerivationKey): Strand => ({
  id: "s-" + derivation,
  data: {
    text: "Something JARVIS already believes", category: "energy", source: "watched",
    strength: "influence", status: "active", createdAt: "2026-08-01",
    lastConfirmed: "2026-08-20", derivation,
  },
});

const pick = (list: Readiness[], key: DerivationKey): Readiness => {
  const r = list.find((x) => x.key === key);
  if (!r) throw new Error("no readiness row for " + key);
  return r;
};

beforeEach(() => {
  setCategoryRegistry([{ id: "cat-admin", name: "Admin", color: "blue" }, { id: "cat-home", name: "Home", color: "green" }]);
});

describe("readiness reports every detector, always", () => {
  it("covers all eight detectors even with nothing to show", () => {
    const list = readiness([], [], [], NOW);
    expect(list.map((r) => r.key)).toEqual([
      "completion_window", "slip_category", "plan_rate", "training_window",
      "email_window", "people_rhythm", "gone_quiet", "task_timing",
    ]);
  });

  it("an empty account reads as waiting, never as broken and never as a zero in prose", () => {
    const list = readiness([], [], [], NOW);
    expect(list.every((r) => r.state === "waiting")).toBe(true);
    expect(list.every((r) => r.have === 0)).toBe(true);
    // Every row still says what it is waiting FOR, which is the whole point.
    expect(list.every((r) => (r.detail ?? "").length > 0)).toBe(true);
  });

  it("the gates it prints are the gates derive.ts enforces", () => {
    const list = readiness([], [], [], NOW);
    expect(pick(list, "completion_window").need).toBe(MIN_COMPLETIONS);
    expect(pick(list, "training_window").need).toBe(MIN_COMPLETIONS);
    expect(pick(list, "email_window").need).toBe(MIN_COMPLETIONS);
    expect(pick(list, "slip_category").need).toBe(MIN_SLIPS_LEADER);
    expect(pick(list, "plan_rate").need).toBe(MIN_PLAN_PICKS);
    expect(pick(list, "people_rhythm").need).toBe(MIN_PERSON_HANDLED);
  });
});

describe("a met gate reads as ready", () => {
  it("twelve completions inside one band is ready, and says how many the band holds", () => {
    const r = pick(readiness(many(12, {}, 10), [], [], NOW), "completion_window");
    expect(r.have).toBe(12);
    expect(r.state).toBe("ready");
    expect(r.detail).toContain("holds 12");
  });

  it("a clear slip leader is ready", () => {
    const rows = [
      ...many(8, { type: "task.pushed", category: "cat-admin" }),
      ...many(2, { type: "task.pushed", category: "cat-home" }),
    ];
    const r = pick(readiness(rows, [], [], NOW), "slip_category");
    expect(r.have).toBe(8);
    expect(r.state).toBe("ready");
  });
});

describe("the count is met and the second condition is not: the reading Dave was missing", () => {
  it("twelve completions spread across the day is not ready, and says so", () => {
    // One an hour: real evidence, no band. The count alone would have read
    // as ready, which is exactly the lie this panel exists to stop telling.
    const rows = Array.from({ length: 24 }, (_, i) =>
      row({ h: i, day: `2026-08-${String((i % 20) + 1).padStart(2, "0")}` }));
    const r = pick(readiness(rows, [], [], NOW), "completion_window");
    expect(r.have).toBe(24);
    expect(r.state).toBe("close");
    expect(r.detail).toContain("spread across the day");
    expect(r.detail).toContain("40");
  });

  it("a slip leader that does not double the runner up says that, not 'not yet'", () => {
    const rows = [
      ...many(6, { type: "task.pushed", category: "cat-admin" }),
      ...many(5, { type: "task.pushed", category: "cat-home" }),
    ];
    const r = pick(readiness(rows, [], [], NOW), "slip_category");
    expect(r.have).toBe(6);
    expect(r.state).toBe("close");
    expect(r.detail).toContain("2 times as often");
  });

  it("a slip leader whose category no longer exists says the area cannot be named", () => {
    setCategoryRegistry([{ id: "cat-home", name: "Home", color: "green" }]);
    // BRAIN-F-05's id shape: task.pushed carries the category ID, and an id
    // whose category was deleted resolves to no name at all.
    const rows = many(8, { type: "task.pushed", category: "3fa85f64-5717-4562-b3fc-2c963f66afa6" });
    const r = pick(readiness(rows, [], [], NOW), "slip_category");
    expect(r.have).toBe(8);
    expect(r.state).toBe("close");
    expect(r.detail).toContain("no longer name");
  });

  it("a plan rate in the middle is a normal life, not a pattern", () => {
    const rows = [
      ...many(6, { type: "plan.outcome", flag: true }),
      ...many(6, { type: "plan.outcome", flag: false }),
    ];
    const r = pick(readiness(rows, [], [], NOW), "plan_rate");
    expect(r.have).toBe(12);
    expect(r.state).toBe("close");
    expect(r.detail).toContain("middle");
  });

  it("people rhythm names the second condition: the person must have no label yet", () => {
    const people: DerivePerson[] = [{ id: "p1", name: "Marco", label: "Work" }];
    const rows = many(14, { type: "email.handled", entity_id: "p1" });
    const r = pick(readiness(rows, [], people, NOW), "people_rhythm");
    expect(r.have).toBe(0); // nobody unlabelled has evidence
    expect(r.state).toBe("waiting");
    expect(r.detail).toContain("already has a label");
  });

  it("gone quiet needs a labelled person AND a known last contact", () => {
    const people: DerivePerson[] = [{ id: "p1", name: "Marco", label: "Work" }];
    const r = pick(readiness([], [], people, NOW), "gone_quiet");
    expect(r.have).toBe(0);
    expect(r.detail).toContain("a last contact JARVIS knows");
  });
});

describe("close and waiting", () => {
  it("six of ten is close, five of ten is waiting", () => {
    const near = pick(readiness(many(6, {}, 10), [], [], NOW), "completion_window");
    const far = pick(readiness(many(5, {}, 10), [], [], NOW), "completion_window");
    expect(near.have / near.need).toBeGreaterThanOrEqual(CLOSE_SHARE);
    expect(near.state).toBe("close");
    expect(far.state).toBe("waiting");
  });
});

describe("muted and known are not the same as waiting", () => {
  it("a derivation told it was wrong twice reads muted, however much evidence arrives", () => {
    const rows = [
      ...many(12, {}, 10),
      row({ type: "strand.deleted", kind: "completion_window" }),
      row({ type: "strand.corrected", kind: "completion_window" }),
    ];
    const r = pick(readiness(rows, [], [], NOW), "completion_window");
    expect(r.have).toBe(12);
    expect(r.state).toBe("muted");
    expect(r.detail).toContain("Corrected or deleted twice");
  });

  it("a gate that already became a fact reads known, which is the system working", () => {
    const r = pick(readiness(many(12, {}, 10), [strand("completion_window")], [], NOW), "completion_window");
    expect(r.state).toBe("known");
    expect(r.detail).toContain("already knows");
  });

  it("known outranks muted, so a fact he kept is never reported as switched off", () => {
    const rows = [
      ...many(12, {}, 10),
      row({ type: "strand.deleted", kind: "completion_window" }),
      row({ type: "strand.corrected", kind: "completion_window" }),
    ];
    expect(pick(readiness(rows, [strand("completion_window")], [], NOW), "completion_window").state).toBe("known");
  });
});

describe("the two detectors that read something other than task rows", () => {
  it("training reads workouts, not tasks", () => {
    const list = readiness(many(12, { kind: "workout" }, 18), [], [], NOW);
    expect(pick(list, "training_window").have).toBe(12);
    expect(pick(list, "training_window").state).toBe("ready");
    // The same rows must NOT count as task completions: taskDone drops them.
    expect(pick(list, "completion_window").have).toBe(0);
  });

  it("email window reads handled mail", () => {
    const r = pick(readiness(many(12, { type: "email.handled" }, 8), [], [], NOW), "email_window");
    expect(r.have).toBe(12);
    expect(r.state).toBe("ready");
  });

  it("task timing counts corrections in one area and names its own source", () => {
    const rows = recent(4, { type: "plan.duration_corrected", category: "cat-admin", n: 20 });
    const r = pick(readiness(rows, [], [], NOW), "task_timing");
    expect(r.have).toBe(4);
    expect(r.state).toBe("ready");
  });

  it("task timing with mixed directions is not a pattern", () => {
    const rows = [
      ...recent(3, { type: "plan.duration_corrected", category: "cat-admin", n: 20 }),
      row({ type: "plan.duration_corrected", category: "cat-admin", n: -20, day: "2026-09-05" }),
    ];
    const r = pick(readiness(rows, [], [], NOW), "task_timing");
    expect(r.have).toBe(4);
    expect(r.state).not.toBe("ready");
    expect(r.detail).toContain("same way");
  });

  it("task timing whose area no longer exists says the area cannot be named", () => {
    // BRAIN-F-05's other half (2026-09-06): this detector resolves its
    // category through catName now, so a met gate can end in silence for a
    // reason that has nothing to do with the evidence. Reporting that as
    // "not all the same way" would be the panel telling Dave something false
    // about his own data, which is worse than the empty screen it replaced.
    const rows = recent(4, { type: "plan.duration_corrected", category: "3fa85f64-5717-4562-b3fc-2c963f66afa6", n: 20 });
    const r = pick(readiness(rows, [], [], NOW), "task_timing");
    expect(r.have).toBe(4);
    expect(r.state).not.toBe("ready");
    expect(r.detail).toContain("no longer name");
  });
});

describe("people rhythm reads the person on the mail", () => {
  it("ten handled rows with one unlabelled person is ready", () => {
    const people: DerivePerson[] = [{ id: "p1", name: "Marco" }];
    const rows = many(11, { type: "email.handled", entity_id: "p1" });
    const r = pick(readiness(rows, [], people, NOW), "people_rhythm");
    expect(r.have).toBe(11);
    expect(r.state).toBe("ready");
  });

  it("with no contacts it says the log carries ids, not that the mail is missing", () => {
    const rows = many(14, { type: "email.handled", entity_id: "p1" });
    const r = pick(readiness(rows, [], [], NOW), "people_rhythm");
    expect(r.have).toBe(0);
    expect(r.detail).toContain("Contacts");
  });
});

describe("gone quiet", () => {
  it("a labelled person nobody has written to in a month is ready", () => {
    const people: DerivePerson[] = [{ id: "p1", name: "Marco", label: "Work", lastMs: NOW - 45 * 86400000 }];
    const r = pick(readiness([], [], people, NOW), "gone_quiet");
    expect(r.have).toBe(1);
    expect(r.state).toBe("ready");
  });

  it("a labelled person written to last week is a candidate, not a fact", () => {
    const people: DerivePerson[] = [{ id: "p1", name: "Marco", label: "Work", lastMs: NOW - 7 * 86400000 }];
    const r = pick(readiness([], [], people, NOW), "gone_quiet");
    expect(r.have).toBe(1);
    expect(r.state).not.toBe("ready");
    expect(r.detail).toContain("Nobody you labelled has been quiet");
  });
});
