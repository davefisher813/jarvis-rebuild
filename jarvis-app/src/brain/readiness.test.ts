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
  // NO PATTERN (2026-09-07): this case moved sides. Completions spread across
  // the day used to be the panel's headline example of "the count is met and
  // the second condition is not", and it was Dave's own row: 158 completions,
  // amber, waiting for a shape that his life does not have. It is not waiting
  // any more, because the absence is now a fact the detector can say, so the
  // row reports a finding. The reading it used to give is still pinned below,
  // on the two band detectors that have no absence twin.
  it("workouts spread across the day are not ready, and say what is missing", () => {
    const rows = Array.from({ length: 24 }, (_, i) =>
      row({ h: i, kind: "workout", day: `2026-08-${String((i % 20) + 1).padStart(2, "0")}` }));
    const r = pick(readiness(rows, [], [], NOW), "training_window");
    expect(r.have).toBe(24);
    expect(r.state).toBe("close");
    expect(r.detail).toContain("spread across the day");
    expect(r.detail).toContain("40");
  });

  // NO PATTERN (2026-09-07): this case moved sides too, for the same reason
  // the completion one above did. A gate met with no area in front is Dave's
  // own row, and it is a finding now, not a wait. The "not yet" reading it
  // used to give is still pinned, on the two states that really are waits:
  // thin evidence (below), and a leader JARVIS cannot name (further down).
  it("a slip leader that does not double the runner up is a finding, not a wait", () => {
    const rows = [
      ...many(6, { type: "task.pushed", category: "cat-admin" }),
      ...many(5, { type: "task.pushed", category: "cat-home" }),
    ];
    const r = pick(readiness(rows, [], [], NOW), "slip_category");
    expect(r.have).toBe(6);
    expect(r.state).toBe("ready");
    expect(r.detail).toContain("no area clear of the rest");
  });

  it("thin evidence still says what it is waiting for, ratio and all", () => {
    const rows = [
      ...many(3, { type: "task.pushed", category: "cat-admin" }),
      ...many(2, { type: "task.pushed", category: "cat-home" }),
    ];
    const r = pick(readiness(rows, [], [], NOW), "slip_category");
    expect(r.state).not.toBe("ready");
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

// NO PATTERN IS A FACT (Dave, 2026-09-07). His row read
//   When Tasks Get Done  158/10  AMBER  158 completions, spread across the day
//                                       One 3-hour stretch has to hold 40 percent
// forever, because his life has no band and never will have one on that
// evidence. The detector can now say the absence, so the row has to stop
// reporting a wait that is over.
describe("no pattern: the row stops waiting once the absence is the answer", () => {
  const flat = (n: number): WindowRow[] =>
    Array.from({ length: n }, (_, i) => row({ h: i % 24, day: `2026-08-${String((i % 20) + 1).padStart(2, "0")}` }));

  it("completions with no band read ready, and the detail states the shape", () => {
    const r = pick(readiness(flat(24), [], [], NOW), "completion_window");
    expect(r.have).toBe(24);
    expect(r.state).toBe("ready");
    expect(r.detail).toContain("no 3-hour stretch in front");
    // And it stops printing a gate it has already cleared.
    expect(r.detail).not.toContain("has to hold");
  });

  it("below the count gate it is still waiting, because thin evidence is not a finding", () => {
    const r = pick(readiness(flat(MIN_COMPLETIONS - 1), [], [], NOW), "completion_window");
    expect(r.state).not.toBe("ready");
    expect(r.detail).toContain("40");
  });

  it("stays ONE row: the absence never gets a row of its own", () => {
    const keys = readiness(flat(24), [], [], NOW).map((r) => r.key);
    expect(keys).not.toContain("completion_no_band");
    expect(keys.filter((k) => k === "completion_window")).toHaveLength(1);
  });

  it("an accepted absence reads known on the question's own row", () => {
    const r = pick(readiness(flat(24), [strand("completion_no_band")], [], NOW), "completion_window");
    expect(r.state).toBe("known");
    expect(r.detail).toContain("already knows");
  });

  it("an accepted band still reads known when the evidence has since flipped", () => {
    // He holds "gets things done between 9 and midnight", his life spread
    // out, and the absence is now what the detector would offer. The row is
    // about the question, and he has answered it, so it is not a wait.
    const r = pick(readiness(flat(24), [strand("completion_window")], [], NOW), "completion_window");
    expect(r.state).toBe("known");
  });

  it("muting the band does not mute the absence, and the panel says so", () => {
    // The nod test is per derivation: he corrected the BAND sentence twice.
    // That is not a verdict on a sentence he has never been offered.
    const rows = [
      ...flat(24),
      row({ type: "strand.deleted", kind: "completion_window" }),
      row({ type: "strand.corrected", kind: "completion_window" }),
    ];
    expect(pick(readiness(rows, [], [], NOW), "completion_window").state).toBe("ready");
  });

  it("muting the absence mutes the row while the absence is what would speak", () => {
    const rows = [
      ...flat(24),
      row({ type: "strand.deleted", kind: "completion_no_band" }),
      row({ type: "strand.corrected", kind: "completion_no_band" }),
    ];
    const r = pick(readiness(rows, [], [], NOW), "completion_window");
    expect(r.state).toBe("muted");
    expect(r.detail).toContain("Corrected or deleted twice");
  });
});

// THE SECOND ROW DAVE WAS MISSING. His panel read
//   The Area That Slips  66/5  AMBER  66 pushes lead
//                                     No area is pushed 2 times as often as the next
// and would have read that forever, because his pushing is even. The absence
// is a fact now, so the row reports one.
describe("no pattern: the slip row stops waiting once the absence is the answer", () => {
  const pushed = (cat: string, n: number, from = 1): WindowRow[] =>
    Array.from({ length: n }, (_, i) => row({ type: "task.pushed", category: cat, h: 10, day: `2026-08-${String(from + (i % 20)).padStart(2, "0")}` }));

  it("pushes with no area in front read ready, and the detail states the shape", () => {
    const r = pick(readiness([...pushed("cat-admin", 15), ...pushed("cat-home", 14)], [], [], NOW), "slip_category");
    expect(r.have).toBe(15);
    expect(r.state).toBe("ready");
    expect(r.detail).toContain("no area clear of the rest");
    expect(r.detail).not.toContain("2 times as often");
  });

  it("below the count gate it is still waiting, because thin evidence is not a finding", () => {
    const rows = [...pushed("cat-admin", MIN_SLIPS_LEADER - 1), ...pushed("cat-home", MIN_SLIPS_LEADER - 1)];
    const r = pick(readiness(rows, [], [], NOW), "slip_category");
    expect(r.state).not.toBe("ready");
    expect(r.detail).toContain("2 times as often");
  });

  it("a leader JARVIS cannot name still reads as the unnameable area, not as an absence", () => {
    // Both halves are silent there, and the row has to say WHICH silence it
    // is: an even spread and a pattern with no name are different answers.
    setCategoryRegistry([{ id: "cat-home", name: "Home", color: "green" }]);
    const rows = [...pushed("3fa85f64-5717-4562-b3fc-2c963f66afa6", 12), ...pushed("cat-home", 3)];
    const r = pick(readiness(rows, [], [], NOW), "slip_category");
    expect(r.state).not.toBe("ready");
    expect(r.detail).toContain("no longer name");
  });

  it("stays ONE row, and an accepted absence reads known on it", () => {
    const rows = [...pushed("cat-admin", 15), ...pushed("cat-home", 14)];
    expect(readiness(rows, [], [], NOW).map((r) => r.key)).not.toContain("slip_no_leader");
    const r = pick(readiness(rows, [strand("slip_no_leader")], [], NOW), "slip_category");
    expect(r.state).toBe("known");
  });

  it("muting the named-area sentence does not mute the absence", () => {
    const rows = [
      ...pushed("cat-admin", 15), ...pushed("cat-home", 14),
      row({ type: "strand.deleted", kind: "slip_category" }),
      row({ type: "strand.corrected", kind: "slip_category" }),
    ];
    expect(pick(readiness(rows, [], [], NOW), "slip_category").state).toBe("ready");
  });
});
