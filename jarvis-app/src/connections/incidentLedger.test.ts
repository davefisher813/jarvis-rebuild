import { describe, it, expect } from "vitest";
import { deriveStatus, type AccountStatus } from "./connectionStatus";
import { incidentId, type Incident } from "./incident";
import { acknowledge, emptyLedger, markSeen, planAnnouncements, RESOLVED_KEEP_MS, type Ledger } from "./incidentLedger";

const T0 = new Date("2026-10-07T12:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * 60e3);
const U = "user-1";

function inc(email: string, kind: "auth" | "degraded", openedAt = "2026-10-07T11:00:00.000Z"): Incident {
  return { id: incidentId(email, kind, openedAt), kind, openedAt, cause: null };
}
function lost(email: string, now: Date, incident: Incident | null = inc(email, "auth")): AccountStatus {
  return { ...deriveStatus({ email, refresh: { ok: false, error: "invalid_grant" }, read: null, lastSyncAt: null, now }), incident };
}
function ok(email: string, now: Date, lastSyncAt: string | null = null): AccountStatus {
  return { ...deriveStatus({ email, refresh: { ok: true, scope: "gmail.send" }, read: { ok: true, status: 200, emailAddress: email }, lastSyncAt, now }), incident: null };
}
const run = (l: Ledger, accts: AccountStatus[], now: Date) => planAnnouncements(l, accts, now);

describe("one notification per confirmed incident", () => {
  it("announces a new incident once, and never again however often the status is read", () => {
    const a = lost("dave@gmail.com", T0);
    const p1 = run(emptyLedger(U), [a], T0);
    expect(p1.post).toEqual({ incidentIds: [a.incident!.id], kind: "auth" });
    const p2 = run(p1.ledger, [lost("dave@gmail.com", at(5))], at(5));
    const p3 = run(p2.ledger, [lost("dave@gmail.com", at(10))], at(10));
    expect(p2.post).toBeNull();
    expect(p3.post).toBeNull();
  });

  it("groups accounts that fail together into ONE notification naming every incident", () => {
    const p = run(emptyLedger(U), [lost("dave@gmail.com", T0), lost("dave@bffsa.org", T0)], T0);
    expect(p.post!.incidentIds).toHaveLength(2);
    expect(p.post!.kind).toBe("auth");
  });

  it("a second account failing later REPLACES the notice with the full open set, not a separate one", () => {
    const p1 = run(emptyLedger(U), [lost("dave@gmail.com", T0), ok("dave@bffsa.org", T0)], T0);
    const p2 = run(p1.ledger, [lost("dave@gmail.com", at(5)), lost("dave@bffsa.org", at(5))], at(5));
    expect(p2.post!.incidentIds).toHaveLength(2);
  });

  it("an account already announced that comes back under a better-anchored ID is the same announcement", () => {
    const p1 = run(emptyLedger(U), [lost("dave@gmail.com", T0, inc("dave@gmail.com", "auth", "2026-10-07T11:55:00.000Z"))], T0);
    const p2 = run(acknowledge(p1.ledger, p1.ledger.open["dave@gmail.com"]!.id, T0), [lost("dave@gmail.com", at(5), inc("dave@gmail.com", "auth", "2026-10-07T11:50:00.000Z"))], at(5));
    expect(p2.post).toBeNull();
    const id = p2.ledger.open["dave@gmail.com"]!.id;
    expect(p2.ledger.acked[id]).toBeTruthy();
  });

  it("a degraded incident announces as degraded, and a mixed set says the stronger kind", () => {
    const d = { ...ok("dave@gmail.com", T0), state: "warning" as const, incident: inc("dave@gmail.com", "degraded") };
    expect(run(emptyLedger(U), [d], T0).post!.kind).toBe("degraded");
    expect(run(emptyLedger(U), [d, lost("dave@bffsa.org", T0)], T0).post!.kind).toBe("auth");
  });
});

describe("recovery withdraws, and a resolved incident is never reopened", () => {
  it("withdraws the notice when the last open incident resolves", () => {
    const p1 = run(emptyLedger(U), [lost("dave@gmail.com", T0)], T0);
    const p2 = run(p1.ledger, [ok("dave@gmail.com", at(6))], at(6));
    expect(p2.withdraw).toBe(true);
    expect(p2.ledger.open).toEqual({});
  });

  it("when only some recover, the notice is replaced so it names only what is still open", () => {
    const p1 = run(emptyLedger(U), [lost("dave@gmail.com", T0), lost("dave@bffsa.org", T0)], T0);
    const p2 = run(p1.ledger, [ok("dave@gmail.com", at(6)), lost("dave@bffsa.org", at(6))], at(6));
    expect(p2.withdraw).toBe(false);
    expect(p2.post!.incidentIds).toEqual([inc("dave@bffsa.org", "auth").id]);
  });

  it("a stale healthy answer does not close an incident", () => {
    const p1 = run(emptyLedger(U), [lost("dave@gmail.com", T0)], T0);
    const stale = ok("dave@gmail.com", T0);
    const p2 = run(p1.ledger, [stale], at(60));
    expect(p2.withdraw).toBe(false);
    expect(Object.keys(p2.ledger.open)).toEqual(["dave@gmail.com"]);
  });

  it("an account that is only warning (not yet connected) does not close an incident either", () => {
    const p1 = run(emptyLedger(U), [lost("dave@gmail.com", T0)], T0);
    const warn = { ...deriveStatus({ email: "dave@gmail.com", refresh: { thrown: true }, read: null, lastSyncAt: null, now: at(5) }), incident: null };
    expect(run(p1.ledger, [warn], at(5)).withdraw).toBe(false);
  });

  it("NEVER REOPENS: the same incident ID arriving again after resolution says nothing", () => {
    const a = lost("dave@gmail.com", T0);
    const p1 = run(emptyLedger(U), [a], T0);
    const p2 = run(p1.ledger, [ok("dave@gmail.com", at(6))], at(6));
    const p3 = run(p2.ledger, [lost("dave@gmail.com", at(12), a.incident)], at(12));
    expect(p3.post).toBeNull();
    expect(p3.ledger.open).toEqual({});
  });

  it("a genuinely new loss has a new ID and is announced", () => {
    const p1 = run(emptyLedger(U), [lost("dave@gmail.com", T0)], T0);
    const p2 = run(p1.ledger, [ok("dave@gmail.com", at(6))], at(6));
    const p3 = run(p2.ledger, [lost("dave@gmail.com", at(600), inc("dave@gmail.com", "auth", "2026-10-07T21:00:00.000Z"))], at(600));
    expect(p3.post).not.toBeNull();
  });

  it("an account that is gone from the answer resolves silently", () => {
    const p1 = run(emptyLedger(U), [lost("dave@gmail.com", T0)], T0);
    expect(run(p1.ledger, [], at(5)).ledger.open).toEqual({});
  });

  it("forgets resolved incidents after thirty days, not before", () => {
    const p1 = run(emptyLedger(U), [lost("dave@gmail.com", T0)], T0);
    const p2 = run(p1.ledger, [ok("dave@gmail.com", at(6))], at(6));
    expect(Object.keys(run(p2.ledger, [], new Date(T0.getTime() + RESOLVED_KEEP_MS - 3600e3)).ledger.resolved)).toHaveLength(1);
    expect(Object.keys(run(p2.ledger, [], new Date(T0.getTime() + RESOLVED_KEEP_MS + 3600e3)).ledger.resolved)).toHaveLength(0);
  });
});

describe("access restored and mail caught up are separate", () => {
  it("restored first; caught up only after a sync that finished after access came back", () => {
    const p1 = run(emptyLedger(U), [lost("dave@gmail.com", T0)], T0);
    const back = ok("dave@gmail.com", at(6), at(-30).toISOString());
    const p2 = run(p1.ledger, [back], at(6));
    expect(Object.values(p2.ledger.resolved)[0]!.caughtUpAt).toBeNull();
    const p3 = run(p2.ledger, [ok("dave@gmail.com", at(12), at(9).toISOString())], at(12));
    expect(Object.values(p3.ledger.resolved)[0]!.caughtUpAt).not.toBeNull();
  });
});

describe("acknowledging", () => {
  it("is remembered per incident, and is dropped with the incident", () => {
    const p1 = run(emptyLedger(U), [lost("dave@gmail.com", T0)], T0);
    const id = Object.values(p1.ledger.open)[0]!.id;
    const l2 = acknowledge(p1.ledger, id, at(1));
    expect(l2.acked[id]).toBeTruthy();
    expect(run(l2, [ok("dave@gmail.com", at(6))], at(6)).ledger.acked[id]).toBeUndefined();
  });
  it("markSeen only touches a resolved incident", () => {
    const p1 = run(emptyLedger(U), [lost("dave@gmail.com", T0)], T0);
    const p2 = run(p1.ledger, [ok("dave@gmail.com", at(6))], at(6));
    const id = Object.keys(p2.ledger.resolved)[0]!;
    expect(markSeen(p2.ledger, id).resolved[id]!.seen).toBe(true);
    expect(markSeen(p2.ledger, "nope")).toBe(p2.ledger);
  });
});
