// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  STATE_TTL_MS, signState, verifyState, judgeExchange, copyFor, needsStepCopy, wrongAccountCopy, providerReason,
  readPending, writePending, clearPending, PENDING_MAX_AGE_MS, ReconnectOutcomeError, ReconnectDenied, ReconnectCancelled, newNonce,
  type StatePayload,
} from "./reconnect";

const KEY = Buffer.alloc(32, 7).toString("base64");
const KEY2 = Buffer.alloc(32, 9).toString("base64");
const NOW = 1_790_000_000_000;
const payload = (o: Partial<StatePayload> = {}): StatePayload => ({ a: "att", u: "user-1", e: "dave@gmail.com", x: NOW + 5 * 60e3, n: newNonce(), ...o });

describe("the signed state", () => {
  it("verifies for its owner inside its ten minutes, and carries the account intent", async () => {
    const s = await signState(payload(), KEY);
    expect(s.startsWith("rc1.")).toBe(true);
    const c = await verifyState(s, KEY, { userId: "user-1", nowMs: NOW });
    expect(c).toMatchObject({ ok: true, payload: { e: "dave@gmail.com", u: "user-1" } });
  });
  it("is refused when tampered with, under another key, for another person, or past its time", async () => {
    const s = await signState(payload(), KEY);
    const [p, body, sig] = s.split(".");
    const forged = `${p}.${btoa(JSON.stringify({ ...payload(), e: "victim@gmail.com" })).replace(/=+$/, "")}.${sig}`;
    expect(await verifyState(forged, KEY, { userId: "user-1", nowMs: NOW })).toEqual({ ok: false, reason: "bad_signature" });
    expect(await verifyState(s, KEY2, { userId: "user-1", nowMs: NOW })).toEqual({ ok: false, reason: "bad_signature" });
    expect(await verifyState(s, KEY, { userId: "user-2", nowMs: NOW })).toEqual({ ok: false, reason: "wrong_user" });
    expect(await verifyState(s, KEY, { userId: "user-1", nowMs: NOW + 6 * 60e3 })).toEqual({ ok: false, reason: "expired" });
    expect(body).toBeTruthy();
  });
  it("can never outlive ten minutes, whatever it claims", async () => {
    const s = await signState(payload({ x: NOW + 60 * 60e3 }), KEY);
    expect(await verifyState(s, KEY, { userId: "user-1", nowMs: NOW })).toEqual({ ok: false, reason: "expired" });
    expect(STATE_TTL_MS).toBe(10 * 60e3);
  });
  it("rejects anything that is not a state", async () => {
    for (const bad of [undefined, null, 5, "", "x", "rc1.a", "rc2.a.b", "rc1.!!.!!", "x".repeat(2000)]) {
      expect((await verifyState(bad, KEY, { userId: "user-1", nowMs: NOW })).ok).toBe(false);
    }
  });
  it("two states for the same account are never equal", async () => {
    expect(await signState(payload(), KEY)).not.toBe(await signState(payload(), KEY));
  });
});

describe("judgeExchange: checks 1 to 3, in order", () => {
  const base = { intendedEmail: "dave@gmail.com", returnedEmail: "dave@gmail.com", grantedScope: "https://www.googleapis.com/auth/gmail.modify", newRefreshToken: true, storedRefreshUsable: false };
  it("passes an exact match with mail permission and a new refresh token", () => expect(judgeExchange(base)).toEqual({ ok: true }));
  it("identity comes first: a different account fails even when everything else is wrong too", () => {
    expect(judgeExchange({ ...base, returnedEmail: "other@gmail.com", grantedScope: "", newRefreshToken: false })).toMatchObject({ ok: false, status: "wrong_account", step: 1 });
    expect(judgeExchange({ ...base, returnedEmail: null })).toMatchObject({ status: "wrong_account" });
  });
  it("case and spaces do not make a different account", () => expect(judgeExchange({ ...base, returnedEmail: " Dave@Gmail.COM " })).toEqual({ ok: true }));
  it("then permissions", () => expect(judgeExchange({ ...base, grantedScope: "openid email" })).toMatchObject({ status: "scope_missing", step: 2 }));
  it("then a credential that can renew: new, or already stored and usable", () => {
    expect(judgeExchange({ ...base, newRefreshToken: false })).toMatchObject({ status: "needs_step", step: 3 });
    expect(judgeExchange({ ...base, newRefreshToken: false, storedRefreshUsable: true })).toEqual({ ok: true });
  });
});

