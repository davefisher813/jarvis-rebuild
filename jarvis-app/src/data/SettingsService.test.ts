// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SettingsService, newerOf, readMirror, writeMirror, clearMirror, SETTING_APPEARANCE } from "./SettingsService";

// UP-PLAT-10 (2026-09-06): "Your decisions follow your account, not your
// phone." scalar_setting has existed since migration 0001, with its RLS
// policies and its monotonic updated_at trigger, and has had zero readers and
// zero writers ever since. These cover the two rules that make it safe to
// adopt one module at a time: the phone answers first, and the server's own
// stamp decides who wins.

type Row = { value: unknown; updated_at: string } | null;

// The two calls this service makes, and nothing else. Built by hand rather
// than mocked wholesale so the shape it depends on is visible here.
function fakeClient(opts: { row?: Row; selectError?: boolean; upsertError?: boolean; stamp?: string }) {
  const upserts: Record<string, unknown>[] = [];
  const client = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    maybeSingle: async () => (opts.selectError
                      ? { data: null, error: { message: "down" } }
                      : { data: opts.row ?? null, error: null }),
                  };
                },
              };
            },
          };
        },
        upsert(payload: Record<string, unknown>) {
          upserts.push(payload);
          return {
            select() {
              return {
                maybeSingle: async () => (opts.upsertError
                  ? { data: null, error: { message: "down" } }
                  : { data: { updated_at: opts.stamp ?? "2026-09-06T10:00:00.000Z" }, error: null }),
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, upserts };
}

beforeEach(() => localStorage.clear());

describe("who wins", () => {
  it("the newer server stamp", () => {
    expect(newerOf({ value: "a", updatedAt: 1 }, { value: "b", updatedAt: 2 })!.value).toBe("b");
    expect(newerOf({ value: "a", updatedAt: 3 }, { value: "b", updatedAt: 2 })!.value).toBe("a");
  });

  it("a tie keeps what is already on screen, which is the calmer answer", () => {
    expect(newerOf({ value: "a", updatedAt: 2 }, { value: "b", updatedAt: 2 })!.value).toBe("a");
  });

  it("either one alone is the answer", () => {
    expect(newerOf(null, { value: "b", updatedAt: 0 })!.value).toBe("b");
    expect(newerOf({ value: "a", updatedAt: 0 }, null)!.value).toBe("a");
    expect(newerOf(null, null)).toBeNull();
  });
});

describe("the phone answers first", () => {
  it("local() is synchronous and needs no server", () => {
    writeMirror("theme", { value: "light", updatedAt: 0 });
    const svc = new SettingsService(null, "u1");
    expect(svc.local<string>("theme")).toBe("light");
    expect(svc.synced).toBe(false);
  });

  it("set() writes the mirror even with no account behind it", async () => {
    const svc = new SettingsService(null, "u1");
    expect(await svc.set("theme", "light")).toBe(false);
    expect(svc.local<string>("theme")).toBe("light");
  });

  it("a set that reaches the account stamps the server's own time", async () => {
    const { client, upserts } = fakeClient({ stamp: "2026-09-06T10:00:00.000Z" });
    const svc = new SettingsService(client, "u1");
    expect(await svc.set("theme", "light")).toBe(true);
    expect(upserts[0]).toMatchObject({ owner_id: "u1", key: "theme", value: "light" });
    expect(readMirror<string>("theme")!.updatedAt).toBe(new Date("2026-09-06T10:00:00.000Z").getTime());
  });

  it("a set the server refuses stays on the phone rather than throwing", async () => {
    const { client } = fakeClient({ upsertError: true });
    const svc = new SettingsService(client, "u1");
    expect(await svc.set("theme", "light")).toBe(false);
    // The choice is still applied here: offline is not an error.
    expect(svc.local<string>("theme")).toBe("light");
  });
});

describe("pulling the account's copy", () => {
  it("a newer row replaces the phone's copy", async () => {
    writeMirror("theme", { value: "dark", updatedAt: 1 });
    const { client } = fakeClient({ row: { value: "light", updated_at: "2026-09-06T10:00:00.000Z" } });
    expect(await new SettingsService(client, "u1").pull<string>("theme")).toBe("light");
    expect(readMirror<string>("theme")!.value).toBe("light");
  });

  it("an older row does not, so an offline change is not thrown away", async () => {
    writeMirror("theme", { value: "light", updatedAt: new Date("2026-09-07T00:00:00.000Z").getTime() });
    const { client } = fakeClient({ row: { value: "dark", updated_at: "2026-09-06T10:00:00.000Z" } });
    expect(await new SettingsService(client, "u1").pull<string>("theme")).toBe("light");
  });

  it("a server that cannot be reached leaves the setting exactly as it was", async () => {
    writeMirror("theme", { value: "light", updatedAt: 0 });
    const { client } = fakeClient({ selectError: true });
    expect(await new SettingsService(client, "u1").pull<string>("theme")).toBe("light");
    expect(readMirror<string>("theme")!.value).toBe("light");
  });

  it("no row and nothing local is undefined, not a made-up default", async () => {
    const { client } = fakeClient({ row: null });
    expect(await new SettingsService(client, "u1").pull<string>("theme")).toBeUndefined();
  });

  it("no row but something local sends the phone's copy up, so it stops being the only copy", async () => {
    writeMirror("theme", { value: "light", updatedAt: 0 });
    const { client, upserts } = fakeClient({ row: null });
    const svc = new SettingsService(client, "u1");
    expect(await svc.pull<string>("theme")).toBe("light");
    await vi.waitFor(() => expect(upserts).toHaveLength(1));
    expect(upserts[0]).toMatchObject({ key: "theme", value: "light" });
  });
});

describe("the mirror's own key", () => {
  it("is versioned, like every other stored shape", () => {
    writeMirror(SETTING_APPEARANCE, { value: { theme: "light" }, updatedAt: 0 });
    expect(localStorage.getItem("jarvis.setting.v1.appearance")).toBeTruthy();
    clearMirror(SETTING_APPEARANCE);
    expect(localStorage.getItem("jarvis.setting.v1.appearance")).toBeNull();
  });

  it("a corrupt mirror reads as nothing rather than crashing a boot", () => {
    localStorage.setItem("jarvis.setting.v1.theme", "{not json");
    expect(readMirror("theme")).toBeNull();
  });
});
