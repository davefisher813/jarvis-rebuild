import { describe, it, expect } from "vitest";
import { deriveStatus, type AccountStatus } from "./connectionStatus";
import { incidentId, type Incident } from "./incident";
import { emptyLedger, planAnnouncements } from "./incidentLedger";
import { bannerModels, pausedLine, recoveryNotes, updatedLines, gmailUrlFor, BANNER_TITLE } from "./incidentView";

const NOW = new Date("2026-10-07T12:00:00Z");
const E = "dave@gmail.com";
const inc = (kind: "auth" | "degraded"): Incident => ({ id: incidentId(E, kind, "2026-10-07T09:00:00.000Z"), kind, openedAt: "2026-10-07T09:00:00.000Z", cause: null });
const lost = (o: Partial<AccountStatus> = {}): AccountStatus => ({
  ...deriveStatus({ email: E, refresh: { ok: false, error: "invalid_grant" }, read: null, lastSyncAt: "2026-10-06T20:12:00.000Z", now: NOW }),
  incident: inc("auth"), paused: { replies: 2, other: 1 }, ...o,
});

describe("the banner says what the spec says", () => {
  it("title, address, when mail last updated, that new mail may be missing, and the paused counts", () => {
    const [m] = bannerModels([lost()], emptyLedger("u"));
    expect(m!.title).toBe("Gmail Needs Reconnecting");
    expect(m!.address).toBe(E);
    expect(m!.lines[0]).toMatch(/^Mail last updated .+ at .+\.$/);
    expect(m!.lines[1]).toBe("New mail may be missing.");
    expect(m!.paused).toBe("2 Replies Unsent · 1 Other Action Paused");
    expect(m!.reconnect).toBe(true);
    expect(m!.strip).toBe(false);
  });

  it("each line is one sentence, so the app's short-copy law holds without an exemption", () => {
    const [m] = bannerModels([lost()], emptyLedger("u"));
    for (const line of [...m!.lines, m!.paused!, m!.title]) expect(line).not.toMatch(/\. [A-Z]/);
  });

  it("never claims a sync that did not happen", () => {
    expect(updatedLines(null)[0]).toBe("Mail has not updated yet.");
  });

  it("singular and plural are right", () => {
    expect(pausedLine({ replies: 1, other: 0 })).toBe("1 Reply Unsent · 0 Other Actions Paused");
    expect(pausedLine({ replies: 0, other: 1 })).toBe("0 Replies Unsent · 1 Other Action Paused");
  });

  it("offers Reconnect only for a confirmed lost grant: a degraded incident never does", () => {
    const [m] = bannerModels([lost({ incident: inc("degraded"), state: "warning", auth_state: "unknown" })], emptyLedger("u"));
    expect(m!.reconnect).toBe(false);
    expect(m!.title).toBe(BANNER_TITLE.degraded);
  });

  it("an acknowledged incident compacts to a strip, but is still there", () => {
    const a = lost();
    const l = planAnnouncements(emptyLedger("u"), [a], NOW).ledger;
    const acked = { ...l, acked: { [a.incident!.id]: NOW.toISOString() } };
    expect(bannerModels([a], acked)[0]!.strip).toBe(true);
    expect(bannerModels([a], acked)).toHaveLength(1);
  });

  it("no incident, no banner: a healthy or merely warning account shows nothing here", () => {
    expect(bannerModels([lost({ incident: null })], emptyLedger("u"))).toEqual([]);
  });

  it("opens Gmail signed in as that address", () => {
    expect(gmailUrlFor("dave+x@gmail.com")).toBe("https://mail.google.com/mail/?authuser=dave%2Bx%40gmail.com");
  });
});

describe("recovery notes", () => {
  it("Access Restored first, Mail Caught Up only once synced, and neither after it has been seen", () => {
    const a = lost();
    const l1 = planAnnouncements(emptyLedger("u"), [a], NOW).ledger;
    const healthy = { ...deriveStatus({ email: E, refresh: { ok: true, scope: "gmail.send" }, read: { ok: true, status: 200, emailAddress: E }, lastSyncAt: null, now: NOW }), incident: null };
    const l2 = planAnnouncements(l1, [healthy], NOW).ledger;
    expect(recoveryNotes([healthy], l2).map((n) => n.title)).toEqual(["Access Restored"]);
    const later = new Date(NOW.getTime() + 600e3);
    const synced = { ...healthy, lastSuccessfulSyncAt: later.toISOString(), checkedAt: later.toISOString() };
    const l3 = planAnnouncements(l2, [synced], later).ledger;
    expect(recoveryNotes([synced], l3).map((n) => n.title)).toEqual(["Mail Caught Up"]);
    const id = Object.keys(l3.resolved)[0]!;
    expect(recoveryNotes([synced], { ...l3, resolved: { [id]: { ...l3.resolved[id]!, seen: true } } })).toEqual([]);
  });
});
