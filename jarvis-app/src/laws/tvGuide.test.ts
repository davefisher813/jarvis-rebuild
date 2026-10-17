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
//
// AMENDED ONCE, 2026-10-17. The copies that make the loop seamless read as
// the whole day twice to a screen reader and to the accessibility text a
// verifier extracts. Asked to choose between hiding the loop copies from
// that layer and changing the loop, Dave said: "Whatever you think is best."
// Alfred's ruling under that delegation: hide the loop copies from the text
// layer, the mechanism and every pixel unchanged. The region gained a ref
// and a data-copies count on the moving track and nothing else; the effect
// that marks the copies aria-hidden lives above the region. Hash updated
// with his quote in the same commit, as this law requires.
const SRC = join(__dirname, "..");
const read = (f: string) => readFileSync(join(SRC, f), "utf8");
const region = (text: string, start: string, end: string) => {
  const a = text.indexOf(start);
  const b = text.indexOf(end);
  if (a < 0 || b < 0 || b < a) throw new Error(`frozen markers missing: ${start} ... ${end}`);
  return text.slice(a, b + end.length);
};
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const FROZEN_YOURDAY = "686d58ccb810789074faa4695c76d91a3a2e638d0080b73bd7a317cea825bd7f";
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
    // The 2026-10-17 amendment, in words: the moving track hands its copy count to the effect that hides the copies.
    expect(y).toMatch(/<div className="ticker-track" ref=\{trackRef\} data-copies=\{copies\}>/);
    expect(y).toMatch(/if \(i >= perCopy\) el\.setAttribute\("aria-hidden", "true"\);/);
    const c = read("styles/components.css");
    expect(c).toMatch(/\.sched-ticker \{ position: relative; height: 252px; overflow: hidden; \}/);
    expect(c).toMatch(/\.ticker-track \{ animation: tickerScroll 40s linear infinite;/);
    expect(c).toMatch(/@keyframes tickerScroll \{ from \{ transform: translateY\(0\); \} to \{ transform: translateY\(-50%\); \} \}/);
  });
});
