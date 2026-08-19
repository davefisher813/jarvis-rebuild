# JARVIS Styling Catalog V4.0 (The Branded Library, 2026-08-18)

## V4 revision (Dave's picks, 2026-08-18). Supersedes conflicting V3 rules.

1. EIGHT SURFACE KINDS cover every screen: A nav list · B content list · C settings tree · H hero (Today only) · D detail/record · S sheet · O overlay · K canvas. A screen that fits none is a design bug and gets restructured.
2. NAV LISTS (More, Brain) are HEADERLESS: one flat list, every glyph the brand red in the FILLED state. Brain carries exactly ONE mini-caps boundary label (Your Categories + count) where user content begins; More separates the trailing Settings cluster with the one legal unlabeled gap (.lib-gap, 32px). Nav rows are name-only.
3. FILLED GLYPHS ARE DRAWN AS FILLED SHAPES (shared/filledIcons.tsx), detail cut out in the page black. Pouring fill into stroke icons makes blobs and is banned. Outline stays the content-row state; one list never mixes states. Law-tested.
4. BRAIN REORG: Contacts, Decisions, Life Philosophy, How You Write, Values, Your Routine as one flat nav list; categories as one flat block ordered org → health → people → plain; the per-kind sub-labels are retired.
5. SETTINGS wears the SAME sectioning as everything else: mini-caps labels (.sh2-caps) over flat full-bleed rows, and joins the red wash: every Settings glyph is a FILLED brand-red shape (Dave 2026-08-18, "settings in all red too"). The inset-card treatment was never approved and is dead.
6. MINI-CAPS (.sh2-caps) is the ONE small-label style: nav boundaries and Settings groups. CONTENT lists keep bold sh2 heads with counts (Decisions never counts).
7. DETAIL PAGES ride a static condensed bar: the .nav-bar is now sticky glass with a centered inline title (the iOS push-page form), consistent with the chassis without per-file rewrites.
8. NO FLOATING ADD ROWS: every in-list create action is a centered accent row (.row-act: Add Project, Add Goal, Add Account, Add Category, Add Block). The red plus tiles are retired.
9. LETTER TILES are retired from list rows: content rows lead with the bare type glyph in the category/slot color (projects folder, accounts wallet). Detail-page heroes may keep their identity tile.
10. CAPS QUALIFIERS leave section counts ("4 ACTIVE" → 4). Capitals lead every middle-dot segment in composed metas too ("55 days · No reply").
11. BANNERS: every offer is a promo card (the stalled-project First Step included).

## L. Page order, hierarchy, and flow (V4, Dave 2026-08-18: "the pages right now don't make sense")

1. ONE VERTICAL GRAMMAR on every page, top to bottom: bar → large title (+search) → alerts → primary offer → sections → trailing actions. A page never interleaves these bands; a thing in the wrong band moves, it doesn't get restyled.
2. ALERT DISCIPLINE (the landing-page chaos fix): alert cards render in one fixed priority order (decision revisit > failed automation > automation receipt > where-you-were) and AT MOST TWO show per open. The rest wait for the next open; nothing is lost because every card is also reachable from its home surface. Offers (weather connect) yield when the alert budget is spent.
3. TODAY's canonical order: hero (date, greeting, summary, ring) → alerts (≤2) → day-draft proposal → re-flow and overflow responses → Now → Check In or suggestions → Money line → Your Day → Tonight → Tomorrow. Nothing else may insert itself.
4. EMAIL's canonical order: bar (compose) → title → search → account and filter chips → the one Needs-You promo card (Deal With It · drain) → Needs You → Waiting On → The Rest fold. The floating headline sentence is retired; the sections say it.
5. LIST PAGES (B): title (+bar action) → search when earned → content sections. NAV PAGES (A): title → flat rows → boundary label → user content → gap → system cluster. Detail pages (D): static bar → identity block → fact blocks → chain blocks → provenance → actions (change above delete, delete always armed).
6. FUNCTIONALITY BAND: a page's ONE primary action lives in the bar (create) or the one promo card (triage); in-list creates are trailing .row-act rows at the END of their section, never floating mid-list. Destructive actions are the LAST thing on a page.
7. FLOW LAW: every list row opens its record in one tap; every record reaches its parent list in one back; every alert card resolves in at most two taps and never navigates away without the action completing. Search results open the exact record. No screen dead-ends: an empty state always carries its action.
8. THE WRITING CANVAS (notes): document title, 17px body at 1.6 leading, block chrome invisible until the block has focus, compose bar sticky at the bottom. Writing surfaces put words first and controls second.

