import { describe, it, expect } from "vitest";
import { deriveStatus } from "./connectionStatus";
import { incidentId, incidentOf, escalationOf, recoveredOf, ESCALATE_AFTER_FAILURES, ESCALATE_AFTER_MS, INCIDENT_PATTERN, type GrantMeta } from "./incident";

const NOW = new Date("2026-10-07T12:00:00Z");
const E = "dave@gmail.com";
const grant = (o: Partial<GrantMeta> = {}): GrantMeta => ({ deadAt: null, oauthFailedAt: null, consecutiveFailures: 0, lastRefreshOkAt: null, cause: null, ...o });
const revoked = () => deriveStatus({ email: E, refresh: { ok: false, error: "invalid_grant" }, read: null, lastSyncAt: null, now: NOW });
const offline = (lastSyncAt: string | null = null) => deriveStatus({ email: E, refresh: { thrown: true }, read: null, lastSyncAt, now: NOW });
const healthy = () => deriveStatus({ email: E, refresh: { ok: true, scope: "gmail.send" }, read: { ok: true, status: 200, emailAddress: E }, lastSyncAt: NOW.toISOString(), now: NOW });

describe("incidentId", () => {
  it("is short, readable and the same every time for the same loss", () => {
    const a = incidentId(E, "auth", "2026-10-07T11:00:00.000Z");
    expect(a).toMatch(INCIDENT_PATTERN);
    expect(incidentId("DAVE@gmail.com ", "auth", "2026-10-07T11:00:00.000Z")).toBe(a);
  });
  it("differs by account, by kind and by when the loss began, so a new loss is never the old one", () => {
    const base = incidentId(E, "auth", "2026-10-07T11:00:00.000Z");
    expect(incidentId("dave@bffsa.org", "auth", "2026-10-07T11:00:00.000Z")).not.toBe(base);
    expect(incidentId(E, "degraded", "2026-10-07T11:00:00.000Z")).not.toBe(base);
    expect(incidentId(E, "auth", "2026-10-08T11:00:00.000Z")).not.toBe(base);
  });
});

describe("incidentOf: a confirmed loss", () => {
  it("opens an auth incident anchored on the recorded failure", () => {
    const at = "2026-10-07T09:00:00.000Z";
    const i = incidentOf({ email: E, status: revoked(), previous: null, grant: grant({ oauthFailedAt: at, cause: "revoked_or_password_change" }), now: NOW })!;
    expect(i).toMatchObject({ kind: "auth", openedAt: at, cause: "revoked_or_password_change", id: incidentId(E, "auth", at) });
  });
  it("without a grant record, keeps the previous anchor so the ID does not move between checks", () => {
    const first = incidentOf({ email: E, status: revoked(), previous: null, grant: null, now: new Date("2026-10-07T10:00:00Z") })!;
    const later = incidentOf({ email: E, status: revoked(), previous: first, grant: null, now: new Date("2026-10-07T10:30:00Z") })!;
    expect(later.id).toBe(first.id);
    expect(later.openedAt).toBe(first.openedAt);
  });
  it("a healthy account has none", () => {
    expect(incidentOf({ email: E, status: healthy(), previous: null, grant: grant(), now: NOW })).toBeNull();
  });
  it("a mailbox with no stored sign-in is a loss", () => {
    const s = deriveStatus({ email: E, refresh: null, read: null, lastSyncAt: null, now: NOW });
    expect(incidentOf({ email: E, status: s, previous: null, grant: null, now: NOW })).toMatchObject({ kind: "auth", cause: "no_stored_signin" });
  });
});

describe("incidentOf: transient trouble escalates only when it lasts", () => {
  it("below ten failures and inside a day it is not an incident", () => {
    expect(incidentOf({ email: E, status: offline(NOW.toISOString()), previous: null, grant: grant({ consecutiveFailures: ESCALATE_AFTER_FAILURES - 1 }), now: NOW })).toBeNull();
  });
  it("ten failures in a row escalate", () => {
    expect(incidentOf({ email: E, status: offline(NOW.toISOString()), previous: null, grant: grant({ consecutiveFailures: ESCALATE_AFTER_FAILURES }), now: NOW })).toMatchObject({ kind: "degraded", cause: "failures" });
  });
  it("a day without a successful sync escalates", () => {
    const old = new Date(NOW.getTime() - ESCALATE_AFTER_MS).toISOString();
    expect(incidentOf({ email: E, status: offline(old), previous: null, grant: grant(), now: NOW })).toMatchObject({ kind: "degraded", cause: "silence", openedAt: old });
  });
  it("anchors on the last good sync, so the ID holds while the trouble does", () => {
    const old = new Date(NOW.getTime() - 30 * 3600e3).toISOString();
    const a = incidentOf({ email: E, status: offline(old), previous: null, grant: grant(), now: NOW })!;
    const b = incidentOf({ email: E, status: offline(old), previous: a, grant: grant(), now: new Date(NOW.getTime() + 3600e3) })!;
    expect(b.id).toBe(a.id);
  });
  it("never offers anything about reconnecting: that is the auth kind's alone", () => {
    expect(escalationOf({ consecutiveFailures: 10, lastSuccessfulSyncAt: null, now: NOW })).toBe("failures");
    expect(escalationOf({ consecutiveFailures: 0, lastSuccessfulSyncAt: null, now: NOW })).toBeNull();
  });
});

describe("recoveredOf: when an incident may end (Email v1 spec section 10)", () => {
  it("only a valid credential, a mailbox reading as itself, and mail that is not stale", () => {
    expect(recoveredOf(healthy())).toBe(true);
    expect(recoveredOf(revoked())).toBe(false);
    expect(recoveredOf(offline(NOW.toISOString()))).toBe(false);
  });
  it("a good refresh while mail is a day behind has not caught up, and a proof carrying an incident is not recovered", () => {
    const stale = deriveStatus({ email: E, refresh: { ok: true }, read: { ok: true, status: 200, emailAddress: E }, lastSyncAt: new Date(NOW.getTime() - 25 * 3600e3).toISOString(), now: NOW });
    expect(recoveredOf(stale)).toBe(false);
    expect(recoveredOf({ ...healthy(), incident: { id: "JC-0000AAAA", kind: "degraded", openedAt: NOW.toISOString(), cause: "silence" } })).toBe(false);
  });
});
