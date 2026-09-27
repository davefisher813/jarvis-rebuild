// THE SENTENCE-CASE SURFACES (Dave 2026-09-26, the pass-off, Batch 1
// casing sweep). The whole rule (§H2) makes every line the app writes Title
// Case, and names the only places sentence case survives: where the app is
// talking in sentences. That boundary is not machine-decidable from a
// string, so it is a roster by path, read by the casing law in
// laws.test.ts. A file listed here is one the law does not scan for a
// lowercase-led sub line or a bare unit; everything else is held to the
// rule.
//
// Each entry carries its reason. Add one only when the surface is a
// conversation, a document body, a prompt, or somebody else's words; a
// grey sub line that happens to be shaped like a sentence is NOT one
// (the narrow boundary: "Same as this block" reads "Same as This Block").
//
// Paths are relative to src/, matched as prefixes.
export const SENTENCE_CASE_SURFACES: ReadonlyArray<readonly [path: string, reason: string]> = [
  ["chat/", "chat bubbles: the app talking in sentences"],
  ["onboarding/", "onboarding prompts: conversation by catalog"],
  ["ai/", "prompt text handed to the model, never drawn"],
  ["paste/", "the paste parser's synonyms, never drawn"],
  ["gym/parseSet.ts", "typed-set input synonyms, never drawn"],
  ["gym/extract.ts", "the extraction prompt handed to the model"],
  ["health/seasonFeed.ts", "the season-feed prompt handed to the model"],
  ["notes/docModel.ts", "note bodies: the user's own document, and markdown marks"],
  ["booking/receipt.ts", "a guest's confirmation email and text: sentences to somebody else"],
  ["booking/PublicBookingPage.tsx", "a guest's public page: prose to somebody else"],
  ["booking/PublicCancelPage.tsx", "a guest's public page: prose to somebody else"],
  ["data/seed.ts", "seeded rows in the user's own words"],
  ["data/seedNotes.ts", "seeded note bodies in the user's own words"],
  ["insights/exportData.ts", "a text file the app exports, not a screen"],
  ["shared/duration.ts", "the one duration formatter: it owns the compact clock's shape"],
];

/** True when the file at `rel` (relative to src/) is a sentence-case surface. */
export const isSentenceSurface = (rel: string): boolean =>
  SENTENCE_CASE_SURFACES.some(([p]) => rel.startsWith(p));
