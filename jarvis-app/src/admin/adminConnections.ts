// The Connections health line (Foundation Fix Spec 3). api/admin/connections.ts
// reads every stored sign-in's record with the service key and hands the rows
// here; the panel shows one line of totals and one row per account that is not
// healthy. Pure, so the arithmetic has a test that needs no server.
//
// Addresses are shown: this is the admin's own operations view, behind the same
// allowlist as every other admin section. Nothing here is a token, a provider
// message or any mail.

/** One stored sign-in, as the endpoint selects it (migration 0057's columns). */
export interface RawGrant {
  email: string;
  state: string;
  dead_at: string | null;
  last_refresh_ok_at: string | null;
  consecutive_failures: number | null;
  last_auth_error: { lastAuthErrorCode?: string; lastAuthErrorSource?: string; likelyCause?: string } | null;
}

export interface AdminConnectionRow {
  email: string;
  /** The incident ID, so an admin can match it to the sink line and the notification Dave saw. Null when the account is only counting failures. */
  incident: string | null;
  kind: "auth" | "failing";
  since: string | null;
  code: string | null;
  source: string | null;
  cause: string | null;
  failures: number;
}

export interface AdminConnections {
  total: number;
  healthy: number;
  /** Not healthy, worst first: a lost grant before one that is only failing. */
  rows: AdminConnectionRow[];
}

/** A failing account is listed from this many failures in a row; one or two are noise the app already retries. */
export const LIST_FAILING_FROM = 3;

export function summarizeConnections(grants: RawGrant[], idOf: (email: string, anchor: string) => string): AdminConnections {
  const rows: AdminConnectionRow[] = [];
  for (const g of grants) {
    if (g.state === "DEAD") {
      rows.push({
        email: g.email, incident: g.dead_at ? idOf(g.email, g.dead_at) : null, kind: "auth", since: g.dead_at,
        code: g.last_auth_error?.lastAuthErrorCode ?? null, source: g.last_auth_error?.lastAuthErrorSource ?? null,
        cause: g.last_auth_error?.likelyCause ?? null, failures: g.consecutive_failures ?? 0,
      });
    } else if ((g.consecutive_failures ?? 0) >= LIST_FAILING_FROM) {
      rows.push({ email: g.email, incident: null, kind: "failing", since: g.last_refresh_ok_at, code: null, source: null, cause: null, failures: g.consecutive_failures ?? 0 });
    }
  }
  rows.sort((a, b) => (a.kind === b.kind ? b.failures - a.failures : a.kind === "auth" ? -1 : 1));
  return { total: grants.length, healthy: grants.length - rows.length, rows };
}
