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
- [x] **Truncation** · 2 fixed (`b84c911`), 0 remain at 390/430/834. **Richer
      demo content brought it back, 2026-09-22:** More > Notifications'
      `.msg-name` fix (this same line) had gone dead -- the class it targets
      is never rendered, so the two-line rule it names never applied and
      titles clipped again; fixed by targeting the class the row actually
      carries. A `.fact-link` chip with no length bound could claim a whole
      Decisions row before the date after it got any width to shrink from,
      losing up to 79%; capped to its own share. Three Brain "This Week"
      tiles read equal-flex widths for unequal-length words at 1.4 scale;
      wrapped, like `.voice-hint` already does for the same class of fixed
      app copy. Readiness-row labels are a closed set of app-written
      sentences read as arbitrary world text; they get the two-line
      treatment `.dec-name` already has. Settings' longest Menu label (Who
      Can Book) fought its own dropdown for width at 1.4 scale; the label
      states itself whole now, scoped so a row that also carries a meta line
      is untouched (freezing that case would have pushed the dropdown off
      the row entirely, the same failure this fix was built to prevent).
      Notes' `.task-name` carries the identical 2026-08-21 exception its
      previous row shape had, which never followed it when Notes moved onto
      `.task-row`. Left for Dave, each a design call rather than a bug: the
      Move headliner's title (a hand-rebuilt row that never got the shared
      component's adaptive layout, a §R.7 violation); the "Needs You" head
      against its own Sweep pill; ordinary `.task-name` truncation on real-
      length titles in Life · Tasks; a Switch row's label against its fixed
      51×31 toggle; a reminder row with both a time gutter and a Snooze pill
      compounding at 1.4 scale.
