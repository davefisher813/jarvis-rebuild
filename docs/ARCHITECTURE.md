# JARVIS architecture

Written 2026-09-05 (UP-LAUNCH-23). One page: what this system is, where the
data lives, who can read it, and which parts are deliberately unfinished. It
is the page a new engineer reads on their first morning and the page a
technical reviewer asks for in their first hour, and it is the same page
because both of them want the same thing.

## The shape

Two packages and no server of our own.

```
jarvis-core/     the data engine. Entities, the store, sync, the offline queue.
                 Knows nothing about the app.
jarvis-app/      the app: React, one Vite build, a Capacitor iOS shell around
                 the same bundle.
jarvis-app/api/  Vercel edge functions. Everything that needs a secret.
Supabase         Postgres, auth, storage. The only database.
```

The app talks to Supabase directly for its own data, under row level security,
and to `api/` for the four things a client must never do: call Anthropic, hold
a Google refresh token, act as an admin, and delete an account.

## One table for the user's data

Every user-owned record is a row in `item`:

```
item(id uuid, owner_id uuid, entity_type text, data jsonb, updated_at, deleted_at)
```

`entity_type` is a foreign key into a registry table, and that is the whole
schema story. A new kind of thing (a workout, a goal, a strand, a metric) is a
new registry row and a TypeScript type, not a migration with new columns. The
tradeoff is deliberate and worth naming: no per-field constraints in the
database, so the shape is enforced in TypeScript and in tests, and one
`entity_type` registry migration is the one thing a new entity cannot ship
without. Postgres validates ownership; the app validates shape.

Row level security is per owner, on every table, with no exceptions and no
shared rows anywhere in the system. The policies are `owner_id = auth.uid()`.

A handful of tables sit outside `item` because they are not the user's
content: `event_log` (typed usage events), `ai_usage` and `ai_tokens`
(accounting), `google_tokens` (encrypted refresh tokens), `email_opens`,
`feedback`. Every one of them is service-role only or per-owner, and none of
them can hold free text by construction.

## Multi-tenancy, today and tomorrow

Today there is exactly one owner per row and no sharing of any kind. Nothing
in the schema, the policies or the client can express "this row belongs to two
people", which is the strongest thing that can be said about tenant isolation:
it is not a rule that is enforced, it is a shape that cannot represent the
violation.

When organizations arrive they will be a membership table plus policies that
read it. Rows will still have exactly one owner. Shared rows are the design
that turns a data leak into a one-line policy mistake, and this system will
not have them.

## Offline

Writes go to the local store first and to a queue if the network is not there.
The queue replays on reconnect. Its known limits are written down rather than
implied: replay is per record and last-writer-wins within a record, with an
age check (`item_apply_patch_if_older`) so a stale edit from a phone that was
offline all day cannot overwrite a newer one from a laptop. There is no
operational transform and no merge of two edits to the same field; the newer
edit wins and the older one is reported to the person rather than silently
dropped.

## AI

`api/ai.ts` is the only thing in the system that talks to Anthropic. The key
exists in one environment variable, in one place, and no client has ever seen
it. Every call passes three bounds: a per-user hourly cap, a global daily
ceiling, and an input size cap. Usage is recorded BEFORE the upstream call, so
a failed or concurrent call cannot slip under the counter. As of UP-LAUNCH-04
a deploy that cannot enforce those caps refuses to serve AI rather than
serving it uncapped.

Model output that a person will read or send passes through a scrubber at its
parse point, so house style is enforced by code rather than by prompt.

## The event log

One row per app open per local day per user, plus the typed acts the product
derives from (a task completed, a plan picked, a thread handled). What makes
it safe is structural, not a policy: the row has columns for a category, a
number, a flag and a closed-vocabulary kind, and the mapper drops every other
prop. There is no column any free text could reach.

That is also the whole analytics stack. There is no third-party analytics SDK
and no advertising SDK anywhere in this app (UP-LAUNCH-17).

## The native app

The iOS app is the same web bundle in a Capacitor shell, plus a small set of
native capabilities. The seven deeper native features (HealthKit, EventKit,
Reminders, Contacts, widgets, App Intents, Live Activities) are STAGED, not
shipped: `jarvis-app/native/` holds the Swift plugins and the typed contracts,
and `src/native/bridge.ts` is every method throwing `NotStagedError` until the
Apple enrollment exists. The pure logic those bridges will feed (de-duplication,
contact matching) is written and tested now; nothing half-wired ships.

## How the rules are kept

`jarvis-app/src/laws/` is a test suite that encodes product rules as
assertions over the source: no em dashes in anything the app says, Title Case
for anything that names or acts, no fake zeros, a count is never a run, no
health screen that scores a person, no permission the Info.plist does not
explain, no environment variable that is not documented. Each law exists
because its violation shipped once. A rule that lives only in a document
decays; a rule that fails the suite cannot.

CI runs the typecheck, the linter, the whole suite and a production build for
both packages on every push (`.github/workflows/ci.yml`).

## Where the bodies are

Named because a page that only lists strengths is not worth reading:

- **Bundle size.** One large chunk, split three ways by vendor. Known,
  deferred deliberately, and not touched by any of the launch work.
- **`api/` is outside the typecheck and the test run.** The logic worth
  testing was moved into `src/` (`account/deleteAccount.ts`,
  `admin/adminCompute.ts`, `admin/adminMetrics.ts`) precisely because of
  this, and `src/laws/env.test.ts` is the only automated thing that reads
  `api/` at all.
- **No end-to-end tests on a device.** The suite is unit and component level;
  the native paths are exercised by hand on a phone.
- **Apple's token revocation on account deletion** is not written yet, and
  `src/account/deleteAccount.ts` says exactly what it would take.

## Related pages

- `docs/LAUNCH_RUNBOOK.md`: every environment variable, which dashboard it
  lives in, and the order to set them up in.
- `docs/DATA_EXPORT.md`: the contract of the backup bundle, field by field.
- `jarvis-app/.env.example`: the authoritative list of configuration.
- `jarvis-app/src/laws/README.md`: what a law is and how to add one.
