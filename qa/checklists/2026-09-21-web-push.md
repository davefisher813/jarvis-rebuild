# Manual check: web push in the PWA

Commit: f3fde6e (the change, merged with main at ba8fa4d and gated on that tree; this checklist update is the next commit)
Date: 2026-09-21
Checked by: Claude Code, in the repo; the device rows are Dave's
QA report: published to basecode-qa
Preview: not applicable, one settings row and one switch, no new screen

**What Dave asked for, in his words:** "Make decisions. This flow sucks but
just proceed." Option (a) from the diagnosis, web push in the PWA, approved
by Clemenza with six conditions on 2026-09-20.

## Steps

| # | Do this | Expect this | Actual | Pass |
|---|---|---|---|---|
| 1 | Missing server variable | `api/push` answers 503 naming the variable, never a value | proxy.test.ts: `{ missing: ["JARVIS_SECRET"] }`, the value absent from the body and from the log line | yes |
| 2 | Subscribe without a session | 401, backend never called | proxy.test.ts | yes |
| 3 | Subscribe with a session | forwarded with `x-jarvis-secret`, answers a 64 hex ownership token that does not contain the secret | proxy.test.ts | yes |
| 4 | Unsubscribe with another user's token, or another endpoint's | 403, backend never called | proxy.test.ts | yes |
| 5 | The worker gets a push with a payload, with garbage, with no data | `showNotification` every time; garbage and no data show a generic JARVIS alert | swPush.test.ts, three cases | yes |
| 6 | A tap on a notification | focuses an open window and tells it the url, else opens one | swPush.test.ts, both cases | yes |
| 7 | Every screen state has a sentence | ten input shapes map to eight states; each non native state has copy; off and on say all or nothing | webPush.test.ts | yes |
| 8 | Re-subscribe on open | once per session, stops after a failure, nothing when the switch was never on or in a Safari tab | webPush.test.ts, four cases | yes |
| 9 | The tap asks first | `Notification.requestPermission` runs before any await; a dismissed dialog is not a denial; no key means no subscribe | webPush.test.ts, three cases | yes |
| 10 | The laws | short copy, em dash, env documented, versioned storage keys, the page's own tests, and the five laws main gained while this was built | all pass after the copy was reworded to the repo's dot separator; the merged tree at f3fde6e ran all eight stages green, 6531 app tests | yes |
| 11 | On Dave's phone, from the Home Screen: Settings, Notifications, Alerts on this phone | iOS asks, Allow, foot reads "Alerts arrive on this phone" | Dave | device |
| 12 | Send a Test Alert | a banner within seconds | Dave | device |
| 13 | Switch off, then on again | no second dialog, foot back to on | Dave | device |
| 14 | Send a Test Alert again | a second banner | Dave | device |

## The standing rules

- [x] No secret printed, logged, committed, or visible in any screenshot. The
      secret lives in Vercel and rides one server to server hop; the ownership
      token is an HMAC that does not contain it; a missing variable is named,
      never valued.
- [x] Anything visual was mocked first: one switch and one row in the existing
      kit, no new screen, no new class.
- [x] The laws pass inside the tests stage.
- [x] No em dashes anywhere.
- [x] No demo data reaches a build.
- [x] Nothing pushed to GitHub except on Dave's word: "just proceed", 2026-09-21.
- [x] Nothing at phone width to check beyond the two rows, which use the
      existing Switch and Row.

## What I would tell Dave in one line

Open JARVIS from the Home Screen, Settings, Notifications, turn on Alerts on
this phone, allow, then tap Send a Test Alert.

## Notes

**Server: zero lines.** The backend was not touched. The proxy is the only
caller of its push routes.

**All or nothing, by Clemenza's condition 1.** `sendToAll` on the backend
ignores the four category switches. The copy under the switch says so.
Honoring categories is in GAPS.md as its own job.

**Definition of done is rows 11 to 14 on Dave's phone.** The gate is the
floor. Until those four rows are filled from the device, this change is
deployed, not done.

**Result: pass, rows 11 to 14 pending the device**
