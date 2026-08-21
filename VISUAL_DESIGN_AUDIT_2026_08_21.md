# JARVIS — Visual Design Audit
**Aug 21, 2026 · layout, type, color, containers, buttons, spacing, hierarchy · 390×844 · both themes**

This is the craft audit, not the behaviour one. Everything below is measured from **computed style on the rendered page**, not read out of the stylesheet — a design system that lives in CSS variables but isn't what the browser paints is not a design system.

Method: 30 pages walked, every text run measured by its **ink position** (`Range.getBoundingClientRect`, not the element box — element boxes include padding and report edges that aren't visible, which is how you get a false alignment finding).

---

## The headline: the contrast auditor was lying, and I fixed it

`tools/visual-audit.mjs` reported **0 findings** yesterday. It was wrong. Its `rel()` helper parsed `rgba(235, 235, 245, 0.3)`, took the first three numbers, and scored the colour **as if it were fully opaque**. Every `--tx-*` grey in this app is `rgba`. So the entire grey scale — the app's whole secondary and tertiary text layer — was measured as solid `#EBEBF5` and passed everything.

Fixed: the ratio now composites the text colour over its actual backdrop before measuring. Same 7 passes, same screens:

| | before the fix | after |
|---|---|---|
| dark | 0 | 26 |
| light | 0 | **192** |
| **total** | **0** | **218** |

That is a measurement correction, not a regression. The failures were always on screen.

### What's failing

| token | alpha | dark | light | verdict |
|---|---|---|---|---|
| `--tx-2` | 0.82 | 7.0–11.7:1 | ok | fine |
| `--tx-3` | 0.60 | 4.6–6.4:1 | **3.1–3.4:1** | **light fails AA everywhere** |
| `--tx-4` | 0.30 | **2.3–2.5:1** | **1.7:1** | **fails both themes, below even the 3:1 floor** |

`--tx-3` is the app's main secondary text — "Then Deep Work", "Due today", "As you last entered it", "Total balance", "3 of 4 done", "Tap to capture". 107 uses. In light theme essentially all of it is under AA.

`--tx-4` (45 uses) carries the **inactive tab labels**. Your primary navigation — "Tasks", "Schedule", "More" — renders at **2.25:1**. Apple's own inactive tab grey is 4.6:1.

**Root cause:** one grey scale was authored and reused across two themes with different surface luminances. Dark got away with it at `tx-3`; light did not.

**Computed fix** (holds on every surface in that theme):

```css
[data-theme="light"] { --tx-3: rgba(60,60,67,0.75);  --tx-4: rgba(60,60,67,0.75); }
[data-theme="dark"]  { --tx-3: rgba(235,235,245,0.60); --tx-4: rgba(235,235,245,0.60); }
```

`tx-4` reaching AA means it stops being a third grey — it collapses into `tx-3`. **That is a real design decision, not a bug fix: you lose a tier of visual quiet and the app gets flatter.** The alternative is to keep `tx-4` dim and only ever put decoration in it, never words. I have not changed these values — your call.

---

## Type

**Tokens define 6 sizes. The app paints 12.** Across the pages sampled: 34, 32, 21, 20, 17, 16, 15, 14, 13, 12, 11, 10 — with **24 distinct size/weight pairs**. 37 hardcoded `font-size` declarations sit alongside 245 tokenised ones.

**Two screen titles, 2px apart, both weight 800:**

- `.pagehead-title` = **34px/800** (hardcoded — the token `--t-h1` is 32px, and this ignores it)
- `.today-title` = **32px/800**

Today's hero and every other page's title are different sizes for a difference no one can perceive as intentional. Pick one.

**Three eyebrow treatments for one role:**

| class | rendered | example |
|---|---|---|
| `.eyebrow` | 11/700 | "Events", "Money", "Work" |
| (Today's) | 11/800 | "Your Day, Drafted" |
| `.sh2 .t` | **12/800** | "Heads Up", "Now" |

Same job, three specs. On Today you can see 12/800 "Heads Up" directly above 11/800 "Your Day, Drafted".

**15px carries five different weights** — 400 (`.conn-meta`, `.voice-hint`, `.sched-cat`), 500 (`.sched-time` — *one class*), 600 (`.chip`, `.seg`, `.sched-loc`), 700 (`.btn-sm`, `.seg.active`), 800 (`.day-pill`, `.time-arc-num`). Five weights at one size is not a hierarchy; it's five near-identical treatments the reader can't decode.

**Orphans** — values used by a single class, which means they were typed, not chosen: `15/500` (`.sched-time`), `14/400` (`.blend-plus`), `21px` (`.rn-title`), `19px` (`.time-arc-num`), `26px`/`27px` (`.doc-title` vs `.upnext-task`).

**Suggested closed set:** 32/800 title · 20/700 section · 17/400 row primary · 17/700 button · 15/400 body-meta · 15/700 emphasis · 11/700 eyebrow · 10/600 tab. Eight pairs. Everything currently outside that maps onto one of them.

---

## Color

### Red is spent 96 times against a law that allows four

The app's own comment in `jarvis-design-system.css` states it:

> Red now means only: primary action, the current tab, a count badge, and capture.

Actual count: **64 rules colour text red, 32 fill red.** Red is currently doing: back buttons and nav actions, "see all" links, section eyebrows, the textarea caret and body text, progress fill, slider fill, avatars, message dots, week cells, the focused input ring — and **location metadata**:

```css
.sched-loc { color: var(--tint); }   /* components.css:516 */
```

That paints "Zoom" and "Ridgeline Fields" in full brand red on the Schedule. A place name is not an action. When everything urgent is red and the venue is also red, red stops meaning urgent.

**Red load above the fold, counted per screen:** Tasks 14 red-ish elements, Today 12, What Now 11, Contacts 8 (five identical red avatar discs in a column).

Honest note on yesterday's change: the tinted `Start` chips you picked add red-ish surfaces — five of Tasks' fourteen. The chips read correctly on their own; they cost something at the screen level. Worth knowing before you decide about F-red below.

### The rest of the palette is healthy

14 distinct text colours and a tight surface set (`#000`, `#1C1C1E`, `#2C2C2E`, `#3A3A3C` + the iOS semantics). No rogue hexes. The problem is allocation, not vocabulary.

---

## Containers

**Two container languages, unreconciled.** Today wraps everything in `.card` on `--surface-1`. Tasks and Schedule put rows **directly on the page background** with only a hairline divider. Same app, same row content, two different ideas of what a list is.

**Radii** — tokens are 2/4/8/14/18/22/pill/circle. Painted adds two off-token values:

- `.segmented .seg` → **7px** (`jarvis-design-system.css:303`)
- `.voice-search` → **16px** (between `--r-md` 14 and `--r-lg` 18)

**Nesting is clean:** zero cards inside cards across all 30 pages. Keep that.

**Ragged text rails inside a single list.** On Money, "Rent" and "Car Insurance" start at **x=72**; "Internet" starts at **x=58** — because Internet has a 32px square icon and the others have a 26px circle. Fourteen pixels of rag inside one card. Icon slots need a fixed width so text shares one rail.

Inside cards generally, rails drift rather than step: Today runs content at 43, 46, 53, 55 and 72; Schedule runs event titles at ~92 with their own subtitles at ~104. The **page** rail (16px) is consistent everywhere — that part is solid.

---

## Buttons

**Six control heights** in the sampled screens: 56, 50, 44, 36, 32, 30. Three of those (30/32/36) are visually the same size doing different jobs.

| class | h | radius | fill |
|---|---|---|---|
| `.btn.btn-primary.btn-block` | 56 | pill | `#E2051E` |
| `.btn.btn-block` | 50 | pill | **transparent** |
| `.btn-sm` | 44 | pill | red tint |
| `.today-search` | 36 | circle | white 6% |
| `.barbtn`, `.cal-step` | 32 | circle | white 6% |
| `.chip` / `.seg` | 30 | pill / **7px** | white 6% / none |

**`.btn.btn-block` renders as an invisible button.** Pill radius, 50px tall, 17/700 type, **no background and no border**. On Tasks that's "I'm Overwhelmed" — it sits directly under the giant filled red "Just Pick One For Me" and reads as a centered heading, not a control. Two adjacent primary affordances, one shouting and one that doesn't look tappable at all. Same pattern on "Add Bill" in Money and "Add Project" in Bigger Picture.

**Suggested set:** primary 50 · secondary 50 outlined · small 44 · chip 34 · icon 44 circle. Four plus one.

---

## Spacing

**16 distinct vertical values painted.** The token scale (2/4/6/8/10/12/14/16/18/20/22/24/32/40/48) is followed most of the time, with four leaks:

| off-scale | uses | where |
|---|---|---|
| 3px | 232 | `.tab` gap, `.wk-rep` margin, `.t-hl`, several `border-left: 3px` |
| 9px | 66 | `.sh2` gap, `.grp .eyebrow` gap, `.hwrap` gap |
| 1px | 6 | `.t-hl` padding |
| 34px | 1 | one-off |

3px and 9px aren't disasters, but they're used enough (298 combined) that they're now a de-facto second scale. Either add them as tokens or round to 4/8.

---

## Hierarchy and minimalism

I measured **dominance** on each page — the area of the largest element divided by the second largest. A page with a focal point scores well above 1.

| page | dominance | reading |
|---|---|---|
| Brain, Notes, More, Settings, Decisions, Connections | **1.00** | perfectly flat — every row identical weight, no entry point |
| Tasks | 1.07 | the red button barely out-weighs the title |
| Your Routine, Account, AI Control | 1.09–1.17 | flat |
| Bigger Picture | 1.22 | mild |

Six pages score exactly 1.00. They're navigable, but nothing tells the eye where to start — which is the scan-fatigue problem the ADHD literature flags, showing up here as a pure layout metric.

The counter-example is in the app already: **Focus / Up Next** is one card, one sentence of reason, two buttons. That page has an obvious focal point and nothing else. It is the best-designed screen you have.

**Where minimalism slips:** Today renders five sections plus two persistent bars above the fold. Tasks stacks **two horizontal scrollers back-to-back** (filter chips, then category chips) directly under two competing primary buttons — four rows of chrome before the first task. Both filter strips clip mid-word at the right edge ("Overdu…"), which reads as broken rather than scrollable.

**Dead space that isn't doing work:** Appearance is one segmented control and ~1,300px of black. Connections is a ~1,100px empty card. Person detail is one row then ~900px. Money's balance card is ~250px tall for three lines with the whole right half empty.

---

## What's genuinely good

- **The page rail (16px) is consistent** across every one of the 30 pages.
- **No nested cards anywhere.**
- **Surface set is tight and correct** — real iOS values, no drift.
- **The pill radius family** (999px) is used consistently for every pill-shaped thing.
- **Focus / Up Next** is a properly designed screen: single focal point, two choices, nothing else.
- **The time ring** (`1h 30m` / `OPEN`) is the strongest single component in the app — continuous, glanceable, and unique to you.

---

## Priority order

| # | fix | effort |
|---|---|---|
| 1 | Light-theme `--tx-3` → 0.75 (218 contrast failures) | token, but see the flatness trade-off |
| 2 | `--tx-4` off the inactive tab labels (2.25:1 nav) | token |
| 3 | `.btn.btn-block` gets a visible container | one rule |
| 4 | `.sched-loc` off red; audit the other 90 red rules against the four-use law | small, high impact |
| 5 | Collapse two titles → one; three eyebrows → one | small |
| 6 | Fixed-width icon slot so list text shares one rail | small |
| 7 | Pick one container language for lists (card vs bare row) | medium |
| 8 | Collapse 6 button heights → 4; `.seg` radius 7 → 8 | medium |
| 9 | Give the six 1.00-dominance pages a focal point | medium |
| 10 | Tasks: one primary button, one filter strip | medium |

Bundle size still untouched per your standing instruction.

## Tooling added

- `tools/design-metrics.mjs` — type/color/spacing/radius/button/hierarchy measurement from computed style
- `tools/design-overlay.mjs` — draws every text rail and sub-44px target onto a screenshot
- `tools/visual-audit.mjs` — **alpha compositing bug fixed**; contrast numbers are now real