## M. Populated-round anatomy (V4.1, Dave 2026-08-18 populated previews)

1. THE WRITING TOOLBAR: every note pins a chip toolbar to the viewport bottom (the tab bar is hidden while writing, so the toolbar owns that edge): Text · Heading · List · Checklist · More (accent). Each chip creates its block and drops the caret in it. The chip row scrolls sideways, never clips. Markdown shortcuts ("# ", "- ", "[] ", "1. ") are law on text blocks.
2. DECISION LIST ANATOMY: colored glyph (category color when linked, purple when free-standing) → name line (decision sentence, wraps to two lines max, never one-line ellipsis) with the recorded date quiet at the right → sub line "Because {why}" with the linked home as a colored semibold fact. No counts anywhere in Decisions (spec law).
3. PROJECT LINKING: Area and Goal are chip pickers on the project detail page itself, saved inline through attemptWrite. Linking never requires the edit sheet.
4. DEMO MAIL: demo builds render the email anatomy from a fixture component (DemoMail) gated by an explicit demoMail prop, never by environment sniffing. The fixture mirrors rule L4's canonical order exactly; when it drifts from the real MessagesFlow layout, the fixture is the one that's wrong. Its compose is a real typing surface (To, Subject, Message all work); only Send explains itself.

## N. The writing system (V4.2, Dave 2026-08-19: "dig deeper with the writing features")

