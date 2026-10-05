// The Errors section's arithmetic (2026-10-05). api/admin/errors.ts reads the
// newest client_error rows with the service key and hands them here; the panel
// shows the top of what comes back. Pure, so the one rule worth getting right
// (one bug is one group, however many phones hit it) has a test that does not
// need a server.

/** A client_error row as the endpoint selects it. Stack and context stay in the table. */
export interface RawClientError {
  created_at: string;
  fingerprint: string;
  name?: string | null;
  message?: string | null;
  build?: string | null;
  platform?: string | null;
}

export interface AdminErrorGroup {
  fingerprint: string;
  /** Rows in the window, not all time: the endpoint reads the newest 200. */
  count: number;
  firstSeen: string;
  lastSeen: string;
  name: string;
  message: string;
  /** From the newest row of the group: the build that last broke this way. */
  build: string;
  platform: string;
}

/** How many rows the endpoint reads. The panel says so when it is reached. */
export const ERROR_WINDOW = 200;
/** How many groups the panel lists. */
export const ERROR_TOP = 20;

// Most often first, then the one that happened most recently, so a bug that
// is happening right now outranks an equally frequent one from last week.
export function groupErrors(rows: RawClientError[]): AdminErrorGroup[] {
  const groups = new Map<string, AdminErrorGroup>();
  for (const r of rows) {
    const g = groups.get(r.fingerprint);
    if (!g) {
      groups.set(r.fingerprint, {
        fingerprint: r.fingerprint,
        count: 1,
        firstSeen: r.created_at,
        lastSeen: r.created_at,
        name: r.name || "Error",
        message: r.message || "",
        build: r.build || "",
        platform: r.platform || "other",
      });
      continue;
    }
    g.count += 1;
    // Compared as instants, not strings: PostgREST writes microseconds and an
    // offset, and two spellings of one moment must not order by their text.
    if (Date.parse(r.created_at) < Date.parse(g.firstSeen)) g.firstSeen = r.created_at;
    if (Date.parse(r.created_at) > Date.parse(g.lastSeen)) {
      g.lastSeen = r.created_at;
      g.name = r.name || g.name;
      g.message = r.message || g.message;
      g.build = r.build || g.build;
      g.platform = r.platform || g.platform;
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || Date.parse(b.lastSeen) - Date.parse(a.lastSeen));
}
