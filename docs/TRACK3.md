# Track 3, 2026-09-14: what is built, what waits

Source: `Claude outputs/JARVIS_TRACK3_BUILD_MASTER_2026_09_14.md` and
`JARVIS_TRACK3_PREVIEW_2026_09_14.html` (Dave: "Do all of this").

## Built

- **The schema, as files.** `jarvis-core/supabase/track3/0001` to `0005`: the
  spine (orgs, org_members, areas, goals, projects, tasks with a denormalized
  `area_id`, persons with the one-attachment CHECK), RLS through
  `current_org_id()`, the Vault-backed connector tables, booking with the
  `exclude using gist` constraint on confirmed overlaps, connections with the
  two canonicalized partial unique indexes, `connection_permissions` reserved,
  `project_shares` with its scope trigger, the two helper functions, the
  additive shared-read and shared-edit policies, and `tasks.assigned_to_user_id`.
  Not in `supabase/migrations/`, so nothing runs them by accident.
- **Your Times** (Settings > Booking, `src/settings/BookingPage.tsx`,
  `src/booking/settings.ts`): the preview's Booking Settings screen. Available
  on or off, the days, the slot length (15, 30, 45, 60), who can book, the
  visibility. Stored on the device; it is what seeds `availability_rules` and
  `booking_links` the day a booking server exists. The links card says No
  Links Yet and why.

## The project (2026-09-14)

The Track 3 Supabase project exists: `zxszpuyhwvalfpfqgutq` ("Jarvis Track 3", org "Jarvis", free plan, us-east-2), created through the Supabase MCP with the seven files under `jarvis-core/supabase/track3/` applied in order, the security advisor clean, the shared-project policies and the rate limiter each proven by a rolled-back test. Vault is installed on it by default. Clerk is not wired yet, so every policy evaluates to nothing through the anon key, which is the safe direction. The live JARVIS project (`roonancpktqigdndrumo`) is untouched by any of it.

## The server, which existed all along (2026-09-19)

This document said four times that there is no server. That was wrong from the day it was written: `jarvis-app/api/` holds eight Vercel edge functions, two of which (`_admin.ts`, `account/delete.ts`) already do service-role writes against Supabase. Nothing had to be stood up; the booking endpoint had only to be written.

**`api/book.ts`** is it. `GET /api/book?slug=<slug>` returns a link's open slots; `POST` takes one. It is the most exposed surface in the app, because a booking link is worthless if the holder needs an account, so it is written accordingly:

- It reads `TRACK3_SUPABASE_URL` and `TRACK3_SUPABASE_SERVICE_ROLE_KEY` and nothing else. The live project's keys are not reachable from the file, so a mistake in it cannot touch the app's real data.
- It fails closed. With either unset it answers 503 and writes nothing, rather than falling back to another project.
- It never trusts the client's arithmetic. The client posts a start; the server recomputes the grid and refuses a start that is not on it. The slot list is a convenience, not an authorization.
- The database arbitrates the race. Two strangers can take the same slot in the same second; `bookings`' exclusion constraint rejects the loser and the endpoint turns that into "someone just took that time" rather than a 500.
- A `named_contacts` link answers 404 rather than 403, because whether a private slug exists is itself worth not saying.

**`src/booking/slots.ts`** is the arithmetic behind it, pure so it can be tested without a network or a clock. Seventeen tests pin it. Three things it gets right that a naive grid does not: a zone is not an offset (the same wall clock is a different instant in June and December, and the test asserts both), a buffer widens what counts as a clash but never widens the slot that is offered or written, and a day already at its cap offers nothing rather than offering a slot the database would refuse.

**What Dave has to do, once:** add those two variables to the Vercel project. The URL is the Track 3 project's API URL; the service key is on the same settings page. Until then the endpoint answers 503, which is the correct behaviour and not a bug.

## The page a stranger sees (2026-09-19)

`/book/<slug>` is the only address in this app that renders before the auth gate, because a booking link is worthless if the person holding it needs an account. `src/booking/publicRoute.ts` decides what counts as one, strictly: a slug that is not a slug is a URL the app does not answer, rather than a query passed along to be refused later.

