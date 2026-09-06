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

## Already in the shipping Info.plist (UP-LAUNCH-03, 2026-09-05)

The web shell asks for two of these today, so two of them have landed in
`ios/App/App/Info.plist` and must NOT be pasted again:

- `NSLocationWhenInUseUsageDescription`, in the narrower wording that
  describes only the weather line. The staged string above also promises
  Leave By alert timing, which the shipping shell does not do; it replaces
  the narrow one in the same session that ships Leave By.
- `NSCameraUsageDescription` (new, not staged above, because the staging pass
  read the native seven and missed that four web image inputs already offer
  Take Photo): "JARVIS uses the camera only when you choose Take Photo to
  read a schedule, a program or a document. Photos stay in your JARVIS
  account."

The privacy manifest landed the same way: `ios/App/App/PrivacyInfo.xcprivacy`
is the trimmed version of `native/PrivacyInfo.xcprivacy`, carrying only what
the shipping binary can collect. Health, Fitness and Contacts come back to it
in the same commit as the plugin that earns them. `src/laws/appStore.test.ts`
fails if either file drifts from what the source actually asks for.

## Checklist for the wiring session

- [ ] Paste the three remaining usage strings above into Info.plist (Health,
      Calendars, Reminders, Contacts: the two below have landed already)
- [ ] Widen the Location string once Leave By ships
- [ ] `NSSupportsLiveActivities` = YES
- [ ] Confirm NO `NSHealthUpdateUsageDescription` is present
- [ ] Register the `jarvis://` URL scheme (widget + intent deep links)
- [ ] Add Health, Fitness and Contacts back to `ios/App/App/PrivacyInfo.xcprivacy`
