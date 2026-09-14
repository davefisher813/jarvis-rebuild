# Track 3 schema (applied 2026-09-14)

Written 2026-09-14 from `Claude outputs/JARVIS_TRACK3_BUILD_MASTER_2026_09_14.md`.
These files are NOT in `supabase/migrations/` on purpose: they target the
Track 3 Supabase project, not the live JARVIS project, and the live project
must never run them.

The Track 3 project is `zxszpuyhwvalfpfqgutq` ("Jarvis Track 3", org "Jarvis",
free plan, us-east-2), created and migrated through the Supabase MCP on
2026-09-14. Files 0001 to 0006 are applied there in order and recorded in the
project's own migration history under the names `track3_000N_*`. Vault is
installed by default on it (0002 stores only `vault_secret_id`).

Still to do before it takes live rows:

1. Clerk as the project's third-party auth provider (a dashboard step), so
   `auth.uid()` is the Clerk user id and `auth.jwt()->>'org_id'` the org.
   Every policy here reads those two claims; until Clerk is wired, every
   read through the anon key returns nothing, which is the safe direction.
2. The MCP rate limiter needs a spec before `org_mcp_connections` takes
   rows (0002).
3. One real test of 0005's permissive-policy combination (an org owner and a
   shared party each reading the same project).

0006 is what the security advisor found after 0001 to 0005 ran: the two org
tables had no row security, four helpers had a mutable search_path, and
btree_gist sat in public. The advisor reports nothing after it.

See `docs/TRACK3.md` for what the app builds against this today and what waits.
