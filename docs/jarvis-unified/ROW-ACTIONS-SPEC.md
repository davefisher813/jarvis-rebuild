# Row actions: clean rows, swipe, sheet, section heads

Dave, 2026-10-05, locked: "Clean rows, no pills anywhere. Tap a row, detail bottom sheet with all actions. Swipe left, the row's quickest contextual action. Swipe right, Complete. Long-press, context menu. Section-level actions move into section headers, never inside cards or rows. One exception: the completion checkbox stays inline on rows because it represents state, not a command." This is the contract every screen is rebuilt to. Where this file and an older ruling (§AK "in-list create is a trailing `.row-act`", the capsule-on-every-row pattern) disagree, this file wins.

## 1. The model

| Gesture | What it does | Built from |
|---|---|---|
| Tap the row | Opens the row's detail sheet. Primary action prominent, quieter ones beneath (Snooze, Move, Edit, Drop). | The row's existing sheet (`TaskSheet`, `ReminderDetailSheet`, ...). Add the actions it lacks. |
| Swipe left | The row's ONE quickest contextual action (table below). | `useSwipe` (`shared/useSwipe.ts`), the one gesture controller. Never a second implementation. |
| Swipe right | Complete (tasks, reminders, bills). Rows with nothing to complete opt out. | `useSwipe` `rightW` + `onRightCommit`. |
| Long press | The context menu: every action again, for power users. Never the only way to anything essential. | `RowActionSheet`. |
| The checkbox | Stays on the row. State, not a command. | existing `.cb` / `.task-check-tap`. |

Swipe-left action by state:

| Row | State | Swipe left |
|---|---|---|
| Task | ready to work | Start |
| Task | active (being worked) | Wrap Up |
| Task | low priority or parked | Drop or Move |
| Task | otherwise | Done |
| Reminder | upcoming | Snooze |
| Reminder | due now or overdue | Snooze (also surfaced on the row, section 3) |
| Bill | any | Mark Paid |
| Notification | any | Done |
| Anytime block on the day | any | Drop |
| Anything else with one obvious verb | | that verb |

A row with no meaningful quick action has no swipe-left; it never invents one. Delete stays behind the reveal where it already is (`task-del`), as the second tray button, never the only one.

## 2. Where every other button goes

