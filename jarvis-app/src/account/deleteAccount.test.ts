// SHELL-F-03 (2026-09-05): Delete Account called an endpoint that did not
// exist, so the armed two-tap ended in "Couldn't delete your account (404)"
// every time while the Privacy Policy on the same device promised deletion.
// These are the rules of the deletion itself: everything owned goes, the auth
// user goes last, and nothing reports success it did not do.
import { describe, it, expect } from "vitest";
import {
  deleteAccountEverywhere,
  deleteOwnedRows,
  revokeGoogleGrants,
  OWNED_TABLES,
  GOOGLE_REVOKE_URL,
  type FetchLike,
} from "./deleteAccount";

const CTX = { url: "https://proj.supabase.co", serviceKey: "svc-key" };
const UID = "user-123";

interface Call { url: string; method: string; body?: unknown; headers: Record<string, string> }

// A fake Supabase that records every call. `answers` overrides the response
// for the first url that matches, so a test can fail one step precisely.
function rig(opts: { files?: Record<string, { name: string; id: string | null }[]>; fail?: (url: string, method: string) => number | null } = {}) {
  const calls: Call[] = [];
  const doFetch: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ url, method, body, headers: init?.headers ?? {} });
    const failStatus = opts.fail?.(url, method);
    if (failStatus) return { ok: false, status: failStatus, json: async () => ({}) };
    if (url.includes("/storage/v1/object/list/")) {
      const prefix = (body as { prefix: string }).prefix;
      return { ok: true, status: 200, json: async () => opts.files?.[prefix] ?? [] };
    }
    return { ok: true, status: 204, json: async () => ({}) };
  };
  return { calls, doFetch };
}

describe("deleting an account", () => {
  // UP-LAUNCH-06 (2026-09-05): deleteOwnedRows now asks for one transaction
  // first (delete_owned, migration 0034) and walks the tables only when that
  // function is not installed. This test is about the WALK, so it forces the
  // fallback; the transaction has its own tests further down.
  it("clears every owned table, keyed to that user and nobody else", async () => {
    const { calls, doFetch } = rig({ fail: (url) => (url.includes("rpc/delete_owned") ? 404 : null) });
    await deleteOwnedRows(CTX, UID, doFetch);
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.method)).toEqual(OWNED_TABLES.map(() => "DELETE"));
    for (const { table, column } of OWNED_TABLES) {
      const hit = calls.find((c) => c.url.includes(`/rest/v1/${table}?`));
      expect(hit, table).toBeTruthy();
      expect(hit!.url).toContain(`${column}=eq.${UID}`);
    }
    // The service key is what gets past RLS; the caller's token cannot.
    expect(calls[0]!.headers.apikey).toBe("svc-key");
  });

  it("walks both levels of the file path convention and deletes what it found", async () => {
    const { calls, doFetch } = rig({
      files: {
        [`${UID}/`]: [{ name: "note-1", id: null }, { name: "loose.pdf", id: "f0" }],
        [`${UID}/note-1/`]: [{ name: "ab12-photo.jpg", id: "f1" }, { name: "cd34-scan.pdf", id: "f2" }],
      },
    });
    await deleteAccountEverywhere(CTX, UID, doFetch);
    const del = calls.find((c) => c.method === "DELETE" && c.url.endsWith("/storage/v1/object/user-files"));
    expect(del).toBeTruthy();
    expect((del!.body as { prefixes: string[] }).prefixes.sort()).toEqual([
      `${UID}/loose.pdf`,
      `${UID}/note-1/ab12-photo.jpg`,
      `${UID}/note-1/cd34-scan.pdf`,
    ]);
  });

  it("deletes the auth user last, after the files and the rows", async () => {
    const { calls, doFetch } = rig({ files: { [`${UID}/`]: [{ name: "a.pdf", id: "f1" }] } });
    await deleteAccountEverywhere(CTX, UID, doFetch);
    const order = calls.filter((c) => c.method === "DELETE").map((c) => c.url);
    expect(order[0]).toContain("/storage/v1/object/user-files");
    expect(order[order.length - 1]).toBe(`${CTX.url}/auth/v1/admin/users/${UID}`);
    // The rows go before the account: rows key on owner_id and RLS keys on
    // auth.uid(), so anything left after the user is gone is unreachable by
    // anyone, which is the same as never deleting it.
    // The data goes before the account: rows key on owner_id and RLS keys on
    // auth.uid(), so anything left after the user is gone is unreachable by
    // anyone, which is the same as never deleting it. The data step is one
    // rpc call now, so its position is what this checks.
    const rpcAt = calls.findIndex((c) => c.url.includes("rpc/delete_owned"));
    const authAt = calls.findIndex((c) => c.url.includes("/auth/v1/admin/users/"));
    expect(rpcAt).toBeGreaterThan(-1);
    expect(rpcAt).toBeLessThan(authAt);
  });

  it("a table that refuses stops the whole thing, and the account is still there", async () => {
    const { calls, doFetch } = rig({ fail: (url, m) => (url.includes("rpc/delete_owned") ? 404 : url.includes("/rest/v1/event_log") && m === "DELETE" ? 500 : null) });
    await expect(deleteAccountEverywhere(CTX, UID, doFetch)).rejects.toThrow(/event_log/);
    expect(calls.some((c) => c.url.includes("/auth/v1/admin/users/"))).toBe(false);
  });

  it("a file that will not delete stops it too, before a single row is touched", async () => {
    const { calls, doFetch } = rig({
      files: { [`${UID}/`]: [{ name: "a.pdf", id: "f1" }] },
      fail: (url, m) => (url.endsWith("/storage/v1/object/user-files") && m === "DELETE" ? 500 : null),
    });
    await expect(deleteAccountEverywhere(CTX, UID, doFetch)).rejects.toThrow(/Could not delete files/);
    expect(calls.some((c) => c.url.includes("/rest/v1/"))).toBe(false);
  });

  it("a project with no file bucket still deletes the account", async () => {
    const { calls, doFetch } = rig({ fail: (url) => (url.includes("/storage/v1/object/list/") ? 404 : null) });
    await expect(deleteAccountEverywhere(CTX, UID, doFetch)).resolves.toEqual({ files: 0, revoked: 0, revokeFailed: 0 });
    expect(calls.some((c) => c.url.includes("/auth/v1/admin/users/"))).toBe(true);
  });

  // A retry after a partial failure has to be able to finish, so an auth user
  // that is already gone is the outcome, not an error the person cannot act on.
  it("an account already gone is a success, so a retry can finish", async () => {
    const { doFetch } = rig({ fail: (url) => (url.includes("/auth/v1/admin/users/") ? 404 : null) });
    await expect(deleteAccountEverywhere(CTX, UID, doFetch)).resolves.toEqual({ files: 0, revoked: 0, revokeFailed: 0 });
  });
});

