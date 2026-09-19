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

## Waits, and on what

| screen or piece | blocked on |
|---|---|
| Public Link (the slot grid, name and email, Confirm) | BUILT 2026-09-19: `api/book.ts`. Waiting only on the two env vars below |
| The booking page itself (the grid, the form, the confirmation) | nothing: next push. The server it calls is built |
| The calendar write-through | a Tier 1 `user_connections` row |
| Connections (request, accept, decline, scope toggles) | Clerk wired as the project's third-party auth provider (two real user ids) |
| Shared Project (view and edit badges, assignee avatars) | connections above (0005's policies are tested at the database, see the track3 README) |
| Tier 1 and Tier 2 connectors | `api/ai.ts` calling `mcp_take_token` (0007) before each Anthropic call. The server exists; the call is not wired |
| Business round-robin booking | not designed (changes `booking_links.owner_id`); the master's section 7 |
| Spine tree screen | the live app keeps categories, goals, projects and tasks in the item store; the Track 3 spine is the new project's schema, not a migration of this one, so a tree over it has no data until the app writes there |

Nothing above is half-built in the app: a screen with no data behind it was
left out rather than drawn empty.
