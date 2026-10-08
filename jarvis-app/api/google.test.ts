import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import handler from "./google";
import { IOS_TAG, encrypt } from "./_google";

// PERSISTENT SIGN-IN, THE HANDLER (2026-09-29). The handler is the only place
// a refresh token lives, and it used to say two things that were not true: that
// a sign-in was remembered when the write that would have stored it had failed,
// and that there was "no stored sign-in" when the database had merely errored.
// Both sent the person through Google's chooser for a problem the chooser
// cannot fix. These run the real handler over a fake Supabase and a fake
// Google, and read the answers a phone would.

const KEY = Buffer.alloc(32, 7).toString("base64");
const USER = "user-1";
const EMAIL = "dave@gmail.com";

type Route = (url: string, init?: RequestInit) => Response | Promise<Response> | undefined;
const res = (body: unknown, status = 200): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

let calls: { url: string; method: string; body?: string }[] = [];

function stubNetwork(overrides: Route[] = []) {
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : init?.body?.toString() });
    for (const r of overrides) {
      const got = r(url, init);
      if (got) return got;
    }
    if (url.includes("/auth/v1/user")) return res({ id: USER });
    if (url.includes("oauth2.googleapis.com/token")) return res({ access_token: "at-1", refresh_token: "1//new", expires_in: 3599, scope: "s1 s2" });
    if (url.includes("gmail.googleapis.com/gmail/v1/users/me/profile")) return res({ emailAddress: "Dave@Gmail.com" });
    if (url.includes("/rest/v1/google_tokens")) return res([], 200);
    throw new Error("unexpected " + url);
  });
  vi.stubGlobal("fetch", f);
  return f;
}

const post = (body: unknown, auth = "Bearer jwt") =>
  new Request("https://x.test/api/google", { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify(body) });

const send = async (body: unknown, auth?: string) => {
  const r = await handler(post(body, auth));
  return { status: r.status, json: (await r.json()) as Record<string, unknown> };
};

const isRest = (url: string) => url.includes("/rest/v1/google_tokens");

