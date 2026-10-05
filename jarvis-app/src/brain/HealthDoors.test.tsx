// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import HealthBody from "./HealthBody";
import { readFileSync } from "node:fs";
import { composeLibrary, fallbackKey } from "../gym/library";
import { shownLibraryCount, defaultView } from "../gym/libraryView";
import { libraryRows } from "../gym/libraryEdit";
import { readClassStore } from "../gym/classify";
import LibraryPage from "../gym/LibraryPage";
import { readGymSettings, writeGymSettings, type CreatedLift } from "../gym/settings";
import type { Program, Workout } from "../gym/types";
import { periodFor, periodOverview } from "../insights/analytics";

// THE THREE DOORS (Dave, 2026-09-14: "Add a visible shortcut row near the top
// of Health, immediately below the weekly overview: Exercises · Program ·
// History. Exercises must open the complete library in one tap. Do not bury it
// inside a program or More menu.")
//
// Before this, Exercises was two taps and a guess: Open the Program, then find
// a row inside it. That is most of why a library of a hundred and fifty
// exercises sat unclassified, and why the Weekly Volume card had almost nothing
// to say. Landed on the approved Health design (the week card first, then the
// doors, then Next Workout).

const program: Program = {
  id: "p1", entityType: "program",
  data: { name: "Block", weeks: [{ id: "w1", label: "Week 1", days: [
    { id: "d1", name: "Push", exercises: [{ id: "e1", name: "Bench Press", kind: "weight_reps", sets: [] }] },
    { id: "d2", name: "Pull", exercises: [{ id: "e2", name: "Row", kind: "weight_reps", sets: [] }] },
  ] }] },
} as unknown as Program;

const workouts: Workout[] = [
  { id: "w1", entityType: "workout", data: { programId: "p1", dayId: "d1", dayName: "Push", date: "2026-09-12", startedAt: 1, endedAt: 2, exercises: [{ exerciseId: "e1", name: "Bench Press", kind: "weight_reps", sets: [{ id: "s1", w: 135, r: 8 }] }] } },
] as unknown as Workout[];

const today = "2026-09-14";
const base = {
  program, workouts, today, isEvening: false, gymEvent: null,
  overview: periodOverview(workouts, null, [], periodFor("7d", today)),
  findings: [], logActions: [],
  onStart: () => {}, onAdjustTime: () => {}, onOpenGym: () => {}, onOpenRecords: () => {}, onOpenFinding: () => {},
  view: "health" as const, onView: () => {},
};

describe("the Health page's three doors", () => {
  it("opens Exercises in one tap", () => {
    const onOpenExercises = vi.fn();
    render(<HealthBody {...base} onOpenExercises={onOpenExercises} />);
    fireEvent.click(screen.getByRole("button", { name: /Exercises/ }));
    expect(onOpenExercises).toHaveBeenCalledTimes(1);
  });

  it("carries all three, with the count behind each", () => {
    render(<HealthBody {...base} onOpenExercises={() => {}} onOpenHistory={() => {}} />);
    expect(screen.getByText("Exercises")).toBeInTheDocument();
    expect(screen.getByText("History")).toBeInTheDocument();
    // Two exercises in the program, two program days, one logged session.
    //
    // A COUNT SAYS WHAT IT COUNTS (Dave 2026-09-16, the health polish pass:
    // "keep your order, take the better rows"). These were bare numbers under
    // a word, which reads as nothing once the eye leaves the label; they carry
    // their own noun now, through capAfterNumber like every other counted line
    // in the app, and the singular is real rather than "1 sessions".
    const counts = Array.from(document.querySelectorAll(".h-door-n")).map((n) => n.textContent);
    expect(counts).toEqual(["2 Exercises", "2 Days", "1 Session"]);
  });

  it("opens Program and History from their own doors", () => {
    const onOpenGym = vi.fn();
    const onOpenHistory = vi.fn();
    render(<HealthBody {...base} onOpenGym={onOpenGym} onOpenExercises={() => {}} onOpenHistory={onOpenHistory} />);
    const doors = document.querySelectorAll(".h-door");
    fireEvent.click(doors[1]!);
    expect(onOpenGym).toHaveBeenCalledTimes(1);
    fireEvent.click(doors[2]!);
    expect(onOpenHistory).toHaveBeenCalledTimes(1);
  });

  it("shows no doors to nothing when the caller has no gym wiring", () => {
    render(<HealthBody {...base} />);
    expect(screen.queryByText("Exercises")).toBeNull();
    expect(screen.queryByText("Program")).toBeNull();
    // Insights and All Data are the segmented control at the top, never door rows too (Dave 2026-10-05, round-2 review).
    expect(document.querySelectorAll(".h-door-k")).toHaveLength(0);
  });

  it("sits under the week and above the next workout", () => {
    const { container } = render(<HealthBody {...base} onOpenExercises={() => {}} onOpenHistory={() => {}} />);
    const html = container.innerHTML;
    expect(html.indexOf("h-week-card")).toBeLessThan(html.indexOf("h-doors"));
    expect(html.indexOf("h-doors")).toBeLessThan(html.indexOf("h-hero-card"));
  });
});


