// THE TOKEN LIFECYCLE IN THE MIGRATED WORLD (Foundation Fix Spec 2, 2026-10-07).
//
// The real getAccessToken / handleRevokedGrant / forgetGrant / keepSignIn run
// over a STATEFUL fake of the 0057 functions and a fake Google. The fake models
// the same rules jarvis-core/supabase/tests/google_token.sh proves in real
// Postgres (a DEAD row is kept and never revived by a refresh result, the lock
// is one atomic decision, a revocation mirrors the mailbox in the same step),
// so these hold the TypeScript half of the contract: which path decides what.
//
// Each acceptance criterion of Spec 2 is named where it is held.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  forgetGrant, getAccessToken, handleRevokedGrant, keepSignIn, ownerMailbox, IOS_TAG, type GoogleStore,
} from "./_google";
import { mailboxToken, gmail, type EmailEnv } from "./_email";
import { openSecret, sealSecret, isEnvelope } from "../src/connections/google/tokenEnvelope";

const KEY = Buffer.alloc(32, 7).toString("base64");
const KEY2 = Buffer.alloc(32, 9).toString("base64");
const USER = "user-1";
const EMAIL = "dave@gmail.com";
const CLIENTS = { clientId: "web.apps", clientSecret: "shh", iosClientId: "" };
const STORE: GoogleStore = { supaUrl: "https://supa.test", service: "service", tokenKey: KEY, clients: CLIENTS };
const ENV = { ...STORE, anon: "anon" } as EmailEnv;
const FAST = { sleep: () => new Promise<void>((r) => setTimeout(r, 0)), random: () => 0 };

interface Row {
  user_id: string; email: string; token_enc: string; state: "VALID" | "DEAD";
  access_enc: string | null; access_expires_at: string | null; refresh_expires_at: string | null; granted_scope: string | null;
  granted_at: string; last_refresh_ok_at: string | null; consecutive_failures: number; dead_at: string | null;
  last_auth_error: Record<string, unknown> | null; refresh_lock_until: string | null;
}
interface World {
  rows: Map<string, Row>;
  account: { state: string; sync_error: string | null } | null;
  credentials: Set<string>;
  googlePosts: URLSearchParams[];
  revokes: string[];
  rpcs: { fn: string; args: Record<string, unknown> }[];
  /** What Google's token endpoint answers. */
  google: (p: URLSearchParams, n: number) => Response;
  gmail: () => Response;
  /** false = migration 0057 not applied. */
  migrated: boolean;
  /** Runs inside google_refresh_record, to model a revocation landing while a refresh is in flight. */
  midRefresh?: () => void;
}

const res = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  ({ ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => body }) as Response;
const iso = (ms: number) => new Date(ms).toISOString();
const rowKey = (u: string, e: string) => `${u}|${e.toLowerCase()}`;

let w: World;

function seedRow(o: Partial<Row> & { refresh?: string }): Promise<Row> {
  return (async () => {
    const row: Row = {
      user_id: USER, email: EMAIL, token_enc: await sealSecret(o.refresh ?? "1//stored", { current: KEY }, { userId: USER, email: EMAIL, kind: "refresh" }),
      state: "VALID", access_enc: null, access_expires_at: null, refresh_expires_at: null, granted_scope: "gmail.send gmail.modify",
      granted_at: iso(Date.now() - 2 * 86400e3), last_refresh_ok_at: iso(Date.now() - 3600e3), consecutive_failures: 0, dead_at: null,
      last_auth_error: null, refresh_lock_until: null, ...o,
    };
    w.rows.set(rowKey(row.user_id, row.email), row);
    w.credentials.add(rowKey(USER, EMAIL));
    w.account = { state: "connected", sync_error: null };
    return row;
  })();
}

const COLS = ["token_enc", "state", "access_enc", "access_expires_at", "refresh_expires_at", "granted_scope", "granted_at", "last_refresh_ok_at", "refresh_lock_until"];