1. INLINE RICH TEXT: storage stays plain text with markers everyone knows: **bold**, *italic*, ==highlight==, ~~strike~~. Blocks render formatted when read, raw when edited. A tap on formatted text drops the caret at the tapped character, mapped through the markers. No HTML in the data model, ever.
2. THE SELECTION BAR: select text in a text block and a floating bar appears above the selection: bold, italic, strike, highlight. Re-applying a format removes it. The bar never steals focus from the canvas.
3. UNDO AND REDO ride the editor's nav bar. Every block mutation snapshots first (50 deep); undo restores wholesale. Disabled arrows show at 30% opacity.
4. TURN INTO lives in the block menu: any text or heading converts to text, heading, list, or checklist in place, keeping its words.
5. EMPTY STARTERS: toolbar-created text and heading blocks start empty with a placeholder; the first keystroke is the writer's.
6. THE QUIET WORD COUNT sits centered under the last block in the muted meta ramp.
7. EVERY LONG-FORM SURFACE IS THE CANVAS: brain docs (Philosophy, Writing, Values, Routine) write on the same borderless page as notes: 17px at 1.6, accent caret, no boxed input. A boxed textarea on a writing page is a violation. Form sheets (task, event, decision, person) stay forms: labels, boxed inputs, segments.
8. TEMPLATES DELIVER WHAT THEIR CARD PROMISES (law-tested): Meeting Notes opens dated ("Aug 19 · Attendees") with Agenda / Decisions / Action Items; Project Brief carries Objective / Key Dates / Tasks / Notes; Journal opens with today's first entry ready to write; Tracker opens with an editable row.
9. THE TRACKER IS A LIVING TABLE: every cell edits in place, Add Row grows it downward, the header's + adds a column, and a column whose cells are all numbers (or money) sums itself in the bold sum row. The sum is computed at render, never stored, so it can't go stale. Table writes are serialized through one queue reading fresh state, because a cell's blur-save and an Add Row tap land back-to-back.
10. BLACK STEEL CANVAS, NUMBERED (Dave's final pick, 2026-08-19: "5 with 4's numbering"): every document heading renders as a red counter number (12px bold tabular, 65% opacity, CSS counter so it renumbers itself) followed by the heading in red mini-caps (12px, bold, 0.14em tracking, uppercase via CSS) and a dotted red leader running to the margin. Doc titles are 26px at -0.01em; body 16.5px at 1.6, tight rhythm (the mock's density IS the design). Tables are steel: surfaced card, quiet header band, red-washed Total row with the accent total. The meta block (grey 14.5px) frames the document under its title. A section head without its number, red caps, and leader is a violation.
11. STEEL HEADS APP-WIDE (Dave 2026-08-19: "Proceed"): every section head in the app is the steel head: .sh2 renders red mini-caps + dotted leader + quiet count; detail-page group labels (.grp .eyebrow: Decided, Because, Details) ride the same treatment. Two exceptions, both principled: bottom-sheet form labels stay quiet grey (a sheet is a form, not a page), and colored category kicker eyebrows keep their category colors (color IS their information). sh2-caps is absorbed; there is ONE section-head style in JARVIS. Settings is a registered headerless nav list (Dave 2026-08-19): eleven rows, no group labels, group order preserved in row order.

Everything below is the V3.3 base that still stands, minus rules superseded above.

# JARVIS Styling Catalog V3.3 (APPROVED 2026-08-18, Library edition)

## K. The iOS label ramp and the promo card (V3.3 revision, approved 2026-08-18)

1. TEXT HIERARCHY is the iOS label ramp: titles pure white; secondary text EBEBF5 at 60% (the system secondaryLabel); tertiary at 30%. Light theme mirrors 3C3C43 at 60/30. Meta is 15px. Recede comes from color and size, never from casing.
2. META CASING: sentence case with proper nouns kept ("Apple Music Hip-Hop"), middle dots divide facts, a single trailing period is legal in promo subs. Forced-lowercase meta is retired. ANYTHING STARTING A LINE, and anything after a middle-dot section break, starts with a capital ("Signed out · Reconnect for mail"). Law-tested on subs, metas, and toast receipts.
3. COLORED HIERARCHY SLOTS: one colored fact inside a grey sub (.fact-warn/.fact-good/.fact-red/.fact-sky/.fact-purple, semibold), kickers may take a systemic color, values keep intent colors. One colored fact per sub, no more.
4. BANNERS are the PROMO CARD (Option C, Dave's pick from Apple Music's Find Concerts card): elevated #1C1C1E card, circular gradient icon badge (amber = moved or slipped, yellow = restore, sky = weather, red = failure, green = money, purple = decisions), white nowrap title, grey sentence sub, X where dismissible, actions as full-width grey pills with accent text (quiet variant grey text). Tint washes and left color bars are retired from banners.
4b. IN-CARD ACTION ROWS: a full-width centered text row inside a card is `.row-signout` (red) ONLY for destructive acts; its non-destructive sibling is `.row-act` (accent). Armed-tap confirm stays the pattern for destructive rows. Decision Record's Change It / Delete Decision pair is the reference.
4c. RECORD BLOCK TEXT (Decision Record, 2026-08-18): a record page reads as eyebrow-labeled cards; the primary fact is `.dec-main` (20px semibold white), the reason `.dec-why` (body, second rank), superseded lines `.dec-old` (struck through, tone neutral by law), quiet facts `.dec-meta`.
5. THE NO-WRAP LAW: titles never wrap, they ellipsize (conn-name, lib-name, sched-title, task-title, promo-title, sh2, empty-title, page titles). Subs clamp at two lines. Copy is written to fit.


Approved by Dave 2026-08-18 with the Library chassis (Design 2 + the red energy line) applied app-wide.

## J. The Library chassis (Design 2, LAW for every page)

0. SECTIONS ARE LABELED, ALWAYS (universal sectioning law, Dave 2026-08-18): every group of rows sits under an sh2 head, bold Title Case at the left edge. Whitespace is never the group label; unlabeled gapped clusters are a review-blocking violation. The sh2 right slot carries a count or See All on CONTENT lists only (All Notes · 2); nav and settings sections leave it empty; Decisions never counts (guilt-metric law). One list chassis on every page: same row height, same glyph column, same divider inset. Search lives under the large title on lists that exceed a screen or hold user content; small nav hubs do not get one.

1. Every page carries the sticky bar (shared/PageHeader): transparent at rest; the moment the large title scrolls under it, it condenses into glass with the centered page title, a hairline, and the red energy line. Page actions are circular accent buttons IN the bar, never floating. Back buttons ride the bar.
2. Large titles and search live in the scroll, always in the same slots. Nothing ever collides with the status bar.
3. Navigation and plain lists are FULL BLEED: bare colored glyphs (RowGlyph / lib-row), large names, hairlines inset to the text edge. Cards are retired from lists.
4. Cards survive ONLY for: stat strips and heroes (money, Now), banners and tips, sheets and overlays, and the day-draft proposal card. That scarcity is what makes them read.
5. Section heads are the bold sh2 form: Title Case at 16, count or See All at -16. Type tiles no longer lead sections.
6. Data rows stay full bleed with their own leading column: checkbox (tasks), time column (schedule), colored glyph (everything else), category dots where the category is the datum.

Supersedes the old 25 catalog files as the styling rulebook. Visual truth stays jarvis-design-system.css + uniformity.css + components.css (flagged sections). This document is the rules layer: what every screen must do with those pieces. Once approved, every new screen and every rebuilt screen is gated against this.

## A. Color is systemic, and the palette is FULL

1. FIFTEEN systemic colors: red, coral, orange, sand, yellow, lime, green, teal, sky, blue, indigo, purple, magenta, pink, graphite. The category picker offers all 15; type tiles draw from the same 15 (nav-tile-* expands to cover every one). Nothing that has an identity is ever gray.
2. Category color follows the category everywhere it appears: tile, dot, chip, avatar accent. Same category, same color, every time.
3. Fixed type-tile assignments stay: task blue, event sky, note yellow, money green, person teal, project indigo, goal purple, gym and time orange, insight purple, mail teal, chat and JARVIS-made red.
4. Intent colors: good green, warn amber, error red, info sky. Status always wears its intent color.
5. Every palette color gets a matching TINT token (16% alpha family) for banners, pills, and stat tiles, so tinted surfaces scale with the palette instead of being limited to red, amber, green, sky.
6. Interactive elements wear the accent. Grey is only for secondary text and dividers.

## B. Every string has a role

Legal text roles, and nothing else:

- Page title (nav-large) and eyebrow above it
- Section head: colored tile + Title Case name, count pill on the right when there is a count
- Row: name (conn-name) + meta (conn-meta), meta short with middle-dot dividers, never a sentence
- Urgency span: colored uppercase, never a filled pill
- Pill: status, tier, or count only
- Stat tile: a number worth reading at a glance, tinted by meaning
- Day divider: the day said once above a group, never repeated per row
- Banner title + meta (see D)
- Empty state title + sub (see E)
- Legal pages and onboarding conversation are the only prose surfaces

A string that fits none of these gets restructured, not styled in place. No standalone explainer paragraphs outside cards ("page-explainer" is retired; its content moves into card rows or dies).

## C. Everything actionable is a control

1. Copy that names an action IS the button. "Needs Google setup · Settings, Connections" is illegal; "Open Connections" as a button is the law.
2. Choices are chips. Selected state is the filled chip. Bounded choosers (chat, pickers) are chip rows, capped, with a Never Mind escape.
3. Numbers the user sets are steppers; tapping the number opens the keypad (stepper-tap / stepper-edit).
4. Mode switches are segmented controls. On/off is the switch. Both iOS-native forms.
5. One primary action per surface, in accent. Secondary actions are quiet buttons or chips.
6. Counts render as pills (count-pill amber for pushed or slipped work; pill-blue and friends for status counts). Figures render as stat tiles.

## D. Banners carry meaning

- Amber banner (left bar + warn tint + orange tile + count pill): work that moved without you. Sweep receipt, slipped blocks, overflow. The repeat offender line is warn-colored (slip-warn).
- Accent-bar banner: an offer (Where You Were, weather connect). Leads with the type tile of what it offers. Tappable everywhere, gone the moment the user acts.
- Error form (sweep-error): louder than success, does not animate away, tap to retry.
- Success is quiet; failed automation is loud. Every banner leads with a tile, never bare text.

## E. Empty states

Icon tile + Title Case title + short sub. When an action exists, the button is IN the empty state. An empty state that tells the user where to go instead of taking them there fails the gate.

## F. Feedback

1. Every mutation shows a receipt toast, with Undo whenever undo is possible.
2. Destructive actions arm: first tap flips the button to "Tap Again to Confirm". Hard deletes state their count in the receipt.
3. Provenance is one short line (madeBy/sourceLine), rendered as meta, never a sentence.

## G. Copy laws (already tests, restated as catalog rules)

1. No em dashes anywhere (law-tested).
2. No sentences in rendered strings: no ". " followed by a capital (shortCopy law). Middle dots divide clauses.
3. Title Case for titles, buttons, section heads, with small words lowercase; sentence case only in conversational surfaces (casing law).
4. ALL CAPS only for eyebrows, kickers, pills, urgency, times.

## H. The alignment grid (LAW)

Four locked columns on every screen: page margin at 16, leading tile at 16 (28pt tile + 12 gap), text edge at 56, trailing edge at -16.

1. One text edge per card: tiled cards indent every text to 56; untiled cards all at 16; a card never mixes.
2. Dividers inset to the card's text edge, never full-bleed through a tile.
3. Trailing column: values, times, chevrons, pills share one right edge at -16; the chevron is always outermost.
4. Numbers are tabular (font-variant-numeric) wherever they stack: times, weights, money, counts.
5. Steppers share one fixed width so their values form a straight column across rows.
6. Section heads sit at 16, flush with the card edge; a section's count pill right-aligns at -16.

Plus the iOS baseline: 44pt minimum hit targets, 8/12/16 rhythm, 4pt grid, safe areas, cards elevated, both themes always. Tokens and classes only; no inline styles in app code; new CSS lands in the flagged sections of components.css.

## H2. Title Case, everywhere (law extended)

Title Case: page titles, section heads, row names, buttons, chips, sheet titles, tab labels. Small words (4 letters or fewer, mid-title) stay lowercase: a, an, the, to, of, in, with, for. ALL CAPS only for eyebrows, kickers, pills, urgency. Meta lines are lowercase fragments with middle dots. Conversation (onboarding, chat, check-ins) is sentence case. The casing law test extends beyond buttons to scan section heads, chips, row-name literals, and sheet titles; violations fail the build.

## H3. Cleaner visuals (approved polish set)

1. Depth tokens: one hairline top light and one card shadow token; cards and stat tiles use them, nothing hand-rolled.
2. Stat tile numerals bigger, tabular, tighter letter-spacing.
3. Hero light: daypart gradient wash on Today; day ring becomes a gradient arc with a soft glow, bursts at 100%.
4. Touch: rows compress on press; primary buttons carry the accent glow; native haptic on completion.
5. Glass chrome: tab bar and large-title nav translucent with real blur, solid fallback for older devices.
6. Motion: one spring token shared by banners, sheets, chips; lists stagger on first paint only; numbers roll on change.

## I. Enforcement

- Laws as tests: em dash, shortCopy, casing, CSS-class existence, versioned keys, typed queries, AI gate, editing primitives.
- Lint gate: react-hooks rules (crash class), runs with tsc + vitest + build on every commit.
- Preview discipline: any visual change ships previews at 390x844 first; Dave approves before code.
- The five no-floating-text rules (section B, C) are the sweep checklist for every existing and future screen.

## Approved conversions queued behind this catalog (from the 2026-08-18 sweep)

1. Today header counts become tappable pills (sky events → Schedule, blue due → Tasks, red overdue → Tasks overdue).
2. Weather offer becomes an accent offer banner with the sky tile.
3. Email setup empty state gets the Open Connections button.
4. Destructive warnings move inside cards as warn rows with the triangle tile (Advanced, Backup; Backup's paragraph becomes three rows).
5. Chat tile in More goes red.
