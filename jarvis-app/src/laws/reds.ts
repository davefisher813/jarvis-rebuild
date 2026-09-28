// ---------------------------------------------------------------------------
// THE ONE DEFINITION OF RED THE LAWS SHARE (2026-09-26, round-3 review).
//
// Three laws amended on one day each wrote "red" their own way. The Colour
// Key's brand red, F-04's words red and L1's guilt and unread patterns
// disagreed about --danger-tx, about a var() with a fallback, and about the
// words red's hexes, so a rule could be red to one law and not to another:
// `var(--tint, #FF2B3C)` on a fact, `var(--on-light-red, #B8001A)` on a
// lateness rule and `var(--danger-tx)` on an unread dot each passed every
// law. So the reds live here, once, and each law reads them from here.
//
// Not app code: nothing the app runs imports this. It is listed in the
// reachability law's NOT_APP roster with that reason.
// ---------------------------------------------------------------------------

/** The tokens that paint the BRAND red, the red that means "tap me" (§AM):
 *  --tint and every --tint-* (the sheet red), every --accent* (the fill, the
 *  words, the glyph, the chip), --on-light-red (light's words red), and
 *  --danger-tx (#CC051B in light, a words red; #FF453A in dark).
 *  AMENDED 2026-09-26 (round-4 review, the lead): --red-tint joins them. It
 *  sat with the system red by its name, but it is the brand red's wash: the
 *  tap red #FF2B3C at 16% in dark and the words red #CC051B at 10% in light,
 *  and the sheets use it as the tap-red wash on purpose. Filed as the
 *  system red, it let the late tile and the late chip sit on the tap red
 *  with every law green. It is still in ANY_RED, through this list. */
const TAP_TOKENS = String.raw`tint[\w-]*|red-tint|on-light-red|accent[\w-]*|danger-tx`;

/** The brand red's hexes, as a hand-painted rule would write them: light's
 *  words reds past and present (#BC000E, #DA0012, #CC051B, #B8001A) and the
 *  dark brand red with its fill and gradient stops (#FF2B3C, #FA233B,
 *  #E2051E, #FB5C74). AMENDED 2026-09-27 (§AQ): #C0000D, light's one words red.
 *  AMENDED 2026-09-26 (round-4 review, the lead): #FF2D3E joins them, the
 *  brand red raised two points that a sheet paints by hand. */
const TAP_HEXES = String.raw`C0000D|BC000E|DA0012|CC051B|B8001A|FF2B3C|FA233B|E2051E|FB5C74|FF2D3E`;

/** Every red token that is not the brand's: the system red and the old
 *  --red alias with their fills, and the red category's inks. --red-tint is
 *  the one --red* that is not here (see TAP_TOKENS). */
const OTHER_TOKENS = String.raw`sys-red[\w-]*|red(?!-tint)[\w-]*|cat-(?:[a-z]+-)?red`;

/** Apple's system red in dark and in light.
 *  AMENDED 2026-09-26 (the lead, #60/#61: the key's red on a sheet grey):
 *  #FF6961 joins them, Apple's increased-contrast systemRed, which dark's
 *  --sys-red-on-sheet resolves to. The token itself was already a red here
 *  through sys-red[\w-]* above; its hex was not, so a rule hand-painting
 *  the sheet red would have read as no red at all. It is not a tap red, so
 *  TAP_RED is unchanged; ANY_RED gains it.
 *  AMENDED 2026-09-27 (Dave, follow-up to §AQ): #D22E24 joins them, the
 *  readable words red -- the brand hue stepped down to 5.05:1 on white,
 *  4.60:1 on the page.
 *  A words red, never a tap red: TAP_RED is unchanged; ANY_RED gains it. */
const OTHER_HEXES = String.raw`FF453A|FF3B30|FF6961|DC3126`;

/** A token reference ends at its closing paren OR at the comma before a
 *  fallback: `var(--tint, #FF2B3C)` is the brand red as surely as
 *  `var(--tint)` is. */
const ref = (tokens: string) => String.raw`var\(--(?:${tokens})\s*[,)]`;

/** AMENDED 2026-09-26 (round-4 review, the lead): "as a hand-painted rule
 *  would write them" did not hold. A hex matched only as six digits, so the
 *  same red with an alpha pair (#FF2B3CCC) passed, and an rgb() or rgba()
 *  spelling of it passed too, though the sheets hand-paint the brand red
 *  that way themselves. So a hex may carry an alpha pair, and every hex on
 *  a list is also read in its rgb() and rgba() forms, commas or spaces,
 *  built from the same list so the two spellings cannot drift apart. */
const hex = (hexes: string) => String.raw`#(?:${hexes})(?:[0-9a-f]{2})?\b`;
const rgb = (hexes: string) => {
  const triples = hexes.split("|").map((h) =>
    [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(String.raw`[\s,]+`));
  return String.raw`rgba?\(\s*(?:${triples.join("|")})\b`;
};

/** The brand red: "tap me". A fact, a lateness word or anything that cannot
 *  be tapped must never wear it. */
export const TAP_RED = new RegExp(
  String.raw`${ref(TAP_TOKENS)}|${hex(TAP_HEXES)}|${rgb(TAP_HEXES)}`, "i");

/** Any red at all, the brand's and the key's: what an unread or behind
 *  state may never wear. */
export const ANY_RED = new RegExp(
  String.raw`${ref(`${TAP_TOKENS}|${OTHER_TOKENS}`)}|${hex(`${TAP_HEXES}|${OTHER_HEXES}`)}|${rgb(`${TAP_HEXES}|${OTHER_HEXES}`)}`, "i");

/** Jarvis Red in light (Dave, 2026-09-27, catalog §AQ): "I hate it. Make all
 *  red Jarvis red." Every red in light is #FF3B30, words included, chosen
 *  over readable twins knowing it reads 3.23:1 on the page. The contrast
 *  laws that measure a light red word exempt this one hex and nothing else;
 *  any other red still has to clear its bar.
 *  AMENDED 2026-09-27 (Dave, same night): the words red steps down to
 *  #D22E24 (5.05:1 on white, 4.60:1 on the page, in OTHER_HEXES above). #FF3B30 stays the brand
 *  red for fills, glyphs and chrome, and the exemption below still covers
 *  the category text red, which keeps the brand hex. */
export const JARVIS_RED_LIGHT = "#FF3B30";
export const isJarvisRedLight = (hex: string | undefined) =>
  (hex ?? "").toUpperCase() === JARVIS_RED_LIGHT;