`PublicBookingPage.tsx` carries no provider and no store. It talks to `/api/book` and to nothing else, so a visitor standing on it has no route to the app's data at all. Three decisions worth keeping:

- **The times are the visitor's.** A grid drawn in the owner's zone asks a stranger to do arithmetic before they can pick a meeting, and they will get it wrong. Every time is in the browser's own zone, grouped into the visitor's days (a slot can be Tuesday for the owner and Wednesday for them), with the owner's zone stated once.
- **The form arrives with the choice.** Asking for an email before a time is picked is asking someone to pay before they know what for.
- **The server decides, and the page says so.** If the slot goes while they are typing, the message says that and the grid reloads. The reason is drawn ABOVE the grid rather than inside the form, because dropping the choice unmounts the form: the first version erased its own explanation in the same tick that made it true, which its test caught.

Still to build here: nothing on the visitor's side. What the host sees is below.

## The confirmation, which was the one promise (2026-09-19)

The receipt screen told every visitor a confirmation was on its way, and nothing sent one. That was the single line in this feature that was a promise rather than a fact, and it is now a fact.

**It sends from the host's own mailbox, not from a service.** The alternative was a transactional mail vendor, which means a new account, a new secret, a from-address that is not the host's, and a much better chance of landing in spam. The app already stores a Google grant for the host and already knows how to send with it. So the confirmation comes from the address the visitor just agreed to meet, lands in the host's own Sent, and a reply reaches a real person. It needs no new environment variable at all.

**The seam, stated plainly.** `api/book.ts` is the only endpoint here with no auth in front of it, and it was written to name no live-project credential anywhere. The grant lives in the live project, so that discipline has to bend exactly once. It bends in `api/_receipt.ts`, whose whole surface is one function, and the honest version of what that discipline is: every function in a deployment can read every variable, so it was never a wall, it is a rule about what the public endpoint does, kept small enough to read in one sitting. What the seam may do with the live project is read ONE row and send ONE message. Its tests assert that every live-project request it makes is a GET.

**It never fails a booking.** The slot is already taken by the time the receipt runs. A host who has not connected Google, a revoked grant, Gmail refusing the message: each means no receipt and none of them means no booking. The endpoint answers with `confirmationSent`, and the page now says either that an email is on its way or that the time is held and nothing went out. Promising an inbox an email that does not exist is how a booking becomes a no-show.

**The clock the email is on is the visitor's.** Their browser sends its zone with the booking, because only it knows. A receipt written in the host's zone asks a stranger to do arithmetic about a meeting they have already agreed to, which is exactly when somebody misses one. The host's zone is stated once underneath, and only when the two differ. A zone name from a stranger's browser is not trusted: it is tried against the runtime first and falls back to the host's, because a bad zone name makes `Intl` throw.

**An .ics, not an invitation.** A real invitation (`METHOD:REQUEST`) makes a mail client offer Yes, No and Maybe, and those answers go to an organizer address with nothing listening. A button that does nothing is worse than no button, so the attachment is a `METHOD:PUBLISH` calendar file and the client offers the one thing it can do, which is add it.

`src/booking/receipt.ts` is the words and the calendar file, pure and tested, including the two details that are quiet bugs otherwise: an unescaped comma or semicolon in a meeting name ends a calendar property early and the event loses its title, and RFC 5545 folds lines at 75 OCTETS, so a name with an accent in it arrives as mojibake if the fold is measured in characters.

`api/_google.ts` is the cipher, the two OAuth clients and the refresh, MOVED out of `api/google.ts` rather than copied. Two copies of AES-GCM code is how one of them stops decrypting what the other wrote. Sign-in still owns the code exchange and forgetting a revoked grant, which is the part only it can do, because only it can ask the person for a new one. Twenty tests now cover what was previously untested because it was private.

## The host finds out (2026-09-19)

