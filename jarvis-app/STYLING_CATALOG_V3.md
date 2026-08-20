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
3. TODAY FOLLOWS THE DAY (V4.4, Dave 2026-08-19: "the order should have the same flow as the day"): hero → NOW (this minute, always first, always carrying an action) → HEADS UP (the one notice stream) → UP NEXT (what's next) → YOUR DAY / TONIGHT (the schedule) → TOMORROW. Nothing about this minute may sit below tomorrow, and nothing else may insert itself.
3a. ONE NOTICE STREAM: every alert, receipt, offer, standing fact, and suggestion renders under the single "Heads Up" head, in fixed priority order (day draft > decision revisit > failed automation > automation receipt > re-flow > overflow > where-you-were > money > email > AI suggestion > fresh start > weather offer). Loose promo cards floating between sections are banned; a new notice joins the stream or it does not ship.
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

## O. The Button Law (V4.3, Dave 2026-08-19: "buttons are not rendering as buttons")

Every tappable action renders as exactly ONE of these, chosen by its slot. A bare unstyled <button> is a design bug.

1. BAR ACTION (.barbtn / .nav-action): icon or text in the nav bar. Page-level create and back live here.
2. PAGE PRIMARY (.btn.btn-primary): the one big red pill. One per screen, max.
3. PROMO PILL (.promo-pill / .promo-pill.quiet): actions inside a promo card only.
4. IN-LIST CREATE (.row-act): centered accent row at the END of its section.
5. ROW PILL (.pill-act): grey pill, accent text, inline in a list row (Nudge).
6. SMALL PILL (.btn-sm): the one small doing-button (Add to Today, Link, Not Now). Always has a pill body: press-3 background, accent semibold text, 34px. Text-only small buttons are illegal; that's the head action's job.
7. HEAD ACTION (.see-all inside .sh2): accent semibold 13px text at the head's FAR RIGHT, after the dotted leader, never mid-head. An action cluster on a head (.sec-left: pause + Schedule) rides the same slot. The quiet variant (dismiss ×) is tx-3.

8. NO DEAD-END SURFACES (the ADHD rule, Dave 2026-08-19: "the more I can do and feel like I didn't have to think, the better"): any card or section that states a fact must also carry the tap that acts on it. Now offers Pick Something / Plan My Day when nothing is teed up; Tomorrow offers Plan It (and Plan Tomorrow when empty); every empty state carries its action (L7). A screen that tells him something and gives him nowhere to go is a bug.
10. THE DECISION KILLERS (Dave 2026-08-19, "I approve whatever you think is best"): four buttons exist purely to remove a choice, and they outrank prettiness wherever they conflict with it. Just Pick One For Me (Tasks' one primary, above the filters: opens the single best task, the list never has to be read). Move All to Today (one tap on an overdue pile, one Undo). Break It Down (splits a big task into 3-4 startable ones; the original is replaced, one Undo restores it; hidden when AI is off so the button never promises nothing). Tappable gaps (open time renders IN the timeline at its own hour, dashed, tap to fill).
11. OPEN TIME IS A ROW, NOT A FOOTNOTE: a gap belongs at the hour it falls, in time order, in the day list. A trailing list of "Open ..." rows under the day is banned in day view (week and month, having no timeline, keep it).

9. A DATE IS NOT A BUTTON: facts render as facts (.n, quiet meta). If a slot is styled like an action it must do the thing its words say.

10. THE CHEVRON IS A DRAWN ARROW, NOT AN ICON. `.chev` is a 7x12 box with two borders rotated 45deg and only renders correctly on an EMPTY element. Putting the class on an `<svg>` draws a rotated bordered box around a second arrow. Twenty-one call sites were doing exactly that. `<div className="chev" />` is the only legal form; `.chev-down` is the disclosure variant. Law-tested.
11. NO TWO CONTROLS IN ONE CORNER. A card with an absolutely-positioned dismiss and a one-row body puts the row's trailing control and the X in the same place. Any card carrying a `.promo-x` reserves the room for it on every row inside, so tap targets can never stack.

Positions are law: head actions right, in-list creates last, destructive actions last on the page (L6). The old icon-tile section head (sec-ico + sec-title) is retired from Today; JARVIS Noticed is a steel head like everything else.

## P. The Schedule (V4.5, Dave 2026-08-19: "still way too difficult to move things around")

1. EVERY EVENT IS MOVABLE, INCLUDING REPEATING ONES. Repeating events used to be excluded from every quick action, which is exactly why "locked in" things felt welded to the calendar. Moving a SERIES by accident is the danger; moving ONE DAY of it is not. A move on a repeating event splits that occurrence off (addExdate + a standalone copy), says "just today" in the toast, and leaves the series untouched.
2. MOVEMENT GOES BOTH WAYS. Until this pass nothing in the app could move an event EARLIER: every control only pushed later. The rail is −15m · +15m · +1h · (Tomorrow, or Skip today when repeating).
3. SKIP IS NOT DELETE. A repeating thing you are not doing today gets skipped for the day from the row itself; the series never notices, and Undo restores it.
4. THE CATEGORY BAR: every event row on every surface (Schedule day list, Today's Your Day, Today's Tomorrow) carries a 4px category-colored bar at its left. The dot on the meta line stays because it carries the NAME; the bar carries the signal you read without reading. A new event row without the bar is a bug.
5. TAP THE TIME, CHANGE THE TIME. The time on a row is its own control and opens a time input in place. Changing when something happens must never cost the whole editor.
6. EVERY MOVE IS UNDOABLE. Shift, move-to, skip, push-to-tomorrow: each returns one Undo that restores the exact prior state, including un-splitting a repeating occurrence. Moving things is only relaxing if getting it wrong is free.

## Q. Reminders (V4.6, Dave 2026-08-19: "taking meds should just be a set reminder")

1. A REMINDER IS NOT A TASK. It rides the task entity for storage (the bill trick, no registry migration), but behaviourally it is its own thing: it never enters a task list, never enters Up Next, never counts toward the day, and is never "overdue". Presence of `reminder` is the one switch every carve-out checks, filtered at `partition()` and `rankOpen()`.
2. DONE IS DERIVED, NEVER STORED. A reminder holds the last date it was ticked; done means that date is today. Nothing runs at midnight, no job resets anything, and a device asleep for three days wakes showing the truth. A stored boolean would need a resetter, and a resetter that never runs is how a med tracker silently lies.
3. MISSED IS NOT LATE. A reminder whose time has passed marks its TIME, never the row, never red, never a count, and never a second notice card. It is information, not an accusation.
4. ONE PLACE PER SCREEN. The strip is the reminder surface on Today. A missed reminder does NOT also get a Heads Up card: the same item twice on one screen is the floating-notification problem this app just spent a round removing.
5. TWO TAPS TO MAKE ONE: name, time, cadence. No category, no duration, no end date, no project. Every field the task sheet has and this one does not is deliberate.
6. SNOOZE IS SAME-DAY ONLY, stored with its date and clamped inside the day, so last night's snooze cannot move this morning's ping.
7. THE CALENDAR HANDOFF (Dave 2026-08-19: "whatever you can within the iOS"). A web app cannot fire its own alarm: the Notification Triggers API was abandoned and ships in no browser, and iOS web push needs a Home Screen install plus a server awake at the right minute. So JARVIS does not pretend. It says so in plain words on the reminder sheet and hands the job to the scheduler already on the phone: an iCalendar file with an RRULE and a VALARM, which iOS fires forever, offline, with JARVIS closed. Times are FLOATING (no Z, no TZID) so 8am meds stay 8am in a new timezone. UIDs are stable so re-adding updates instead of duplicating. Every reminder ships in ONE file so adding them all is one tap.
8. NEVER LET A REMINDER LOOK LIKE IT WILL PING WHEN IT WILL NOT. Any surface that creates a reminder must either deliver the alert or say, in the same breath, that it cannot and offer the thing that can.

## R. The Notice Law (V4.7, A1 approved by Dave 2026-08-20)

Every card in Heads Up is built ONE way. This exists because the stream had drifted into nine shapes: promo cards with two pills, plain rows with a chevron, a suggestion row with a corner ×, and a money line with nothing at all.

1. THE ANATOMY: colored glyph, the words, and EXACTLY ONE control on the visible line. The control is a `.pill-act` when the notice does something, or a `.chev` when the whole row opens a screen. Nothing else sits on that line, ever.
2. DISMISS IS A SWIPE. The corner × is gone app-wide, enforced by law test (`no card carries a corner dismiss`). On a one-row card the corner and the row's right edge are the same place; two tap targets stacked on each other is worse than ugly, it makes you hit the wrong one.
3. THE SECOND PATH RIDES THE SWIPE. When a notice genuinely offers two choices (Still Good / Change It, Undo / Set Aside), the primary is the one you can see and tap without deciding. The alternate sits on the reveal beside Dismiss.
4. NO DEAD ENDS. A notice with no control is a statement you can only read. The bill card got Mark Paid for exactly this reason. If JARVIS is going to interrupt, it brings the way out with it.
5. THE CARD IS OPAQUE AND ABOVE ITS OWN REVEAL (`z-index: 1`, solid `--surface-1`). The glass `.card` is translucent; without this the hidden Dismiss button prints straight through the row and reads as two labels on one target.
6. TITLES GET TWO LINES. "Complete Your Enrollment" truncated to "Complete Your Enr..." throws away the one thing the card exists to say. A second line is cheaper than a card he has to open to understand.
7. ONE COMPONENT, `today/NoticeCard.tsx`. A notice hand-built out of divs is a review-blocking violation; that is how the drift happened the first time.

## S. Email on the Home Page (V4.7, Dave 2026-08-20: "it serves absolutely no purpose")

He was right. "14 emails need you → Deal with it here" was a number and a link to somewhere else. It told him he was behind and then made him travel to find out what about. A guilt counter, not a feature.

1. THE COUNT IS NOT THE HEADLINE. It survives as a footnote at the bottom of the stream ("5 More Emails in Your Inbox · Nothing in there is urgent") and nowhere else.
2. FOUR DIFFERENT JOBS, NEVER THE SAME JOB THREE TIMES. `deadline` (a sender named a date and the date is now → Add Task) · `reply` (the single thread that most needs an answer → Reply) · `promised` (something HE said he would do, in his own sent mail → Add Task) · `nudge` (someone who owes HIM, and has for days → Nudge). One of each before a second of any.
3. TWO OF THE FOUR FINISH ON TODAY. Add Task writes the task and the card clears. No navigation, no inbox, no second decision. The other two open EXACTLY the thread, never the inbox he would then have to search.
4. NOTHING IS INVENTED. Deadlines come from what the sender wrote (`by`, never a guess), promises from his own outgoing words, waits from a thread whose last message is his. An unreadable AI reply means no notice, not a fabricated one.
5. TODAY NEVER WAITS ON THE NETWORK. The Email tab leaves a snapshot behind; Today reads it instantly. A snapshot older than 36 hours is dropped rather than shown as current.
6. DISMISSALS LAST THE DAY, NOT FOREVER. A swiped notice is "not now", and the email is still sitting there tomorrow.
7. THE PROMISE SWEEP is the half the commitment catcher could not reach: promises made in the Gmail web client, on his phone, or before JARVIS existed. One capped AI pass, and only when new mail has actually gone out since the last one.

## T. The Number-Lead Capital (V4.7, Dave 2026-08-20, caught on "14 emails need you")

1. When a number leads a line, the first word behind it that can carry a capital gets one. `14 Emails Need You`, `55 Days · No reply`, `3 More in Anytime`.
2. ONE EXCEPTION: a small connecting word sitting BETWEEN two numbers is part of a compound quantity, not a sentence start. `2 of 5 Done`, not `2 Of 5 done`.
3. MEASUREMENTS ARE EXEMPT. `135 kg × 8` stays lowercase; a capitalized unit is wrong, not stylish.
4. The rule lives in `shared/casing.ts` and is applied by the STRING BUILDERS, never at render. Magic in a wrapper component cannot be tested and drifts the moment the same string renders somewhere else. Enforced by law test.

## U. Plan My Day (V4.8, Dave 2026-08-20: "look at how limited this still is")

Three things in it were plainly broken, and the rest made him do the planner's job.

**The bugs.**

1. IT LIED ABOUT WHICH DAY IT WAS PLANNING. The eyebrow and the question were hardcoded to today while every input behind them flipped to tomorrow, so Plan Tomorrow at 10:54 PM offered a 1 PM slot and read as a bug. The sheet is now TOLD which day it is filling (`date`, `dayLabel`, `target`) and says so, and Today/Tomorrow is a visible control in the sheet rather than hidden state chosen a screen earlier.
2. FIVE ROUTINE ROWS BECAME ONE. Three of them existed to say when he eats. The fold names the focus zone and summarises the rest; the detail is one tap away.
3. THE PLAN HE ALREADY MADE WAS INVISIBLE. The list correctly drops anything already scheduled and said nothing about it, so a planned day looked like an empty one. `alreadyPlanned` names them.

**The laws.**

4. THE SHEET SAYS HOW FULL THE DAY IS, BEFORE HE COMMITS. Open minutes, picked minutes, and the over-run, derived from the same inputs the planner used so the number can never disagree with the plan. A focus block counts as OPEN (it is where picks are meant to go) and meals count as open (saying "you have no time" because dinner exists is a lie).
5. WHEN IT DOES NOT FIT, IT SAYS SO WHERE THE PICKING HAPPENS, with the fix in the same breath. It used to appear as grey text at the very bottom after the damage was done. Dropping takes the LAST picks, never the first: pick order is priority order everywhere else in this sheet.
6. NO STAT WITHOUT A HANDLE. "Lately · 2 of 7 picks done same-day" told him he was failing, directly above the thing he was about to fail at again. The same measurement pointed forward is a setting: "You Finish About Two a Day · Want me to plan for two?"
7. THE PRIMARY IS NEVER A CHORE. It said "Pick your tasks", which is the app telling him to do the work it exists to do. Nothing picked now means one tap plans the whole day: **Plan It For Me** selects, sizes, orders and places, then hands back Accept / Change It. The old AI button only estimated LENGTHS for tasks already picked by hand, and picking is the hard part.
8. SILENT INTELLIGENCE READS AS NO INTELLIGENCE. The planner has always used his chronotype and peak window without ever saying so. It says so now.
9. ONE PICK SHOWS ITS CONTROLS AT A TIME. Length chips plus a time field under every pick turned three picks into six hundred pixels of chrome. Tapping the row picks or unpicks (one tap either way, so "no, not that one" never costs two); tapping the time chip opens that pick's controls.
10. UTILITY CONTROLS SIT BELOW THE LIST. Above it, Done By and Add pushed the actual tasks off the bottom of a 390px phone: a planning sheet whose main job you had to scroll to reach.
11. LENGTH IS CHIPS, NOT A STEPPER (45m to 2h was five taps), and the chips WRAP rather than scroll. The live number shows only when no chip can say it, since a learned or AI length is any number of minutes.
12. A THREE-HOUR TASK IS NOT A THREE-HOUR SITTING. Anything past two hours is offered as two sittings; the split rides synthetic ids (`taskId#2`) and collapses back to the real id at commit, so it adds no new placement path.
13. A DAY THAT WORKED CAN BE REUSED, RHYTHM ONLY. Shapes are recorded at COMMIT from the blocks that actually committed. "Worked" means MEASURED: only a day whose own outcomes say every pick landed is offered as one that worked; anything else is offered by its weekday and named as such. `plan.outcome` now carries its day so this can be asked at all.
14. PICK BY FEEL. Something Quick, The Hard One, Moves a Goal. Deterministic (tapping twice is not a slot machine), never returns something already picked, and a button that would do nothing is not shown.
15. A DEAD DAY SAYS SO. Under an hour left and the sheet stops asking "what fits today?" and points at tomorrow.
16. A REMINDER IS NEVER A PLAN CANDIDATE (catalog Q1, violated here since reminders shipped). "Morning Meds" sat under Anytime asking for a 45-minute block. Now enforced by law test across every list that offers work.

## Approved conversions queued behind this catalog (from the 2026-08-18 sweep)

1. Today header counts become tappable pills (sky events → Schedule, blue due → Tasks, red overdue → Tasks overdue).
2. Weather offer becomes an accent offer banner with the sky tile.
3. Email setup empty state gets the Open Connections button.
4. Destructive warnings move inside cards as warn rows with the triangle tile (Advanced, Backup; Backup's paragraph becomes three rows).
5. Chat tile in More goes red.