- [x] **The Schedule row is two lines now** · Dave's pick 2026-09-21, from
      four layouts rendered in the real app on his own day at both text
      sizes. The row was five columns -- rail, star, a 62px time gutter, the
      body, a 44px chevron -- and the body got **152px of a 358px row**. Two
      of four titles cut at the default size; at 1.4 the meta took three
      lines under a title cut to "Drive to...". Reclaiming the chevron and
      the gaps bought 24 pixels and did not fix it, which is what the
      comparison was for: B looked plausible and was not enough.
      The time, the star and the chevron take one line; the title and its
      facts take the next at the row's full width. Every title on his day is
      whole at both sizes and the meta is one line at both. It costs about
      30% of the row's height.
      The rail leads the row now, so the `--sched-lead` machinery goes with
      the bug it existed for: it was there because the rail sat PAST the time
      gutter and a Remember star pushed the gutter right and left the rail
      inside the digits. There is no gutter to sit past. The law kept its job
      and changed its sentence.
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
- [x] **Settings switch descriptions** · 2026-09-22. The "8" was stale: five
      switches in `NotificationsPage.tsx` had no description at all (every
      other switch in `src/settings/` already carried one), each now reading
      the real, traced effect of its own toggle rather than a paraphrase of
      its label -- Overdue/Goal nudges are in-app-tab-only and say so; Rest
      timer reuses the exact string `HealthSettingsPage.tsx` already uses for
      the same underlying field, so the two controls for one setting agree.
      Whether they get a law of their own (§AK already reaches the `meta=`
      prop, per `typeLaw.test.ts`'s EXPLAINING regex) is still open, named
      here rather than decided unilaterally.
- [x] **Empty-state copy** · 2026-09-22, read on its own terms for the first
      time: ~40 sampled across the app, most already good and left alone
      (Health, Gym, Money's top-level states, Decisions, the review module).
      Four real defects fixed: Tasks' `EMPTY_TITLE` map rendered sentence
      case while every sibling Life lens is Title Case, invisible to the
      casing law because the title is a dynamic lookup, not literal JSX;
      Reminders showed one generic title for all four of its views where
      Tasks (its structural sibling) already writes one per filter; Strands'
      "A detector lands here as it nears its gate" was the one place
      internal engineering vocabulary ("detector", "gate") leaked into
      user-facing copy; Money's Tracker still had a live, reachable
      "Nothing here yet" — the exact generic-filler pattern already fixed
      once elsewhere, now reading "No accounts yet" like its siblings.
- [x] **Error and toast copy** · 2026-09-21. All 142 distinct toasts read.
      **Every failure toast now names what happened AND what to do next**;
      the one without a dot-break carries a Retry button instead, which is
      the same promise made with a control.
      The sweep found one failure with FIVE spellings across six files: a
      photo the app could not read was "Couldn't read that · Try a clearer
      photo", "Couldn't read that image", "Couldn't read that image.",
      "Couldn't read that photo · Try clearer" and "Couldn't read that
      receipt", depending on which upload flow you were standing in. Two of
      those are genuinely different failures -- the model read it and found
      nothing, versus the FILE could not be opened at all -- and they now say
      so in the same words everywhere. Three toasts ended in a full stop
      where the other 139 do not, and one concatenated a raw `Error.message`
      into a sentence the app was supposed to have written.
      **And the law that watches this copy had a hole.** It split on the
      literal middot, so a string written `"Marked blocked \u00b7 "` carried
      no character to split on and the whole line was judged as one segment:
      the capital after the break went unchecked in all EIGHTY places the app
      writes the escape instead of the character. Both spellings normalise
      now, and the check was proved to bite on the escaped form before being
      called done. Nothing had actually fallen through the hole, which is
      worth saying plainly rather than claiming eighty finds.
      A second law caught the sweep itself: "Couldn't find that task · It
      may have been deleted" tripped the one that says a toast announcing a
      removal must offer Undo. It was right to: the word promises something
      the message could not deliver. The line says what actually happened
      instead ("Nothing was changed").

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
- [x] **Anything else the crawler names as unreachable** · checked
      2026-09-22. Unchanged: the same 4 `DIVE_CAP` gaps (More > Brain, More >
      Email, More > Settings, Tab: Today), each named and each just past the
      default 6-row dive depth, reachable with `DIVE_CAP=30` when wanted.
      Nothing newly unreachable.

## PHASE 8 · ONE GREY, EVER (Dave 2026-09-21, five screenshots)

"There should not be more than one gray subtext anywhere... you can make it
gray with regular font one time. And then after that shit has to look
different... I never want to speak about this again. Enforced strict, strict
laws with visuals."

- [x] **The catalog carries it** · §AK, in his words, naming what it
      supersedes (V4.1 M.3 capped the colour and let the grey run).
- [x] **The auditor measures it** · check 8, `grey-twice`: the COMPUTED
      colour and weight of every text leaf in every row and card, on every
      screen it reaches. Not class names. The three ways out the ruling
      names are the three exemptions: weight 600+, a wordless mark ahead of
      the words (a dot, a pie, a ring, inside the span or before it), a fill
      of its own. A sentence whose numbers sit in their own spans is one run.
      `src/laws/subtextLaw.test.ts` pins the section and the check together.
- [x] **The first pass found 20 rows on 7 screens; the fourth found 0** ·
      across both themes at both text sizes, 43 screens each. Fixed: the
      Schedule meta line (length and repeat carry weight; the place is the
      one grey), Decisions (the date wears cyan), Money's account rows (the
      amount carries weight), the set strip (units are labels and carry
      weight; "Last:" is the one grey), Brain's Shaping rows ("Your Move ·
      Plan My Day" was two greys and is one fact with a list in it), the
      goal cards (the count carries weight).
- [x] **The five screenshots** · the lift page's pill clipped on BOTH sides
      ("·vidence and Calculatio") because text-overflow cannot draw on a flex
      container, measured at 67px past its own edge; a text-only pill is
      inline-block now and the ellipsis is real. Two stacked action rows had
      colliding hit boxes (same arithmetic as Basis). A note made from a
      meeting carried its date in the title AND on the meta line. "Nothing
      under it yet" drew a grey line with nothing in it under six goals. An
      email-born task said "Email" in bare grey beside a dotted category; an
      origin wears a mark now.

## PHASE 7 · DRIFT

Dave, 2026-09-21, after finding the superset buttons missing: "We cannot
have drifts." A rule applied by name in one place, or a capability built on
one surface, is a rule and a capability that is wrong everywhere else.

- [x] **Superset, on both surfaces and in one vocabulary** · the page where
      you build a day had NO superset control (only a long-press item called
      "Group With..."), and the live session's sat 1.3 screens down. Both
      have a visible one now and both say the athlete's word.
- [x] **A function that is written, tested, and wired to nothing** · fixing
      the buttons found the same defect one layer down: `ungroupToday` had
      been written, documented and unit tested, and was imported by nothing.
      You could make a superset for today; the only way out was a five second
      toast. Every guard the repo had said that was fine -- the MODULE was
      reachable, the export had tests, the tests passed. **A unit test is a
      caller**, so a function can be perfectly tested and attached to
      nothing, and the suite is the last place that will say so.
      `src/laws/noDeadExport.test.ts` counts callers that are not tests.
- [x] **The live card's lead line** · the same class again, found by the new
      law. `currentLine` ("Bench Press · 3 × 225 lb × 5") was computed,
      documented as "the one line the card leads with", tested, and rendered
      by NEITHER of Today's two live-workout surfaces -- while the comment
      above one of them said the card reads "the exercise it is on WITH its
      numbers". Mid-workout, Today told you the day, the minutes and the set
      count, and never the lift. Both surfaces lead with it now.
- [x] **The other ~67 exports the law finds app-wide, triaged** · 2026-09-22.
      `noDeadExport.test.ts` still only walks `gym/` (still zero roster
      entries there); widening its scan the same way this triage did found
      **16 false positives** first -- the law's own source-scan only reaches
      `src/`, and these 16 (the admin panel, the AI proxy, the booking
      system, `legal/html.renderPage`) are called from `api/` and `tools/`,
      real code the law cannot see. Rostering them would be lying about a
      live caller; widening the scan itself is bigger than this pass. Of the
      remaining 51: **~30 are legitimate** (test-only helpers, the `native/`
      layer, self-contained eval harnesses, code superseded by a later
      mechanism and never deleted -- e.g. `automaticity.ts`'s two exports,
      named BAN-1 right next to the replacement that superseded them). **Two
      were real, fixed:** `messages/mailCache.ts::clearRows()` and
      `monitoring/monitor.ts::clearRecentErrors()` were written, tested and
      wired to nothing -- `jarvis.mail.rows.v1` (cached inbox rows: senders,
      subjects, snippets) survived both Clear Local Data and sign-out on
      shared glass, the exact SHELL-F-10 bug already fixed once for other
      keys; and `people/importMatch.ts` hand-duplicated `contactMethods.ts`'s
      documented `matchKeys` as a private `keysOf`. Both wired in. **A real
      tail, diagnosed but not wired** (each is a design/product call, not a
      mechanical fix): `ai/context.ts::movePack` is built and documented for
      Your Move's prompt but the live prompt still uses the generic pack;
      `notes/richtext.ts::wrapRange` implements a bold/italic toggle for
      inline-edited text but `InlineEdit.tsx` has no bold/italic control at
      all; `bigger/reach.ts::byDue` is a tested sort helper nothing calls,
      and the comment above it in the same file already records an identical
      case that was found dead and deleted; `tasks/rightNow.ts::rightNowLine`
      is unused even though Just Fifteen, the feature it belongs to, is
      alive and wired elsewhere with its own hand-written copy;
      `tasks/startStore.ts::newestSession` looks superseded by the Resume
      card's real, view-scoped resolver but has no explicit "this replaces
      it" comment the way `automaticity.ts` does. Full 67-item roster with
      reasoning for each is in the session's own record; not reproduced here.

## PHASE 6 · BEHAVIOUR, NOT PIXELS

- [x] **Every destructive action has an Undo** · `ba8fa4d`, corrected 2026-09-22:
      this was still marked open here after the law that actually closes it
      had already shipped. `src/laws/undoLaw.test.ts` walks every
      `showToast(...)` call app-wide, finds every one whose message names a
      removal (`deleted`, `removed`, `cleared`, `discarded`, ...), and fails
      unless it carries an Undo or is named in an exact roster with the
      reason it correctly has none (undoing an undo, a Delete Forever behind
      its own confirm, an armed double-tap). Green on the current suite.
- [x] **Every write has a failure path** · `ba8fa4d`, same correction.
      `src/laws/writeGuard.test.ts` finds every service-mutation call site
      app-wide and fails unless it sits inside `attemptWrite` (or a local
      `*Write` helper) or a `try`, or is named in an exact roster with the
      reason it does not need one (a best-effort cleanup after an already-
      guarded call, a callback whose caller reads the outcome). Green on the
      current suite.
- [x] **Orphan sweep** · 2026-09-22. `unfileArea` (`645c990`) was itself
      partial -- it walked tasks and events but not notes, projects or
      people, even though both delete doors' own cost lines already promised
      "Untags N Tasks, Notes, Projects, People." All five are unfiled now,
      symmetrically, with Undo restoring exactly what was taken. Two more
      pairs the same class of bug: deleting a project orphaned every task
      pointing at it, and deleting a goal orphaned its projects -- both
      named in `BiggerPictureFlow.tsx`'s own comment, both only ever fixed
      for the Undo path (the row comes back under its own id) and never for
      a delete that stays deleted. `projects/unfile.ts` and
      `life/unfileGoal.ts` close both, same shape as `unfileArea`. Deleting a
      person orphaned their tasks and any decision attached to them, same
      Undo-only gap (`people/unfile.ts`); linked Notes are deliberately left
      alone, since `NotesFlow.tsx`'s `targetGone` already marks a gone
      connection instead of pretending it is live, and that design must not
      be quietly overridden here.
      **Two more real gaps found, not fixed, both bigger than a roster
      entry:** `GymService.removeProgram` never clears a workout's
      `programId`, and that delete has no Undo at all today, so fixing the
      orphan and adding the Undo it never had are one decision, not two.
      `ScheduleService.deleteEvent` never clears a task's `eventId`, and is
      called from 20+ sites (Today, Schedule, Messages, Google sync,
      booking import) -- patching the two user-facing delete flows would
      leave the programmatic ones still leaking, so this wants a single
      choke point (a `TasksService` handle on `ScheduleService`, or an
      `entity.deleted` subscriber) rather than twenty call-site patches.
      Both are Dave's call on shape, not a diff to guess at.
- [ ] **The 34 rows already orphaned in the live database** · Dave's call on
      where they belong; not a migration's.

## PHASE 9 · THE REST OF THE LIST (Dave 2026-09-22: "finish the entire rest
## of the outstanding items")

Fourteen parallel investigations, each independently verified before its
diff was applied, closed every checklist item above marked 2026-09-22.
The rest of this phase is what that pass found beyond those items.

- [x] **Tap Ladder gaps that were the auditor's, not the app's** · Life's
      Area/Group/Focus filter capsules and Booking's own capsule rows were
      already painted at their correct 34px rung; the auditor's `RUNGS`
      roster in `tools/visual-audit.mjs` just never learned their class, so
      it held them to the flat 44px floor and reported a working control as
      broken. Taught, not resized -- the same fix shape Phase 1's Tap Ladder
      item already established, extended to controls found after it.
- [x] **A real 24px tap-target bug, only visible once the false ones were
      gone** · Life's Projects and Goals category headers (`.bp-shelf-head`,
      "Work"/"Family"/"Health"/"Money") are genuine `<button>`s at 24px, with
      no hit-area expansion at all. Bought back with the app's own `::after`
      technique, the paint held exactly to Dave's Apple Music reference
      (2026-09-18); the under-44 law now scans `ruled.css`, where this
      control's rule lives, so it stops being invisible to the law meant to
      catch it.
