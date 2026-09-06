# JARVIS launch runbook

Written 2026-09-05 (UP-LAUNCH-04). What has to be true, in which dashboard,
before a stranger can use this app. `jarvis-app/.env.example` is the
authoritative list of variables and what each one does; this page says where
they go and in what order, and how to prove each step worked.

Nothing here is code. Every step is a dashboard, and every step ends with a
check you can actually run.

---

## 1. Supabase

The database, the auth, and the file storage.

**Environment (Vercel needs these too, see section 2):**

| Variable | Where it comes from |
| --- | --- |
| `VITE_SUPABASE_URL` / `SUPABASE_URL` | Project Settings, API, Project URL |
| `VITE_SUPABASE_ANON_KEY` / `SUPABASE_ANON_KEY` | Project Settings, API, anon public |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings, API, service_role. Secret. |

**Migrations.** They are plain SQL under `jarvis-core/supabase/migrations/`,
run in the SQL editor, in numeric order. A fresh project needs all of them.
An existing project needs whichever have not been run yet; every one is
written to be safe to run twice. The ones that carry a launch feature:

- `0022_ai_usage_kind.sql`: the AI usage counter's per-kind column, which the
  admin usage page reads.
- `0026_ai_tokens.sql`: token accounting per call, the input to cost.
- `0029_metric_and_health_entities.sql` and `0030_user_file_entity.sql`: the
  newest entity types. An entity type missing from the registry fails at
  write time, on the user's phone.
- `0031_apply_patch_strip_nulls.sql` and `0032_apply_patch_if_older.sql`: the
  sync fixes. Without 0032 an offline edit can overwrite a newer one.

Check: in the SQL editor,
`select count(*) from entity_type;` returns a row per registered type, and
`select proname from pg_proc where proname like 'item_apply_patch%';` lists
both `item_apply_patch` and `item_apply_patch_if_older`.

**Auth.** Authentication, URL Configuration:

- Site URL: the deployed web origin (`https://<project>.vercel.app`).
- Redirect URLs: that origin, plus `jarvis://auth` for the native app.

**SMTP.** Authentication, Emails. Supabase's built-in sender is rate limited
to a handful of messages an hour and is not for production: sign-up
confirmations and password resets will silently not arrive. Point it at a
real transactional sender before any tester exists.

Check: create a throwaway account on the deployed site and confirm the email
arrives in under a minute.

---

## 2. Vercel

The web app and every serverless function under `jarvis-app/api/`.

Set every variable in `.env.example` marked `where: vercel`, for both
Production and Preview. The ones that decide behaviour rather than merely
connecting something:

- `AI_REQUIRE_LIMITS=1`. On by default in code since UP-LAUNCH-04: a deploy
  with no service role key refuses AI rather than serving it uncapped. Set it
  explicitly anyway, so the intent is visible in the dashboard.
- `ADMIN_USER_IDS`: Dave's Supabase user id. Unset means nobody is an admin,
  which is the correct failure, but it also means the admin panel is dead.
- `VITE_ADMIN_API=1`: tells the built app the admin endpoints are deployed.
- `VITE_ERROR_SINK=1`: crash reports go to `api/client-error.ts`.
- `AI_MODEL` and `AI_MODEL_WRITE`: both `claude-sonnet-4-6` today. One model,
  deliberately, so a change in output has one cause.
- `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_KEY`: secrets.
  `GOOGLE_TOKEN_KEY` in particular cannot be rotated casually: it encrypts
  every stored Google refresh token, so a new value disconnects everyone.

A variable added after a deploy does nothing until the next one. Redeploy.

Check: `https://<origin>/api/ai` with no auth answers 401 rather than 500
(500 means the Supabase variables are missing), and the admin panel in
Settings shows live numbers instead of "Wired at launch".

---

## 3. Codemagic

The iOS build. `codemagic.yaml` at the repo root carries the build flags
(`VITE_API_BASE`, `VITE_ADMIN_API`, `VITE_ERROR_SINK`); the App Store Connect
API key lives in the `appstore_credentials` group in the Codemagic UI.

The native build reads no server secret. Everything privileged happens in the
Vercel functions, which is why the app can ship without one.

Check: a build produces a signed `.ipa` and TestFlight lists it.

---

## 4. Google

Only needed for the Gmail and Calendar features.

- OAuth consent screen: the published Privacy Policy and Terms URLs
  (`https://<origin>/privacy.html` and `/terms.html`, generated from
  `src/legal/content.ts`).
- Web client: authorized origin is the deployed web origin.
- iOS client: bundle id `com.bridge.jarvis`, no client secret.

Unverified apps using restricted scopes are capped at 100 users. That cap is
a launch constraint, not a bug.

---

## 5. The order

1. Supabase project, migrations, auth URLs, SMTP.
2. Vercel variables, deploy, check `/api/ai` answers 401.
3. Sign up on the web, confirm the email arrives, use the app for a minute.
4. Codemagic build, TestFlight, install on a device.
5. On the device: sign in, connect Google, take a photo into a capture flow,
   delete a throwaway account and watch it disappear from Supabase.

Step 5 is the whole runbook in one pass. If every part of it works on a phone
that has never seen this app, it is ready for someone who is not Dave.
