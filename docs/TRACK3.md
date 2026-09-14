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

## Waits, and on what

| screen or piece | blocked on |
|---|---|
| Public Link (the slot grid, name and email, Confirm) | a Track 3 Supabase project and a server function that writes `bookings` with the service role; there is no server today |
| Confirmed screen and the calendar write-through | the same, plus a Tier 1 `user_connections` row and Vault |
| Connections (request, accept, decline, scope toggles) | Clerk (two real user ids) and the Track 3 project |
| Shared Project (view and edit badges, assignee avatars) | connections above, then 0005 |
| Tier 1 and Tier 2 connectors | Vault on the new project; the MCP rate limiter has no design |
| Business round-robin booking | not designed (changes `booking_links.owner_id`); the master's section 7 |
| Spine tree screen | the live app keeps categories, goals, projects and tasks in the item store; the Track 3 spine is a new project's schema, not a migration of this one, so a tree over it has no data until that project exists |

Nothing above is half-built in the app: a screen with no data behind it was
left out rather than drawn empty.
