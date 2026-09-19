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

Still to build here: the calendar write-through, which needs a Tier 1 connection. The host also does not learn about a booking until the app next syncs, and that write-through is the real answer to it.

## The confirmation, which was the one promise (2026-09-19)

The receipt screen told every visitor a confirmation was on its way, and nothing sent one. That was the single line in this feature that was a promise rather than a fact, and it is now a fact.

**It sends from the host's own mailbox, not from a service.** The alternative was a transactional mail vendor, which means a new account, a new secret, a from-address that is not the host's, and a much better chance of landing in spam. The app already stores a Google grant for the host and already knows how to send with it. So the confirmation comes from the address the visitor just agreed to meet, lands in the host's own Sent, and a reply reaches a real person. It needs no new environment variable at all.

**The seam, stated plainly.** `api/book.ts` is the only endpoint here with no auth in front of it, and it was written to name no live-project credential anywhere. The grant lives in the live project, so that discipline has to bend exactly once. It bends in `api/_receipt.ts`, whose whole surface is one function, and the honest version of what that discipline is: every function in a deployment can read every variable, so it was never a wall, it is a rule about what the public endpoint does, kept small enough to read in one sitting. What the seam may do with the live project is read ONE row and send ONE message. Its tests assert that every live-project request it makes is a GET.

**It never fails a booking.** The slot is already taken by the time the receipt runs. A host who has not connected Google, a revoked grant, Gmail refusing the message: each means no receipt and none of them means no booking. The endpoint answers with `confirmationSent`, and the page now says either that an email is on its way or that the time is held and nothing went out. Promising an inbox an email that does not exist is how a booking becomes a no-show.

**The clock the email is on is the visitor's.** Their browser sends its zone with the booking, because only it knows. A receipt written in the host's zone asks a stranger to do arithmetic about a meeting they have already agreed to, which is exactly when somebody misses one. The host's zone is stated once underneath, and only when the two differ. A zone name from a stranger's browser is not trusted: it is tried against the runtime first and falls back to the host's, because a bad zone name makes `Intl` throw.

**An .ics, not an invitation.** A real invitation (`METHOD:REQUEST`) makes a mail client offer Yes, No and Maybe, and those answers go to an organizer address with nothing listening. A button that does nothing is worse than no button, so the attachment is a `METHOD:PUBLISH` calendar file and the client offers the one thing it can do, which is add it.

`src/booking/receipt.ts` is the words and the calendar file, pure and tested, including the two details that are quiet bugs otherwise: an unescaped comma or semicolon in a meeting name ends a calendar property early and the event loses its title, and RFC 5545 folds lines at 75 OCTETS, so a name with an accent in it arrives as mojibake if the fold is measured in characters.

`api/_google.ts` is the cipher, the two OAuth clients and the refresh, MOVED out of `api/google.ts` rather than copied. Two copies of AES-GCM code is how one of them stops decrypting what the other wrote. Sign-in still owns the code exchange and forgetting a revoked grant, which is the part only it can do, because only it can ask the person for a new one. Twenty tests now cover what was previously untested because it was private.

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
| The calendar write-through | a Tier 1 `user_connections` row |
| Connections (request, accept, decline, scope toggles) | Clerk wired as the project's third-party auth provider. Booking no longer waits on it: see the bridge below |
| Shared Project (view and edit badges, assignee avatars) | connections above (0005's policies are tested at the database, see the track3 README) |
| Tier 1 and Tier 2 connectors | `api/ai.ts` calling `mcp_take_token` (0007) before each Anthropic call. The server exists; the call is not wired |
| Business round-robin booking | not designed (changes `booking_links.owner_id`); the master's section 7 |
| Spine tree screen | the live app keeps categories, goals, projects and tasks in the item store; the Track 3 spine is the new project's schema, not a migration of this one, so a tree over it has no data until the app writes there |

Nothing above is half-built in the app: a screen with no data behind it was
left out rather than drawn empty.