function newWorld(): World {
  const world: World = {
    rows: new Map(), account: null, credentials: new Set(), googlePosts: [], revokes: [], rpcs: [], migrated: true,
    google: () => res({ access_token: "ya29.fresh", expires_in: 3599, scope: "gmail.send gmail.modify" }),
    gmail: () => res({ emailAddress: EMAIL }),
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url, "https://x.test");
    // The token endpoint is sent a URLSearchParams, not a string.
    const body = typeof init?.body === "string" ? init.body : init?.body ? String(init.body) : "";
    if (url.includes("oauth2.googleapis.com/revoke")) { w.revokes.push(body); return res({}); }
    if (url.includes("oauth2.googleapis.com/token")) { w.googlePosts.push(new URLSearchParams(body)); return w.google(new URLSearchParams(body), w.googlePosts.length); }
    if (url.includes("gmail.googleapis.com")) return w.gmail();
    if (url.includes("/rest/v1/google_tokens")) {
      const e = u.searchParams.get("email")?.replace("eq.", "");
      const uid = u.searchParams.get("user_id")?.replace("eq.", "");
      const select = (u.searchParams.get("select") ?? "").split(",");
      if (!w.migrated && select.some((c) => c !== "token_enc" && c !== "email")) return res({ message: "column does not exist" }, 400);
      if (init?.method === "PATCH") { const r = w.rows.get(rowKey(uid!, e!)); if (r) r.refresh_lock_until = null; return res({}, 204); }
      if (init?.method === "DELETE") { w.rows.delete(rowKey(uid!, e!)); return res({}, 204); }
      const out = [...w.rows.values()].filter((r) => (!uid || r.user_id === uid) && (!e || r.email === e)).map((r) => Object.fromEntries(select.map((c) => [c, (r as unknown as Record<string, unknown>)[c]])));
      return res(out);
    }
    if (url.includes("/rest/v1/email_account?")) return res(w.account ? [{ id: "acct-1" }] : []);
    if (url.includes("/rest/v1/rpc/")) {
      const fn = url.split("/rpc/")[1]!;
      const a = (body ? JSON.parse(body) : {}) as Record<string, unknown>;
      w.rpcs.push({ fn, args: a });
      if (fn.startsWith("google_") && !w.migrated) return res({}, 404);
      const row = w.rows.get(rowKey(String(a.p_user), String(a.p_email ?? "")));
      switch (fn) {
        case "google_refresh_lock": {
          if (!row || row.state !== "VALID") return res(false);
          if (row.refresh_lock_until && new Date(row.refresh_lock_until).getTime() > Date.now()) return res(false);
          row.refresh_lock_until = iso(Date.now() + 15_000);
          return res(true);
        }
        case "google_refresh_record": {
          w.midRefresh?.();
          if (!row || row.state !== "VALID") return res({ error: "NOT_VALID" });
          row.access_enc = a.p_access_enc as string | null; row.access_expires_at = a.p_access_exp as string | null;
          row.token_enc = (a.p_refresh_enc as string | null) ?? row.token_enc; row.refresh_expires_at = (a.p_refresh_exp as string | null) ?? row.refresh_expires_at;
          row.granted_scope = (a.p_scope as string | null) ?? row.granted_scope; row.last_refresh_ok_at = iso(Date.now()); row.consecutive_failures = 0; row.refresh_lock_until = null;
          if (w.account?.state === "reauth") w.account = { state: "connected", sync_error: null };
          return res({ recorded: true });
        }
        case "google_refresh_failed": { if (row?.state === "VALID") { row.consecutive_failures++; row.refresh_lock_until = null; } return res({ failures: row?.consecutive_failures ?? 0 }); }
        case "google_grant_revoked": {
          const prev = row?.state;
          if (row && prev === "VALID") {
            row.state = "DEAD"; row.dead_at = iso(Date.now()); row.access_enc = null; row.access_expires_at = null; row.refresh_lock_until = null;
            row.last_auth_error = { oauthRefreshFailedAt: iso(Date.now()), lastAuthErrorSource: a.p_source, lastAuthErrorCode: a.p_code, lastAuthErrorHttpStatus: a.p_http, likelyCause: a.p_cause };
          }
          if (w.account && w.account.state !== "disconnected") w.account = { state: "reauth", sync_error: "Reconnect Gmail to continue." };
          return res({ row: !!row, first: prev === "VALID" });
        }
        case "google_signin_forget": {
          w.credentials.delete(rowKey(String(a.p_user), String(a.p_email)));
          w.rows.delete(rowKey(String(a.p_user), String(a.p_email)));
          if (w.account && w.account.state !== "disconnected") w.account = { state: "disconnected", sync_error: null };
          return res({ forgotten: true });
        }
        case "google_signin_keep": {
          const key = rowKey(String(a.p_user), String(a.p_email));
          const prev = w.rows.get(key);
          if (a.p_refresh_enc === null) {
            if (!prev) return res({ error: "NO_STORED_SIGNIN" });
            if (prev.state === "DEAD") return res({ error: "NO_REFRESH_TOKEN" });
            prev.access_enc = a.p_access_enc as string | null; prev.access_expires_at = a.p_access_exp as string | null;
          } else {
            w.rows.set(key, {
              user_id: String(a.p_user), email: String(a.p_email), token_enc: String(a.p_refresh_enc), state: "VALID", access_enc: a.p_access_enc as string | null,
              access_expires_at: a.p_access_exp as string | null, refresh_expires_at: a.p_refresh_exp as string | null, granted_scope: a.p_scope as string | null,
              granted_at: iso(Date.now()), last_refresh_ok_at: iso(Date.now()), consecutive_failures: 0, dead_at: null, last_auth_error: null, refresh_lock_until: null,
            });
          }
          w.account = { state: "connected", sync_error: null };
          w.credentials.add(key);
          return res({ stored: true, revived: prev?.state === "DEAD" });
        }
        case "email_account_state": { if (w.account) w.account = { state: String(a.p_state), sync_error: (a.p_error as string | null) ?? null }; return res({ state: a.p_state }); }
        case "email_account_upsert": { w.account = { state: "connected", sync_error: null }; return res({ account_id: "acct-1" }); }
      }
      return res({}, 404);
    }
    return res({}, 404);
  }));
  return world;
}

