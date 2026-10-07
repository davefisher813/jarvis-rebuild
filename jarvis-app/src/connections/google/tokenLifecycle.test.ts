// THE RULES OF A STORED GOOGLE GRANT (Foundation Fix Spec 2): the error
// taxonomy, the backoff, the absolute expiry, and the likely cause of a death.
import { describe, it, expect } from "vitest";
import { classifyRefresh, backoffMs, expiryOf, isFresh, likelyDeathCause, AUTH_ERRORS, SKEW_MS, MAX_ATTEMPTS } from "./tokenLifecycle";

const DAY = 24 * 3600e3;

describe("classifyRefresh: the error taxonomy", () => {
  it.each(["invalid_grant", "invalid_token", "invalid_client", "unauthorized_client", "Error: invalid_grant (Bad Request)"])("%s is terminal", (e) => {
    expect(classifyRefresh(e, 400)).toBe("terminal");
    expect(AUTH_ERRORS.test(e)).toBe(true);
  });

  it("a network failure, a throttle and a 5xx are transient", () => {
    expect(classifyRefresh("network_error", 0)).toBe("transient");
    expect(classifyRefresh("rate_limit_exceeded", 429)).toBe("transient");
    expect(classifyRefresh("Refresh failed", 503)).toBe("transient");
    expect(classifyRefresh("Refresh failed", 502)).toBe("transient");
  });

  it("a refusal of the request itself is rejected: no retry, and the grant is not proven bad", () => {
    for (const e of ["invalid_request", "unsupported_grant_type", "invalid_scope", "redirect_uri_mismatch"]) expect(classifyRefresh(e, 400)).toBe("rejected");
  });

  it("an unexplained 4xx is not a verdict on the grant", () => {
    expect(classifyRefresh("Refresh failed", 400)).toBe("transient");
  });

  it("terminal outranks status: an invalid_grant on a 5xx-looking proxy answer is still terminal", () => {
    expect(classifyRefresh("invalid_grant", 500)).toBe("terminal");
  });
});

describe("backoffMs: full jitter, honouring Retry-After", () => {
  it("waits a random time under a ceiling that doubles and is capped", () => {
    expect(backoffMs(0, undefined, () => 0.999)).toBeLessThan(400);
    expect(backoffMs(1, undefined, () => 0.999)).toBeLessThan(800);
    expect(backoffMs(2, undefined, () => 0.999)).toBeLessThan(1600);
    expect(backoffMs(10, undefined, () => 0.999)).toBeLessThan(4000);
    expect(backoffMs(3, undefined, () => 0)).toBe(0);
  });

  it("does what Google asked when it asked, within a sane cap", () => {
    expect(backoffMs(0, 2)).toBe(2000);
    expect(backoffMs(0, 600)).toBe(8000);
    expect(backoffMs(0, 0, () => 0)).toBe(0);
    expect(backoffMs(0, Number.NaN, () => 0)).toBe(0);
  });

  it("a transient failure is attempted three times at most", () => {
    expect(MAX_ATTEMPTS).toBe(3);
  });
});

describe("expiryOf: the absolute instant, never an assumed hour", () => {
  const T = 1_790_000_000_000;
  it("is the arrival time plus what Google said", () => {
    expect(expiryOf(3599, T)).toBe(T + 3_599_000);
    expect(expiryOf("1800", T)).toBe(T + 1_800_000);
  });
  it("is NOW when Google said nothing usable, so the token is refreshed rather than trusted", () => {
    for (const bad of [undefined, null, "", "soon", Number.NaN, 0, -5, Infinity]) expect(expiryOf(bad, T)).toBe(T);
  });
});

describe("isFresh: a cached token is handed out only with room to spare", () => {
  const T = 1_790_000_000_000;
  it("needs more than the skew left", () => {
    expect(isFresh(T + SKEW_MS + 1000, T)).toBe(true);
    expect(isFresh(T + SKEW_MS, T)).toBe(false);
    expect(isFresh(T + 30_000, T)).toBe(false);
    expect(isFresh(T - 1000, T)).toBe(false);
  });
  it("reads ISO stamps, and an unparseable or missing one is never fresh", () => {
    expect(isFresh(new Date(T + 3600e3).toISOString(), T)).toBe(true);
    expect(isFresh("not a date", T)).toBe(false);
    expect(isFresh(null, T)).toBe(false);
    expect(isFresh(undefined, T)).toBe(false);
  });
});

describe("likelyDeathCause: a hint, from what the row shows", () => {
  const NOW = 1_790_000_000_000;
  it("Google's own Testing-mode stamp has passed", () => {
    expect(likelyDeathCause({ nowMs: NOW, grantedAtMs: NOW - 8 * DAY, lastRefreshOkMs: NOW - DAY, refreshExpiresAtMs: NOW - 1000 })).toBe("testing_mode_7_day");
  });
  it("about a week old with nothing else changed reads as the Testing-mode clock even without the stamp", () => {
    expect(likelyDeathCause({ nowMs: NOW, grantedAtMs: NOW - 7 * DAY, lastRefreshOkMs: NOW - 3600e3, refreshExpiresAtMs: null })).toBe("testing_mode_7_day");
  });
  it("six months without a successful refresh reads as non-use", () => {
    expect(likelyDeathCause({ nowMs: NOW, grantedAtMs: NOW - 400 * DAY, lastRefreshOkMs: NOW - 190 * DAY, refreshExpiresAtMs: null })).toBe("six_month_non_use");
  });
  it("a younger or older grant that was in use is a revocation, a password change or an admin block", () => {
    expect(likelyDeathCause({ nowMs: NOW, grantedAtMs: NOW - 2 * DAY, lastRefreshOkMs: NOW - 3600e3, refreshExpiresAtMs: null })).toBe("revoked_or_password_change");
    expect(likelyDeathCause({ nowMs: NOW, grantedAtMs: NOW - 60 * DAY, lastRefreshOkMs: NOW - 3600e3, refreshExpiresAtMs: null })).toBe("revoked_or_password_change");
  });
  it("a Testing-mode stamp still in the future does not claim the cause", () => {
    expect(likelyDeathCause({ nowMs: NOW, grantedAtMs: NOW - 2 * DAY, lastRefreshOkMs: NOW - 3600e3, refreshExpiresAtMs: NOW + 5 * DAY })).toBe("revoked_or_password_change");
  });
});
