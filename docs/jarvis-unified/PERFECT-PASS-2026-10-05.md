# The perfect pass (2026-10-05)

Dave: "Everything should look PERFECT. I want the most aesthetically pleasing app ever. He opens the app and finds nothing." One comprehensive change, built and checked screen by screen in dark and light.

## What shipped

**The row model (locked, `ROW-ACTIONS-SPEC.md`).** No pill or filled chip inside a row or a card. Tap a row: its sheet with every action. Swipe left: the row's one quick action. Swipe right: complete. Long press: the context menu. The checkbox stays. Section actions (Add, Plan My Day, Copy Yesterday, Add Account, Add Bill, Add Item) live in the section head; a head holds at most two capsules and the rest sit behind one round overflow (`shared/HeadMore.tsx`). A card holding only a button is not drawn. A row whose moment has come shows one quiet text action (`shared/RowCtxAction.tsx`). The swipe is taught by a one-time peek and a dismissible first-run tip (`shared/swipeTeach.ts`, `shared/SwipeTip.tsx`), with no permanent affordance.

**Warm neutrals and craft tokens (`STYLING_CATALOG_V3.md` §AY).** Cream light grounds, warm charcoal dark (never pure black), brand red `#FF2B3C` unchanged. One radius language (24 cards, 16 fields, pill buttons), the 8pt grid, one shadow recipe, a rounded display face, tabular digits, spring press feedback, completion celebrations that vary and respect Reduced Motion. Pearl Glass and Dark Polish (§AU to §AX, already on main) sit on top of it; every glass law still passes.

**The catalog is enforced on the rendered DOM** (`laws/catalogCheck.ts`, `catalogSetup.ts`, `catalogRoster.ts`, run after every jsdom test): a lowercase word after a leading number ("2 Blocks"), a card holding only an action, and a capsule in a list row all fail the test that drew them. The written catalog is `VISUAL-CATALOG-GATE.md` (14 rules and a definition of done).

**Casing.** Acronyms are always capitals ("AI", "EIN"); `lineCase` applies the number rule itself; about 90 rendered offenders were fixed at their sources.

**Colour.** Type icons carry their type's colour in both themes (Email teal, Task red, Event sky, Waiting purple, Money green; every More destination its own tone), light twins from the glyph set.

## How it was checked

Every screen the tap sweep and four section tours reach was captured at 390x844 in dark and light and reviewed by designers reading the screenshots. Round 1: 389 defects. Round 2: 146 (3 P0). Final ship-blocker review: 15 P1, 0 P0, all fixed. The Today TV guide still moves and its hash law passes; the Schedule day view still scrolls.

## Decisions I made that Dave may want to change

- Brand red stays; the playbook's coral accent was declined by Dave. The research playbook's liquid-glass, illustration and widget items (P1 to P3) were not built: they need art and native work.
- Light and dark now share one type ramp (the four light-only sizes are gone), per "the only difference is the colours".
- The condensed top bar no longer draws the small red stroke at its foot (it read as an orphaned underline over cards). The large-title stroke stays.
- Sheet text actions stay white in dark and red in light (contrast ruling); a disabled primary is a washed red; schedule state words (FIXED, PROPOSED) stay as the closed vocabulary.
- A goal's glyph wears its area colour on goal lists and purple in mixed lists.
- Your Routine's tone is sky; the AI Hub row is indigo.
- "Javris" in Life > Areas is a name in Dave's own data, not in the code.

## Still open

Contact organisations have no building glyph (no organisation kind on a contact). The disabled-primary contrast in light. People screens still carry four measured capsules in rows (`CAPSULE_ROSTER`, marked DEBT). Dave's rename of the app is later.
