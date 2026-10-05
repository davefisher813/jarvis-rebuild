# Smart autofill: the spec

2026-10-05. Dave's request: when a task is added and a project is picked, fill what the project can fill; when Add is tapped inside a section, already know the section; then think of every other way autofill can make life easier, and build it, with no dead ends and the rule that every autofill is visibly correct or does not happen.

This is grounded in a read of every create and edit surface (eight mappers, 2026-10-05) and in Dave's own rulings, which already bind most of the design. Where a ruling forbids something Dave asked for, this says so and offers the version the ruling allows.

## 1. What already exists

More autofill exists than it feels like, and it is uneven.

- **Task sheet, project pick:** fills a BLANK primary area from the project's area and sets the goal to the project's live goal (`TaskSheet.fillAreaFrom`, Dave 2026-09-09: "if someone selects a project or event connected to a goal or category it should autofill when it can"). Event pick fills a blank area the same way. Flaws: once filled it never refreshes if the project changes, and picking None does not clear it, because "blank" is tested as "has any area" and cannot tell a typed area from a filled one.
- **Launch context:** the Tasks tab passes only the view's due date and Daily's repeat. It throws away the Area chip, the search text and the group. The Area page and Project page do pass their area, project and goal. A Goal page's add does not carry the goal's area. Life-lens adds carry nothing.
- **Capture (Quick Capture, Smart Paste):** reads day words, clock times, repeat words, amounts, one named person, one whole-title project match. It never takes the matched project's area or goal. The AI path cannot supply a person or project id. Person aliases ("Mom") never match in capture because it is handed names only.
- **Events:** title memory fills a whole event from the last one (`suggestTitles`), locations (`suggestLocations`), a weekly-repeat offer after three weeks (`repeatCandidate`), travel minutes per place, next free slot. Category suggestion (`suggestCategory`) exists but only capture calls it, not the event sheet.
- **Money:** a vendor's last category (`lastCategoryFor`) for receipts and transactions; a monthly-recurrence offer after three consecutive months (`suggestMonthly`); a new budget month copies last month's limits; the next recurring bill copies the paid one.
- **Gym:** the next set fills from the last session (Dave 2026-09-27), warm-up ramp is derived, double-progression ghost with an explicit Accept.
- **Elsewhere:** a thread's next task inherits the thread's newest filed sibling's project and area; a project with no area is offered the majority area of its tasks; one goal means a new project opens linked to it; protected-block and routine offers from repeated events.
- **Not found anywhere:** title-word dates in the Task sheet, project-derived people or length or extra areas, per-area defaults or templates (an area stores a name, colour, icon and order only), a project's defaults (it stores an area, a goal, a due date and a status only), last-used memory for tasks, a vendor's previous bill for the Bill sheet, a contact's details filling an event's guest, any duplicate-name check when adding a person.

## 2. The principles (these are rulings, not preferences)

1. **Visible.** Every filled value is shown in its own field, with one quiet fact saying where it came from ("From Bridge", "From the title", "From last week"), and one tap clears it. Dave, in code he approved: "Never silent. An Area JARVIS chose and never mentioned is worse than no Area." The fact is the sky fact the Colour Key already gives to "something the app worked out" (`.fact.est`), never a second grey line (one grey per row, §AK), never brand red (red means tap).
2. **Blank only, and never again once touched.** Autofill fills an empty field. It never overwrites a value a person typed or picked, and once a person has changed a field in that sheet, autofill never touches that field again in that sheet. "Overwriting an area he set by hand would be the app arguing with him." The sheet remembers which fields it filled and which a person touched; a filled field follows its source (change the project, the filled area follows) until touched.
3. **Derived at runtime, stored as nothing.** Suggestions are computed from data already loaded (`memory.ts`: "nothing to migrate and nothing to go stale in sync"). No new stored state except an explicit rule, and a rule follows the rules doctrine: born from two identical corrections, announced on first use, dead on one contradiction, listed in What JARVIS Learned.
4. **Deterministic first, AI never required.** Everything below works with AI off (zero proxy calls). AI is never an input to a field a person did not ask it to fill.
5. **One answer acts, several ask, none stays silent.** One unambiguous candidate fills visibly. Two or more become a bounded chooser of chips. Zero shows nothing and no placeholder: a line that states nothing is itself a violation.
6. **A wrong guess is worse than nothing.** Every inference has a floor (sample size, strict majority, exact match) and errs toward silence. Accept and dismiss are counted (`suggestion.accepted` / `suggestion.dismissed`, the existing event pair) and an inference whose measured accept rate is poor switches itself off, as the Looks Related link already does.
7. **Offline.** Only data already in memory is an input. A missing store means learn nothing, never crash.
8. **No dead ends.** Every autofill chip or fact is a real control with a real effect, at least 44px, in Title Case, no sentence in a rendered string, and it works in light and dark.
9. **No invention.** Never a guessed date for a bill, a classification from an exercise name, a relationship from an area name, a link from title words to a project or goal, a recurrence nobody confirmed.