beforeEach(() => {
  calls = [];
  vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "web.apps.googleusercontent.com");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "shh");
  vi.stubEnv("GOOGLE_TOKEN_KEY", KEY);
  vi.stubEnv("VITE_SUPABASE_URL", "https://supa.test");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
  vi.stubEnv("VITE_GOOGLE_IOS_CLIENT_ID", "");
  vi.stubEnv("GOOGLE_IOS_CLIENT_ID", "");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("connect: durable means stored", () => {
  it("claims remembered only after the token store was accepted", async () => {
    stubNetwork([(u, i) => (isRest(u) && i?.method === "POST" ? res({}, 201) : undefined)]);
    const { status, json } = await send({ code: "c1" });
    expect(status).toBe(200);
    expect(json).toMatchObject({ accessToken: "at-1", email: EMAIL, remembered: true, scope: "s1 s2" });
    expect(json.code).toBeUndefined();
    // The row was written encrypted, never as the raw token.
    const write = calls.find((c) => isRest(c.url) && c.method === "POST")!;
    expect(write.body).not.toContain("1//new");
  });

  it("a rejected store is remembered:false with a storage failure, and the connection still works", async () => {
    stubNetwork([(u, i) => (isRest(u) && i?.method === "POST" ? res({ message: "boom" }, 500) : undefined)]);
    const { status, json } = await send({ code: "c1" });
    expect(status).toBe(200);
    expect(json).toMatchObject({ accessToken: "at-1", remembered: false, code: "GOOGLE_STORAGE_FAILURE", retryable: true });
  });

  it("a store that throws is the same storage failure, not a 500", async () => {
    stubNetwork([(u, i) => { if (isRest(u) && i?.method === "POST") throw new Error("reset"); return undefined; }]);
    const { status, json } = await send({ code: "c1" });
    expect(status).toBe(200);
    expect(json).toMatchObject({ remembered: false, code: "GOOGLE_STORAGE_FAILURE" });
  });

  it("when Google omits a refresh token the old one is left alone and still counts", async () => {
    const old = await encrypt("1//old", KEY);
    stubNetwork([
      (u) => (u.includes("oauth2.googleapis.com/token") ? res({ access_token: "at-2", expires_in: 3599 }) : undefined),
      (u, i) => (isRest(u) && (i?.method ?? "GET") === "GET" ? res([{ token_enc: old }]) : undefined),
    ]);
    const { json } = await send({ code: "c1" });
    expect(json).toMatchObject({ accessToken: "at-2", remembered: true });
    // Nothing was written or deleted: the valid old token is untouched.
    expect(calls.filter((c) => isRest(c.url) && c.method !== "GET")).toEqual([]);
  });

  it("no new token and no old one is remembered:false, and says why", async () => {
    stubNetwork([
      (u) => (u.includes("oauth2.googleapis.com/token") ? res({ access_token: "at-2" }) : undefined),
      (u) => (isRest(u) ? res([]) : undefined),
    ]);
    const { json } = await send({ code: "c1" });
    expect(json).toMatchObject({ remembered: false, code: "GOOGLE_NO_STORED_SIGNIN" });
    expect(calls.filter((c) => isRest(c.url) && c.method !== "GET")).toEqual([]);
  });

  it("a database error while looking for the old token is a storage failure, not 'no token'", async () => {
    stubNetwork([
      (u) => (u.includes("oauth2.googleapis.com/token") ? res({ access_token: "at-2" }) : undefined),
      (u) => (isRest(u) ? res({ message: "down" }, 503) : undefined),
    ]);
    const { json } = await send({ code: "c1" });
    expect(json).toMatchObject({ remembered: false, code: "GOOGLE_STORAGE_FAILURE" });
  });

  it("an old token that will not decrypt is reported as unreadable, and is not overwritten", async () => {
    stubNetwork([
      (u) => (u.includes("oauth2.googleapis.com/token") ? res({ access_token: "at-2" }) : undefined),
      (u) => (isRest(u) ? res([{ token_enc: "AAAA" }]) : undefined),
    ]);
    const { json } = await send({ code: "c1" });
    expect(json).toMatchObject({ remembered: false, code: "GOOGLE_STORED_SIGNIN_UNREADABLE" });
    expect(calls.filter((c) => isRest(c.url) && c.method !== "GET")).toEqual([]);
  });

  it("a network failure reaching Google's token endpoint is a network failure", async () => {
    stubNetwork([(u) => { if (u.includes("oauth2.googleapis.com/token")) throw new TypeError("fetch failed"); return undefined; }]);
    const { status, json } = await send({ code: "c1" });
    expect(status).toBe(503);
    expect(json).toMatchObject({ code: "GOOGLE_NETWORK_ERROR", retryable: true });
  });

  it("keeps the native PKCE exchange: the iOS client, the verifier, no secret, and the tag on the stored token", async () => {
    vi.stubEnv("VITE_GOOGLE_IOS_CLIENT_ID", "1234-abc.apps.googleusercontent.com");
    stubNetwork([(u, i) => (isRest(u) && i?.method === "POST" ? res({}, 201) : undefined)]);
    const { json } = await send({ code: "c1", verifier: "ver", redirectUri: "com.googleusercontent.apps.1234-abc:/oauth" });
    expect(json).toMatchObject({ remembered: true });
    const exchange = new URLSearchParams(calls.find((c) => c.url.includes("oauth2.googleapis.com/token"))!.body);
    expect(exchange.get("client_id")).toBe("1234-abc.apps.googleusercontent.com");
    expect(exchange.get("code_verifier")).toBe("ver");
    expect(exchange.get("client_secret")).toBeNull();
    // The stored value is encrypted, and decrypts to the tagged token.
    const stored = JSON.parse(calls.find((c) => isRest(c.url) && c.method === "POST")!.body!) as { token_enc: string };
    const { decrypt } = await import("./_google");
    expect(await decrypt(stored.token_enc, KEY)).toBe(IOS_TAG + "1//new");
  });

  it("refuses a native verifier when the iOS client is not configured", async () => {
    stubNetwork();
    const { status } = await send({ code: "c1", verifier: "ver", redirectUri: "com.googleusercontent.apps.x:/o" });
    expect(status).toBe(400);
  });
});

