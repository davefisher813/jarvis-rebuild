// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import HealthBody from "./HealthBody";
import { readFileSync } from "node:fs";
import { composeLibrary, libraryCount } from "../gym/library";
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
  onOpenInsights: () => {}, onOpenAllData: () => {},
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
    expect(document.querySelector(".h-doors")).toBeNull();
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
    expect(libraryCount([program], workouts, seeds)).toBe(list.length);
    writeGymSettings({ ...readGymSettings(), createdLifts: HAND_MADE });
    render(<HealthBody {...base} onOpenExercises={() => {}} />);
    expect(badge()).toBe(`${list.length} Exercises`);
  });

  it("neither screen can quietly go back to a private chain: both go through composeLibrary", () => {
    const gym = readFileSync("src/gym/GymFlow.tsx", "utf8");
    const body = readFileSync("src/brain/HealthBody.tsx", "utf8");
    expect(gym).toMatch(/composeLibrary\(/);
    expect(body).toMatch(/libraryCount\(/);
    expect(gym).not.toMatch(/withCreated\(/);
    expect(body).not.toMatch(/buildLibrary\(/);
  });
});
