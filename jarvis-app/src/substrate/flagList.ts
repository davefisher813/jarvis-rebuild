// THE FLAG ROSTER, WITH NO ENVIRONMENT IN IT (Phase 0, 2026-10-10).
//
// flags.ts reads VITE_JARVIS_FLAGS at import time, which is right for the app
// and wrong for anything that only wants to know which flags exist: a law
// that checks every flag is documented, a test that parses a flag string, a
// script run outside Vite. The roster and the parser live here, pure, and
// flags.ts re-exports them beside the one env read. Nothing in this module
// reads the Vite environment or the process one; flagList.test.ts pins that.
//
// Phase 0 adds three (PHASE0-DESIGN.md section 7):
//   memory_v1     origin stamps on the Google import and Smart Paste's
//                 inferred fields; the alias and refused-AI paths
//   trust_v1      the trust checkpoint: a Store backed door says Will Sync
//                 while the write is still on this phone
//   vyzn_sync_v1  the VYZN feed: proposals pulled into the inbox surface

export const FLAGS = [
  "substrate_v1",
  "email_intake_v1",
  "verified_agent_adapters",
  "email_hold_v1",
  "memory_v1",
  "trust_v1",
  "vyzn_sync_v1",
] as const;
export type Flag = (typeof FLAGS)[number];

/** The flags named in a comma separated build string. Unknown names are
 *  dropped, whitespace is forgiven, and an unset string is no flags at all. */
export function parseFlags(raw: string | undefined): ReadonlySet<Flag> {
  const on = new Set<Flag>();
  for (const part of (raw ?? "").split(",")) {
    const name = part.trim();
    if ((FLAGS as readonly string[]).includes(name)) on.add(name as Flag);
  }
  return on;
}
