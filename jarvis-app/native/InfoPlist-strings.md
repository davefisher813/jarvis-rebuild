# Info.plist usage strings (native seven)

Staged 2026-08-15. These go into `ios/App/App/Info.plist` verbatim when the
native wiring session runs. Each string states what JARVIS reads, that it
stays in the user's own account, and what is never touched. These gate App
Review: a vague string here is a rejection.

## HealthKit

**`NSHealthShareUsageDescription`**

> JARVIS reads your workouts, step counts, and sleep so your Apple Watch
> sessions appear in your gym history and your day reflects how you slept.
> This stays in your JARVIS account. JARVIS never reads any other health
> data and never writes anything to Apple Health.

Note: no `NSHealthUpdateUsageDescription` is included because the app never
requests write access. Do not add one.

## Calendars

**`NSCalendarsFullAccessUsageDescription`**

> JARVIS reads your calendar events so they appear in your schedule
> alongside your tasks. Your events stay in your JARVIS account. JARVIS
> never edits, deletes, or creates events in your calendar.

## Reminders

**`NSRemindersFullAccessUsageDescription`**

> JARVIS reads your reminders so they appear with your tasks, and marks a
> reminder complete in Reminders when you complete it in JARVIS. Your
> reminders stay in your JARVIS account. JARVIS never creates, edits, or
> deletes reminders beyond that one completion mark.

## Contacts

**`NSContactsUsageDescription`**

> JARVIS reads your contacts to fill in missing phone numbers, email
> addresses, and photos for people you already added to JARVIS. This stays
> in your JARVIS account. JARVIS never uploads your address book, never
> adds people on its own, and never changes anything in Contacts.

## Location

**`NSLocationWhenInUseUsageDescription`**

> JARVIS uses your location while you use the app to show local weather and
> to time Leave By alerts for your events. Your location stays on your
> device and in your JARVIS account. JARVIS never tracks you in the
> background and never shares your location.

## Notifications

Notification permission has no Info.plist string; the system sheet is
generic. The in-app pre-permission screen (shown BEFORE the system ask, per
the onboarding flow) uses:

> JARVIS sends a notification when a task is due or it is time to leave.
> Done and Tomorrow buttons let you act without opening the app. No streak
> nags, no marketing, ever.

## Live Activities

**`NSSupportsLiveActivities`**: `YES` (boolean, no prose). The Leave By
countdown on the lock screen and Dynamic Island depends on it.

## Checklist for the wiring session

- [ ] Paste the five usage strings above into Info.plist
- [ ] `NSSupportsLiveActivities` = YES
- [ ] Confirm NO `NSHealthUpdateUsageDescription` is present
- [ ] Register the `jarvis://` URL scheme (widget + intent deep links)