describe("the words", () => {
  it("wrong account names both addresses, one sentence a line", () => {
    const c = wrongAccountCopy("other@gmail.com", "dave@gmail.com");
    expect(c.title).toBe("That's a Different Google Account");
    expect(c.lines).toEqual(["You selected other@gmail.com.", "JARVIS is reconnecting dave@gmail.com."]);
    for (const l of [c.title, ...c.lines]) expect(l).not.toMatch(/\. [A-Z]/);
  });
  it("one more step offers Finish and Not Now once, then ends the loop with Google's permissions page", () => {
    expect(needsStepCopy(false).actions).toEqual(["finish", "not_now"]);
    expect(needsStepCopy(false).lines).toEqual(["Google allowed access now.", "JARVIS cannot renew it automatically."]);
    expect(needsStepCopy(true).actions).toEqual(["permissions", "not_now"]);
    expect(needsStepCopy(true).actions).not.toContain("finish");
  });
  it("silent outcomes have no words, and verified needs none", () => {
    for (const s of ["cancelled", "superseded", "verified", "started"] as const) expect(copyFor(s, { intended: "dave@gmail.com" })).toBeNull();
  });
  it("Google's refusal is reported with its reason, in words", () => {
    expect(copyFor("denied", { intended: "dave@gmail.com", reason: providerReason("admin_policy_enforced") })!.lines).toEqual(["Google said your administrator blocks this app."]);
    expect(providerReason("some_new_reason")).toBe("some new reason");
  });
  it("no copy uses a dash for a pause, or says a thing is connected when it is not", () => {
    for (const s of ["wrong_account", "needs_step", "scope_missing", "unverified", "denied", "expired"] as const) {
      const c = copyFor(s, { intended: "dave@gmail.com", selected: "o@x.com", reason: "x" })!;
      expect([c.title, ...c.lines].join(" ")).not.toMatch(/—|connected|all caught up/i);
    }
  });
});

describe("what the client throws", () => {
  it("cancelled is silent in kind, denied carries the reason, an outcome carries the words", () => {
    expect(new ReconnectCancelled().name).toBe("ReconnectCancelled");
    expect(new ReconnectDenied("admin_policy_enforced").reason).toBe("admin_policy_enforced");
    const e = new ReconnectOutcomeError("wrong_account", "dave@gmail.com", { selected: "o@x.com" });
    expect(e.message).toContain("o@x.com");
    expect(e.message).toContain("dave@gmail.com");
    expect(e.status).toBe("wrong_account");
  });
});

describe("the note a killed app leaves for its next launch", () => {
  beforeEach(() => localStorage.clear());
  it("remembers the account and when it left, and forgets on clear", () => {
    writePending("Dave@Gmail.com", NOW);
    expect(readPending(NOW + 1000)).toEqual({ email: "dave@gmail.com", startedAt: NOW });
    clearPending();
    expect(readPending(NOW)).toBeNull();
  });
  it("a note older than the attempt could possibly be alive is dropped, not believed", () => {
    writePending("dave@gmail.com", NOW);
    expect(readPending(NOW + PENDING_MAX_AGE_MS + 1)).toBeNull();
    expect(localStorage.getItem("jarvis.reconnect.pending.v1")).toBeNull();
  });
  it("garbage reads as nothing", () => {
    localStorage.setItem("jarvis.reconnect.pending.v1", "{not json");
    expect(readPending(NOW)).toBeNull();
  });
});