const row = () => w.rows.get(rowKey(USER, EMAIL))!;
const googleCalls = () => w.googlePosts.length;
const lifecycleRpcs = (fn: string) => w.rpcs.filter((r) => r.fn === fn);

beforeEach(() => { w = newWorld(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("a DEAD grant is never used", () => {
  it("is refused without asking Google, and without even opening the stored token", async () => {
    await seedRow({ state: "DEAD", dead_at: iso(Date.now()) });
    const r = await getAccessToken(STORE, { userId: USER, email: EMAIL, source: "email", ...FAST });
    expect(r).toMatchObject({ ok: false, kind: "revoked", detail: "dead_grant", code: "GOOGLE_SIGNIN_REVOKED" });
    expect(googleCalls()).toBe(0);
    expect(lifecycleRpcs("google_refresh_lock")).toHaveLength(0);
  });

  it("is skipped by the booking receipt's mailbox, and never touched", async () => {
    await seedRow({ state: "DEAD" });
    expect(await ownerMailbox({ supaUrl: STORE.supaUrl, service: "service", tokenKey: KEY, clients: CLIENTS, userId: USER })).toBeNull();
    expect(googleCalls()).toBe(0);
  });

  it("a refresh that lands after the grant was revoked underneath it is DISCARDED, never handed out", async () => {
    await seedRow({});
    w.midRefresh = () => { row().state = "DEAD"; };
    const r = await getAccessToken(STORE, { userId: USER, email: EMAIL, source: "app", ...FAST });
    expect(r).toMatchObject({ ok: false, kind: "revoked" });
    expect(row().state).toBe("DEAD");
  });
});

describe("AC1: exactly one revocation path, whichever door finds it", () => {
  const revoke = () => { w.google = () => res({ error: "invalid_grant" }, 400); };

  async function outcome() {
    return {
      state: row().state,
      kept: isEnvelope(row().token_enc),
      accessDropped: row().access_enc === null,
      mailbox: w.account?.state,
      error: { code: row().last_auth_error?.lastAuthErrorCode, http: row().last_auth_error?.lastAuthErrorHttpStatus },
      deleted: !w.rows.has(rowKey(USER, EMAIL)),
    };
  }

  it("via the app's refresh and via the mail routes, the same outcome, and each marks its own source", async () => {
    revoke();
    await seedRow({});
    const viaApp = await getAccessToken(STORE, { userId: USER, email: EMAIL, source: "app", ...FAST });
    const app = await outcome();
    const appSource = row().last_auth_error?.lastAuthErrorSource;

    w = newWorld(); revoke();
    await seedRow({});
    const viaEmail = await mailboxToken(ENV, USER, EMAIL);
    const email = await outcome();
    const emailSource = row().last_auth_error?.lastAuthErrorSource;

    expect(viaApp).toMatchObject({ ok: false, kind: "revoked" });
    expect(viaEmail).toMatchObject({ ok: false, reauth: true, fail: { code: "PROVIDER_AUTH" } });
    expect(app).toEqual({ state: "DEAD", kept: true, accessDropped: true, mailbox: "reauth", error: { code: "invalid_grant", http: 400 }, deleted: false });
    expect(email).toEqual(app);
    expect([appSource, emailSource]).toEqual(["app", "email"]);
  });

  it("goes through ONE function each time: google_grant_revoked, with redacted metadata and no token anywhere in it", async () => {
    revoke();
    await seedRow({ refresh: "1//super-secret-refresh" });
    await getAccessToken(STORE, { userId: USER, email: EMAIL, source: "app", ...FAST });
    const calls = lifecycleRpcs("google_grant_revoked");
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0]!.args).sort()).toEqual(["p_cause", "p_code", "p_email", "p_http", "p_source", "p_user"]);
    expect(JSON.stringify(w.rpcs)).not.toMatch(/1\/\/super-secret|ya29/);
  });

  it("invalid_grant is TERMINAL: Google is asked exactly once, never retried, and a second caller never asks at all", async () => {
    revoke();
    await seedRow({});
    await getAccessToken(STORE, { userId: USER, email: EMAIL, source: "app", ...FAST });
    expect(googleCalls()).toBe(1);
    await getAccessToken(STORE, { userId: USER, email: EMAIL, source: "email", ...FAST });
    await getAccessToken(STORE, { userId: USER, email: EMAIL, source: "worker", force: true, ...FAST });
    expect(googleCalls()).toBe(1);
  });

  it("only the call that found the revocation is `first`, so the announcement fires once per incident", async () => {
    await seedRow({});
    const a = await handleRevokedGrant(STORE, { userId: USER, email: EMAIL, source: "app", code: "invalid_grant", httpStatus: 400 });
    const b = await handleRevokedGrant(STORE, { userId: USER, email: EMAIL, source: "email", code: "invalid_grant", httpStatus: 400 });
    expect([a.first, b.first]).toEqual([true, false]);
  });

  it("names the likely cause from the row: a Testing-mode clock that has run out", async () => {
    revoke();
    await seedRow({ granted_at: iso(Date.now() - 8 * 86400e3), refresh_expires_at: iso(Date.now() - 1000) });
    await getAccessToken(STORE, { userId: USER, email: EMAIL, source: "app", ...FAST });
    expect(row().last_auth_error?.likelyCause).toBe("testing_mode_7_day");
  });

  it("is a transient failure, NOT a revocation, when Google is down: nothing is marked DEAD", async () => {
    w.google = () => res({}, 503);
    await seedRow({});
    const r = await getAccessToken(STORE, { userId: USER, email: EMAIL, source: "app", ...FAST });
    expect(r).toMatchObject({ ok: false, kind: "transient", code: "GOOGLE_REFRESH_UNAVAILABLE" });
    expect(row().state).toBe("VALID");
    expect(w.account?.state).toBe("connected");
    expect(lifecycleRpcs("google_grant_revoked")).toHaveLength(0);
  });
});

