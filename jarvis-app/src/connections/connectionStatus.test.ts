// WHAT A REFRESH AND A READ PROVE, AND WHAT THE DEVICE'S OWN CLOCK DOES WITH
// THE ANSWER (Foundation Fix Spec 1). These hold the rules the spec states in
// words: presence is not evidence; pending_auth only for true auth loss;
// transient causes never offer a reconnect; a green answer that is old or read
// offline is not shown green.
import { describe, it, expect } from "vitest";
import { deriveStatus, viewOf, deliveryOf, STATUS_STALE_MS, VERIFIED_READ_OP, OFFLINE_LINE, type AccountStatus, type DeriveInput } from "./connectionStatus";

const NOW = new Date("2026-10-06T18:00:00Z");
const EMAIL = "dave@gmail.com";
const SYNC = "2026-10-06T17:50:00Z";
const GOOD_SCOPE = "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send";

const base = (o: Partial<DeriveInput>): DeriveInput => ({
  email: EMAIL, refresh: { ok: true, scope: GOOD_SCOPE }, read: { ok: true, status: 200, emailAddress: EMAIL }, lastSyncAt: SYNC, now: NOW, ...o,
});

describe("deriveStatus: a stored token is not evidence", () => {
  it("is connected only when the refresh worked AND the named read answered with the intended address", () => {
    const s = deriveStatus(base({}));
    expect(s).toMatchObject({ auth_state: "valid", state: "connected", transient: null, lastError: null, lastSuccessfulRefreshAt: NOW.toISOString() });
    expect(s.receipt).toEqual({ operation: `token_refresh+${VERIFIED_READ_OP}`, at: NOW.toISOString(), ok: true, identityMatched: true });
    expect(s.sendReady.ready).toBe(true);
    expect(s.syncCoverage).toEqual({ days: 90, through: SYNC });
  });

  it("a revoked grant is pending_auth with the provider's code, and nothing is green", () => {
    const s = deriveStatus(base({ refresh: { ok: false, error: "invalid_grant" }, read: null, previousRefreshAt: "2026-10-05T10:00:00Z" }));
    expect(s).toMatchObject({ auth_state: "revoked", state: "pending_auth", lastError: "invalid_grant", lastSuccessfulRefreshAt: "2026-10-05T10:00:00Z" });
    expect(s.sendReady.ready).toBe(false);
  });

  it.each(["invalid_token", "invalid_client", "unauthorized_client"])("%s is a true auth failure too", (code) => {
    expect(deriveStatus(base({ refresh: { ok: false, error: code }, read: null })).state).toBe("pending_auth");
  });

  it("no stored sign-in at all is pending_auth, and says why", () => {
    expect(deriveStatus(base({ refresh: null, read: null }))).toMatchObject({ state: "pending_auth", auth_state: "revoked", lastError: "no_stored_signin", receipt: null });
  });

  it("a network failure or an unexplained refusal is transient and NEVER pending_auth", () => {
    for (const refresh of [{ thrown: true } as const, { ok: false, error: "Refresh failed" } as const]) {
      const s = deriveStatus(base({ refresh, read: null }));
      expect(s).toMatchObject({ state: "warning", transient: "service_unavailable", auth_state: "unknown" });
    }
  });

  it("a valid credential whose provider read fails is demoted, never left green", () => {
    expect(deriveStatus(base({ read: { ok: false, status: 429 } }))).toMatchObject({ auth_state: "valid", state: "warning", transient: "temporarily_limited", lastError: "http_429" });
    expect(deriveStatus(base({ read: { ok: false, status: 503 } }))).toMatchObject({ state: "warning", transient: "service_unavailable", lastError: "http_503" });
    expect(deriveStatus(base({ read: { ok: false, status: 0 } }))).toMatchObject({ state: "warning", lastError: "network_error" });
    expect(deriveStatus(base({ read: { ok: false, status: 403 } }))).toMatchObject({ state: "error", transient: null, lastError: "http_403" });
  });

  it("an unresolvable 401 on a fresh token is an auth failure", () => {
    expect(deriveStatus(base({ read: { ok: false, status: 401 } }))).toMatchObject({ state: "pending_auth", auth_state: "revoked", lastError: "http_401" });
  });

  it("the wrong mailbox is an error, not a connection", () => {
    const s = deriveStatus(base({ read: { ok: true, status: 200, emailAddress: "someone@else.com" } }));
    expect(s).toMatchObject({ state: "error", lastError: "identity_mismatch" });
    expect(s.receipt?.identityMatched).toBe(false);
  });

  it("the address comparison ignores case and padding", () => {
    expect(deriveStatus(base({ read: { ok: true, status: 200, emailAddress: " Dave@GMAIL.com " } })).state).toBe("connected");
  });

  it("send readiness is its own dimension: valid credential, no send scope", () => {
    const s = deriveStatus(base({ refresh: { ok: true, scope: "https://www.googleapis.com/auth/calendar.readonly" } }));
    expect(s.state).toBe("connected");
    expect(s.sendReady).toEqual({ ready: false, reason: "Send permission missing" });
    expect(deriveStatus(base({ refresh: { ok: true } })).sendReady.ready).toBe(false);
  });

  it("records only machine codes and a named operation, never provider text", () => {
    const s = deriveStatus(base({ refresh: { ok: false, error: "invalid_grant" }, read: null }));
    expect(JSON.stringify(s)).not.toMatch(/token_enc|access_token|refresh_token|Bearer/);
  });
});

