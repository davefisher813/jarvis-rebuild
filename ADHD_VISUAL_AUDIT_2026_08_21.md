# JARVIS — Full ADHD Visual Audit
**Aug 21, 2026 · every screen · dark theme · 390×844**

## How coverage was guaranteed

The app has no router. Every screen is React state reached by tapping, so there is no route list to read off disk and no way to claim "every page" by inspection. Two earlier attempts both produced confident numbers that were wrong: an ad-hoc script that captured 22 screens and never left Today, and a crawler that reported "30/30 seeds reached" while five of those pages had silently failed to open (the tap landed, the screen didn't change).

The tool that produced this report (`tools/screen-crawl.mjs`) is built so those failures are impossible to hide:

- **Seeded from source, not from clicking.** Every destination in `shell/destinations.tsx`, every Settings row, every Brain row, both Search entry points, the What-Now bolt and the capture bar are navigated to *by name*. A seed that cannot be reached fails the run.
- **Heading verification.** After each seed it compares the page heading to the parent's. A tap that "succeeded" but left you on the parent is recorded as `SEED DID NOT OPEN`, not as a pass. This is what caught the five false passes.
- **Full scroll height, not viewport.** Every screen is captured in segments covering its entire scroll height. A viewport-only shot of a scrolling page is a partial audit that reads as a complete one.
- **Fresh load per branch.** Each screen is reached by replaying its click path from zero, so a destructive tap on one branch cannot contaminate any other.
- **Measured, not just seen.** Every screen is scored at every scroll segment for truncation, tap-target size, word count, repeated-action walls, shame copy, and unstoppable motion. The eye slides over a 22px tap target; a counter does not.
- **A skip ledger by name.** Everything not tapped is listed individually with a reason. Silent truncation is the exact failure this tool exists to prevent.

**Result: 33/33 seeds reached · 197 unique screens · 386 image segments · 30 skipped entries, all named** (24 are the same screen reached twice by two routes; 6 are destructive taps — "Delete task" ×5, "Delete Chat History" — deliberately not made). Manifest: `/tmp/crawl-full2/manifest.json`.

---

## The research this is judged against

ADHD brains run on interest and urgency, not importance. Time is "now" or "not now" — what isn't visible doesn't exist. Task *initiation* is the wall, not execution. Guilt and failure-tallies cause avoidance, not correction (~23% of ADHD adults carry high internalized stigma, Masuch 2019). Choice overload causes paralysis. Continuous visual time beats numeric countdowns. Undo beats confirmation. Sources at the bottom.

---

## What JARVIS already gets right

These are the moat. Almost no productivity app does any of them.

1. **"I'm Overwhelmed"** collapses the list to one item, deletes nothing, and everything returns on one tap. Direct hit on the hardest ADHD moment.
2. **Focus / Up Next** is a perfect one-thing surface: one card, the reason ("Due today · your focus peak"), and exactly two choices — Done, Not This One.
3. **The What-Now bolt** offers "15 Minutes on it, starting now · Until 11:45" with three options. A time-boxed commitment small enough to say yes to, on every screen in the app.
4. **The Now card** sizes one task to the actual gap ("About 45 min · Fits this gap") against a continuous time ring — exactly the spatial time representation the research prefers over countdowns.
5. **Blending** — "You can do this while you move", "Same as this block" — matches task demand to what the body is already doing.
6. **Email triage** — "3 Threads Need You. Everything else is filed below", "Nothing in there is urgent" — reduces checking compulsion instead of feeding it.
7. **AI Control** (Everything / Draft Only / On Request / Off, plus per-feature overrides and a "What Ran" log) is precisely the consensual, transparent, self-directed control the ADHD literature asks for and almost nothing ships.
8. **"Move all to Today"** with a single Undo, commented in source as "an overdue pile is where the shame lives."
9. **Motion is already handled.** The ticker is the only infinite animation; it honours `prefers-reduced-motion` and has a pause that persists. Not a finding.
10. **100% WCAG AA contrast** in both themes, re-verified after today's colour change: 0 findings across all 7 viewport/theme passes.

---

## Findings, ranked

### F1 — "Just Pick One For Me" opens the Edit Task form
**Severity: critical. This is the flagship anti-paralysis button doing the opposite of its job.**

Verified twice, independently of the crawler. Tapping it lands on a sheet with: a text field, "Add a When and Where", Category (5 chips), Due (4), Repeat (4), Project (4+), then Save / Add to Schedule / **Delete Task** / Cancel. That is the highest-decision-density screen in the app — roughly 20 decisions — handed to someone who just said they cannot choose.

The ranking logic is right. The destination is wrong. `TasksFlow.tsx:445` says the intent plainly:

```
// one tap goes from "Tasks" straight to a task that is already open.
const pickOne = () => {
  const best = rankOpen(parts.all, today)[0];
  if (!best) { showToast({ message: "Nothing open · Enjoy it" }); return; }
  openEdit(best.id);          // <- opens the metadata form
};
```

"Open the task" was implemented as "edit the task." **The app already contains the correct destination**: the What-Now sheet ("DO THIS · 15 Minutes on it, starting now · Just Fifteen / Something Else / Not Now") or Focus/Up Next. Point `pickOne` at one of those. This is a small change with the largest behavioural payoff in the list.

Related, same sheet: **"Delete Task" is a full-width saturated-red button sitting directly under Save**, visually heavier than the primary action. Impulsivity is a core ADHD trait; the most destructive control should not be the most eye-catching one.

### F2 — Red marks inventory, not urgency
**Severity: high. Token/logic change.**

Caught red-handed by the crawl: on `Tasks > Overdue · 0` the filter reads **zero overdue** while the Tasks tab badge still shows a **red 5**. The badge counts overdue *plus* due-today, so the alarm colour fires when nothing is actually late. Meanwhile in Money, a genuinely urgent "Rent · DUE IN 2 DAYS" is calm grey caps.

Urgency semantics are inverted: ambient counts shout, real deadlines whisper. Every glance at the nav reads as threat, which is how users learn to ignore the nav.

**Fix — one rule, applied to tab badges, header chips, and due labels:** red only when something is genuinely overdue; amber for due-soon; neutral grey/white for a plain count.

### F3 — 22px tap targets, half the 44px minimum
**Severity: high. Present on 28 of 197 screens.**

Measured, not guessed. `.cb` is a `role="button"` rendered at exactly **22×22px** with no hit-area expansion (`::after` is `static`/`none`) — confirmed in `jarvis-design-system.css:311` and used by `RemindersStrip.tsx:56` and `NoteEditor.tsx:116`. The reminder rows on Today (Morning Meds, Vitamin D, Night Meds) and the day-draft task rows are all 22px tall.

The existing law only checks one hardcoded class:

```js
it("the row action pill expands its hit area to the tap minimum", () => {
  expect(css).toMatch(/\.pill-act::after\s*\{[^}]*inset/);   // .pill-act only
});
```

`.cb` was never covered. Also under 44px: header chips "6 events"/"5 due" (32px), the Day/Week/Month segmented control (30px), Repeat None/Daily/Weekly/Monthly (32px), the round "+" New Task / New Event buttons (32×32).

**Fix:** give `.cb` and the chip/segment classes the same `::after { inset: … }` hit-area expansion `.pill-act` already uses, and broaden the law from one class to every class used with `role="button"`.

### F4 — Failure-tally copy
**Severity: high. Copy-only, and the single most-cited ADHD anti-pattern.**

Two strings in source tally non-completion:

- `TodayFlow.tsx:1007` — `` `${sweepCand.text} has moved ${sweepCand.slips} days running` `` (this is the "moved 5 days running" line on your screenshot)
- `inboxBrief.ts:38` — `` `someone has been waiting ${worst} days on you` ``

Both name a number of days you have failed. That reads as a performance ledger and produces avoidance, not action.

**Fix:** keep the fact, drop the tally, add an exit. "This one keeps sliding — smaller first step, or let it go?" and "58 days · no reply" (neutral form) instead of "waiting 58 days on you."

### F5 — Blank-canvas pages that will never be filled
**Severity: medium-high.**

Brain > **How You Write**, **Values**, and **Life Philosophy** are each an empty textarea with one grey placeholder ("Tone · style · words you use and avoid") and ~1400px of black. A blank canvas is the maximum-friction surface for task initiation — these will stay empty forever, and they are the pages that make the AI personal.

**Fix:** scaffold each with 4–6 tappable starter prompts that write a first line ("I never use exclamation points", "I write short"), the same pattern Chat's TRY chips already use.

### F6 — Dead-end detail screens
**Severity: medium.**

- **Person detail** (e.g. Marcus Delaney): avatar, name, one "Relationship / Attorney" row, then ~900px of nothing. No email, no call, no linked tasks, no "Still Open" items.
- **Brain > Personal** (and other empty categories): heading, one "Add Task" button, nothing else.
- **Settings > Connections**: a ~1100px empty card saying "Google Setup Required / Needs Google setup first" — states the problem twice and offers no button to fix it.
- **Settings > What JARVIS Learned**: "Nothing Learned Yet", no icon, no explanation of what would ever appear.
- **Settings > Appearance**: Dark/Light and nothing else, on a project whose brand DNA is the theme/skin system.

Each is a place the app stops having a next action. **Fix:** every empty state gets one primary action and one line of what belongs here. Appearance is also the natural home for an in-app **Reduce Motion** toggle (the CSS already honours `prefers-reduced-motion`, but users shouldn't have to know an OS setting exists).

### F7 — Identical-action walls
**Severity: medium. Measured across 197 screens.**

Screens rendering 4+ identical buttons at equal weight: `Start ×10` (4 screens), `Start ×5` (10 screens), `Dismiss ×4` (10 screens), `−15m/+15m/+1h ×4–5` (11 screens). Notifications is five rows with five identical "Done" buttons and no priority signal. Equal-weight lists cause scan fatigue and choice overload.

**Fix:** rank one row as the lead (the overdue one) and render the rest quieter — the Now-card-vs-Heads-Up pattern already established on Today.

### F8 — Density spikes on Today
**Severity: medium.**

The heaviest states measured: `Today > Change It` — **426 words, 39 distinct actions on one screen**; `Today > Start` — 395 words, 36 actions; `What Now > Focus` — 410 words, 28 actions. For comparison, Focus/Up Next at its best is one card and two buttons.

**Fix:** these are sheet-over-page states where the page keeps rendering its full content behind. Collapse or dim the underlying page when a decision sheet is open.

### F9 — Title truncation at the primary width
**Severity: low-medium, but it's a visible bug at 390px.**

Clipped with an ellipsis at the default iPhone width: **"What JARVIS Lear…"** (page title, 3 screens), "In: Draft the Coach Onboarding Email", "Draft the Coach Onboarding Email", "Moves Ship the App Store Launch". The no-wrap law is clipping page titles at the width most users are on.

**Fix:** allow page titles to wrap to two lines, or shrink-to-fit, above the 340px exception already in the CSS.

### F10 — Every contact avatar is the same red disc
**Severity: low.**

Five identical saturated-red circles in a column. No visual shortcut — the eye must read text on every row — and it spends the brand's alarm colour on decoration. Category colours already exist. **Fix:** tint each avatar with the person's category colour.

### F11 — Double JARVIS branding
**Severity: cosmetic.**

Header says JARVIS, capture bar says JARVIS, Chat page says JARVIS. The capture bar could drop the wordmark and use the space for a fuller hint.

---

## Recommended order

1. **F1** (repoint `pickOne`) — smallest change, biggest behavioural payoff, plus de-emphasise Delete.
2. **F4** (two copy strings) and **F2** (badge rule) — high emotional impact, low risk.
3. **F3** (tap targets + broaden the law) — mechanical, and the law upgrade stops it recurring.
4. **F5**, **F6** (scaffolding and empty states) — real work, high retention value.
5. **F7**, **F8**, **F9**, **F10**, **F11** — polish.

Bundle size remains untouched per your standing instruction.

## Deliberately not flagged

The dark theme, the saturated red identity, and the violent completion animations. The research favours muted palettes, but it equally favours reward and novelty, and the energy is why this app is not Todoist. The compromise already in place — red for action and identity, calm surfaces everywhere else, motion that pauses and stays paused — is the right call.

## Sources

- arXiv 2507.06864 — *Toward Neurodivergent-Aware Productivity* (25-participant ADHD professional survey; guilt-inducing tools rejected; 55% prefer gentle nudges; privacy-first; never gamify non-completion)
- Tiimo — *Why Productivity Systems Fail ADHD Brains* (Volkow 2011 dopamine motivation deficit; Masuch 2019 internalized stigma ~23%; energy-based planning)
- Super Productivity — *ADHD Time Blindness* (continuous visual time beats countdowns; checkpoints beat single alarms; "now vs not now")
- Stephanie Walter — *Neurodiversity and UX* (cognitive load, session length, reflow)
- AccessibilityChecker — *Neurodivergent UX Design Principles* (distraction minimization, progressive disclosure, error tolerance)
- Welcoming Web — *Designing for ADHD and Neurodiversity in UX* (visual hierarchy, WCAG 2.2 AA, chunking, consistency)