describe("AC2: reconnect", () => {
  it("a fresh refresh token revives the DEAD row, mirrors the mailbox, and a real refresh then succeeds", async () => {
    w.google = (p) => (p.get("grant_type") === "refresh_token" && p.get("refresh_token") === "1//stored" ? res({ error: "invalid_grant" }, 400) : res({ access_token: "ya29.after", expires_in: 3599, scope: "gmail.send" }));
    await seedRow({});
    await getAccessToken(STORE, { userId: USER, email: EMAIL, source: "app", ...FAST });
    expect(row().state).toBe("DEAD");
    expect(w.account?.state).toBe("reauth");

    const kept = await keepSignIn(STORE, { userId: USER, email: EMAIL, refreshToken: "1//new", accessToken: "ya29.connect", expiresIn: 3599, scope: "gmail.send" });
    expect(kept).toEqual({ remembered: true });
    expect(row()).toMatchObject({ state: "VALID", last_auth_error: null, dead_at: null });
    expect(w.account?.state).toBe("connected");

    const after = await getAccessToken(STORE, { userId: USER, email: EMAIL, source: "app", force: true, ...FAST });
    expect(after).toMatchObject({ ok: true, accessToken: "ya29.after", fresh: true });
    expect(row().last_refresh_ok_at).not.toBeNull();
  });

  it("consent that returned NO refresh token cannot revive a dead grant, and says so", async () => {
    await seedRow({ state: "DEAD" });
    expect(await keepSignIn(STORE, { userId: USER, email: EMAIL, accessToken: "ya29.x", expiresIn: 3599 })).toEqual({ remembered: false, code: "GOOGLE_NO_STORED_SIGNIN" });
    expect(row().state).toBe("DEAD");
  });

  it("stores each secret in its own envelope, bound to this user and address, and never the plain token", async () => {
    await keepSignIn(STORE, { userId: USER, email: "Dave@Gmail.com", refreshToken: "1//the-refresh", accessToken: "ya29.the-access", expiresIn: 3599, native: true });
    const r = row();
    expect(isEnvelope(r.token_enc) && isEnvelope(r.access_enc!)).toBe(true);
    expect(r.token_enc + r.access_enc!).not.toMatch(/1\/\/the-refresh|ya29\.the-access/);
    expect(await openSecret(r.token_enc, { current: KEY }, { userId: USER, email: EMAIL, kind: "refresh" })).toBe(IOS_TAG + "1//the-refresh");
    await expect(openSecret(r.token_enc, { current: KEY }, { userId: "someone-else", email: EMAIL, kind: "refresh" })).rejects.toThrow();
    await expect(openSecret(r.access_enc!, { current: KEY }, { userId: USER, email: EMAIL, kind: "refresh" })).rejects.toThrow();
  });
});