A booking had been landing in Track 3 since the public page shipped and the host had no way to find out. The visitor got a receipt; the person whose day it was did not. That is worse than having no booking system, because he fills the hour himself and only one of the two people turns up expecting company.

**It lands in JARVIS's own schedule, not in Google, and that is a rule rather than a shortcut.** The stored Google grant is `calendar.readonly` on purpose, under a standing decision written into `connections/google/config.ts`: JARVIS writes schedules to its own store and never to Google. Widening that scope to write events is Dave's call, not a side effect of this feature, and it is not free: a scope change forces every already-connected account through one interactive reconnect. **That is the one open question left in booking.** Everything else about it works without it.

`api/bookings.ts` began as a GET and nothing else, and cancelling was added to it deliberately rather than by drift. See below.

The import follows the Google one's shape and inherits its two expensive lessons. It never makes a second copy, because the booking id is the key and the store is read before anything is written, which is what makes running it on every app open safe. And it never deletes on an absence alone: an event is removed only when the server was actually asked about its day, because outside that window an absence means "not asked", and deleting on it would delete a real meeting over a query's limits. It is much simpler than the Google import in one respect that matters: a booking cannot be edited, so there is no field-by-field merge and no hash. An id either has an event or it does not.

It runs from `BookingImportPump`, mounted in AppShell beside the mail pumps rather than inside a tab, because a tab switch unmounts a tab and the point is that the schedule is right whether or not he opened the right screen. Once per app open: a booking is a meeting some days out, not a live feed.

Settings > Booking now also lists who has booked, which answers the question everybody asks straight after publishing a link. Nobody having booked and not being able to ask are shown as the different facts they are, because reading the second as the first tells him his link is dead when it is not.

`api/_track3.ts` is the shared floor under both signed-in endpoints, lifted out of `booking-link.ts` rather than copied, because the interesting part of it is a security check and a second copy of a security check is a second thing to get wrong. `parseRange` went the other way, into `src/booking/slots.ts`: three callers need it, and `api/book.ts` is the one endpoint with no auth in front of it that names no live-project credential, so it must not import a module that does.

## Calling a meeting off (2026-09-19)

A booking he could see but not cancel is half a feature: the only way out was to leave a stranger to turn up. `DELETE /api/bookings {id, reason?}` is the other half, and it is written as the different kind of decision it is.

- **The row is marked cancelled, never deleted.** The history is worth keeping, and the hour frees itself, because every grid this app draws counts confirmed bookings only.
- **The guest is told.** A cancellation nobody hears about is not a cancellation, it is a stranger standing somewhere on their own. The email carries a `METHOD:CANCEL` calendar file, which is the one case where a client should act on the attachment rather than offer a button, and every client does: it takes the event off their calendar. It works only against the same UID with a higher SEQUENCE, so the uid is built from the booking id in one function and never improvised.
- **Cancelled and told are reported as two facts.** The endpoint answers `{cancelled, told}` and the toast says which happened, because "Cancelled" over an email that never sent leaves him believing a stranger knows not to turn up.
- **The mail goes after the row, never before.** Telling somebody a meeting is off and then failing to cancel it is the one ordering that cannot be recovered from.
- **It is idempotent, and its authorization is the same query.** The lookup is scoped to the caller and to `status=confirmed`, so somebody else's booking and an already-cancelled one are the same 404. Whether another person's booking exists is not this caller's business.
- **Two taps to get there, and nothing happens on the way.** The row's own menu, then a sheet that says what the stranger will receive. The optional note is his own words; left empty the email says the meeting is off and the time is free again, which is the whole truth. The app has no business writing that line for him.
- The list and the schedule both stop showing it at once rather than at the next app open. The import is the only thing that knows how to take the event off, so it is asked rather than second-guessed on the settings screen.

`src/laws/shortCopy.test.ts` gained one exemption: `booking/receipt.ts`. Those strings are the body of an email that lands in a stranger's mail client, not UI copy, and the law is about a second sentence hiding inside a label. An email that may not contain two sentences is not an email.

## The visitor gets out too (2026-09-19)