describe("delivery health is separate from credential health", () => {
  it("a valid credential with nothing synced is a warning on the client", () => {
    expect(deliveryOf(null, NOW).liveness).toBe("never");
    expect(deliveryOf("2026-10-04T00:00:00Z", NOW).liveness).toBe("stale");
    const s = deriveStatus(base({ lastSyncAt: "2026-10-04T00:00:00Z" }));
    expect(s.state).toBe("connected");
    expect(viewOf(s, NOW, true)).toMatchObject({ state: "warning", headline: "Mail Not Updating" });
  });
});

describe("viewOf: the device judges the answer again", () => {
  const connected = (): AccountStatus => deriveStatus(base({}));
  const later = (ms: number) => new Date(NOW.getTime() + ms);

  it("a fresh connected answer reads Connected", () => {
    expect(viewOf(connected(), later(60e3), true)).toMatchObject({ state: "connected", headline: "Connected", offerReconnect: false });
  });

  it("a frozen healthy answer is stale once it is old, whatever it says", () => {
    const v = viewOf(connected(), later(STATUS_STALE_MS + 1), true);
    expect(v.state).toBe("stale");
    expect(v.headline).toBe("Status Unconfirmed");
  });

  it("an offline device says so and invents no fresh status", () => {
    expect(viewOf(connected(), later(60e3), false)).toMatchObject({ state: "offline", detail: OFFLINE_LINE, offerReconnect: false });
  });

  it("reconnect is offered for confirmed auth loss and nothing else", () => {
    const revoked = deriveStatus(base({ refresh: { ok: false, error: "invalid_grant" }, read: null }));
    expect(viewOf(revoked, later(1000), true)).toMatchObject({ state: "pending_auth", headline: "Needs Reconnecting", offerReconnect: true });
    for (const read of [{ ok: false, status: 429 }, { ok: false, status: 503 }, { ok: false, status: 403 }]) {
      expect(viewOf(deriveStatus(base({ read })), later(1000), true).offerReconnect).toBe(false);
    }
    expect(viewOf(deriveStatus(base({ refresh: { thrown: true }, read: null })), later(1000), true)).toMatchObject({ headline: "Service Unavailable", offerReconnect: false });
    expect(viewOf(deriveStatus(base({ read: { ok: false, status: 429 } })), later(1000), true).headline).toBe("Temporarily Limited");
  });

  it("a stale revoked answer is not shown as a fresh one either", () => {
    const revoked = deriveStatus(base({ refresh: { ok: false, error: "invalid_grant" }, read: null }));
    expect(viewOf(revoked, later(STATUS_STALE_MS + 1), true).state).toBe("stale");
  });
});
