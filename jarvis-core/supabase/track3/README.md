# Track 3 schema (unapplied)

Written 2026-09-14 from `Claude outputs/JARVIS_TRACK3_BUILD_MASTER_2026_09_14.md`.
These files are NOT in `supabase/migrations/` on purpose: they target a Track 3
Supabase project that does not exist yet, and the live JARVIS project must not
run them. Apply in file order, once, against the new project, after:

1. Clerk is configured as the project's third-party auth provider, so
   `auth.uid()` is the Clerk user id and `auth.jwt()->>'org_id'` the org.
2. Vault is enabled (0002 stores only `vault_secret_id`).
3. The MCP rate limiter has a spec (0002's `org_mcp_connections` must not take
   live rows before it exists).

Then run one real test of 0005's permissive-policy combination (an org owner
and a shared party each reading the same project) before relying on it.

See `docs/TRACK3.md` for what the app builds against this today and what waits.
