import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

// THE TODAY TV GUIDE IS FROZEN (Dave 2026-09-27, on his phone, the card
// standing still with three rows left: "For no reason are we ever getting
// rid of that. It should never be edited. It should never be touched. It was
// the one thing I was happy with the whole time. ... Fix it and it's to
// never be touched again unless I say so.")
//
// So this law does not describe the card; it HASHES it. The region between
// the FROZEN and END markers in YourDay.tsx (the moving/paused branches,
// the copies, the twin, the band, the hint) and the .sched-ticker block in
// components.css must be byte-identical to what he approved. Any edit,
// however small, fails the build. The only way to change either region is
// Dave saying so in his own words: quote him, date it, and update the hash
// in the same commit.
//
// What the frozen region promises, in words, for the reader who cannot read
// a hash: the card renders whenever the day has anything in it; it MOVES at
// all times (a day shorter than the window is repeated, an even number of
// copies, until the loop has two windows to loop); Pause holds it for the
// visit only and is the one way to reach the actionable view; the loop is a
// 40s -50% translate inside a 252px window; nothing else on the page decides
// any of that.
const SRC = join(__dirname, "..");
const read = (f: string) => readFileSync(join(SRC, f), "utf8");
const region = (text: string, start: string, end: string) => {
  const a = text.indexOf(start);
  const b = text.indexOf(end);
  if (a < 0 || b < 0 || b < a) throw new Error(`frozen markers missing: ${start} ... ${end}`);
  return text.slice(a, b + end.length);
};
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const FROZEN_YOURDAY = "4e4592d6dd98b6b0c871cf34f712f7a0d684db6a2b1d8730d87e2bed5202dbf2";
const FROZEN_CSS = "ec91a5ab96d0cb14100775aba84ca97ac7901fedeb334438038c2c5c0a9c6ac6";

describe("THE TODAY TV GUIDE IS FROZEN (Dave 2026-09-27)", () => {
  it("YourDay.tsx's ticker region is byte-identical to what Dave approved", () => {
    const r = region(read("today/YourDay.tsx"), "  // === TV GUIDE, FROZEN (Dave 2026-09-27) ===", "  // === END TV GUIDE ===");
    expect(sha(r), "the TV guide was edited; only Dave can unfreeze it (quote him, date it, update the hash)").toBe(FROZEN_YOURDAY);
  });
  it("the .sched-ticker stylesheet block is byte-identical to what Dave approved", () => {
    const r = region(read("styles/components.css"), "/* === TV GUIDE, FROZEN (Dave 2026-09-27)", "/* === END TV GUIDE === */");
    expect(sha(r), "the TV guide's CSS was edited; only Dave can unfreeze it").toBe(FROZEN_CSS);
  });
  it("in words: it moves at all times, in a 252px window, on a 40s loop", () => {
    const y = read("today/YourDay.tsx");
    expect(y).toMatch(/const moving = !paused;/);
    expect(y).toMatch(/const copies = Math\.max\(2, 2 \* Math\.ceil\(WINDOW \/ Math\.max\(1, dayH \|\| WINDOW\)\)\);/);
    expect(y).toMatch(/const WINDOW = 252;/);
    const c = read("styles/components.css");
    expect(c).toMatch(/\.sched-ticker \{ position: relative; height: 252px; overflow: hidden; \}/);
    expect(c).toMatch(/\.ticker-track \{ animation: tickerScroll 40s linear infinite;/);
    expect(c).toMatch(/@keyframes tickerScroll \{ from \{ transform: translateY\(0\); \} to \{ transform: translateY\(-50%\); \} \}/);
  });
});