describe("refresh: four causes, four codes", () => {
  const stored = () => encrypt("1//stored", KEY);

  it("no stored token", async () => {
    stubNetwork([(u) => (isRest(u) ? res([]) : undefined)]);
    const { status, json } = await send({ refresh: EMAIL });
    expect(status).toBe(410);
    expect(json).toMatchObject({ code: "GOOGLE_NO_STORED_SIGNIN", message: `Google isn't set to stay signed in. Reconnect ${EMAIL}.`, retryable: false });
  });

  it("a stored token that cannot be decrypted", async () => {
    stubNetwork([(u) => (isRest(u) ? res([{ token_enc: "AAAA" }]) : undefined)]);
    const { status, json } = await send({ refresh: EMAIL });
    expect(status).toBe(410);
    expect(json).toMatchObject({ code: "GOOGLE_STORED_SIGNIN_UNREADABLE", message: `The saved Google sign-in couldn't be opened. Reconnect ${EMAIL}.` });
  });

  it("invalid_grant is a revoked sign-in and forgets the row", async () => {
    const enc = await stored();
    stubNetwork([
      (u, i) => (isRest(u) && (i?.method ?? "GET") === "GET" ? res([{ token_enc: enc }]) : undefined),
      (u, i) => (isRest(u) && i?.method === "DELETE" ? res({}, 204) : undefined),
      (u) => (u.includes("oauth2.googleapis.com/token") ? res({ error: "invalid_grant" }, 400) : undefined),
    ]);
    const { status, json } = await send({ refresh: EMAIL });
    expect(status).toBe(410);
    expect(json).toMatchObject({ code: "GOOGLE_SIGNIN_REVOKED", message: `Google revoked this sign-in. Reconnect ${EMAIL}.` });
    expect(calls.some((c) => isRest(c.url) && c.method === "DELETE")).toBe(true);
    // The Email tab's mirror of this sign-in is marked reauth_required, NOT left to read as "disconnected": the cached
    // mail and drafts stay, Reconnect is offered (Email spec section 8, AC37).
    const mark = calls.find((c) => c.url.includes("/rest/v1/rpc/email_account_mark"));
    expect(JSON.parse(mark!.body ?? "{}")).toMatchObject({ p_address: EMAIL, p_auth: "reauth_required" });
  });

  it("any other provider error is temporary, retryable, and forgets nothing", async () => {
    const enc = await stored();
    stubNetwork([
      (u, i) => (isRest(u) && (i?.method ?? "GET") === "GET" ? res([{ token_enc: enc }]) : undefined),
      (u) => (u.includes("oauth2.googleapis.com/token") ? res({ error: "temporarily_unavailable" }, 503) : undefined),
    ]);
    const { status, json } = await send({ refresh: EMAIL });
    expect(status).toBe(502);
    expect(json).toMatchObject({ code: "GOOGLE_REFRESH_UNAVAILABLE", message: "Google couldn't refresh right now. Try again.", retryable: true });
    expect(calls.some((c) => isRest(c.url) && c.method === "DELETE")).toBe(false);
  });

  it("a provider error with an unreadable body is still that, not a crash", async () => {
    const enc = await stored();
    stubNetwork([
      (u, i) => (isRest(u) && (i?.method ?? "GET") === "GET" ? res([{ token_enc: enc }]) : undefined),
      (u) => (u.includes("oauth2.googleapis.com/token")
        ? ({ ok: false, status: 502, json: async () => { throw new SyntaxError("html"); } } as unknown as Response)
        : undefined),
    ]);
    const { json } = await send({ refresh: EMAIL });
    expect(json).toMatchObject({ code: "GOOGLE_REFRESH_UNAVAILABLE" });
  });

  it("a dead network to Google is a network failure and forgets nothing", async () => {
    const enc = await stored();
    stubNetwork([
      (u, i) => (isRest(u) && (i?.method ?? "GET") === "GET" ? res([{ token_enc: enc }]) : undefined),
      (u) => { if (u.includes("oauth2.googleapis.com/token")) throw new TypeError("fetch failed"); return undefined; },
    ]);
    const { status, json } = await send({ refresh: EMAIL });
    expect(status).toBe(503);
    expect(json).toMatchObject({ code: "GOOGLE_NETWORK_ERROR", retryable: true });
    expect(calls.some((c) => isRest(c.url) && c.method === "DELETE")).toBe(false);
  });

  it("a database SELECT error is a storage failure, never 'no stored sign-in'", async () => {
    stubNetwork([(u) => (isRest(u) ? res({ message: "down" }, 500) : undefined)]);
    const { status, json } = await send({ refresh: EMAIL });
    expect(status).toBe(503);
    expect(json).toMatchObject({ code: "GOOGLE_STORAGE_FAILURE", retryable: true });
    stubNetwork([(u) => { if (isRest(u)) throw new Error("reset"); return undefined; }]);
    expect((await send({ refresh: EMAIL })).json).toMatchObject({ code: "GOOGLE_STORAGE_FAILURE" });
  });

  it("success carries the token, expiry, the granted scope and remembered:true", async () => {
    const enc = await stored();
    stubNetwork([
      (u, i) => (isRest(u) && (i?.method ?? "GET") === "GET" ? res([{ token_enc: enc }]) : undefined),
      (u) => (u.includes("oauth2.googleapis.com/token") ? res({ access_token: "fresh", expires_in: 1800, scope: "a b" }) : undefined),
    ]);
    const { status, json } = await send({ refresh: "  Dave@Gmail.com " });
    expect(status).toBe(200);
    expect(json).toEqual({ accessToken: "fresh", email: EMAIL, expiresIn: 1800, remembered: true, scope: "a b" });
  });

  it("never puts a token in a failure response", async () => {
    const enc = await stored();
    stubNetwork([
      (u, i) => (isRest(u) && (i?.method ?? "GET") === "GET" ? res([{ token_enc: enc }]) : undefined),
      (u) => (u.includes("oauth2.googleapis.com/token") ? res({ error: "boom" }, 500) : undefined),
    ]);
    const { json } = await send({ refresh: EMAIL });
    expect(JSON.stringify(json)).not.toContain("1//stored");
  });
});

