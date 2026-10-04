import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import handler from "./booking-link";
import { DEFAULT_BOOKING_SETTINGS } from "../src/booking/settings";

// WHAT THE SERVER WRITES FOR "WHO CAN BOOK" AND "VISIBILITY" (2026-10-04).
// api/book.ts serves a link to anyone who holds it and never reads
// booking_permissions, and it answers 404 to a named_contacts link for every
// visitor. So the only rows worth writing are link_only and open_link, whatever
// words a phone running an older build still sends.

interface Call { method: string; path: string; body: unknown }
let calls: Call[];

beforeEach(() => {
  calls = [];
  vi.stubEnv("TRACK3_SUPABASE_URL", "https://t3.test");
  vi.stubEnv("TRACK3_SUPABASE_SERVICE_ROLE_KEY", "svc");
  vi.stubEnv("VITE_SUPABASE_URL", "https://live.test");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const path = url.replace("https://t3.test/rest/v1/", "");
    if (url.startsWith("https://live.test/auth/v1/user")) return new Response(JSON.stringify({ id: "owner-1" }), { status: 200 });
    calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const answer = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
    if (method === "GET" && path.startsWith("booking_links")) return answer([]);
    if (method === "GET" && path.startsWith("org_members")) return answer([{ org_id: "org-1" }]);
    if (method === "POST" && path === "bookable_types") return answer([{ id: "bt-1" }]);
    if (method === "POST" && path === "booking_links") return answer([{ id: "link-1", slug: "wide-harbour" }]);
    return answer([]);
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const put = (settings: Record<string, unknown>) => handler(new Request("https://app.test/api/booking-link", {
  method: "PUT",
  headers: { authorization: "Bearer tok", "content-type": "application/json" },
  body: JSON.stringify({ settings: { ...DEFAULT_BOOKING_SETTINGS, available: true, ...settings }, timezone: "UTC" }),
}));
const wrote = (path: string) => calls.find((c) => c.method === "POST" && c.path === path)?.body as Record<string, unknown> | undefined;

describe("PUT /api/booking-link", () => {
  it("writes the link as link_only and the permission as open_link for the one choice the screen offers", async () => {
    const r = await put({});
    expect(r.status).toBe(200);
    expect(wrote("booking_links")).toMatchObject({ visibility: "link_only" });
    expect(wrote("booking_permissions")).toMatchObject({ mode: "open_link" });
  });

  it("an older build's Named Contacts does not close the link, and Approved Contacts does not promise a gate", async () => {
    const r = await put({ visibility: "named", who: "approved" });
    expect(r.status).toBe(200);
    expect(wrote("booking_links")).toMatchObject({ visibility: "link_only" });
    expect(wrote("booking_permissions")).toMatchObject({ mode: "open_link" });
    expect(((await r.json()) as { link: { visibility: string } }).link.visibility).toBe("link_only");
  });

  it("a word it has never heard of still lands on the open rows rather than failing the save", async () => {
    const r = await put({ visibility: "loud", who: "aliens" });
    expect(r.status).toBe(200);
    expect(wrote("booking_links")).toMatchObject({ visibility: "link_only" });
    expect(wrote("booking_permissions")).toMatchObject({ mode: "open_link" });
  });
});
