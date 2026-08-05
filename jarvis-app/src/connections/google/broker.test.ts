import { describe, it, expect } from "vitest";
import { serverBroker } from "./broker";

// The silent path is the whole feature: a stored sign-in mints a token with
// no user interaction; a revoked/absent one returns null (never throws), so
// the caller falls back to the interactive popup exactly once.

const fetchReturning = (status: number, body: unknown) =>
  (async () => ({ ok: status < 400, status, json: async () => body })) as unknown as
  (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

describe("serverBroker", () => {
  it("silent returns a fresh token when the server has a stored sign-in", async () => {
    const b = serverBroker(() => "supa-tok", fetchReturning(200, { accessToken: "fresh", email: "a@x.com" }));
    expect(await b.silent!("a@x.com")).toBe("fresh");
  });

  it("silent returns null on revoked (410), server errors, and network failure", async () => {
    expect(await serverBroker(() => "t", fetchReturning(410, { error: "Sign-in revoked" })).silent!("a@x.com")).toBeNull();
    expect(await serverBroker(() => "t", fetchReturning(502, { error: "boom" })).silent!("a@x.com")).toBeNull();
    const dead = (async () => { throw new Error("offline"); }) as unknown as Parameters<typeof serverBroker>[1];
    expect(await serverBroker(() => "t", dead).silent!("a@x.com")).toBeNull();
  });

  it("silent without a signed-in JARVIS user does not even call the server", async () => {
    let called = 0;
    const counting = (async () => { called++; return { ok: true, status: 200, json: async () => ({}) }; }) as unknown as Parameters<typeof serverBroker>[1];
    expect(await serverBroker(() => undefined, counting).silent!("a@x.com")).toBeNull();
    expect(called).toBe(0);
  });

  it("forget swallows failures: disconnect must never get stuck on the network", async () => {
    const dead = (async () => { throw new Error("offline"); }) as unknown as Parameters<typeof serverBroker>[1];
    await expect(serverBroker(() => "t", dead).forget!("a@x.com")).resolves.toBeUndefined();
  });
});