describe("AC3: disconnect is the kill switch", () => {
  it("deletes the token row AND the credential reference, disconnects the mailbox, and revokes at Google", async () => {
    await seedRow({ refresh: "1//to-revoke" });
    const gone = await forgetGrant(STORE, { userId: USER, email: EMAIL, source: "app" });
    expect(gone).toEqual({ ok: true, revokedAtGoogle: true });
    expect(w.rows.size).toBe(0);
    expect(w.credentials.size).toBe(0);
    expect(w.account?.state).toBe("disconnected");
    expect(w.revokes).toEqual(["token=" + encodeURIComponent("1//to-revoke")]);
  });

  it("nothing can act for the account afterwards: no credential left to act with", async () => {
    await seedRow({});
    await forgetGrant(STORE, { userId: USER, email: EMAIL, source: "app" });
    expect(await mailboxToken(ENV, USER, EMAIL, "send")).toMatchObject({ ok: false, reauth: true });
    expect(await getAccessToken(STORE, { userId: USER, email: EMAIL, source: "worker", ...FAST })).toMatchObject({ ok: false, kind: "no_signin" });
    expect(googleCalls()).toBe(0);
  });

  it("Google being down never delays or undoes the local disconnect", async () => {
    await seedRow({});
    const f = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const inner = f.getMockImplementation()!;
    f.mockImplementation(async (url: string, init?: RequestInit) => { if (String(url).includes("/revoke")) throw new TypeError("offline"); return inner(url, init); });
    expect(await forgetGrant(STORE, { userId: USER, email: EMAIL, source: "app" })).toEqual({ ok: true, revokedAtGoogle: false });
    expect(w.rows.size).toBe(0);
  });

  it("a native token is revoked without our tag, which Google has never heard of", async () => {
    await seedRow({ refresh: IOS_TAG + "1//phone" });
    await forgetGrant(STORE, { userId: USER, email: EMAIL, source: "app" });
    expect(w.revokes).toEqual(["token=" + encodeURIComponent("1//phone")]);
  });

  it("says it could not, rather than claiming a disconnect that did not happen", async () => {
    await seedRow({});
    const f = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const inner = f.getMockImplementation()!;
    f.mockImplementation(async (url: string, init?: RequestInit) => (String(url).includes("google_signin_forget") ? res({}, 500) : inner(url, init)));
    expect(await forgetGrant(STORE, { userId: USER, email: EMAIL, source: "app" })).toEqual({ ok: false });
    expect(w.rows.size).toBe(1);
  });
});

