import { describe, it, expect } from "vitest";
import { createGoogleApi } from "./api";

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