// UP-LAUNCH-06 (2026-09-05): what SHELL-F-03's deletion was still missing.
// The rows and the files were right; the GRANT at Google was not handed back,
// and the five deletes were five separate calls with no transaction around
// them.
describe("what the deletion owes other people", () => {
  const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  const withGoogle = { ...CTX, tokenKey: KEY };

  function googleRig(rows: { token_enc?: string }[], opts: { revokeStatus?: number } = {}) {
    const calls: Call[] = [];
    const doFetch: FetchLike = async (url, init) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body, headers: init?.headers ?? {} });
      if (url.includes("google_tokens")) return { ok: true, status: 200, json: async () => rows };
      if (url === GOOGLE_REVOKE_URL) {
        const st = opts.revokeStatus ?? 200;
        return { ok: st < 400, status: st, json: async () => ({}) };
      }
      return { ok: true, status: 204, json: async () => ({}) };
    };
    return { calls, doFetch };
  }

  it("hands every stored refresh token back to Google before the rows go", async () => {
    const { calls, doFetch } = googleRig([{ token_enc: "a" }, { token_enc: "b" }]);
    const out = await revokeGoogleGrants(withGoogle, UID, doFetch, async (packed) => "refresh-" + packed);
    expect(out).toEqual({ revoked: 2, failed: 0 });
    const revokes = calls.filter((c) => c.url === GOOGLE_REVOKE_URL);
    expect(revokes).toHaveLength(2);
    expect(revokes[0]!.method).toBe("POST");
    expect(String(revokes[0]!.body)).toBe("token=refresh-a");
    // Never the service key: this request goes to Google, not to Supabase.
    expect(revokes[0]!.headers["apikey"]).toBeUndefined();
  });

  it("a refusal from Google is counted, never fatal: the deletion was asked for", async () => {
    const { doFetch } = googleRig([{ token_enc: "a" }], { revokeStatus: 400 });
    expect(await revokeGoogleGrants(withGoogle, UID, doFetch, async () => "r")).toEqual({ revoked: 0, failed: 1 });
  });

  it("does nothing at all without the encryption key, rather than guessing", async () => {
    const { calls, doFetch } = googleRig([{ token_enc: "a" }]);
    expect(await revokeGoogleGrants(CTX, UID, doFetch)).toEqual({ revoked: 0, failed: 0 });
    expect(calls).toEqual([]);
  });

  it("deletes the five tables in one transaction when the function exists", async () => {
    const { calls, doFetch } = rig();
    await deleteOwnedRows(CTX, UID, doFetch);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/rest/v1/rpc/delete_owned");
    expect(calls[0]!.body).toEqual({ p_uid: UID });
  });

  it("falls back to the per-table walk when the function is not installed yet", async () => {
    const { calls, doFetch } = rig({ fail: (url) => (url.includes("rpc/delete_owned") ? 404 : null) });
    await deleteOwnedRows(CTX, UID, doFetch);
    expect(calls).toHaveLength(1 + OWNED_TABLES.length);
    for (const { table } of OWNED_TABLES) expect(calls.some((c) => c.url.includes(`/rest/v1/${table}?`))).toBe(true);
  });

  it("a function that exists and fails stops everything, instead of quietly walking", async () => {
    const { doFetch } = rig({ fail: (url) => (url.includes("rpc/delete_owned") ? 500 : null) });
    await expect(deleteOwnedRows(CTX, UID, doFetch)).rejects.toThrow(/500/);
  });

  it("a bug report is not the user's data, so no step deletes it", () => {
    expect(OWNED_TABLES.map((t) => t.table)).not.toContain("feedback");
  });
});
