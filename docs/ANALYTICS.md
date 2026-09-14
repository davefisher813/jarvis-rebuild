# Health analytics: the definitions

The prose twin of `jarvis-app/src/insights/analytics.ts`. The landing page, Insights, the record browser and the export all read these functions, so a number cannot disagree with itself across screens. Approved Health design, 2026-09-14, item 10.

## Records

- **Working set.** A logged set that is not skipped, not a warm-up and not a drop segment, and either scores (weight, reps, time, distance) or carries a done mark. Planned sets never logged are not sets.
- **Completed workout.** A saved session with at least one working set. A saved session with none stays a record (it can be opened and edited) but counts as no workout anywhere a workout is counted.
- **Active and partial sessions.** A live or parked session is not a workout until it is finished; the landing page offers Resume for it and never a second Start. A finished session with some of its plan logged is a completed workout of however many working sets it holds.

## Duration

Three readings, all kept:

| reading | how | where it shows |
|---|---|---|
| Elapsed | end stamp less start stamp | the Duration card on a saved session |
| Active | elapsed less the time the session sat parked (`pausedMs`) | every "minutes" on a training surface, training time totals |
| Set span | first logged set's stamp to the last one's | the Duration card, and the review rule |

A session is **flagged for review** when active time passes 240 minutes, or runs more than 120 minutes past its own set span. Flagging changes no number. The Duration card shows how the number was made and offers two corrections: end at the last logged set, or a typed end time. Each correction is stored in `revisions` with the value it replaced, so the original survives.

The 627-minute session: the end is stamped when Finish is tapped. A session left open (the app closed with it live, the phone in a locker, a finish the next morning) records the whole wall clock, and only parked time is subtracted. Millisecond arithmetic, pause handling and the timezone were checked and are not the cause; the stamp is honest, the session was simply never ended.

## Sleep

A night is one log of the Sleep metric, dated the local day the night **ended**, which is the date the Sleep screen asks for as Night Ending. Sleep across midnight belongs to the morning it ended on. The bedtime mark is a separate record and never a duration.

## Periods and days

- A period is inclusive of both its local ISO days. 7, 28 and 90 days end today; a custom period is the two dates typed.
- Daily boundaries are the device's local timezone, the same one every local ISO day in the app is written in.
- The previous period is the same length, ending the day before the period starts.

## Missing, not zero

A metric with no log in the period is null and renders as nothing logged, never as 0. A day with no night logged is a gap in the sleep strip, never a zero bar. A count of zero working sets is a real zero.

## Units

Loads compare only in the unit they were logged in and under the same counting convention (the whole load, each hand, each side, added, assistance). Charts that need one line across a unit change convert to pounds and say so on the axis; findings never compare across a unit or convention change.

## Muscle volume

Every working set counts in total volume. A set counts toward a muscle only once the exercise carries that muscle (set by hand on Your Lifts, keyed to the library key so a rename keeps it). The first muscle counts the set whole, further muscles half; the card names this as the app's convention, not the cited study's. Unassigned sets are shown as their own bar with the coverage stated.

## Duplicates, edits and deletions

Imported and manual records share one store; a queued write carries a clientId so a replay lands once. Every aggregate is derived from the record list at render time, so an edit or a deletion updates the landing page, Insights, details and export on the next read with no cached total to invalidate.
