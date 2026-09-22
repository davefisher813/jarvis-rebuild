import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { posix } from "node:path";

const { join } = posix;
const ROOT = process.cwd().replace(/\\/g, "/");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

// ---------------------------------------------------------------------------
// LAW: ONE GREY, EVER (Dave 2026-09-21, five screenshots; tightened V5.2
// 2026-09-22).
//
// V5.1, his words: "There should not be more than one gray subtext anywhere.
// So it should say one thing up top or just say whatever it says up top.
// And if there's subtext, you can make it gray with regular font one time.
// And then after that shit has to look different. If you want to bold
// something in gray, fine. Color coordinating, dots, chips, whatever. But I
// never want to speak about this again. Enforced strict, strict laws with
// visuals."
//
// V5.2 pulled the "bold something in gray, fine" exemption back out: a real
// block row paired a grey kicker with the identical grey, bolded, on the
// same line, and at Dynamic Type 1.4x the two still crowded and wrapped as
// one grey mass. Dave: "TOO MUCH GREY SUBTEXT... styled different if it
// shares a line w grey subtext." Weight can still reinforce a real
// distinction; it can no longer BE one.
//
// The visual half lives in tools/visual-audit.mjs, check 8, which reads the
// COMPUTED colour and weight of every text-bearing leaf in every row it
// reaches and names the rows carrying two regular-or-bold greys. That is the
// enforcement, because it measures what he sees. This file is the other half:
// it pins the catalog section, the auditor's check and the exemptions the
// ruling itself still names (a dot ahead of the words; a fill of its own) to
// one another, so none of them can be quietly removed while the rest stand.
// ---------------------------------------------------------------------------
describe("LAW: one grey, ever", () => {
  const catalog = read("STYLING_CATALOG_V3.md");
  const auditor = read("tools/visual-audit.mjs");

  it("the catalog carries the ruling in Dave's words, and names what it supersedes", () => {
    expect(catalog).toMatch(/## §AK\. One Grey, Ever/);
    expect(catalog).toMatch(/at most ONE run of text is secondary ink at regular weight/);
    expect(catalog, "the V4.1 rule that capped the colour instead of the grey is named as superseded")
      .toMatch(/M\.3 is superseded/);
    expect(catalog, "V5.2 says in the catalog itself that weight alone no longer clears a row")
      .toMatch(/Weight may reinforce one of these; it may not be the whole of the distinction/);
  });

  it("the auditor measures it on every row, by computed colour, weight is no longer a way out on its own", () => {
    expect(auditor).toMatch(/add\("grey-twice"/);
    expect(auditor, "the ink is read from the computed style, never a class name").toMatch(/isGrey\(cs\.color\)/);
    expect(auditor, "V5.2: weight alone must not skip a grey run")
      .not.toMatch(/if \(Number\(cs\.fontWeight\) >= 600\) continue;/);
    expect(auditor, "a mark ahead of the words is still a way out").toMatch(/marked\(e\)/);
    expect(auditor, "a fill of its own is still a way out").toMatch(/onOwnFill\(e, row\)/);
    expect(auditor, "and a sentence broken into spans is one run, not several").toMatch(/greys\.some\(\(g\) => g\.unit === unit\)/);
  });

  it("a placeholder under a row is not subtext, so the goal line says nothing when it has nothing", () => {
    const reach = read("src/bigger/reach.ts");
    expect(reach, "the placeholder may be remembered in a comment, never returned").not.toMatch(/return "Nothing under it yet"/);
  });

  it("a note made from a meeting says its date once, on the meta line", () => {
    const notes = read("src/notes/NotesService.ts");
    expect(notes).not.toMatch(/`\$\{title\} · \$\{shortDateFromMs/);
  });
});
