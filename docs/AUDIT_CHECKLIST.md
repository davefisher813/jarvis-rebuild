# THE AUDIT CHECKLIST

One list. Everything an audit of this app covers, in the order it gets done,
with what is finished and what is not. Updated with every push so nobody has
to ask what state it is in.

Started 2026-09-20 after the fair complaint that there was no list and each
question was getting its own one-off scan.

**Rule for this file: an item is DONE only when it is measured, fixed, gated
and pushed. "Scanned it" is not done. "Looks fine" is not done.**

---

## PHASE 0 · THE TOOL ITSELF

The audit is only as honest as the thing running it. Every number quoted
before this phase was a screens-only number.

- [x] **Merge the backlog, clear the branch** · `42475ab`
- [x] **The auditor opens sheets and modals** · `6cf1026`
      11 screens/pass to 22. It walks four tabs, the More rows and three
      detail rows each, and now every sheet reachable from them.
- [x] **A layer is the subject while it is up** · `0e3b5a9`
      Auditing inside a sheet was measuring the page underneath it. Same
      pass, 38 findings to 7. Thirty-one were the page showing through.
- [x] **The auditor knows the Tap Ladder** · `305e6c9`
      Chips 28, capsules 34, rows 44, buttons 50. 77 flat-44 findings became
      21 real ones.
- [x] **The auditor knows the two contrast rulings** · `1f11a61`
      The glyph bar (catalog L6) and the Astra palette. It was reporting
      Dave's own decisions as defects.
- [x] **Report the gap** · every run names what it could not open or close.
      This is how the missing More section was found.
- [ ] **Drive empty, error and loading states** · the auditor cannot reach
      them by walking. Needs deliberate seeding. (Phase 3)
- [x] **The auditor gets inside a live workout** · 6 screens nothing had ever
      measured: Health, the program, the time sheet, the session, the session
      one set in, the finish receipt. 25 findings on those six alone.
      **Three separate reasons it had never got there, each one enough on its
      own.** (1) `DIVE_SEL` matched ZERO elements on the Life tab, because an
      area is a `.area-card`, not a `.row` — so the tab dive added the day
      before walked straight past the one tab that is a hub. (2) A live
      session is four taps deep through four different kinds of control, and
      starting one MUTATES state, so it needs its own hand-driven walk that
      runs last in the pass rather than a generic dive. (3) The demo seed had
      no program at all: it wrote fourteen finished sessions with
      `exercises: []` against a program id no program had, so Health read
      "Set Up a Program / 0 Days" and **Start was not on the screen**.
- [x] **Say whether the build under the tool had any data in it** · a plain
      `npm run build` drops every seed (`__DEMO_SEED__`, on purpose, so demo
      names can never ship), and the auditor had no idea. Every report it has
      ever printed may have been an audit of empty states. It now checks for
      the `DEMO_BUILD` marker on :4173 and says which kind of run it was, at
      the top and the bottom. `npm run audit:build` produces the right one.
- [x] **The under-bar check honours the modal root** · it was the last check
      still reading the whole document, so with a sheet up it measured the
      sheet's own buttons against the page's fixed bars under the scrim. The
      finish receipt's "Done" and "Keep Training" both came back as hidden
      behind the log bar they sit on top of.

## PHASE 1 · GEOMETRY AND COLOUR  ·  18 distinct findings to 2

- [x] **320px retired** · `305e6c9` · Dave's call. Seven of the eighteen
      findings lived only there, including every truncation in the app.
- [x] **Truncation** · 2 fixed (`b84c911`), 0 remain at 390/430/834.
- [x] **The Schedule row at 1.4** · 2026-09-21, three separate failures of
      "everything should auto scale", all of them a number measured once at
      the default text size and written into the stylesheet.
      `.sched-time` was `width: 62px`, so at 1.4 an 11:30 AM wanted 77 and
      painted fifteen pixels of itself into the title beside it. It is
      `calc(62px * var(--type-scale))` now, like every other size in that
      file.
      The meta line was `flex-wrap: nowrap` with the place "ellipsizing into
      whatever is left", which is right until nothing is left: the row read
      "FIXED · Family ·" with a separator, a space and no address, 99% of
      "Ridgeline Fields" gone at 1.4 and 68% gone at the default size. Each
      fact carries its own separator now (`.sched-fact`), so the line wraps
      BETWEEN facts and a separator can never be the last thing on a row.
      And the Now rule put NOW, Live, the hairline, Running Late? and the
      clock on one nowrap row, so at 1.4 the clock painted past the right
      edge of the screen. It wraps, with the button ordered last: the rule,
      the word and the clock stay together and the action takes the second
      line.
