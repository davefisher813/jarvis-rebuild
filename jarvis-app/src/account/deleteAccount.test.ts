// SHELL-F-03 (2026-09-05): Delete Account called an endpoint that did not
// exist, so the armed two-tap ended in "Couldn't delete your account (404)"
// every time while the Privacy Policy on the same device promised deletion.
// These are the rules of the deletion itself: everything owned goes, the auth
// user goes last, and nothing reports success it did not do.
import { describe, it, expect } from "vitest";
import {
  deleteAccountEverywhere,
  deleteOwnedRows,
  OWNED_TABLES,
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
  it("clears every owned table, keyed to that user and nobody else", async () => {
    const { calls, doFetch } = rig();
    await deleteOwnedRows(CTX, UID, doFetch);
    expect(calls.map((c) => c.method)).toEqual(OWNED_TABLES.map(() => "DELETE"));
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
    for (const { table } of OWNED_TABLES) {
      expect(order.findIndex((u) => u.includes(`/rest/v1/${table}?`))).toBeLessThan(order.length - 1);
    }
  });

  it("a table that refuses stops the whole thing, and the account is still there", async () => {
    const { calls, doFetch } = rig({ fail: (url, m) => (url.includes("/rest/v1/event_log") && m === "DELETE" ? 500 : null) });
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
    await expect(deleteAccountEverywhere(CTX, UID, doFetch)).resolves.toEqual({ files: 0 });
    expect(calls.some((c) => c.url.includes("/auth/v1/admin/users/"))).toBe(true);
  });

  // A retry after a partial failure has to be able to finish, so an auth user
  // that is already gone is the outcome, not an error the person cannot act on.
  it("an account already gone is a success, so a retry can finish", async () => {
    const { doFetch } = rig({ fail: (url) => (url.includes("/auth/v1/admin/users/") ? 404 : null) });
    await expect(deleteAccountEverywhere(CTX, UID, doFetch)).resolves.toEqual({ files: 0 });
  });
});
