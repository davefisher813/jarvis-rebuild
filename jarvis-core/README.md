# jarvis-core

The data engine every JARVIS feature sits on. This is the Core Data Model from
the Track 3 code phase, built to match the behavior approved in the test
harness (steps D1 through D10).

## What this is

A small, typed data layer over Supabase with one job: store records correctly,
delete them correctly, and sync them correctly across devices. Features (Notes,
Tasks, and the rest) get built on top of this, one at a time, each through the
same test gate.

This build is the engine only. The Personal objects (org, workstream, project,
meeting, contact) are not built yet; they are the next gated steps. The schema
is designed so they plug in without a rewrite (the `entity_type` seam).

## The pieces

```
src/core/types.ts            shared types
src/core/adapter.ts          the storage interface (two implementations)
src/core/inMemoryAdapter.ts  no-network backend, used by the tests
src/core/supabaseAdapter.ts  the real backend, used on device
src/core/store.ts            typed client: create/read/update/delete/listForUser + offline queue
src/core/spec.ts             SINGLE SOURCE: the 11 approved steps, ported 1:1 from the harness
tests/core.spec.ts           the automated tests, generated from spec.ts
supabase/migrations/0001_core_data_model.sql   schema, row-level security, trigger, merge function
docs/DEVICE_TEST.md          how to prove the real database
docs/verify-rls.mjs          the script that proves it
```

## How it maps to the approved behavior

| Req | Behavior | How it is enforced |
| --- | --- | --- |
| D1, D2, D3 | create, read, update | store + adapter |
| D4 | hard delete | native `DELETE`, no tombstone table |
| D5 | deleted record never returns | nothing to resurrect; proven by guardian test |
| D6 | per-user isolation | row-level security keyed to `auth.uid()` |
| D7, D10 | last write wins, deterministic | monotonic `updated_at` set by a trigger |
| D8 | offline edit survives reconnect | client-side queue, replays in order |
| D9 | missing-id write is a safe no-op | RLS and the merge function affect zero rows |

## Run the tests

```
npm install
npm test          # 23 tests: 11 steps + 10 coverage + 2 permanent guardians
npm run typecheck
```

The in-memory adapter mirrors the database rules exactly, so the tests run with
no network. The real database rules are proven separately on device; see
`docs/DEVICE_TEST.md`.

## Wire it to your Supabase project

1. Apply `supabase/migrations/0001_core_data_model.sql` in the SQL editor.
2. Run `docs/verify-rls.mjs` once to confirm the live rules hold.
3. In the app, build the store with the real backend:

```ts
import { Store, createSupabaseAdapter } from "jarvis-core";

const adapter = createSupabaseAdapter(SUPABASE_URL, SUPABASE_ANON_KEY, sessionAccessToken);
const store = new Store(adapter);
```

The app code is identical whether the store is backed by the in-memory adapter
(tests) or the Supabase adapter (device). That is the point of the split.

## Identity now and later

Now: Supabase Auth. `owner_id` defaults to the signed-in user and RLS enforces
isolation. At Milestone B this swaps to Clerk with no table changes: change how
the client signs in and swap `auth.uid()` for the Clerk subject in the policies.
See `docs/DEVICE_TEST.md`.

## Scope notes (deliberate)

- Only updates queue when offline; creates and deletes apply immediately. This
  matches the approved core. A fuller offline model can be added later.
- Conflict resolution is last-write-wins by server time. This is the chosen
  model for scalar sync (theme, budget). Deeper per-field or CRDT merge is out
  of scope.
