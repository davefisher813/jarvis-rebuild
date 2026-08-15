# native/ staging area: the native seven

Staged 2026-08-15, before Apple Developer enrollment cleared. Everything in
this directory is committed but NOT compiled and NOT part of the web build:
`vite build` never touches it, and nothing under `src/native/` is imported
by any shipping file yet. The pure logic (dedupe, matching) is implemented
and tested now in `src/native/`; the Swift here is the faithful
implementation of the approved spec, waiting on signing.

## What is here

```
native/
  README.md                              this file
  PrivacyInfo.xcprivacy                  privacy manifest, ships in the bundle
  InfoPlist-strings.md                   App Review usage strings, verbatim
  ios/
    HealthKitPlugin.swift                1. Health read-only (workouts/steps/sleep)
    EventKitPlugin.swift                 2. Calendar + Reminders (one write: complete)
    ContactsPlugin.swift                 3. Contacts read-only enrichment
    NotificationActions.swift            4. Done / Tomorrow notification actions
    JarvisWidget/JarvisWidget.swift      5. Home Screen widget (WidgetKit)
    LeaveByActivity/LeaveByActivity.swift  6. Leave By Live Activity (ActivityKit)
    Intents/AddTaskIntent.swift          7a. Siri capture into Smart Paste
    Intents/NextUpIntent.swift           7b. Siri speaks the next item

src/native/  (in the web tree, typechecked and tested today)
  bridge.ts          typed plugin contracts; every method throws NotStagedError
  healthDedupe.ts    overlap-window dedupe, JARVIS wins (tested)
  eventKitDedupe.ts  iCal UID then title+30min window (tested)
  contactsMatch.ts   phone/email identity match, fill-only patches (tested)
  native.test.ts     17 tests pinning all of the above
```

## What compiles when enrollment clears

1. **App target additions** (existing `ios/App`): add the four plugin
   files (`HealthKitPlugin`, `EventKitPlugin`, `ContactsPlugin`,
   `NotificationActionsPlugin`) to the target, register them with
   Capacitor, paste the Info.plist strings from `InfoPlist-strings.md`,
   add `PrivacyInfo.xcprivacy` to the bundle.
2. **Capabilities on the App target**: HealthKit; App Groups
   (`group.com.bridge.jarvis`); Push Notifications (`aps-environment`)
   for remote pushes (local notification actions work without it).
3. **Widget extension target**: new target `JarvisWidget`, one source
   file, App Groups capability, dark-shell assets.
4. **Live Activity**: `LeaveByActivity.swift` joins the widget extension
   target; `NSSupportsLiveActivities` YES in the app Info.plist.
5. **App Intents**: `AddTaskIntent`, `NextUpIntent`, and
   `JarvisAppShortcuts` compile into the app target (in-process intents);
   App Groups carries the capture queue and the Up Next snapshot.
6. **TS wiring session**: replace the `NotStagedError` stubs in
   `src/native/bridge.ts` with `registerPlugin` calls, wire the sync flows
   through the already-tested pure functions, add the `jarvis://` deep
   link router.

## Sequencing (from the approved spec)

1. Apple Health read-only into gym history (provenance `apple_health`)
2. EventKit import + the single reminder-completion write
3. Contacts enrichment (fill-only, refuse ambiguity)
4. Notification actions (Done / Tomorrow via the Auto-Sweep push path)
5. Home Screen widget mirroring Up Next
6. Leave By Live Activity
7. Siri capture + Next Up

Each lands behind its own permission ask, asked in context at first use,
never in a permissions wall at onboarding.

## Blocked until enrollment

- Provisioning profiles and signing certificates
- Entitlements: HealthKit, App Groups, aps-environment
- Any device build of the widget, Live Activity, or intents (all need
  entitlements even for local runs)
- TestFlight distribution
- App Store Connect record

## Invariants the code enforces (do not relax in the wiring session)

- HealthKit: read only; no share types requested, no save calls exist
- EventKit: exactly one write, reminder completion; nothing else mutates
- Contacts: no `CNSaveRequest` anywhere; never create people; ambiguous
  match enriches nobody; only missing fields fill
- Widget and Siri read the App Group snapshot the app writes; they never
  rank or query the database themselves (one brain, every surface)
- Notification "Tomorrow" goes through `TasksService.setDue` with the slip
  flag, the same path Auto-Sweep uses, so slips and `task.pushed` stay one
  system
- Siri capture never asks a voice follow-up; low confidence saves a note
- No em dashes in any file, including Swift comments (house law)