The receipt used to say "reply to this email" and nothing more. That puts the work on the host and leaves the visitor with no idea whether anything happened, which is exactly how a cancellation becomes a no-show: the person decides they cannot make it, sends a message into a mailbox, hears nothing, and the hour stays blocked for a meeting neither of them is going to.

The confirmation now carries one address to tap: `/book/<slug>?cancel=<booking id>`.

**Why an id is enough authorization, and when it would not be.** A booking id is a random v4 uuid, 122 bits nobody walks, disclosed to exactly two people: the visitor, in their own receipt and in the answer to their own booking, and the host, who owns it. The link is therefore a capability held by the one person entitled to use it, with no new column and no migration. What it must never do is hand back anything the link does not already imply, so `GET /api/book?cancel=<id>` answers with the meeting's name, its times and whether it still stands, and stops there. Somebody holding a forwarded email learns the meeting that email already describes: no address, no other booking, and no way to ask about one.

**An already-cancelled booking is a success, not an error.** Somebody who taps the link in an old email is told the meeting is off, which it is. "No such booking" reads as a broken link and sends them to write that email after all.

**A cancellation is never silent on the host's side.** An hour can now leave his schedule while he is not looking, and an event that quietly vanishes is worse than no booking system: he plans around an hour that is actually free, or notices the gap and cannot tell why. The import's own count drives a toast, and only on a removal. Arrivals stay silent, because a booking is a thing somebody else did deliberately and the hour appearing IS the news.

The host is not emailed when a visitor cancels. A message from his own mailbox to his own mailbox is not a reliable notification, and the toast is, so the toast is the answer rather than a mail that might be filed anywhere.

## The link stops double-booking him (2026-09-19)

The grid subtracted bookings other people had made and nothing else. A link published for Tuesday afternoons cheerfully offered the hour he already had a meeting in, which makes it worse than no booking link at all: two people turn up expecting him and he is in neither place.

**The app works it out and hands it over; the server never reads his calendar.** `api/book.ts` has no auth in front of it and names no live-project credential, which is exactly why a mistake in it cannot reach the app's real data. Teaching it to read a calendar would end that. So the app, which already holds the calendar, computes the hours that are taken and puts them where the public endpoint can see them: rows he owns in Track 3.

**It needed no migration, because `availability_overrides` already had the columns.** `is_blocked` sits alongside an optional `override_start` and `override_end`, and a blocked row's times were simply ignored. They now mean what they say, which is three readings of two columns and none of them contradict:

| row | meaning |
|---|---|
| blocked, no window | the whole day is off, which is what it already meant |
| blocked, with a window | that window is taken, the rest of the day stands |
| not blocked, with a window | the day runs to THAT window instead of the usual one |

**His own hours are a separate list from bookings, and they have to be.** Both block a slot, but only bookings count toward `max_per_day`: that cap is how many BOOKINGS he will take in a day, not how many things are on his calendar. Folded into one list, a cap of two plus two of his own meetings would close a day nobody had booked him into. `openSlots` therefore takes `committed` beside `busy`.

**It replaces, never merges.** A meeting he moved or deleted has to stop blocking the hour it used to be in, so the rows mean exactly what his calendar means right now, and an empty calendar sends an empty list rather than skipping the call. Every delete is filtered to rows that name a window, so a day he marked off is never cleared by a busy push.

**A booking is never pushed back as an hour of his own.** It came from the link, the link already knows about it, and sending it back would have the grid subtract the same hour twice. The push runs after the import for the same reason, so a booking that just arrived is already an event.

`src/booking/committed.ts` is the arithmetic, pure and tested, because the failures are all quiet ones: an event with a start and no end is an ordinary thing in this app and blocking nothing for it offers a stranger the hour he is sitting in; travel and buffer are time he is not free; an end before its start is a bad row rather than a 23 hour meeting; and two meetings that merely touch are one busy stretch, because there is no gap between them to book into.

## The bridge past Clerk (2026-09-19)

Track 3's policies expect Clerk, Clerk is not wired, and that was read as blocking everything. It does not block booking, and the reason is worth writing down: **the session can come from the live project while the storage is Track 3.**

