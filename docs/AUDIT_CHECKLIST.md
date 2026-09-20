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

## PHASE 1 · GEOMETRY AND COLOUR  ·  18 distinct findings to 2

- [x] **320px retired** · `305e6c9` · Dave's call. Seven of the eighteen
      findings lived only there, including every truncation in the app.
- [x] **Truncation** · 2 fixed (`b84c911`), 0 remain at 390/430/834.
- [x] **Tap targets under their rung** · `305e6c9`
      21 head capsules at 28 where C1 says 34; `.opt-done` at 44x18, under
      the broken floor, the only way out of an Options sheet.
- [x] **Swipe rails** · `db8cb16` · Delete on every row that owns a record;
      the schedule rail counted its buttons instead of hiding them.
- [x] **Red on a press fill** · accepted and recorded, see OPEN DECISIONS 1.
- [x] **Light tab bar** · `db8cb16` · 99 findings, one token.

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

- [x] **Empty states** · 65 of them, read. L7 ("an empty state always carries
      its action") is stated three times in the catalog and was enforced
      nowhere; 26 were dead ends. Now a law with an EXACT roster, so a new
      dead end fails and fixing one fails too. Fixed: No Projects Here and No
      Goals Here got their buttons, two "Loading..." empty states became
      skeletons, and the Strands paragraph became a title and a sub.
      **Debt, named, 7 left:** empty states whose action lives on another
      screen and needs a callback plumbed (AreasTab, LiftDetail, InsightsPage,
      WhatTheySee, NightBefore, AllData, HealthFlow). The law holds the count
      at 7 so it can only go down.
- [~] **Error states** · partly done. The health screen had SEVENTEEN writes
      running as `void healthSvc.x().then(bumpHealth)`: `void` discards the
      promise, so a rejection went nowhere. Fourteen were UNDO handlers, the
      worst place for it. All seventeen now route through a healthWrite guard
      shaped like the metricWrite that has had it right all along.
      **Remaining: ~24 mutations across 10 files with no visible failure
      path**, and the count is HEURISTIC, not verified. A grep for this gave
      223, then 97, then 140, then 39 before the method was right (character
      ranges, not line windows), and sampling showed the first three were
      mostly wrong. No law is written on this number until each of the 24 is
      read. Files: GymFlow 5, HealthFlow 4, ChatFlow 3, and seven others.
- [ ] **Loading and skeletons** · every screen, caught mid-load. Two fake
      ones found and fixed via the empty-state law; the other 16 real
      skeletons are unreviewed.
- [x] **Toasts** · 60 report a removal; 52 already carried Undo, which is why
      the eight that did not were invisible. Two of the eight were shipped by
      the swipe work the same morning: a swipe on a repeating row wrote an
      exdate and offered no way back. Both now call removeExdate, the exact
      inverse. The other six are correct and rostered with reasons. Law with
      an exact roster, and it checks the handler, not just the word "Undo".
- [ ] **Offline** · what the app says when the backend is unreachable.

## PHASE 4 · REACH AND INPUT

- [ ] **Keyboard and switch control** · known gap: `.search-overlay.focus-screen`
      (What Now) ignores Escape, so it cannot be dismissed without a pointer.
      Found by the crawler sitting behind it.
- [ ] **VoiceOver names** · every control's accessible name, against what it
      does. The button audit checked labels, not names.
- [ ] **Focus order and visible focus** · never audited.
- [ ] **Dynamic Type** · the app pins nothing; what breaks at the large sizes.

## PHASE 5 · THE SCREENS NOTHING HAS REACHED

- [ ] **Bigger Picture** · in neither More nor Life. Renamed, moved or gone.
- [ ] **Settings > Categories** · same.
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

1. **Red on a press fill.** `--on-light-red` #DA0012 was measured on the page
   (4.79:1) and on a white card (5.26:1). `.row-act` sits on neither: over
   press-3 it composites to rgb(225,226,231) and reads **4.07:1**. Dark's
   `.pill-act` reads **4.49:1** on the same shape of ground, against a 4.5
   bar. Reaching 4.5 in light means about #CD0012, a visibly darker red.
   **Taken as ACCEPT AND RECORD** on 2026-09-20, without asking again,
   because Dave has ruled on exactly this trade twice: the Astra pass chose
   Apple's real light colours over a measured darker pair, and L6 chose brand
   red over the text cap for glyphs. A third darkening would contradict both.
   Say so and it changes.

2. **The 34 orphaned rows** in the live database. Where they belong.
