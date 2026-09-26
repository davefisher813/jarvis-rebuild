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
 *  --danger-tx (#CC051B in light, a words red; #FF453A in dark). */
const TAP_TOKENS = String.raw`tint[\w-]*|on-light-red|accent[\w-]*|danger-tx`;

/** The brand red's hexes, as a hand-painted rule would write them: light's
 *  words reds past and present (#BC000E, #DA0012, #CC051B, #B8001A) and the
 *  dark brand red with its fill and gradient stops (#FF2B3C, #FA233B,
 *  #E2051E, #FB5C74). */
const TAP_HEXES = String.raw`BC000E|DA0012|CC051B|B8001A|FF2B3C|FA233B|E2051E|FB5C74`;

/** Every red token that is not the brand's: the system red and the old
 *  --red alias with their tints and fills, and the red category's inks. */
const OTHER_TOKENS = String.raw`sys-red[\w-]*|red[\w-]*|cat-(?:[a-z]+-)?red`;

/** Apple's system red in dark and in light. */
const OTHER_HEXES = String.raw`FF453A|FF3B30`;

/** A token reference ends at its closing paren OR at the comma before a
 *  fallback: `var(--tint, #FF2B3C)` is the brand red as surely as
 *  `var(--tint)` is. */
const ref = (tokens: string) => String.raw`var\(--(?:${tokens})\s*[,)]`;

/** The brand red: "tap me". A fact, a lateness word or anything that cannot
 *  be tapped must never wear it. */
export const TAP_RED = new RegExp(String.raw`${ref(TAP_TOKENS)}|#(?:${TAP_HEXES})\b`, "i");

/** Any red at all, the brand's and the key's: what an unread or behind
 *  state may never wear. */
export const ANY_RED = new RegExp(
  String.raw`${ref(`${TAP_TOKENS}|${OTHER_TOKENS}`)}|#(?:${TAP_HEXES}|${OTHER_HEXES})\b`, "i");