- **Section-level action** (Add a Task, Add a Reminder, Add Account, Add Bill, Add Item, Add a Note, Add Milestone, Plan My Day, Plan Tomorrow, Wrap Up for the day, Copy Yesterday, Add Person, Add Area): in the section head, as the one `see-all pill-action` capsule beside the title, exactly as New Event and Schedule sit on Tonight. Never inside a card, never at the foot of a list. A section with nothing in it draws its head and the action only; no empty plate (rule 12).
- **A sheet's group** (Checklist: Add Item; More: Add a Note): the group's own label row carries the action at its right, same capsule.
- **Row-level action** (Start, First Step, Snooze, Done, Drop, Adjust, Pay, Track, Open): gone from the row. It is the swipe, the row's sheet, and the long-press menu.
- **A card with its own words and actions** (notice cards, promo cards, permission asks, the Email review card, a receipt): these are the settled PROMO/NOTICE card pattern (§AK banners, actions as full-width pills with accent text) and are NOT rows. They stay. A card that is only a list of rows with a button in it is not that.
- **Toasts, action sheets, confirm dialogs, a sheet's bar and footer** (Save, Cancel, Undo, Delete): unchanged.
- **Form submit and primary buttons** (the screen's one filled primary): unchanged.

## 3. Contextual surfacing

A row whose moment has come quietly shows its one action ON the row: a reminder that is due now shows `Snooze`; an overdue task shows its action. Future items show nothing. It is the SAME action as the swipe-left (so there is one verb per row), drawn by `RowCtxAction` (`shared/RowCtxAction.tsx`): text only, no capsule, no fill, `--tint`, `--t-caption` 700, a 44px hit area, sitting at the trailing edge before the chevron. It is the only text-only action in the app and exists only while its condition holds. Never more than one per row.

## 4. Teaching the swipe, three parts, no permanent affordance

1. **Peek, once.** On the first launch of the Today list, the first swipeable row slides left about 40% of its reveal to show its action, then slides back. One time, ever (`jarvis.swipe.peeked.v1`). Skipped under Reduced Motion (the tip still shows).
2. **Tip, until used.** A dismissible line at the top of the Today list on first run: "Swipe a task for quick actions". Gone for good after one real swipe or one dismiss (`jarvis.swipe.tip.v1`).
3. **Nothing else.** No grip dots, no hint chevrons, no always-visible rail. `shared/swipeTeach.ts` owns the state; `shared/SwipeTip.tsx` is the tip; `useSwipe` has `peek()`.

## 5. What enforces it

**The law: `capsulesInRows`** (`laws/catalogCheck.ts`, run on everything every jsdom test draws by `laws/catalogSetup.ts`). It fails the test that draws a capsule (`.pill-act`, `.row-act`, `.btn-sm`, `.quiet-action`) in a list row or at the foot of a list card.

- **A list row** is a `.task-row`, `.rem-row`, `.rem-card`, `.sched-row`, `.lib-row`, `.conn`, or a `.row` inside a `.list-card-ruled`, plus the row classes the rebuilt screens use for the same job (`.msg-row`, `.anytime-row`, `.lifemap-row`, `.conn-row`, `.offer-row`). The selector is `CAPSULE_ROW`.
- **A list card** is a `.list-card-ruled` or `.card` that holds at least one list row beside the capsule. A capsule in one, outside every row, is "at the foot of a list card" (the old trailing "Add a Task" row).
- **The finding** reads `label @ row-class` (in a row) or `label @ foot of card-class` (at a foot). An empty card whose only content is a capsule is not this law's business; `loneActionBoxes` (rule 12) holds that.
- **The settled homes** (`CAPSULE_HOMES`) are never reported, because they are where a capsule belongs by section 2: a section head (`.sh2`); a sheet's bar, foot or action line (`.sheet-bar`, `.sheet-foot`, `.sheet-actions`, `.bar`); an action sheet (`.action-sheet`); a notice or promo card, with its own words and its own action, including NoticeCard's offer form (`.notice-card`, `.notice-actions`, `.notice-clear-row`, `.promo-card`, `.promo-actions`); a toast and its Undo (`.toast`, `.toast-dock`); a card with its own words and its own actions (the goal check-in outcome row `.dec-outcome-acts`, the reminder Advice strip `.xs-strip`, the send-hold card `.send-hold`, the meeting card `.msg-summary`, the waiting card `.wait-card-acts`); a live control card (the rest timer, `.rest-acts`); and an empty state with its own title carrying one quiet escape (`.empty-state`).
- **The roster** (`laws/catalogRoster.ts` `CAPSULE_ROSTER`) is per test file, then per finding, each with a reason. It was measured over the whole suite on 2026-10-05 (`CATALOG_REPORT=<file> npx vitest run`, about 8 minutes) and holds only what the homes do not cover. Today that is the People repair card and review rows, listed as DEBT so nothing new joins them; an entry goes when its screen finds a real home. A capsule that a screen draws for the first time in a row fails the test that draws it, with the finding in the message.
- **Proof it sees what it is for:** `laws/capsulesInRows.test.ts` builds a row of every kind with every capsule class on a detached element and expects the finding, builds each settled home beside a row and expects silence, and pins the selector lists.

**Beside it:** `capsulesInCards` (the wide net: any capsule in any `.card`, `.row` or `.grp`) is the helper the screens' own tests call on their own DOM; `loneActionBoxes` (rule 12); the swipe laws (`editingPrimitives`, `swipeDelete`, `swipeSlot`) roster every swipe surface by file with its pan-y class, its right-swipe verb or its reason it has none, and its Delete or its reason; the tap sweep covers the same on the real screens.