describe("AC4: two workers racing a refresh make exactly one Google POST", () => {
  it("the loser waits for and reuses the winner's result: no false invalid_grant, no re-auth prompt", async () => {
    // A real Google answers the SECOND use of a single-use refresh token with invalid_grant; the race must never produce one.
    let used = 0;
    w.google = () => (used++ === 0 ? res({ access_token: "ya29.winner", expires_in: 3599, scope: "gmail.send" }) : res({ error: "invalid_grant" }, 400));
    await seedRow({});
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => getAccessToken(STORE, { userId: USER, email: EMAIL, source: "email", coalesce: false, ...FAST })));
    expect(googleCalls()).toBe(1);
    for (const r of [a, b, c]) expect(r).toMatchObject({ ok: true, accessToken: "ya29.winner" });
    expect([a, b, c].filter((r) => r.ok && r.fresh)).toHaveLength(1);
    expect(row().state).toBe("VALID");
    expect(w.account?.state).toBe("connected");
  });

  it("inside one isolate the callers share a single promise, so a burst is one refresh too", async () => {
    await seedRow({});
    const rs = await Promise.all([1, 2, 3, 4].map(() => getAccessToken(STORE, { userId: USER, email: EMAIL, source: "email", ...FAST })));
    expect(googleCalls()).toBe(1);
    expect(new Set(rs.map((r) => (r.ok ? r.accessToken : "x"))).size).toBe(1);
  });

  it("a worker that died holding the lock blocks the account for its TTL, not forever", async () => {
    await seedRow({ refresh_lock_until: iso(Date.now() - 1000) });
    expect(await getAccessToken(STORE, { userId: USER, email: EMAIL, source: "email", ...FAST })).toMatchObject({ ok: true, fresh: true });
  });

  it("a lock that never frees is a transient failure, never a hang and never a revocation", async () => {
    await seedRow({ refresh_lock_until: iso(Date.now() + 3600e3) });
    const r = await getAccessToken(STORE, { userId: USER, email: EMAIL, source: "email", sleep: async () => {}, random: () => 0 });
    expect(r).toMatchObject({ ok: false, kind: "transient", detail: "refresh_in_flight" });
    expect(googleCalls()).toBe(0);
    expect(row().state).toBe("VALID");
  });
});

describe("AC5: a refresh that omits refresh_token leaves the stored one untouched", () => {
  it("renewal succeeds with no consent prompt, and the stored envelope is byte for byte what it was", async () => {
    await seedRow({});
    const before = row().token_enc;
    const r = await getAccessToken(STORE, { userId: USER, email: EMAIL, source: "app", ...FAST });
    expect(r).toMatchObject({ ok: true });
    expect(row().token_enc).toBe(before);
    expect(lifecycleRpcs("google_refresh_record")[0]!.args.p_refresh_enc).toBeNull();
  });

  it("a token Google DOES rotate replaces the stored one, keeping the native tag", async () => {
    w.google = () => res({ access_token: "ya29.x", expires_in: 3599, refresh_token: "1//rotated" });
    await seedRow({ refresh: IOS_TAG + "1//phone" });
    await getAccessToken(STORE, { userId: USER, email: EMAIL, source: "app", ...FAST });
    expect(await openSecret(row().token_enc, { current: KEY }, { userId: USER, email: EMAIL, kind: "refresh" })).toBe(IOS_TAG + "1//rotated");
  });

  it("a token still in the original format is rewritten into the envelope on its next refresh, and still opens", async () => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const k = await crypto.subtle.importKey("raw", Uint8Array.from(atob(KEY), (c) => c.charCodeAt(0)), "AES-GCM", false, ["encrypt"]);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode("1//legacy")));
    const legacy = btoa(String.fromCharCode(...iv, ...ct));
    await seedRow({});
    row().token_enc = legacy;
    expect(await getAccessToken(STORE, { userId: USER, email: EMAIL, source: "app", ...FAST })).toMatchObject({ ok: true });
    expect(isEnvelope(row().token_enc)).toBe(true);
    expect(await openSecret(row().token_enc, { current: KEY }, { userId: USER, email: EMAIL, kind: "refresh" })).toBe("1//legacy");
  });

  it("a secret sealed under the OLD key opens beside the new one and is rewritten under it", async () => {
    await seedRow({});
    const rotated: GoogleStore = { ...STORE, tokenKey: KEY2, tokenKeyPrev: KEY };
    expect(await getAccessToken(rotated, { userId: USER, email: EMAIL, source: "app", ...FAST })).toMatchObject({ ok: true });
    expect(await openSecret(row().token_enc, { current: KEY2 }, { userId: USER, email: EMAIL, kind: "refresh" })).toBe("1//stored");
  });
});

