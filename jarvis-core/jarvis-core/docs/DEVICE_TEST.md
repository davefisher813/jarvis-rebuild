# Device test: prove the real database

The automated tests in this repo run against an in-memory copy of the database
rules, with no network. They prove the engine logic. They cannot prove the
actual Postgres security rules, because the sandbox has no database. This
checklist proves the real thing on your Supabase project. Do it once after you
apply the schema, then again any time you change the schema.

## What this proves that the unit tests cannot

- Row-level security really blocks one user from seeing another's data (D6).
- Hard delete really removes the row, and it never comes back (D4, D5).
- The server timestamp really moves forward on every write (D7, D10).
- Updating a missing id really does nothing and does not error (D9).

## One-time setup

1. Create a Supabase project. Copy the Project URL and the anon public key.
2. In the SQL editor, paste and run `supabase/migrations/0001_core_data_model.sql`.
3. In Authentication, create two test users (email + password):
   - user A: an email and password you choose
   - user B: a different email and password

## Run the check

From the `docs` folder on your machine (Node 18+):

```
npm i @supabase/supabase-js
SUPABASE_URL="https://YOUR-PROJECT.supabase.co" \
SUPABASE_ANON_KEY="YOUR-ANON-KEY" \
A_EMAIL="a@example.com" A_PASSWORD="..." \
B_EMAIL="b@example.com" B_PASSWORD="..." \
node verify-rls.mjs
```

Every line should read `PASS`. The script exits 0 when all checks pass, and
prints which check failed otherwise.

## If anything fails

- A `FAIL` on isolation usually means RLS is not enabled or a policy is missing.
  Re-run the migration; confirm `item` shows row-level security enabled.
- A `FAIL` on monotonic time means the trigger did not install. Re-run the
  trigger and function block from the migration.

## When you swap to Clerk (Milestone B)

The schema does not change. You change two things:

1. How the client signs in (a Clerk session token instead of Supabase Auth).
2. The identity claim in the policies: replace `auth.uid()` with the Clerk
   subject, for example `(auth.jwt() ->> 'sub')::uuid`, and configure a
   Clerk to Supabase JWT template.

Re-run this script (pointed at Clerk-issued sessions) to confirm isolation
still holds.