describe("JARVIS auth", () => {
  it("an expired JARVIS sign-in is its own code", async () => {
    stubNetwork([(u) => (u.includes("/auth/v1/user") ? res({ msg: "bad jwt" }, 401) : undefined)]);
    const { status, json } = await send({ refresh: EMAIL });
    expect(status).toBe(401);
    expect(json).toMatchObject({ code: "GOOGLE_AUTH_EXPIRED", retryable: false });
  });

  it("no bearer token at all is the same answer", async () => {
    stubNetwork();
    const { json } = await send({ refresh: EMAIL }, "");
    expect(json).toMatchObject({ code: "GOOGLE_AUTH_EXPIRED" });
  });

  it("the auth service being down is a temporary failure, not an expired sign-in", async () => {
    stubNetwork([(u) => (u.includes("/auth/v1/user") ? res({}, 503) : undefined)]);
    expect((await send({ refresh: EMAIL })).json).toMatchObject({ code: "GOOGLE_NETWORK_ERROR", retryable: true });
    stubNetwork([(u) => { if (u.includes("/auth/v1/user")) throw new TypeError("fetch failed"); return undefined; }]);
    expect((await send({ refresh: EMAIL })).json).toMatchObject({ code: "GOOGLE_NETWORK_ERROR" });
  });
});

describe("forget", () => {
  it("deletes the row, and says so honestly when it could not", async () => {
    stubNetwork([(u, i) => (isRest(u) && i?.method === "DELETE" ? res({}, 204) : undefined)]);
    expect((await send({ forget: EMAIL })).json).toEqual({ ok: true });
    // A forgotten sign-in closes the Email tab's mirror as removed; a failed delete does not.
    expect(JSON.parse(calls.find((c) => c.url.includes("/rest/v1/rpc/email_account_mark"))!.body ?? "{}")).toMatchObject({ p_address: EMAIL, p_auth: "removed" });
    calls.length = 0;
    stubNetwork([(u, i) => (isRest(u) && i?.method === "DELETE" ? res({}, 500) : undefined)]);
    expect((await send({ forget: EMAIL })).json).toMatchObject({ code: "GOOGLE_STORAGE_FAILURE" });
    expect(calls.some((c) => c.url.includes("email_account_mark"))).toBe(false);
  });
});