`api/booking-link.ts` verifies the caller against the LIVE project, exactly the way the admin endpoints already do, and then writes Track 3 with the service role using the caller's live user id as `owner_id`. That column is a bare uuid with no foreign key behind it, which is what makes this legal rather than a trick. Booking therefore works today, for the one user this app has.

What still needs Clerk is what actually needs it: connections and shared projects need TWO real user ids that can see each other under RLS. One person's own calendar never did.

The endpoint is idempotent by construction. PUT writes the org (made once, personal), the bookable type (updated, never duplicated, so changing the slot length changes what the public page offers), the availability rules (replaced wholesale, so the table means exactly what the screen shows) and the link (its slug made once and then kept, because an address that changes every time you save is an address nobody can give out). DELETE clears the hours and the link and leaves existing bookings alone, because cancelling somebody's meeting is a different decision from closing your calendar and must never be a side effect of it.

`src/booking/linkPayload.ts` is the translation, pure and tested, because the screen's words and the database's words disagree in three places that would each be a quiet, plausible bug: the screen stores a Monday-first week and both Postgres and JavaScript count from Sunday; "link" is `link_only` and who may book is a row rather than a column; and a day is not a window, so the working hours come from one default stated in one place.

Settings > Booking now has a Publish button and shows the address, which is the first time Your Times has had anywhere to go.

## Waits, and on what

| screen or piece | blocked on |
|---|---|
| Public Link (the slot grid, name and email, Confirm) | BUILT 2026-09-19: `api/book.ts`. Waiting only on the two env vars below |
| The booking page itself (the grid, the form, the confirmation) | BUILT 2026-09-19: `/book/<slug>`, the one path that renders above the auth gate |
| The confirmation email and its calendar file | BUILT 2026-09-19: sends from the host's own Gmail, needs no new env var |
| A booking showing up for the host | BUILT 2026-09-19: `api/bookings.ts` and the import into JARVIS's own schedule |
| Cancelling a booking, and telling the guest | BUILT 2026-09-19: `DELETE /api/bookings`, with a `METHOD:CANCEL` calendar file |
| The VISITOR cancelling, from the link in their receipt | BUILT 2026-09-19: `/book/<slug>?cancel=<id>`, the booking id as the capability |
| The link not offering an hour he is already in | BUILT 2026-09-19: `PUT /api/booking-busy`, pushed by the app on every open |
| Marking a whole day off by hand | the rows and the grid already honour it (blocked, no window); nothing writes one yet, so it needs a screen |
| Writing a booking into GOOGLE Calendar | Dave's ruling on widening the Google scope past `calendar.readonly`, which forces one interactive reconnect. Not needed for the host to see a booking |
| Connections (request, accept, decline, scope toggles) | Clerk wired as the project's third-party auth provider. Booking no longer waits on it: see the bridge below |
| Shared Project (view and edit badges, assignee avatars) | connections above (0005's policies are tested at the database, see the track3 README) |
| Tier 1 and Tier 2 connectors | Vault enabled on the Track 3 project, and one real MCP server plus its token to point at. This line used to say the work was `api/ai.ts` calling `mcp_take_token`, which read as a one-line wiring job and is not: that function is the per-org budget the connectors will spend, a PREREQUISITE rather than the feature. `api/ai.ts` already enforces a per-user hourly cap and a global daily ceiling atomically against the live project, so adding a third limiter in a second database, for an org concept the app does not use yet, would buy a round trip per AI call and no protection. The feature itself is per-provider OAuth into `user_connections` and an `mcp_servers` list assembled per request, and it is blocked on Vault and on having a server to connect to |
| Business round-robin booking | not designed (changes `booking_links.owner_id`); the master's section 7 |
| Spine tree screen | the live app keeps categories, goals, projects and tasks in the item store; the Track 3 spine is the new project's schema, not a migration of this one, so a tree over it has no data until the app writes there |

Nothing above is half-built in the app: a screen with no data behind it was
left out rather than drawn empty.