## 3. The engine (one place, pure)

`src/autofill/` holds pure functions and one hook. Nothing in it imports a service or touches storage (a law enforces that), so every rule is testable with plain data.

- **`resolve(kind, inputs) -> Candidate[]`** where a candidate is `{ field, value, certainty: "certain" | "likely", reason, evidence }`. `reason` is the short fact the person sees ("From Bridge"); `evidence` is the count or id it rests on.
- **Policy, one table:** `certain` and the field is blank and untouched: fill and show the fact. `likely`: show a chip, fill nothing. Two candidates for one field: show chips, fill nothing.
- **`useAutofill(draft)`** (sheets): tracks `filled` (field to {value, reason, source}) and `touched` (set of fields). `fill()` is a no-op for a touched field. A field edit marks it touched. A source change re-resolves only fields still in `filled`. Exposes `clear(field)` and `applyAll()`.
- **`<AutoFact>`**: the sky fact plus a Clear control for a filled field, and the chip row for offers. It is the only way autofill is drawn, so the look and the 44px target are in one place.
- **Provenance:** field-level, and only inside the sheet. It is not stored, and the entity `source` is not overloaded (provenance lines are facts about auto-CREATED entities, not about fields).
- **Laws added:** the engine imports no service; every field a sheet fills renders an `AutoFact`; no filled field survives a touch; the sheet-fields law (every call site loads and saves every field) is unchanged because autofill adds no field.

## 4. Dave's two cases, specified

### Case 1: add a task, pick a project (Bridge)

On picking a project in the Task sheet's Where group:

| Field | Behaviour | Certainty | Notes |
|---|---|---|---|
| Area | Fill the project's area if Area is blank | certain | Exists. Now follows the project until touched; None clears a filled one. Shows "From Bridge". |
| Goal | Fill the project's live goal | certain | Exists. Same follow and clear. |
| Extra areas (the tags) | Offer the project's goal's areas, and the areas its other tasks carry, as chips | likely | Never auto-added: "adding to the extra set would silently spread a task across areas he never chose" (TaskSheet comment). One tap per chip, or Use All. |
| Person | Offer the person most of the project's open tasks are with, if a strict majority of at least 3 | likely | Chip "Brian · From Bridge". |
| Length | Offer the project's median task length (at least 3 samples) beside the existing per-area fact | likely | Fact line stays a fact by ruling; the offer is a chip. |
| Due | Never filled. If the project has a due date, show "Project due Oct 20" as a fact | n/a | Dates are never invented. |

Project "defaults" are therefore derived from the project's own tasks and goal, not stored. If Dave wants defaults he types himself (a default person, a default length), that is a Phase 3 explicit field on the project, not an inference.

The same fill applies in every task-creation path, not only the sheet: capture. A captured line that names a project ("Send invoice, Bridge") today files only the project id; it will inherit the project's area and goal, and the receipt will say so.

### Case 2: Add inside a section

