import { describe, it, expect } from "vitest";
import { SAY_GROUPS, type SayKind } from "./examples";
import { classifyLine } from "../paste/deterministic";
import { readPrefix } from "../paste/prefixes";
import { readQuestion } from "./intent";
import { readSpokenSet } from "./spokenSet";
import { STARTER_EXERCISES } from "../gym/starterLibrary";

// WHAT CAN I SAY? NEVER LIES (2026-10-31). Every sentence the help shows is run through the same reads the box uses, and must
// land as the kind it is listed under. A help page that teaches a sentence the app mis-files is worse than no help.
const NAMES = STARTER_EXERCISES.map((e) => e.name);
const TODAY = "2026-10-31";

function landsAs(line: string): SayKind | string {
  if (readQuestion(line)) return "question";
  if (readSpokenSet(line, NAMES)) return "set";
  const pre = readPrefix(line);
  if (pre?.kind === "remember") return "fact";
  if (pre?.kind === "decision") return "decision";
  const e = classifyLine(line, TODAY);
  if (e.expense) return "money";
  if (e.reminder) return "reminder";
  if (e.kind === "event") return "event";
  if (e.kind === "decision") return "decision";
  if (e.kind === "fact") return "fact";
  if (e.kind === "note") return "note";
  if (e.kind === "task" && e.confident) return "task";
  return "unsure " + e.kind;
}

describe("every example files as its group says", () => {
  for (const g of SAY_GROUPS) {
    for (const ex of g.examples) {
      it(`${g.title}: ${ex}`, () => { expect(landsAs(ex)).toBe(g.kind); });
    }
  }
});
