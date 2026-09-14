# Track 3 schema (applied 2026-09-14)

Written 2026-09-14 from `Claude outputs/JARVIS_TRACK3_BUILD_MASTER_2026_09_14.md`.
These files are NOT in `supabase/migrations/` on purpose: they target the
Track 3 Supabase project, not the live JARVIS project, and the live project
must never run them.

The Track 3 project is `zxszpuyhwvalfpfqgutq` ("Jarvis Track 3", org "Jarvis",
free plan, us-east-2), created and migrated through the Supabase MCP on
2026-09-14. Files 0001 to 0007 are applied there in order and recorded in the
project's own migration history under the names `track3_000N_*`. Vault is
installed by default on it (0002 stores only `vault_secret_id`).

Still to do before it takes live rows: Clerk as the project's third-party
auth provider, so `auth.uid()` is the Clerk user id and
`auth.jwt()->>'org_id'` the org. That is a dashboard step (Authentication >
Sign In / Providers > Third-Party Auth > Clerk, with the Clerk domain) and
there is no Clerk account or domain in this repo yet; the live app signs in
through Supabase Auth. Every policy here reads those two claims, so until
Clerk is wired every read through the anon key returns nothing, which is the
safe direction.

Done on 2026-09-14, on the project itself:

- 0006 is what the security advisor found after 0001 to 0005 ran: the two org
  tables had no row security, four helpers had a mutable search_path, and
  btree_gist sat in public. The advisor reports nothing after it.
- 0007 is the MCP rate limiter the master asked for: a token bucket per org
  (`org_mcp_rate`, capacity and refill per minute on the row, 60 and 60 by
  default) and `mcp_take_token(org, cost)`, which refills by elapsed time
  and takes under a row lock. Only the service role may execute it; the app
  role cannot spend or read another org's budget. A false return means wait.
- The 0005 policy test ran for real with the claims Clerk will send (an org
  owner, a shared party in their own org, a stranger), as a migration that
  raised at the end so it rolled back: the owner read both projects and
  tasks, the party read only the shared project and its task, a view share
  could not update, the stranger read nothing.
- The 0007 test ran the same way: a bucket of three allowed three takes,
  refused the fourth, and allowed one more after two seconds of refill.

See `docs/TRACK3.md` for what the app builds against this today and what waits.
