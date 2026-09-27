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

  it("the ruling is written down", () => {
    const cat = readFileSync(join(SRC, "..", "STYLING_CATALOG_V3.md"), "utf8");
    expect(cat).toMatch(/## AN\. One logging flow/);
    expect(cat).toMatch(/Three dots isn't obvious enough/);
  });
});
