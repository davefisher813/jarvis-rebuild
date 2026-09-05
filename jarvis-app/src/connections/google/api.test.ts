import { describe, it, expect } from "vitest";
import { createGoogleApi, withSilentRefresh } from "./api";

function res(body: unknown, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(body) });
}

describe("createGoogleApi", () => {
  it("lists upcoming events and sends the bearer token", async () => {
    const calls: string[] = [];
    const fakeFetch = (url: string, init?: { headers?: Record<string, string> }) => {
      calls.push(url);
      expect(init?.headers?.Authorization).toBe("Bearer tok");
      return res({ items: [{ id: "g1", summary: "X", start: { dateTime: "2026-06-01T09:00:00Z" } }] });
    };
    const api = createGoogleApi("tok", fakeFetch as never);
    const evs = await api.listUpcomingEvents(10);
    expect(evs.map((e) => e.id)).toEqual(["g1"]);
    expect(calls[0]).toContain("calendar/v3/calendars/primary/events");
  });
  it("lists messages then fetches each metadata", async () => {
    const fakeFetch = (url: string) =>
      url.includes("/messages?")
        ? res({ messages: [{ id: "m1" }, { id: "m2" }] })
        : res({ id: url.includes("m1") ? "m1" : "m2", snippet: "s", payload: { headers: [] } });
    const api = createGoogleApi("tok", fakeFetch as never);
    const metas = await api.listRecentMessages(5);
    expect(metas.map((m) => m.id)).toEqual(["m1", "m2"]);
  });
  it("throws on a non-ok response", async () => {
    const api = createGoogleApi("tok", (() => res({}, false, 401)) as never);
    await expect(api.listUpcomingEvents(5)).rejects.toThrow("calendar 401");
  });
});

// PLUMB-F-04 (2026-09-05): "Google access tokens are minted once at open and
// never refreshed." Every method threw on 401 and the screen said the
// sign-in expired, while one silent re-mint would have fixed it.
describe("withSilentRefresh", () => {
  const bearer = (init?: { headers?: Record<string, string> }) => init?.headers?.Authorization ?? "";

  it("answers a 401 with one silent re-mint and replays the same request under the new token", async () => {
    const seen: string[] = [];
    let refreshes = 0;
    const fakeFetch = (url: string, init?: { headers?: Record<string, string> }) => {
      seen.push(url + " " + bearer(init));
      return bearer(init) === "Bearer fresh" ? res({ emailAddress: "me@x.com" }) : res({}, false, 401);
    };
    const api = createGoogleApi("stale", withSilentRefresh(fakeFetch as never, async () => { refreshes += 1; return "fresh"; }));
    expect((await api.getProfile()).emailAddress).toBe("me@x.com");
    expect(refreshes).toBe(1);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toContain("Bearer stale");
    expect(seen[1]).toContain("Bearer fresh");
    expect(seen[1]!.split(" ")[0]).toBe(seen[0]!.split(" ")[0]); // the same URL, replayed
  });

  it("keeps the request's method and body on the replay", async () => {
    const inits: { method?: string; body?: string; headers?: Record<string, string> }[] = [];
    const fakeFetch = (_url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => {
      inits.push(init ?? {});
      return bearer(init) === "Bearer fresh" ? res({ id: "s1" }) : res({}, false, 401);
    };
    const api = createGoogleApi("stale", withSilentRefresh(fakeFetch as never, async () => "fresh"));
    await api.sendMessage("RAW", "t1");
    expect(inits).toHaveLength(2);
    expect(inits[1]!.method).toBe("POST");
    expect(inits[1]!.body).toBe(inits[0]!.body);
    expect(inits[1]!.headers?.["Content-Type"]).toBe("application/json");
  });

  it("when the re-mint comes back empty, the 401 reaches the caller and the sentence is still honest", async () => {
    let calls = 0;
    const api = createGoogleApi("stale", withSilentRefresh((() => { calls += 1; return res({}, false, 401); }) as never, async () => null));
    await expect(api.listThreads(5)).rejects.toThrow("threads 401");
    expect(calls).toBe(1); // no replay without a token to replay with
  });

  it("only a 401 is retried: a 403 or a 429 goes straight through, no re-mint", async () => {
    let refreshes = 0;
    const refresh = async () => { refreshes += 1; return "fresh"; };
    const api403 = createGoogleApi("t", withSilentRefresh((() => res({}, false, 403)) as never, refresh));
    await expect(api403.trashThread("x")).rejects.toThrow("thread trash 403");
    const api429 = createGoogleApi("t", withSilentRefresh((() => res({}, false, 429)) as never, refresh));
    await expect(api429.getThread("x")).rejects.toThrow("thread 429");
    expect(refreshes).toBe(0);
  });
});
