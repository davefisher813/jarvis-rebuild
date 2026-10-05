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

`laws/catalogCheck.ts` `capsulesInRows` flags a `.pill-act`, `.row-act`, `.btn-sm` or `.quiet-action` inside a list row (`.task-row`, `.rem-row`, `.rem-card`, `.sched-row`, `.lib-row`, `.conn`, `.notice-card-row` that is not a settled notice) or at the foot of a list card. Every jsdom test runs it (`laws/catalogSetup.ts`). `laws/catalogRoster.ts` lists the exceptions, each with a reason, and starts as short as the rules above allow. The tap sweep covers the same on the real screens.