describe("expiry is the absolute instant Google gave, never an assumed hour", () => {
  it("caches the token until Google's own expiry, and a call inside the cache makes no Google POST", async () => {
    await seedRow({});
    const t0 = Date.now();
    const first = await getAccessToken(STORE, { userId: USER, email: EMAIL, source: "email", ...FAST });
    expect(first).toMatchObject({ ok: true, fresh: true });
    const stamped = new Date(row().access_expires_at!).getTime();
    expect(stamped).toBeGreaterThanOrEqual(t0 + 3599_000);
    expect(stamped).toBeLessThan(Date.now() + 3600_000);
    const second = await getAccessToken(STORE, { userId: USER, email: EMAIL, source: "email", ...FAST });
    expect(second).toMatchObject({ ok: true, fresh: false, accessToken: "ya29.fresh" });
    expect(googleCalls()).toBe(1);
  });

  it("refreshes inline when the cached token is within ten minutes of dying", async () => {
    await seedRow({});
    await getAccessToken(STORE, { userId: USER, email: EMAIL, source: "email", ...FAST });
    row().access_expires_at = iso(Date.now() + 9 * 60e3);
    expect(await getAccessToken(STORE, { userId: USER, email: EMAIL, source: "email", ...FAST })).toMatchObject({ ok: true, fresh: true });
    expect(googleCalls()).toBe(2);
  });

  it("a response with no usable expiry is handed out but NOT cached, so the next call refreshes", async () => {
    w.google = () => res({ access_token: "ya29.noexp" });
    await seedRow({});
    const r = await getAccessToken(STORE, { userId: USER, email: EMAIL, source: "email", ...FAST });
    expect(r).toMatchObject({ ok: true, accessToken: "ya29.noexp", expiresIn: 0 });
    expect(row().access_enc).toBeNull();
    await getAccessToken(STORE, { userId: USER, email: EMAIL, source: "email", ...FAST });
    expect(googleCalls()).toBe(2);
  });

  it("a stamp that cannot be parsed is never trusted", async () => {
    await seedRow({});
    await getAccessToken(STORE, { userId: USER, email: EMAIL, source: "email", ...FAST });
    row().access_expires_at = "garbage";
    await getAccessToken(STORE, { userId: USER, email: EMAIL, source: "email", ...FAST });
    expect(googleCalls()).toBe(2);
  });

  it("the granted scope comes from Google's response, not from what was asked for", async () => {
    w.google = () => res({ access_token: "ya29.x", expires_in: 3599, scope: "https://www.googleapis.com/auth/gmail.readonly" });
    await seedRow({});
    const r = await getAccessToken(STORE, { userId: USER, email: EMAIL, source: "email", ...FAST });
    expect(r).toMatchObject({ ok: true, scope: "https://www.googleapis.com/auth/gmail.readonly" });
    expect(row().granted_scope).toBe("https://www.googleapis.com/auth/gmail.readonly");
  });

  it("records a Testing-mode refresh-token lifetime when Google reports one", async () => {
    w.google = () => res({ access_token: "ya29.x", expires_in: 3599, refresh_token_expires_in: 604799 });
    await seedRow({});
    await getAccessToken(STORE, { userId: USER, email: EMAIL, source: "email", ...FAST });
    expect(new Date(row().refresh_expires_at!).getTime() - Date.now()).toBeGreaterThan(604_000_000);
  });
});