- [x] **Schedule's "Running Late?" capsule, genuinely under its own rung** ·
      painted 23px against the capsule floor of 34, the one control the Now
      row never gave the `.pill-act` hit-area trade to. Grown into
      `.sched-now`'s own spare padding, zero visual change. The row's two
      remaining sub-44 controls (the time and duration buttons nested inside
      a `role="button"` row) are a named, accepted rung (14px, "nested in a
      tappable row") -- one already law-pinned as Dave's call
      (`sched-until-btn`, 2026-08-24); the other's stale `-13px` hit-area
      inset actually overshot the row's own clip and undershot a real
      button 2px away, corrected to what is actually free.
- [x] **Two auditor-side false positives, taught rather than chased into the
      app** · `flush-stack` fired between adjacent rows of the same grouped
      card (Today's Your Move and mail bands), which components.css draws
      flush on purpose with a zero-height hairline divider -- "like every
      other grouped list in the app." `overlap` fired between Bigger
      Picture's card menu and the shelf's own "scroll for more" arrow only
      at 1.4x type scale, where cards grow wide enough to make an
      always-latent, by-design overlay actually visible; both now read the
      pattern instead of re-litigating it every run.
- [x] **A real hit-box collision, found by 1.4x scale specifically** · two
      `.se-chip-door` buttons (Equipment, Superset) share a row that wraps
      to two lines only at 1.4x scale, and their opposing 11px hit-area
      expansions overlapped across the new line break -- a genuine mis-tap
      hazard invisible at scale 1. Row-gap widened past the collision;
      deliberately not given a rung, since a rung skips the hit-test that
      caught this.
- [x] **A tap target that was never trapped, just scrolled** · two findings
      ("Vitamin D" in Reminders, "Focus" on Today) measured broken only at
      the exact scroll position where their natural box ends at the app's
      persistent footer -- which is laid out by the shell's flex column, not
      `position: fixed`, so the existing "a row you can scroll out is not
      trapped" exemption never saw it. Same exemption, asked earlier.
- [x] **FitSheet's missing scroll region** · the one gym sheet that never
      wrapped its variable-height body in `.sheet-form`, so at 1.4x scale on
      a full day its own Start/Cancel buttons render off the bottom of the
      screen and fail a real tap, not just a visual clip. Wrapped, matching
      every sibling sheet.
- [x] **A real overlap on Today, from the Report card's own hit-area** ·
      `.pill-act`'s universal 9px reach poked into the row above it inside a
      2px-padded button row. The fix that looked right first --
      zeroing just the top border -- was caught before landing: `.pill-act`
      also carries `min-height: 34px` under `box-sizing: border-box`, so
      removing border height without removing the min-height just pushed
      the missing pixels into the pill's own paint, growing it visibly
      taller. `overflow: hidden` on the container fixes the same root cause
      with no effect on the pill at all.
- [x] **Today itself, read start to finish rather than sampled** · already
      closed by every phase above that names it (Tap Ladder, one-grey,
      Dynamic Type, drift). One live auditor pass found four findings, three
      by design (the dealt task's one-line title, a mail sender's ellipsis,
      both per named 2026-09-16/2026-09-01 rulings) and one real: a mail
      card in the Heads Up band's compact 56px row can lose its title AND
      its sub at once, the exact failure the "shredded sub" law exists to
      prevent, because the law's drop-a-line gate never fires in the
      compact band. Left for the rendered comparison below rather than
      guessed at. One stale doc comment (`NoticeCard.tsx` still said mail
      "opts OUT" of the uniform row a year after Dave reversed that) fixed
      in passing.
- [ ] **Task #27 itself** · "render options from Dave's real day and send
      examples" has no further spec anywhere in the docs or code. Read
      end to end: this is a rendering exercise against Dave's real account
      data (not the demo seed), the same process that produced the writing-
      bar and Schedule-row decisions, and cannot be done from a demo build.
      The one concrete candidate ready for that comparison is the Heads Up
      mail card above.
- [ ] **One new tap-target edge the `.receipt-line` fix surfaced** ·
      "4 More Emails in Your Inbox" now reaches its own top edge correctly
      (the `overflow: hidden` fix above did its job), but at 834px wide and
      1.4x type scale specifically, it is the LAST row before the app's
      persistent voice-bar footer, and the downward half of its hit-area
      expansion lands on that footer instead of empty space -- a real tap
      there would miss. Narrow (one screen, one viewport, one scale) and not
      chased further this pass; the fix likely wants the same shape as the
      log bar's own `--logbar-clear` (measured clearance published as a
      variable) rather than a wider blind expansion.
- [ ] **Truncation calls still open, each a design decision** · the Move
      headliner's title (a hand-rebuilt row that never got the shared
      component's adaptive layout -- itself a catalog §R.7 violation worth
      fixing on its own); "Needs You" against its own Sweep pill at 1.4x
      scale; ordinary task-row title truncation on real-length titles in
      Life · Tasks (extending the Heads Up stream's two-line rule app-wide
      is a scope decision, not a bug fix); Notifications' longest Switch
      label against its fixed-size toggle; a Reminders row with both a time
      gutter and a Snooze pill compounding at 1.4x scale.

---

## OPEN DECISIONS

Anything here blocks an item above and needs Dave, not a guess.

1. **Red on a press fill.** ~~Accepted and recorded 2026-09-20~~ ·
   **SETTLED. `.pill-act`: option D, red ring and white verb (2026-09-21).
   `.row-act`/`.quiet-action`: the same ring, no fill, in both themes
   (2026-09-22).**

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

   **SETTLED 2026-09-22.** `.row-act`/`.quiet-action` now take the same
   ring-not-fill shape as the pill, just without the pill's rounded fill:
   `background: transparent; box-shadow: inset 0 0 0 1px var(--accent-chip-bd);
   color: var(--on-light-red)` in light (`var(--accent-tx)` in dark, made
   unconditional the same push, since the identical grey-fill defect turned
   up there too). The 4.07:1 complaint was never the red itself, it was red
   text on a press-3 grey fill -- with no more fill under it there is nothing
   left to fail. `2be2a68`.

2. **The 34 orphaned rows** in the live database. Where they belong.