- [x] **Tap targets under their rung** · `305e6c9`
      21 head capsules at 28 where C1 says 34; `.opt-done` at 44x18, under
      the broken floor, the only way out of an Options sheet.
- [x] **Swipe rails** · `db8cb16` · Delete on every row that owns a record;
      the schedule rail counted its buttons instead of hiding them.
- [x] **Red on a press fill** · `.pill-act` settled 2026-09-21 (option D: red
      ring, white verb; 19.10:1 on glass, 13.94 raised). `.row-act` in light
      is still open at 4.07:1. See OPEN DECISIONS 1.
- [x] **Light tab bar** · `db8cb16` · 99 findings, one token.
- [x] **The six live-workout screens** · 2026-09-21, the first time any of
      them was measured. Every one of these was a real defect and none of
      them was reachable by the tool before this week:
      **The week strip's day buttons were 43x27** on a quiet week, because
      the bar's height IS the datum -- so the strip also changed height as
      workouts landed. A min-height holds it open for the tallest bar it can
      draw and every day is tappable on the quietest week of the year.
      **The program's day rows were 42px inside a 66px row.** `align-self:
      stretch` only reaches the row's content box, so the fix is the row's
      padding moving onto the only child bound to the tap. Same size on the
      screen, twelve more pixels that work, top and bottom.
      **Basis sat 10px inside the Log pill's hit area.** `.pill-act` buys its
      34px touch height from 9px transparent borders pulled back out of the
      flow, so two pills an 8px gap apart overlap by ten: the bottom of "Log
      275 lb x 5" opened Basis. Three pills are one row of actions anyway.
      **The Match shortcut logs a set from a 16px line.** It takes eight
      pixels of the ghost row's own spare padding, which is the 24px floor;
      44 is impossible there (one pixel separates it from the weight field)
      and Dave named it a rung rather than leave the auditor reporting a
      decision as a defect for ever.
      **The log bar covered the last set row AND the Undo toast.** The foot
      under it was the generic 32px against a bar nearer 90, and the toast
      docks in the shell's footer stack which a fixed bar paints straight
      over -- so the five second Undo timer ran out on a control the finger
      could not reach. No number typed in a stylesheet is right for every
      text size and every phone, so the bar measures itself and publishes
      `--logbar-clear`, the way the writing bar already did
      (`shared/useBarClearance.ts`, now one implementation for both).
      **A head action's 44px box reached 6px onto the card below it.** The
      payback was split evenly; it goes upward now, into section spacing,
      which has the room to give. Same layout to the pixel.

## PHASE 2 · WORDS  ·  next

- [x] **Subtext sweep** · all 253 read in context against the empty-database
      test. The app's subtext was in good shape: ONE manual in the whole app,
      the weather offer's "One line each morning, only when it matters", which
      also never rendered. The COVERAGE was the real gap and is closed: the
      law watches the prop route and the full class census now, and is proven
      to bite on the line it was widened for.
- [ ] **Settings switch descriptions** · 8 of them, a separate class from a
      row's fact line: a toggle has to say what it does. Deliberately left out
      of the no-manual law; decide whether they get a rule of their own.
- [ ] **Empty-state copy** · exempt from the no-manual law by design; never
      reviewed on its own terms.
- [ ] **Error and toast copy** · never reviewed. Does each one say what
      happened and what to do next.

## PHASE 3 · THE STATES NOTHING HAS LOOKED AT

- [x] **Empty states** · L7 ("an empty state always carries its action") is
      stated three times in the catalog and was enforced nowhere.
      **Corrected 2026-09-21: the first version of this law under-counted by
      almost half.** It took a 1400-character slice per empty state, which ran
      past short ones into whatever followed, so a dead end sitting above a
      list of tappable rows scored as having an action. Counting div depth
      finds 41, not 22. Fixed: New Project, New Goal, two fake "Loading..."
      states turned into skeletons, and TWO raw-JSX paragraphs on Strands (the
      second missed first time because it had no .empty-title).
      **Debt, named, 14 left:** empty states whose action lives on another
      screen and needs a callback plumbed. The law pins the count.
- [x] **Loading and skeletons** · every empty state checked for whether it
      can paint while a load is in flight. Two fakes found and fixed (titled
      with the literal word "Loading..."). "Reading Your Inbox" looks like a
      third and is not: a deliberate progress screen carrying a live
      "N of M sorted" count, built after an open-ended wait felt broken. The
      16 real SkeletonRows uses are correct.
- [x] **Toasts** · 60 report a removal; 52 already carried Undo, which is why
      the eight that did not were invisible. Two of the eight were shipped by
      the swipe work the same morning: a swipe on a repeating row wrote an
      exdate and offered no way back. Both now call removeExdate, the exact
      inverse. The other six are correct and rostered with reasons. Law with
      an exact roster, and it checks the handler, not just the word "Undo".
- [x] **Offline** · no findings, and it is one of the better-built parts:
      data/offlineSync.ts queues on a network-class failure the browser does
      not report (iOS onLine only flips when no interface is up at all),
      retries on a backoff, drains the separate health queue on the same
      events, drains a queue restored from a killed session, and names a
      conflict in a toast rather than silently keeping one side.

## PHASE 4 · REACH AND INPUT

- [x] **Keyboard: Escape closes the top layer** · useSheetEscape keyed on
      .sheet-scrim, which is 66 layers and not all of them. SIX were not
      scrims and ignored Escape entirely: Search, Fresh Start, What Now, the
      schedule guard, and the two menu scrims. One listener now takes the
      TOPMOST layer in document order, so a sheet over an overlay closes
      first, and each full-screen layer marks its exit with data-layer-close.
      Verified in the built app: What Now and Search both close on Escape and
      demonstrably did not before. Law holds the roster both ways.
- [x] **Keyboard: focus enters, stays, and comes back** · measured by driving
      the built app, not by reading it. Before: focus never entered a layer,
      10 of 14 tabs escaped the New Event sheet into the Day/Week/Month
      control behind it, 13 of 14 escaped What Now into the tab bar, and
      closing left focus on the body or somewhere arbitrary. A keyboard user
      was pressing things they could not see. After: focus lands on Cancel
      and on Close, 0 of 14 tabs escape either, and Escape puts focus back on
      the exact control that opened the layer. One hook beside the Escape
      one, reading the same exported roster so the two cannot drift.
- [x] **VoiceOver names** · asked of the RENDERED page, in the auditor, not
      of the source. The static version of this question in the button audit
      reported 208 nameless controls and every one was false. The runtime
      check found ZERO across 22 screens and their sheets, and that result was
      verified rather than believed: a nameless icon button injected into the
      page is caught and nothing else is.
      The second half is the one that had findings. "Delete" is a name but not
      an ANSWER on a list: on the web build a rail's buttons are siblings of
      the row, so a screen reader hears "Delete" with nothing saying which.
      Twelve controls passed the record's name and five did not. The task row,
      both note rails and all three mail rail actions now name their record;
      three single-record screens keep the bare verb and say why.
- [x] **Focus order and visible focus** · the auditor grew a `FOCUS=1` mode
      that tabs every screen and reports four kinds: `no-ring`,
      `ring-clipped`, `focus-unscrolled`, `focus-backwards`. Verified before
      it was believed, the way the `no-name` check was: a ringless control and
      a control inside `overflow: hidden` injected into the page are both
      caught, and a clean one beside them stays clean.
      **The starting suspicion was wrong and is written down so nobody
      re-runs it.** The computed outline on a focused control reads
      `auto 1px rgb(16,16,16)`, which looks like a near-black ring on a
      near-black app. It is not: Chromium's `outline: auto` is drawn specially
      and inverts per backdrop. Screenshotted, it is a WHITE ring in dark and
      a black one in light. The ring is fine, and `:focus-visible` appears
      nowhere in the app because it does not need to.
      **Three of the first four findings were the tool's own arithmetic**, and
      each was chased rather than triaged: viewport y is not position (tabbing
      below the fold SCROLLS, so the next control reads a smaller y); adding
      the scroll back puts an element in its own scroller's frame, and
      `.app-scroll` and the toast dock are two different frames; and a fixed
      control does not scroll at all. A fourth was mine: `blur()` does not
      reset the sequential focus starting point, so the audit had been
      starting mid-page. All four fixed, and each is pinned by a law.
      **Two real findings, one cause.** The Tracker's "Subscriptions" segment
      sat 98px outside its segmented control and Chat's "Complete..." starter
      75px outside its `.chip-row`, both AFTER the browser focused them: the
      browser's scroll-on-focus does not reach a horizontal scroller nested in
      the page scroller. One document-level hook, `useFocusReveal`, mounted
      beside `useSheetEscape` and `useLayerFocus`, fixes every scrolling row
      the app has or grows. It measures first and centres, because `inline:
      "nearest"` is a no-op on a row carrying `scroll-snap-type: x` (verified:
      scrollLeft 0 before, 0 after).
      **And a third thing fell out of it.** That segmented control shipped as
      `Dashboard | Transactions | Budgets | Su`, cut mid-word at the screen
      edge with nothing saying more existed, which is word for word the bug
      the chip rows were fixed for on 2026-08-02 in a control that was never
      given the fix. It now wears the same edge fade, rendered in Chromium
      before it was kept as that note requires. Clean at 390 dark, 390 light,
      430 and 834.
- [x] **Dynamic Type** · and the line that used to sit here ("the app pins
      nothing") was wrong. `appearance/textZoom.ts` clamps `--type-scale` to
      1.0-1.4, reads the phone's own text size, offers an override in
      Settings, and every named type token multiplies by it. What had never
      happened was LOOKING at the top of that range.
      The auditor grew a `scale` per pass and 1.4 found **8 findings on
      Dave's own 390px width**, six of which were the same elements that
      "only existed at 320" - the width retired the day before because nobody
      uses it. Larger text in a fixed width is the same arithmetic as fixed
      text in a narrower one, so dropping 320 had hidden those six rather
      than removed them.
      All 8 fixed, and every one by letting the layout give rather than by
      pinning a size, per Dave: "everything should auto scale". The search
      field may shrink (Cancel was painting to x=468, off a 390px screen);
      a form row's label states itself whole and the VALUE yields, which is
      the control already built to; and four titles that are copy this app
      wrote take a second line instead of a clip - which is the no-wrap law's
      own stated exception, already written twice in components.css.
      **Nothing moves at scale 1**: the whole matrix is unchanged there.
      1.4 is now a standing part of the matrix, so all six sizes run twice.
      834 at 1.4 found nothing and stays anyway; "this pass is unlikely to
      find anything" is the exact reasoning that hid the other six. Nine
      laws in `browserWalk.test.ts` hold the fixes and the matrix itself.
      **A ninth finding, found by LOOKING**, after twelve clean passes: the
      capture bar. `.voice-hint` had no `min-width` and no `nowrap`, so at 1.4
      "Add anything" wrapped to two lines and painted across the JARVIS
      wordmark and past the pill's right edge, on the one piece of chrome
      that is on every tab. An ellipsis was tried first and was measurably
      worse: the auditor then read "Add anything" losing 48% on ten screens,
      which is a two-word sentence shipping as "Add ...". The pill wraps
      instead, so the bar is one row taller at 1.4, keeps every word, and is
      identical at scale 1.
- [x] **The auditor cannot see text that escapes its box** · closed, and it
      paid for itself the same day. `outside-box` reports a text leaf painting
      outside its nearest ancestor with a PAINTED background, because "its
      box" cannot mean its parent (half the spans here sit in a bare div, and
      escaping one of those is what normal text flow looks like). The walk
      stops at the first scrollable ancestor, since content outside a scroller
      is the whole point of a scroller.
      Verified rather than believed: the capture-bar fix was reverted and the
      check reported it on all 11 screens it appears on, then restored.
      **Zero noise at scale 1** across the whole app.
      **It immediately caught a regression I had introduced** in the Dynamic
      Type pass: holding the form label at `flex: 0 0 auto` without letting
      the value shrink just moved the overflow, and at 1.4 "At a Date and
      Time" ran 17px past the card and off the screen, chevron and all,
      because `.dd.dd-value .dd-w` capped itself at `52vw` -- a viewport
      number doing a flexbox job. The row bounds it now, and wraps to a second
      line rather than losing a quarter of the answer.
      **Two more instrument fixes fell out of it.** `truncated` was blind to a
      flex item that lost a shrink fight: its content box is smaller, so the
      text lays out at THAT width and `scrollWidth` comes back equal to
      `clientWidth`. It now measures against an off-screen ruler at
      `max-content` when scrollWidth has nothing to say. (`getComputedStyle().
      font` is an empty string in Chromium for most elements, which silently
      left the first ruler measuring at 16px; the longhands are used instead.)
      And `small-44` was calling a 220x24 dropdown value too small when its
      ROW forwards taps to it -- right about the pixels, wrong about the app.
      `forwardTo` was a React prop with no DOM trace; `Row` writes it as
      `data-forwards` now, the same string the pointer handler uses, so the
      tool resolves the real target the way the row does.
      Known and NOT fixed, Dave's call: at 1.4 the New Reminder sheet title
      reads "New Remind...". The ruler says the string wants 196px in a 195px
      box, so it loses two characters to the width of the ellipsis glyph
      itself, not to a missing word. Below the 15% bar and left alone.

## PHASE 5 · THE SCREENS NOTHING HAS REACHED

- [x] **Bigger Picture** · it was in Life the whole time. Not renamed, not
      moved, not gone: it is Life's Projects and Goals lenses, behind a
      SEGMENTED CONTROL, and the crawler did not know a segmented control was
      a control. One tab, five screens, and it audited one of them. It walks
      every segment of every tab now (`segmentsOf`), which also picked up
      Life's Tasks and Reminders and Schedule's Week and Month.
- [x] **Settings > Categories** · never missing, never looked at. The dive
      took the first THREE rows of every screen, silently, and Categories is
      the fourth row of Settings. The cap is named, tunable (`DIVE_CAP`,
      default 6) and reported: every row it skips now prints in the gap list
      at the foot of the run, the way every other gap does. A `DIVE_CAP=30`
      pass covers Settings' eighteen sub-pages when the long tail is wanted.
- [x] **The count, before and after** · 11 screens a pass when this phase was
      written, 28 once the live workout was reachable, **43** once segments
      and the dive cap were fixed. The screens that were "unreachable" were
      the tool's blind spots, not the app's.
- [ ] **Anything else the crawler names as unreachable** on its next run.

## PHASE 6 · BEHAVIOUR, NOT PIXELS

- [ ] **Every destructive action has an Undo** · spot-checked, never swept.
- [ ] **Every write has a failure path** · `attemptWrite` is the pattern;
      confirm nothing bypasses it.
- [ ] **Orphan sweep** · deleting an area was leaving 34 rows pointing at
      nothing (`645c990` fixed the cause). Other parent/child pairs unchecked.
- [ ] **The 34 rows already orphaned in the live database** · Dave's call on
      where they belong; not a migration's.

---

## OPEN DECISIONS

Anything here blocks an item above and needs Dave, not a guess.

1. **Red on a press fill.** ~~Accepted and recorded 2026-09-20~~ ·
   **SETTLED 2026-09-21 for `.pill-act`: option D, red ring and white verb.**

   The 2026-09-20 note read the trade as "darken the red or live with 4.49",
   and on that framing accepting was right: Dave had ruled against a third
   darkening twice. What it missed is that the pill's own 6% white wash is
   what costs the contrast, so there was a third road. Getting inside a live
   workout put the same finding on twelve screens at once (Today, Notes,
   Money, the Tracker, the session) and made it worth measuring properly
   instead of filing.

   Four treatments were rendered through the real stylesheets with their
   measured numbers under them, which is how the writing-bar decision was
   made and is the standard now. As it ships: 4.50 on a glass card, **3.12**
   raised. Outlined with red text (the row-pill option Dave picked on
   2026-08-21, applied here): 5.15 / **3.76** -- still failing, which is the
   result that killed the obvious answer. White verb: 16.70 / 11.58. Red ring
   plus white verb: **19.10 / 13.94**, and red still says the pill is a verb.
   Dave picked the last. Light gains too, 4.51 to 5.26, though it never
   failed.

   **Still open, and narrower than it was:** `.row-act` in LIGHT reads 4.07:1
   over press-3. It is a full-width text row, not a pill, so a ring is the
   wrong shape for it and D does not carry across. Its own answer is owed.

2. **The 34 orphaned rows** in the live database. Where they belong.