describe("the error taxonomy for everything that is not invalid_grant", () => {
  it("429 and 5xx back off with full jitter, honour Retry-After, and stop after three attempts", async () => {
    w.google = () => res({ error: "rate_limit_exceeded" }, 429, { "retry-after": "2" });
    await seedRow({});
    const waits: number[] = [];
    const r = await getAccessToken(STORE, { userId: USER, email: EMAIL, source: "email", sleep: async (ms) => { waits.push(ms); }, random: () => 0.5 });
    expect(r).toMatchObject({ ok: false, kind: "transient" });
    expect(googleCalls()).toBe(3);
    expect(waits.filter((ms) => ms === 2000)).toHaveLength(2);
    expect(row().consecutive_failures).toBe(1);
    expect(row().state).toBe("VALID");
    expect(row().refresh_lock_until).toBeNull();
  });

  it("recovers when Google comes back inside the retries", async () => {
    w.google = (_p, n) => (n < 3 ? res({}, 503) : res({ access_token: "ya29.ok", expires_in: 3599 }));
    await seedRow({});
    expect(await getAccessToken(STORE, { userId: USER, email: EMAIL, source: "email", ...FAST })).toMatchObject({ ok: true, accessToken: "ya29.ok" });
    expect(googleCalls()).toBe(3);
    expect(row().consecutive_failures).toBe(0);
  });

  it("a network failure is retried, then reported as a network failure, and marks nothing", async () => {
    const f = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const inner = f.getMockImplementation()!;
    f.mockImplementation(async (url: string, init?: RequestInit) => { if (String(url).includes("/token")) throw new TypeError("offline"); return inner(url, init); });
    await seedRow({});
    const r = await getAccessToken(STORE, { userId: USER, email: EMAIL, source: "email", ...FAST });
    expect(r).toMatchObject({ ok: false, kind: "transient", code: "GOOGLE_NETWORK_ERROR" });
    expect(row().state).toBe("VALID");
  });

  it("a refusal of the request itself is not retried and is not a revocation", async () => {
    w.google = () => res({ error: "invalid_request" }, 400);
    await seedRow({});
    const r = await getAccessToken(STORE, { userId: USER, email: EMAIL, source: "email", ...FAST });
    expect(r).toMatchObject({ ok: false, kind: "transient", detail: "rejected" });
    expect(googleCalls()).toBe(1);
    expect(row().state).toBe("VALID");
  });

  it("a stored token that cannot be opened is unreadable, is not marked DEAD, and releases the lock", async () => {
    await seedRow({});
    row().token_enc = "AAAA";
    const r = await getAccessToken(STORE, { userId: USER, email: EMAIL, source: "app", ...FAST });
    expect(r).toMatchObject({ ok: false, kind: "unreadable", code: "GOOGLE_STORED_SIGNIN_UNREADABLE" });
    expect(row().state).toBe("VALID");
    expect(row().refresh_lock_until).toBeNull();
    expect(googleCalls()).toBe(0);
  });

  it("a storage failure is never reported as no sign-in", async () => {
    const f = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockImplementation(async () => res({ message: "down" }, 500));
    expect(await getAccessToken(STORE, { userId: USER, email: EMAIL, source: "app", ...FAST })).toMatchObject({ ok: false, kind: "storage", code: "GOOGLE_STORAGE_FAILURE" });
  });
});

describe("a 401 on an API call: renew once, retry once, then escalate", () => {
  it("renews with a forced refresh and retries, and a second 401 is returned, never looped", async () => {
    await seedRow({});
    const tok = await mailboxToken(ENV, USER, EMAIL);
    expect(tok.ok).toBe(true);
    if (!tok.ok) return;
    let gmailCalls = 0;
    w.gmail = () => { gmailCalls++; return res({}, 401); };
    const a = await gmail(tok, "/profile", { safeRead: true });
    expect(a.status).toBe(401);
    expect(gmailCalls).toBe(2);
    expect(googleCalls()).toBe(2); // the first mint, and exactly one renewal
  });

  it("succeeds on the retry when the renewed token is accepted", async () => {
    await seedRow({});
    const tok = await mailboxToken(ENV, USER, EMAIL);
    if (!tok.ok) throw new Error("no token");
    let n = 0;
    w.gmail = () => (n++ === 0 ? res({}, 401) : res({ emailAddress: EMAIL }));
    expect((await gmail(tok, "/profile", { safeRead: true })).ok).toBe(true);
    expect(n).toBe(2);
  });

  it("a write is safe to repeat after a 401 (the request was not processed), but only once", async () => {
    await seedRow({});
    const tok = await mailboxToken(ENV, USER, EMAIL);
    if (!tok.ok) throw new Error("no token");
    let n = 0;
    w.gmail = () => (n++ === 0 ? res({}, 401) : res({ id: "m1" }));
    expect((await gmail(tok, "/messages/m1/trash", { method: "POST" })).ok).toBe(true);
    expect(n).toBe(2);
  });
});

describe("before migration 0057 is applied the same functions still work", () => {
  beforeEach(() => { w.migrated = false; });

  it("refreshes with no cache and no lock, and deletes nothing", async () => {
    await seedRow({});
    const r = await getAccessToken(STORE, { userId: USER, email: EMAIL, source: "app", ...FAST });
    expect(r).toMatchObject({ ok: true, accessToken: "ya29.fresh" });
    expect(w.rows.size).toBe(1);
  });

  it("a revocation moves the mailbox to reauth the older way and still deletes nothing", async () => {
    w.google = () => res({ error: "invalid_grant" }, 400);
    await seedRow({});
    const r = await getAccessToken(STORE, { userId: USER, email: EMAIL, source: "app", ...FAST });
    expect(r).toMatchObject({ ok: false, kind: "revoked" });
    expect(w.account?.state).toBe("reauth");
    expect(w.rows.size).toBe(1);
  });
});