// THE BADGE AND THE PAGE AGREE (2026-09-30). A tester added four exercises by
// hand (Font Hack Squat, Glute Kickbacks, Leg Curls, Step Ups). The Exercises
// page listed all four and the Health dashboard said "0 Exercises", because the
// badge counted programs and workouts only and the page also adds the lifts
// made by hand, which are kept in GymSettings. Both now compose the list with
// gym/library.composeLibrary.
describe("the Exercises badge counts what the Exercises page lists", () => {
  const HAND_MADE: CreatedLift[] = [
    { key: "ek-font", name: "Font Hack Squat", kind: "weight_reps" },
    { key: "ek-glute", name: "Glute Kickbacks", kind: "weight_reps" },
    { key: "ek-curl", name: "Leg Curls", kind: "weight_reps" },
    { key: "ek-step", name: "Step Ups", kind: "weight_reps" },
  ];
  const badge = () => Array.from(document.querySelectorAll(".h-door-n")).map((n) => n.textContent)[0];
  let saved: ReturnType<typeof readGymSettings>;
  beforeEach(() => { saved = readGymSettings(); });
  afterEach(() => { writeGymSettings(saved); });

  it("a tester with no program and no workouts who added four by hand sees 4, not 0", () => {
    writeGymSettings({ ...readGymSettings(), createdLifts: HAND_MADE });
    render(<HealthBody {...base} program={null} workouts={[]} onOpenExercises={() => {}} />);
    expect(badge()).toBe("4 Exercises");
  });

  it("hand-made lifts add to the ones the program and workouts already carry", () => {
    writeGymSettings({ ...readGymSettings(), createdLifts: HAND_MADE });
    render(<HealthBody {...base} onOpenExercises={() => {}} />);
    expect(badge()).toBe("6 Exercises"); // Bench Press, Row, and the four
  });

  it("a hand-made lift that was later used is one exercise, not two", () => {
    writeGymSettings({ ...readGymSettings(), createdLifts: [{ key: "ek-bench", name: "Bench Press", kind: "weight_reps" }] });
    render(<HealthBody {...base} onOpenExercises={() => {}} />);
    expect(badge()).toBe("2 Exercises");
  });

  it("counts an archived program's lifts when the caller hands every program in, as the page does", () => {
    const archived = { id: "p0", entityType: "program", data: { name: "Old", archived: true, weeks: [{ id: "w0", label: "Week 1", days: [
      { id: "d0", name: "Legs", exercises: [{ id: "e0", name: "Front Squat", kind: "weight_reps", sets: [] }] },
    ] }] } } as unknown as Program;
    render(<HealthBody {...base} libraryPrograms={[program, archived]} onOpenExercises={() => {}} />);
    expect(badge()).toBe("3 Exercises");
  });

  it("with nothing at all it says 0, honestly", () => {
    render(<HealthBody {...base} program={null} workouts={[]} onOpenExercises={() => {}} />);
    expect(badge()).toBe("0 Exercises");
  });

  it("the page's list and the badge's number come from the same composition, so a hand-made lift is in both", () => {
    const seeds = { created: HAND_MADE };
    const list = composeLibrary([program], workouts, seeds);
    for (const c of HAND_MADE) expect(list.map((e) => e.name)).toContain(c.name);
    expect(shownLibraryCount([program], workouts, seeds)).toBe(list.length);
    writeGymSettings({ ...readGymSettings(), createdLifts: HAND_MADE });
    render(<HealthBody {...base} onOpenExercises={() => {}} />);
    expect(badge()).toBe(`${list.length} Exercises`);
  });

  it("neither screen can quietly go back to a private chain: both go through composeLibrary", () => {
    const gym = readFileSync("src/gym/GymFlow.tsx", "utf8");
    const body = readFileSync("src/brain/HealthBody.tsx", "utf8");
    expect(gym).toMatch(/composeLibrary\(/);
    expect(body).toMatch(/shownLibraryCount\(/);
    expect(gym).not.toMatch(/withCreated\(/);
    expect(body).not.toMatch(/buildLibrary\(/);
  });

  it("the page's opening list and the badge both ask libraryView.defaultView", () => {
    const view = readFileSync("src/gym/libraryView.ts", "utf8");
    const page = readFileSync("src/gym/LibraryPage.tsx", "utf8");
    expect(page).toMatch(/defaultView\(/);
    expect(view).toMatch(/export function shownLibrary\([\s\S]*defaultView\(/);
  });
});

// THE BADGE IS THE PAGE'S OPENING LIST (2026-10-01). Verified live: adding an
// exercise took the badge 37 to 38, and archiving it left 38, because the page
// takes archived and hidden rows off its list and the badge counted them. The
// number beside the door is now libraryView.shownLibraryCount, the count of the
// very view the page opens in, so every case below is checked two ways: the
// badge, and the rows the page actually draws from the same records.
describe("the Exercises badge is the page's opening list, archived and hidden left out", () => {
  const MADE: CreatedLift[] = [{ key: "ek-test", name: "Test Press", kind: "weight_reps" }];
  const badge = () => Array.from(document.querySelectorAll(".h-door-n")).map((n) => n.textContent)[0];
  const BENCH = fallbackKey("Bench Press", "weight_reps");
  let saved: ReturnType<typeof readGymSettings>;
  beforeEach(() => { saved = readGymSettings(); });
  afterEach(() => { writeGymSettings(saved); });

  /** Rows on the Exercises page when it opens, drawn from the same records the
   *  badge reads, through the same composition GymFlow hands the page. */
  function pageRows(): number {
    const gs = readGymSettings();
    const lib = composeLibrary([program], workouts, { created: gs.createdLifts, aliases: gs.aliases, favoriteKeys: gs.favoriteKeys });
    const rows = libraryRows(lib, workouts, gs.hiddenKeys ?? []);
    const store = readClassStore(gs.classByKey, gs.muscleByKey);
    const { unmount } = render(
      <LibraryPage rows={rows} store={store} todayIso={today} onOpen={() => {}} onRename={() => {}} onSetClass={() => {}}
        onMerge={() => {}} onToggleHidden={() => {}} onBack={() => {}} />,
    );
    const n = document.querySelectorAll(".ex-row").length;
    unmount();
    return n;
  }
  const BASE = 3; // Bench Press, Row, and Test Press

  function check(expected: number) {
    const { unmount } = render(<HealthBody {...base} onOpenExercises={() => {}} />);
    expect(badge()).toBe(`${expected} Exercises`);
    unmount();
    expect(pageRows()).toBe(expected);
  }

  it("counts a hand-made exercise, on the badge and on the page", () => {
    writeGymSettings({ ...readGymSettings(), createdLifts: MADE });
    check(BASE);
  });

  it("does not count an archived one, and the page agrees", () => {
    writeGymSettings({ ...readGymSettings(), createdLifts: MADE, classByKey: { "ek-test": { archived: true } } });
    check(BASE - 1);
  });

  it("does not count a hidden one, and the page agrees", () => {
    writeGymSettings({ ...readGymSettings(), createdLifts: MADE, hiddenKeys: ["ek-test"] });
    check(BASE - 1);
  });

  it("an archived exercise that has history is not counted either", () => {
    writeGymSettings({ ...readGymSettings(), createdLifts: MADE, classByKey: { [BENCH]: { archived: true } } });
    check(BASE - 1);
  });

  it("restoring it counts it again", () => {
    writeGymSettings({ ...readGymSettings(), createdLifts: MADE, classByKey: { "ek-test": { archived: true } }, hiddenKeys: ["ek-test"] });
    check(BASE - 1);
    writeGymSettings({ ...readGymSettings(), classByKey: {} });
    check(BASE - 1); // still hidden
    writeGymSettings({ ...readGymSettings(), hiddenKeys: [] });
    check(BASE);
  });

  it("the badge on a mounted dashboard follows the settings on the next render", () => {
    writeGymSettings({ ...readGymSettings(), createdLifts: MADE });
    const { rerender } = render(<HealthBody {...base} onOpenExercises={() => {}} />);
    expect(badge()).toBe("3 Exercises");
    writeGymSettings({ ...readGymSettings(), classByKey: { "ek-test": { archived: true } } });
    rerender(<HealthBody {...base} onOpenExercises={() => {}} />);
    expect(badge()).toBe("2 Exercises");
    writeGymSettings({ ...readGymSettings(), classByKey: {}, hiddenKeys: ["ek-test"] });
    rerender(<HealthBody {...base} onOpenExercises={() => {}} />);
    expect(badge()).toBe("2 Exercises");
    writeGymSettings({ ...readGymSettings(), hiddenKeys: [] });
    rerender(<HealthBody {...base} onOpenExercises={() => {}} />);
    expect(badge()).toBe("3 Exercises");
  });

  it("the page's header count is the same number, and the Archived chip still shows the archived row", () => {
    writeGymSettings({ ...readGymSettings(), createdLifts: MADE, classByKey: { "ek-test": { archived: true } } });
    const gs = readGymSettings();
    const lib = composeLibrary([program], workouts, { created: gs.createdLifts });
    const rows = libraryRows(lib, workouts, []);
    const store = readClassStore(gs.classByKey, gs.muscleByKey);
    expect(defaultView(rows, store).rows).toHaveLength(2);
    render(
      <LibraryPage rows={rows} store={store} todayIso={today} onOpen={() => {}} onRename={() => {}} onSetClass={() => {}}
        onMerge={() => {}} onToggleHidden={() => {}} onBack={() => {}} />,
    );
    expect(document.querySelector(".nav-count")?.textContent).toBe("2");
    expect(screen.queryByText("Test Press")).toBeNull();
    // The floor line says one is out of sight rather than leaving it unexplained.
    expect(screen.getByText("2 of 3 Shown, 1 Archived.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    expect(screen.getByText("Test Press")).toBeInTheDocument();
    expect(document.querySelectorAll(".ex-row")).toHaveLength(3);
    // The header badge is the opening list's count; the chip does not move it.
    expect(document.querySelector(".nav-count")?.textContent).toBe("2");
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    expect(screen.queryByText("Test Press")).toBeNull();
  });
});


// CLEAN ROWS, NO PILLS (Dave 2026-10-05, locked; Alfred 2026-10-04: Adjust Time, Change Workout, Log Something, All Data,
// Customize and View Insights inside the Health cards). The next workout is a row: tap it and its sheet holds every
// action, Start first and filled. Start Workout stays on the card as the screen's one primary.
describe("the Health page wears the row-action model (2026-10-05)", () => {
  const withNext = { ...base, onOpenExercises: () => {}, onOpenHistory: () => {}, onOpenSettings: () => {} };

  it("draws no capsule, and no capsule-shaped button, inside any card on the page", () => {
    const { container } = render(<HealthBody {...withNext} />);
    for (const label of ["Adjust Time", "Change Workout", "All Data", "Log Something", "Customize", "View Insights"]) {
      // Each is a row, a sheet action or a head capsule now; none is a pill or a button sitting in a card.
      const hits = screen.queryAllByText(label).filter((e) => e.closest(".card"));
      for (const h of hits) expect(h.closest(".pill-act, .row-act, .btn-sm, .quiet-action, .btn"), label).toBeNull();
    }
    expect(container.querySelector(".h-next-acts")).toBeNull();
    // The one filled primary on the screen is Start Workout.
    expect([...container.querySelectorAll(".btn-primary")].map((b) => b.textContent)).toEqual(["Start Workout"]);
  });

  it("the next workout is a row whose sheet holds Start (filled), Adjust Time and Change Workout", () => {
    const onStart = vi.fn();
    const onAdjustTime = vi.fn();
    render(<HealthBody {...withNext} onStart={onStart} onAdjustTime={onAdjustTime} />);
    expect(screen.queryByText("Adjust Time")).toBeNull();
    fireEvent.click(document.querySelector(".h-hero")!);
    const sheet = document.querySelector(".sheet-scrim")!;
    expect(sheet.querySelector(".btn-primary")!.textContent).toBe("Start Workout");
    const rest = [...sheet.querySelectorAll(".btn-secondary")].map((b) => b.textContent);
    expect(rest).toContain("Change Workout");
    // Adjust Time needs an estimate; this fixture has no logged sets to price, so it is honestly absent rather than dead.
    fireEvent.click(within(sheet as HTMLElement).getByText("Change Workout"));
    expect(onStart).not.toHaveBeenCalled();
    // Change Workout hands over to its own picker, with the other days in it and an empty session.
    expect(document.querySelector(".sheet-scrim .eyebrow")?.textContent).toBe("Change Workout");
  });

  it("Log Something is the Your Progress head's capsule and opens its sheet", () => {
    render(<HealthBody {...withNext} logActions={[{ label: "Bedtime", onPick: () => {} }]} />);
    const head = screen.getByText("Your Progress").closest(".sh2")!;
    const btn = within(head as HTMLElement).getByRole("button", { name: "Log Something" });
    expect(btn).toHaveClass("see-all", "pill-action");
    fireEvent.click(btn);
    expect(screen.getByText("Bedtime")).toBeInTheDocument();
  });

  it("Customize is a door row with a chevron, and Insights and All Data are the segments only", () => {
    const onOpenSettings = vi.fn();
    render(<HealthBody {...withNext} onOpenSettings={onOpenSettings} />);
    const door = [...document.querySelectorAll(".h-door")].find((d) => d.querySelector(".h-door-k")?.textContent === "Customize")!;
    expect(door.querySelector(".chev")).not.toBeNull();
    fireEvent.click(door);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    // The same two words are not door rows as well as the segmented control above (the round-2 review).
    const doorLabels = [...document.querySelectorAll(".h-door-k")].map((e) => e.textContent);
    expect(doorLabels).not.toContain("Insights");
    expect(doorLabels).not.toContain("All Data");
  });
});

// A ZERO HAS NO STATE (Dave 2026-10-05, D4; the round-2 review: "0 Workouts" and "0 Working Sets" drawn in large lime, a second
// green beside the done tick). The state is a class on the number, so the stylesheet can paint a zero white and a real count in
// the one done green; and the empty Your Progress card is the app's empty state with its glyph.
describe("the Health week card's numbers wear a state only when they have one", () => {
  const quiet = { ...base, workouts: [], overview: periodOverview([], null, [], periodFor("7d", today)) };

  it("a week with no workout and no set marks both numbers as zero, so neither is the done green", () => {
    render(<HealthBody {...quiet} />);
    expect(document.querySelector(".h-week-count")).toHaveClass("zero");
    const sets = screen.getByText("Working Sets").closest(".h-stat") as HTMLElement;
    expect(sets).not.toHaveClass("lime");
  });

  it("a week with a workout does not mark the count as zero", () => {
    const busy = { ...base, overview: { ...base.overview, workouts: 2, workingSets: 14 } };
    render(<HealthBody {...busy} />);
    expect(document.querySelector(".h-week-count")).not.toHaveClass("zero");
    expect(screen.getByText("Working Sets").closest(".h-stat")).toHaveClass("lime");
  });

  it("Your Progress with nothing to read is the one empty state, with its glyph", () => {
    render(<HealthBody {...quiet} />);
    const state = screen.getByText("Nothing to Read Yet").closest(".empty-state") as HTMLElement;
    expect(state.querySelector(".empty-icon")).not.toBeNull();
  });

  it("the Next Workout card's Today or Tomorrow is amber text and a gym block's time is never split from AM or PM", () => {
    render(<HealthBody {...base} gymEvent={{ start: "15:30" }} />);
    const when = document.querySelector(".h-hero-facts .fact.warn, .h-hero-facts .fact.date") as HTMLElement;
    expect(when).toHaveClass("warn");
    expect(when).not.toHaveClass("date");
    expect(when.textContent).toMatch(/^Today 3:30\u00a0PM$/);
  });
});
