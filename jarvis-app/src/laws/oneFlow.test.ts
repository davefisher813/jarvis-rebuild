import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// §AN ONE LOGGING FLOW (Dave 2026-09-26, the pass-off: "worst offender on the
// whole list, needs to be flawless"). These pin the shape the rework settled
// so the next pass cannot quietly bring back a second Log control, a bare
// ··· or the pill that floated over the set list.
const SRC = join(__dirname, "..");
const read = (f: string) => readFileSync(join(SRC, f), "utf8");

describe("§AN: one logging flow", () => {
  it("only the red button logs: the Now row has no tick and Match only fills", () => {
    const strip = read("gym/SetStrip.tsx");
    expect(strip, "the tick's write path is gone").not.toMatch(/onLogGhostAs/);
    expect(strip, "Match fills the fields (onMatchLast) and hides when they already match").toMatch(/onMatchLast/);
    expect(strip).toMatch(/nowMatchesLast/);
  });

  it("the set being logged has one source of truth (seed plus draft)", () => {
    const next = read("gym/nextSet.ts");
    expect(next).toMatch(/export function fieldsOf\(/);
    expect(next).toMatch(/export function withDraft\(/);
    const screen = read("gym/SessionScreen.tsx");
    expect(screen, "the label names the pending entry, not the plan").toMatch(/logButtonLabel\([^)]*pending/);
  });

  it("secondary moves live behind one labelled More capsule, not a bare ···", () => {
    const screen = read("gym/SessionScreen.tsx");
    expect(screen).toMatch(/className="pill-act se-more"[\s\S]{0,160}?>More</);
    expect(screen, "the capsule announces the sheet it opens").toMatch(/se-more" aria-haspopup="dialog"/);
  });

  it("the shell's return pill stands down while a session is open", () => {
    expect(read("shell/AppShell.tsx")).toMatch(/\{!sessionOpen && <ReturnPill \/>\}/);
  });

  // DAVE, 2026-09-27: "I need to be able to merge 2-3 exercises together
  // seamlessly for supersets while logging my workouts ... it does not
  // automatically go back and forth ... autofill ... should default to the
  // week prior ... I need to be able to cancel a workout."
  it("a superset is picked, not guessed: two or three lifts from the session, from two obvious doors", () => {
    const screen = read("gym/SessionScreen.tsx");
    expect(screen, "the picker is the multi-pick sheet, two at least").toMatch(/<PickSheet[\s\S]{0,200}?multi[\s\S]{0,60}?minPick=\{2\}/);
    expect(screen, "This Session's head carries the door").toMatch(/className="pill-act se-sup"[\s\S]{0,120}?>Superset</);
    expect(screen, "the old pair-with-the-next-lift guess is gone").not.toMatch(/linkNext/);
    expect(read("gym/liveGroups.ts"), "and the write is the exact group").toMatch(/export function setGroupToday\(/);
  });

  it("a set in a superset moves the session to the next member's turn on its own", () => {
    const screen = read("gym/SessionScreen.tsx");
    const log = screen.slice(screen.indexOf("const log = () => {"), screen.indexOf("// LOG A DROP"));
    expect(log).toMatch(/nextTurnInGroup\(me, dayEx, after\)/);
    expect(log).toMatch(/if \(moved\) onMove\(turnIdx\)/);
    expect(screen, "and a switcher goes to any member in one tap").toMatch(/className="se-chips se-turns" role="group" aria-label="Superset"/);
  });

  it("the prefill reads last session whatever Show Last says, this workout day first", () => {
    const screen = read("gym/SessionScreen.tsx");
    expect(screen).toMatch(/nextSetEntry\(\{ plan: planEx, logged, lastSession: seedHit\?\.sets \?\? null \}\)/);
    expect(screen).toMatch(/const seedHit = lastSessionFor\(history, exercise, exercise\.kind, lastOpts\)/);
  });

  it("a started workout can be cancelled, after asking, with Undo", () => {
    const screen = read("gym/SessionScreen.tsx");
    expect(screen).toMatch(/>Cancel Workout<\/button>/);
    expect(screen, "the confirm's way out is not a second Cancel").toMatch(/dismissLabel="Keep Going"/);
    const flow = read("gym/GymFlow.tsx");
    const cancel = flow.slice(flow.indexOf("onCancel={() => {"), flow.indexOf("onBack={parkSession}"));
    expect(cancel, "nothing is queued or saved").not.toMatch(/queueFinished|saveWorkout/);
    expect(cancel).toMatch(/clearLive\(\)/);
    expect(cancel, "and Undo puts the session back").toMatch(/writeLive\(snap\); enterSession\(snap\)/);
  });

  // DAVE, 2026-09-29: "Edit the warm up feature. It is way too complicated...
  // I should also be EASILY able to mark sets as warm ups and vice versa."
  it("the warm-up is a side of the Now card: no ramp rows, a Work | Warm-Up pill, one flag", () => {
    const screen = read("gym/SessionScreen.tsx");
    expect(screen, "the ramp is not counted off by how many warm-ups are logged").not.toMatch(/rampLeft|rampLogged/);
    expect(screen, "the session decides the side through the ramp module").toMatch(/startsInWarmUp\(ramp, logged\)/);
    expect(screen, "the pill flips the side").toMatch(/onNowMode=\{flipMode\}/);
    expect(screen, "and the button and the write follow it").toMatch(/logButtonLabel\([^)]*pending, warm\)/);
    expect(screen).toMatch(/\.\.\.\(warm \? \{ warmup: true \} : \{\}\)/);
    const strip = read("gym/SetStrip.tsx");
    expect(strip, "no warm-up row logs on tap any more").not.toMatch(/onLogGhost/);
    expect(strip).toMatch(/className="segmented se-mode" role="group" aria-label="Set type"/);
    const sheet = read("gym/SetSheet.tsx");
    expect(sheet, "a logged set converts in the Set sheet").toMatch(/<SwitchRow[\s\S]{0,120}?label="Warm-Up Set"/);
    expect(sheet).toMatch(/warmup: warm \? true : undefined/);
  });

  it("the suggestion reads the session the Last line reads", () => {
    expect(read("gym/SessionScreen.tsx")).toMatch(/preferDayId: live\.dayId/);
    expect(read("gym/progression.ts")).toMatch(/preferDayId\?: string/);
  });

  it("the ruling is written down", () => {
    const cat = readFileSync(join(SRC, "..", "STYLING_CATALOG_V3.md"), "utf8");
    expect(cat).toMatch(/## AN\. One logging flow/);
    expect(cat).toMatch(/Three dots isn't obvious enough/);
    expect(cat, "and so is the warm-up model").toMatch(/## §AS\. The warm-up is a side of the Now card/);
  });
});