The rule: **Add inherits where the person is.** The launching screen already knows (the Area chip, the lens, the goal or project page, the person page, the tab's view); the sheet is told, fills the matching field visibly, and says "From the JARVIS Area" (not "From the filter", so it reads as a fact about the screen).

| Add from | Fills |
|---|---|
| Tasks tab with an Area chip | Area (today the chip is thrown away). Plus the view's due/repeat, which exists. |
| Projects or Goals page with an Area cut ("the JARVIS section") | Area on the new project or goal. |
| Goal page, Add Project | The goal and the goal's area (today only the goal). |
| Project page, Add Task | Project, its area and goal (exists; add the offers above). |
| Area page, any Add | The area (exists for task, goal, project, event; add for person and note). |
| Person page, Add Task or Event | The person. |
| Schedule day, Add Event | That day, and the gap if it came from a gap (today the New Event door from a gap forgets it). |
| Contacts opened from an Area | The person's areas. (Reverses the 2026-08 PeopleFlow comment "nothing is inferred from where they tapped Add"; Dave's 2026-10 request supersedes it.) |
| Notes opened from an Area page | The note's area. Decision for Dave: this meets his 2026-08-29 ruling "NO SILENT FILING" only because the fill is visible and context-derived rather than `catList[0]`; All Notes still starts unfiled. |

A filtered Add must also say so (Life Header rule 7: a filter that narrows what is shown, and an Add scoped by it, must be visible).

## 5. The wider catalogue

Status: **Exists** (works today), **Fix** (exists but wrong), **New**, **Offer** (a chip, never an auto-fill), **Ruled out** (a ruling forbids it).

### Tasks

| # | Autofill | Status | Rule |
|---|---|---|---|
| T1 | Project to area, goal | Fix | Follow and clear (above). |
| T2 | Project to extra areas, person, length | New, Offer | Above. |
| T3 | Title words to due date | New | Read with the existing deterministic resolvers (`resolveDay`, `resolveTime`, `resolveRepeat`). "tomorrow", "today", "tonight", a weekday name, an explicit date ("Aug 20", "8/20", "the 1st") on a blank Due fills it visibly: "Due Tomorrow · From the title", one tap clears it. The title is never edited silently; a second control, "Remove the Word", takes the word out. Weekday means the NEXT such day, never today. A three-letter weekday, "may", "march", "sat" count only beside a clock time or "on/by/next". "Later", "soon", "eventually" read as nothing. |
| T4 | Title to repeat | New, Offer | "every Monday", "daily", "weekly" on a blank Repeat offers a chip. Not auto-filled: a repeat is a standing promise. |
| T5 | Title to person | New | Exactly one contact answers to a name in the title (the existing narrow matcher; ambiguous first names need a surname): fill the Person visibly. Two: chips. |
| T6 | Title to area | Offer | History vote across past task and event titles, at least 2 shared significant words, never auto-filled (Dave was burned by this class: `memory.ts` 2026-09). Chip "Work · From 3 similar". Subject to the accept-rate kill switch. |
| T7 | Title to project or goal | **Ruled out** | Dave 2026-09-06: "unlabeled tasks randomly go into projects and goals that have nothing to do with them"; where a task lives is "a link someone made, not a filter that matches it". The only allowed link is an exact whole-title project match in capture, which exists. |
| T8 | A task done the same way three times, repeat? | New, Offer | The event repeat offer, for tasks: same normalized title done weekly three weeks running, ask once. |
| T9 | Length from the area's learned median | Exists | Stays a fact; add the chip. |
| T10 | Start step, first step | Exists | Unchanged. |

### Projects and goals

| # | Autofill | Status | Rule |
|---|---|---|---|
| P1 | Add from an Area cut, goal page, Life lens | Fix | Section 4. |
| P2 | Project with no area: majority area of its tasks | Exists, Fix | Today only on the detail page; also offer in the Project sheet. |
| P3 | One goal means a new project is linked | Exists | Visible in the sheet. Excludes achieved and dropped goals (today it counts them: Fix). |
| P4 | "Looks Related" goal link | Exists | Title-overlap, one per card, dismissals permanent, self-killing. Keep as is. |
| P5 | Project due from goal date | **Ruled out** | No invented dates. |

### Events and reminders

