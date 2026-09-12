import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import handler from "../../../api/google";

// WHICH CLIENT REFRESHES WHICH TOKEN (2026-09-11). api/google.ts is the only
// place refresh tokens live, and it refreshed every one with the web client.
// A token from the iPhone's native connect belongs to the iOS client, so the
// phone never stayed signed in. These drive the real handler end to end
// against a fake Google and a fake Supabase: store a token the way each
// connect stores it, then refresh it and look at which client was asked.

const SUPA = "https://supa.test";
const WEB = "web-123.apps.googleusercontent.com";
const IOS = "ios-456.apps.googleusercontent.com";
const IOS_REDIRECT = "com.googleusercontent.apps.ios-456:/oauth2redirect";

type Reply = { status: number; body: unknown };
let stored = "";
let deleted = 0;
let refreshCalls: { client_id: string | null; secret: boolean }[] = [];
let refreshReply: (clientId: string) => Reply;

const res = (r: Reply) => new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  stored = ""; deleted = 0; refreshCalls = [];
  refreshReply = () => ({ status: 200, body: { access_token: "fresh", expires_in: 3600 } });
  const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  Object.assign(process.env, {
    VITE_GOOGLE_CLIENT_ID: WEB, GOOGLE_CLIENT_SECRET: "shh", VITE_GOOGLE_IOS_CLIENT_ID: IOS,
    GOOGLE_TOKEN_KEY: key, VITE_SUPABASE_URL: SUPA, VITE_SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "svc",
  });
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url === `${SUPA}/auth/v1/user`) return res({ status: 200, body: { id: "u1" } });
    if (url.startsWith("https://gmail.googleapis.com")) return res({ status: 200, body: { emailAddress: "me@example.com" } });
    if (url === "https://oauth2.googleapis.com/token") {
      const p = new URLSearchParams(String(init?.body));
      if (p.get("grant_type") === "authorization_code") return res({ status: 200, body: { access_token: "a1", refresh_token: "1//refresh", expires_in: 3600 } });
      expect(p.get("refresh_token")).toBe("1//refresh");
      refreshCalls.push({ client_id: p.get("client_id"), secret: p.has("client_secret") });
      return res(refreshReply(p.get("client_id") ?? ""));
    }
    if (url.startsWith(`${SUPA}/rest/v1/google_tokens`)) {
      if (method === "POST") { stored = (JSON.parse(String(init?.body)) as { token_enc: string }).token_enc; return res({ status: 201, body: {} }); }
      if (method === "DELETE") { deleted += 1; return new Response(null, { status: 204 }); }
      return res({ status: 200, body: stored ? [{ token_enc: stored }] : [] });
    }
    throw new Error("unexpected fetch " + url);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

const call = (body: unknown) => handler(new Request("https://app.test/api/google", {
  method: "POST", headers: { authorization: "Bearer user-jwt" }, body: JSON.stringify(body),
}));
const connectWeb = () => call({ code: "c" });
const connectNative = () => call({ code: "c", verifier: "v".repeat(64), redirectUri: IOS_REDIRECT });
const refresh = () => call({ refresh: "me@example.com" });

describe("refresh asks the client that issued the token", () => {
  it("a token from the phone's native connect refreshes with the iOS client, and no secret", async () => {
    expect((await connectNative()).status).toBe(200);
    const r = await refresh();
    expect(r.status).toBe(200);
    expect(refreshCalls).toEqual([{ client_id: IOS, secret: false }]);
  });

  it("a token from the web connect refreshes with the web client and its secret, once", async () => {
    await connectWeb();
    expect((await refresh()).status).toBe(200);
    expect(refreshCalls).toEqual([{ client_id: WEB, secret: true }]);
  });

  it("a phone token stored before the tag existed still refreshes: web first, then iOS", async () => {
    // Stored untagged (the web path stores untagged, which is exactly what an
    // older native token looks like), and only the iOS client will take it.
    await connectWeb();
    refreshReply = (id) => (id === IOS
      ? { status: 200, body: { access_token: "fresh", expires_in: 3600 } }
      : { status: 400, body: { error: "unauthorized_client" } });
    const r = await refresh();
    expect(r.status).toBe(200);
    expect(refreshCalls.map((c) => c.client_id)).toEqual([WEB, IOS]);
    expect(deleted).toBe(0);
  });

  it("a grant every client refuses is still forgotten, so the app re-asks once", async () => {
    await connectWeb();
    refreshReply = () => ({ status: 400, body: { error: "invalid_grant" } });
    const r = await refresh();
    expect(r.status).toBe(410);
    expect(deleted).toBe(1);
  });
});
