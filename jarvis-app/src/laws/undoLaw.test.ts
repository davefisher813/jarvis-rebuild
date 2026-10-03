// LAW: IF THE APP SAYS SOMETHING IS GONE, IT SAYS HOW TO GET IT BACK.
//
// The pattern was already everywhere -- 52 of the 60 toasts that report a
// removal carry actionLabel "Undo" and an onAction that reverses the write --
// which is exactly why the eight that did not were invisible. A convention
// followed 87% of the time looks like a rule and behaves like a coin toss.
//
// Two of the eight were shipped by the swipe work earlier the same day: a
// swipe on a repeating row skips the day by writing an exdate, and the toast
// reported it with no way back, so the only route out of a mis-swipe was
// opening the series and editing it by hand. Found by sweeping, not by
// remembering.
//
// The roster below is exact in both directions, like L7's: a new destructive
// toast without an Undo fails, and so does adding an Undo to a rostered one
// without taking it off the list.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(__dirname, "..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(n) && !/\.test\./.test(n)) out.push(p);
  }
  return out;
}

// The words this app uses when a thing has left.
const GONE = /\b(deleted|removed|cleared|erased|discarded|trashed|wiped|forever|let go|skipped)\b/i;

function destructiveToasts(): { at: string; msg: string; hasUndo: boolean }[] {
  const out: { at: string; msg: string; hasUndo: boolean }[] = [];
  for (const f of walk(SRC)) {
    const r = relative(SRC, f).replace(/\\/g, "/");
    if (/^(bench|testpanel|laws)\//.test(r)) continue;
    const src = readFileSync(f, "utf8");
    let i = 0;
    for (;;) {
      const at = src.indexOf("showToast(", i);
      if (at === -1) break;
      i = at + 8;
      // Balance the parens so a nested call cannot cut the message off.
      let depth = 0, end = at;
      for (let j = src.indexOf("(", at); j < src.length && j < at + 2500; j++) {
        if (src[j] === "(") depth++;
        else if (src[j] === ")") { depth--; if (depth === 0) { end = j; break; } }
      }
      const call = src.slice(at, end + 1);
      const msg = (call.match(/message:\s*["`]([^"`]{2,80})/) ?? [])[1]
        ?? (call.match(/message:\s*[^,}]{2,60}/) ?? [])[0] ?? "";
      if (!GONE.test(msg)) continue;
      out.push({ at: `${r} · ${msg.slice(0, 44)}`, msg, hasUndo: /actionLabel/.test(call) && /onAction/.test(call) });
    }
  }
  return out;
}

// Reports of a removal that correctly offer no Undo, each read and reasoned.
const NO_UNDO: Record<string, string> = {
  "chat/ChatFlow.tsx · Receipt removed": "this IS the Undo's own confirmation; undoing an undo is not a thing",
  "chat/ChatFlow.tsx · Note removed": "same, for the note",
  "gym/GymFlow.tsx · Discarded · The Saved Session Stays": "the message says in its own words that nothing was lost",
  "notes/NotesFlow.tsx · Deleted for good": "Delete Forever, behind its own confirm; permanence is the feature",
  "settings/AdvancedPage.tsx · message: n === 0 ? \"No Chat History\" : `Dele": "a two-tap armed delete of all chat history; permanence is the point",
  // Brain Manual v1 (2026-09-27): the Brain settings erase is a tap-twice
  // armed delete of every brain_memory row, behind its own confirm; the
  // point of the button is a clean brain, and rows cannot be un-erased.
  "settings/BrainSettingsPage.tsx · Brain Erased ✓": "a two-tap armed erase of all brain memory; permanence is the point",
  // The unified substrate (slice 04, spec S19): deleting a receipt is an
  // erasure behind its own confirm sheet. The words are gone for good and a
  // tombstone stays; the action it recorded is NOT undone, and the toast says
  // so in its own words. There is nothing to bring back.
  "hub/ReceiptDetail.tsx · Receipt Deleted · The Action Stands": "an erasure behind its own confirm; the words go for good, the action stands, and the toast says so",
};

describe("LAW: a toast that says something is gone offers Undo", () => {
  const toasts = destructiveToasts();

  it("finds the destructive toasts at all", () => {
    expect(toasts.length).toBeGreaterThanOrEqual(40);
  });

  it("every one without an Undo is rostered, and every roster entry is one", () => {
    const bare = toasts.filter((t) => !t.hasUndo).map((t) => t.at).sort();
    expect(bare, "a removal the user cannot take back, or a roster entry that gained an Undo")
      .toEqual(Object.keys(NO_UNDO).sort());
  });

  it("the skip toasts carry the inverse write, not just the word Undo", () => {
    // The two this law was written for. An Undo that does not undo is worse
    // than no Undo, so the roster is not enough here: the handler has to call
    // removeExdate, which is addExdate's exact inverse.
    for (const f of ["today/TodayFlow.tsx", "schedule/ScheduleFlow.tsx"]) {
      const src = readFileSync(join(SRC, f), "utf8");
      expect(src, `${f}: the skip must be reversible`).toMatch(/removeExdate\(/);
    }
  });
});