| # | Autofill | Status | Rule |
|---|---|---|---|
| E1 | Title picks a past event | Fix | Fill only blank fields; today it overwrites start, end, place and area. |
| E2 | Locations | Fix | Today an empty title shows the three most frequent places overall; show them only when a title or the field has focus and a same-title place exists. |
| E3 | Category from history | Offer | Wire `suggestCategory` into the Event sheet as a chip. |
| E4 | Guests from a known person | New | Picking a contact as a guest fills their email (the primary email, normalized). Phone for "text them". Never invites on its own. |
| E5 | Gap to start and end | Fix | The New Event door from a gap forgets the gap. |
| E6 | Travel minutes per place | Fix | `rememberPlace` passes null minutes in one path (verified by a mapper's probe); remembered minutes are offered next time. |
| E7 | Repeat weekly after three weeks | Exists | Extend beyond the Schedule tab (Today and Area adds). |
| E8 | Reminder day and time from the title | Exists | `readQuick` strips the matched words; a shared resolver replaces its private regex copy (drift risk). |

### Money

| # | Autofill | Status | Rule |
|---|---|---|---|
| M1 | Bill: vendor picks the last bill of that vendor | New | On a blank new bill, choosing a known vendor offers its last amount, due day of month, autopay, pay link and notes, as one "From last time" chip row (apply all or each). Amount carries "Last was $84". Due date stays blank unless the person fills it (no invented dates, ledger rule 3). |
| M2 | Recurring bills from history | Exists, extend | Monthly after three consecutive months exists; add weekly and yearly with the same floor and the same explicit Yes. A suggestion is a candidate, never a schedule (ledger rule: recurrence is the person's call). |
| M3 | Rolled next bill with a variable amount | Fix | The next bill copies the paid one's amount; flag it "Last was" and let the person correct it before it counts. |
| M4 | Vendor to category | Exists | Receipts and transactions; extend to subscriptions' merchant. |
| M5 | Receipt date | Exists | Today is the one allowed default. |
| M6 | New budget month | Exists | Copies last month's limits and says so. |

### People and mail

| # | Autofill | Status | Rule |
|---|---|---|---|
| PE1 | Add person from an Area | New | Section 4. |
| PE2 | Typing a name that already exists | New | "Already in Contacts: Sam Lee" chip that opens the existing person instead. Name alone never merges (`duplicatesOf` is email or phone). |
| PE3 | Email to company | Offer | The domain, free mail excluded, as a chip for the Organization field. |
| PE4 | Add person from a thread | New | Name and email from the header. |
| PE5 | Known person to guest, recipient, text | New | E4 plus: typing a name in an email's To offers matching contacts with their address; a Task's "Text Mom" exists. |
| PE6 | Relationship from an area name | **Ruled out** | Dave 2026-09-16 ("Family · Family"). |
| PE7 | Device contacts enrichment | Dead code | `native/contactsMatch.ts` is not called by the app today; wiring it needs the native contacts bridge and is not part of this. |

### Notes, brain, areas

| # | Autofill | Status | Rule |
|---|---|---|---|
| N1 | New note's area from the Area page | New | Section 4, with the ruling note. |
| N2 | Note title | Exists | First line names the note at display time. |
| A1 | Area defaults and templates | New, Phase 3 | An area stores only a name, colour and icon today. Allow typed per-area defaults (default length, default repeat, a starter steps list) that fill a blank new task in that area with the same visible fact. Explicit and typed by the person, never inferred. |
| A2 | New Area: kind from its name | Fix | `suggestKind` runs once at mount so it does nothing on New Area; run it as the name is typed, as a chip. |

### Gym, health, routine

| # | Autofill | Status | Rule |
|---|---|---|---|
| G1 | Next set from the last session | Exists | Dave 2026-09-27. |
| G2 | Add Exercise: near-duplicate names | Offer | `findDuplicates` exists and runs only on the library page; run it on the Add Exercise name field: "Looks Like Bench Press (Flat)". |
| G3 | Add Exercise: rest, ramp, note from the last use of that lift | Fix | Library does not carry them; the audit fixes for this are in review. |
| G4 | Classification from the name | **Ruled out** | LAW 18: never inferred from an exercise's name. |
| G5 | Dose time | Exists | Took It defaults to now. |
| R1 | Routine block from repeated events | Exists | One offer at a time. |

## 6. Where the data comes from, and the ceiling on each

| Source | Used for | Floor |
|---|---|---|
| The launching screen | Section 4 | Always certain (the person is standing there). |
| The picked project, goal, person, event | T1, T2, E4 | Certain for its own fields; likely for anything derived from siblings. |
| Siblings (a project's other tasks) | T2 | At least 3, strict majority for a person, median for a length. |
| The title's words | T3 to T5 | Deterministic resolvers only; ambiguous means nothing. |
| History (past titles, past bills) | T6, T8, E1, M1, M2 | Exact match, or at least 2 shared significant words, or three consecutive periods. |
| Typed explicit defaults | A1 | Always certain. |
| AI | Nothing in this spec | Not an input. |

## 7. What the person sees

One pattern everywhere, shown in the Task sheet:

- A filled field looks like any filled field. Under or beside it, one sky fact: "From Bridge". Tapping the fact opens nothing; a trailing "Clear" control (44px) empties the field and marks it touched so it does not refill.
- An offer is a chip in the field's own row: "Brian · From Bridge". Tapping fills it. Dismissing it (a long press or its own close control) is remembered for the sheet's lifetime and counted for the kill switch.
- Several offers for one field are a bounded row of chips (at most 3), most evidence first.
- Nothing appears when there is nothing to say.
- A toast is never used for an autofill (it would cover the field it describes).

Dave reviews on an iPhone, so previews are rendered through the real component and stylesheets from a scratch bench with text size pinned (`-webkit-text-size-adjust: 100%`), per CLAUDE.md. A preview of the Task sheet with the Bridge case, and of an Add inside the JARVIS section, goes to him before the build merges.

## 8. Build order

**Phase 1** (Dave's two cases, and what makes the rest possible):
1. `src/autofill/` engine, `useAutofill`, `AutoFact`, the laws.
2. Task sheet: project and event fills follow their source and clear; the Task sheet title-date read (T3); person from title (T5).
3. Launch context carried into every Add (section 4), including the Tasks tab's Area chip, Goal page, Life lenses, Area-page person and note adds, gap to New Event.
4. Capture inherits a matched project's area and goal, and shows it in the receipt.

**Phase 2:** project-derived offers (T2), project sheet offers (P2, P3), event sheet history (E1 to E6), bill history (M1 to M3), person-to-guest and duplicate-name guard (E4, PE2 to PE5), Add Exercise duplicates (G2).

**Phase 3:** typed area defaults and templates (A1), task repeat offers (T4, T8), title-to-area offers behind the kill switch (T6), learned rules for areas after two corrections.

Each phase ships on its own, each behind the same laws, and each autofill carries tests that fail without it.

## 9. How each autofill is proved

1. A pure-function test of the rule with adversarial inputs (ambiguous words, ties, one sample, a stale source, a done project, a paused area).
2. A sheet test: fills when blank; does not overwrite a typed or picked value; does not refill after Clear; follows a changed source until touched; shows its reason; saves exactly the field and nothing extra.
3. Mutation check: undo the rule, see the test fail.
4. The tap-sweep crawler runs over every sheet touched, so a chip or Clear that does nothing fails the build.
5. A rendered preview on a phone-sized viewport, light and dark, for Dave.

## 10. Decisions for Dave

1. **Title words fill Due visibly** (my recommendation, because it is what "autofill when it can" and "tomorrow, Friday" ask for, and one tap clears it), or only offer a chip?
2. **Notes opened from an Area start filed to that Area** (visible, and Clear takes it off), or stay unfiled as the 2026-08-29 ruling says?
3. **Title to area as an offer chip at all?** The same idea burned him once; the safeguards are two-vote floor, offer only, and a kill switch. Skipping it is safe.
4. **Project defaults:** derived from the project's tasks (this spec), or typed by him on the project as well (Phase 3)?
5. **Where the section label reads "From the JARVIS Area"** or something shorter ("JARVIS")?

Nothing in Phases 1 to 3 touches the frozen Today TV guide or the protected-block resolver, and none of it adds a stored field except the typed area defaults in Phase 3.
