import { describe, it, expect, vi, afterEach } from "vitest";
import type { AddMeetingResult, MeetingCandidate } from "./mailContracts";
import { executeMailAction, type MailActionDeps, type MailActionTarget } from "./executeMailAction";
import { analyzeNotification, forgetAllCodes, rememberCode } from "./notificationActions";
import {
  CODE, bundleFor, calendarInvite, docusign, driveRequest, driveShare, flightOne, flightTwoLegs, googleForm,
  newsletterBoth, newsletterWeb, otp, paymentFailed, shipment, type Sample,
} from "./notificationFixtures";

afterEach(() => forgetAllCodes());

const ACCOUNT = "me@x.com";
const targetOf = (m: Sample): MailActionTarget => ({
  action: analyzeNotification(bundleFor(m), m === newsletterBoth || m === newsletterWeb ? { bucket: "noise" } : {}).action!,
  threadId: m.threadId, account: ACCOUNT, fromEmail: m.fromEmail, from: m.from,
});

function harness(over: Partial<MailActionDeps> = {}) {
  const opened: string[] = [];
  const copied: string[] = [];
  const deps: MailActionDeps = {
    owner: "u1",
    open: (u) => { opened.push(u); return true; },
    copy: async (t) => { copied.push(await t); },
    ...over,
  };
  return { deps, opened, copied };
}

const ADDED: AddMeetingResult = { status: "added", eventId: "e1", message: "Added to your schedule", undo: async () => true };

describe("the page-opening actions: opened means opened, and nothing more", () => {
  const table: [string, Sample, string][] = [
    ["Grant Access", driveRequest, "Opened Google's access request."],
    ["Open", driveShare, "Opened."],
    ["Sign", docusign, "Opened the signing page."],
    ["Track", shipment, "Opened tracking."],
    ["Fill Out", googleForm, "Opened the form."],
    ["Fix", paymentFailed, "Opened the payment page."],
  ];
  it.each(table)("%s opens the exact extracted URL and says only that it opened", async (_l, m, receipt) => {
    const { deps, opened } = harness();
    const t = targetOf(m);
    const r = await executeMailAction(t, deps);
    expect(opened).toEqual([t.action.url]);
    expect(r).toMatchObject({ status: "opened", message: receipt, settled: false });
    expect(r.message).not.toMatch(/granted|signed|paid|submitted|accepted|unsubscribed|approved/i);
  });

  it("opens inside the tap: before the first await", () => {
    const { deps, opened } = harness();
    void executeMailAction(targetOf(docusign), deps);
    expect(opened).toHaveLength(1); // no await has happened yet
  });

  it("Accept and a web Unsubscribe open inside the tap too", () => {
    const a = harness({ addMeeting: async () => ADDED });
    void executeMailAction(targetOf(calendarInvite), a.deps);
    expect(a.opened).toHaveLength(1);
    const opened: string[] = [];
    void executeMailAction(targetOf(newsletterWeb), harness({ requestUnsub: async (u) => { opened.push(u.target); return { sent: true, kind: "http" as const }; } }).deps);
    expect(opened).toHaveLength(1);
  });

  it("a blocked tab is a failure, and the exact validated link comes back to offer", async () => {
    const { deps } = harness({ open: () => false });
    const t = targetOf(docusign);
    const r = await executeMailAction(t, deps);
    expect(r).toMatchObject({ status: "failed", settled: false, fallbackUrl: t.action.url });
    expect(r.message).toBe("Your Browser Blocked That Tab");
  });

  it("a stored URL that no longer validates is never opened", async () => {
    const { deps, opened } = harness();
    const t = targetOf(docusign);
    const r = await executeMailAction({ ...t, action: { ...t.action, url: "javascript:alert(1)" } }, deps);
    expect(opened).toEqual([]);
    expect(r.status).toBe("failed");
    expect(r.openThread).toBe(true);
  });
});

describe("Accept: the page opens, Jarvis may add the event, and the RSVP is never claimed", () => {
  it("opens the exact invitation link and says the RSVP is not confirmed", async () => {
    const { deps, opened } = harness();
    const t = targetOf(calendarInvite);
    const r = await executeMailAction(t, deps);
    expect(opened).toEqual([t.action.url]);
    expect(t.action.url).toContain("rst=1");
    expect(r).toMatchObject({ status: "opened", message: "Opened · RSVP not confirmed", rsvp: "not_confirmed", settled: false });
    expect(r.message).not.toMatch(/accepted/i);
  });

  it("adds the complete event AFTER the tap, tracks it apart from the RSVP, and offers Undo", async () => {
    const addMeeting = vi.fn(async () => ADDED);
    const { deps } = harness({ addMeeting });
    const t = targetOf(calendarInvite);
    const r = await executeMailAction(t, deps);
    expect(addMeeting).toHaveBeenCalledTimes(1);
    expect(addMeeting).toHaveBeenCalledWith({ candidate: t.action.meeting, threadId: t.threadId, account: ACCOUNT });
    expect(r).toMatchObject({ status: "partial", localEvent: "added", rsvp: "not_confirmed", settled: false });
    expect(r.message).toBe("Opened · Added to Jarvis · RSVP not confirmed");
    expect(await r.undo!()).toBe(true);
  });

  it("does not add an event for an invitation whose page never opened", async () => {
    const addMeeting = vi.fn(async () => ADDED);
    const { deps } = harness({ open: () => false, addMeeting });
    const r = await executeMailAction(targetOf(calendarInvite), deps);
    expect(addMeeting).not.toHaveBeenCalled();
    expect(r.status).toBe("failed");
  });

  it("an event already on the schedule is not added again, and says so", async () => {
    const { deps } = harness({ addMeeting: async () => ({ status: "already", message: "Already on your schedule" }) });
    const r = await executeMailAction(targetOf(calendarInvite), deps);
    expect(r).toMatchObject({ status: "opened", localEvent: "already", message: "Opened · Already on Jarvis · RSVP not confirmed" });
  });

  it("a save that failed is said to have failed, next to the page that did open", async () => {
    const { deps } = harness({ addMeeting: async () => { throw new Error("disk"); } });
    const r = await executeMailAction(targetOf(calendarInvite), deps);
    expect(r).toMatchObject({ status: "partial", localEvent: "failed", message: "Opened · Couldn't Add to Jarvis · RSVP not confirmed" });
  });

  it("confirms the RSVP only when a read-only check says so", async () => {
    const yes = await executeMailAction(targetOf(calendarInvite), harness({ verifyRsvp: async () => true }).deps);
    expect(yes).toMatchObject({ rsvp: "confirmed", message: "Opened · RSVP confirmed" });
    const boom = await executeMailAction(targetOf(calendarInvite), harness({ verifyRsvp: async () => { throw new Error("x"); } }).deps);
    expect(boom.rsvp).toBe("not_confirmed");
  });

  it("an invite with more than one event opens the page and writes nothing", async () => {
    const two = ["BEGIN:VCALENDAR", "METHOD:REQUEST", "BEGIN:VEVENT", "DTSTART:20261006T160000", "SUMMARY:A", "END:VEVENT", "BEGIN:VEVENT", "DTSTART:20261013T160000", "SUMMARY:A", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const addMeeting = vi.fn(async () => ADDED);
    const r = await executeMailAction(targetOf({ ...calendarInvite, ics: [two] }), harness({ addMeeting }).deps);
    expect(addMeeting).not.toHaveBeenCalled();
    expect(r.message).toBe("Opened · RSVP not confirmed");
  });
});

describe("Add to Schedule: added only after the save", () => {
  it("a complete flight is saved once, reported after the save, and Undo removes Jarvis's entry", async () => {
    const order: string[] = [];
    const addMeeting = vi.fn(async (_a: { candidate: MeetingCandidate }) => { order.push("save"); return ADDED; });
    const t = targetOf(flightOne);
    const r = await executeMailAction(t, harness({ addMeeting }).deps);
    order.push("reported");
    expect(order).toEqual(["save", "reported"]);
    expect(r).toMatchObject({ status: "completed", message: "Added to your schedule", settled: true, localEvent: "added" });
    expect(addMeeting.mock.calls[0]![0].candidate).toEqual(t.action.meeting);
    expect(await r.undo!()).toBe(true);
  });
  it("Undo reports false when the delete did not take", async () => {
    const r = await executeMailAction(targetOf(flightOne), harness({ addMeeting: async () => ({ ...ADDED, undo: async () => false }) }).deps);
    expect(await r.undo!()).toBe(false);
  });
  it("a second tap on a saved itinerary is 'already', and settled", async () => {
    const r = await executeMailAction(targetOf(flightOne), harness({ addMeeting: async () => ({ status: "already", message: "Already on your schedule" }) }).deps);
    expect(r).toMatchObject({ status: "completed", localEvent: "already", settled: true });
  });
  it("more than one leg opens the review flow and writes nothing", async () => {
    const addMeeting = vi.fn(async () => ADDED);
    const r = await executeMailAction(targetOf(flightTwoLegs), harness({ addMeeting }).deps);
    expect(addMeeting).not.toHaveBeenCalled();
    expect(r).toMatchObject({ status: "opened", openThread: true, settled: false });
    expect(r.message).toMatch(/Nothing Added/);
  });
  it("a candidate the schedule calls incomplete opens the review flow", async () => {
    const r = await executeMailAction(targetOf(flightOne), harness({ addMeeting: async () => ({ status: "incomplete", message: "x" }) }).deps);
    expect(r).toMatchObject({ status: "opened", openThread: true });
  });
  it("a save that fails is a failure and claims nothing", async () => {
    const r = await executeMailAction(targetOf(flightOne), harness({ addMeeting: async () => ({ status: "failed", message: "Couldn't Add It · Nothing Was Saved" }) }).deps);
    expect(r).toMatchObject({ status: "failed", settled: false, localEvent: "failed" });
    expect(r.message).not.toMatch(/^Added/);
    const thrown = await executeMailAction(targetOf(flightOne), harness({ addMeeting: async () => { throw new Error("x"); } }).deps);
    expect(thrown.status).toBe("failed");
  });
  it("with no schedule to write to, it opens the review flow", async () => {
    const r = await executeMailAction(targetOf(flightOne), harness().deps);
    expect(r).toMatchObject({ status: "opened", openThread: true });
  });
});

describe("Copy Code", () => {
  it("copies ONE code with its leading zeroes and says so only after the clipboard accepted it", async () => {
    const t = targetOf(otp);
    rememberCode({ userId: "u1", account: ACCOUNT, messageId: t.action.evidence.sourceMessageId }, CODE);
    const events: string[] = [];
    const { deps, copied } = harness({ copy: async (text) => { events.push("write"); copied.push(await text); events.push("accepted"); } });
    const p = executeMailAction(t, deps);
    expect(events).toEqual(["write"]); // the write starts inside the tap
    const r = await p;
    expect(events).toEqual(["write", "accepted"]);
    expect(copied).toEqual(["004291"]);
    expect(r).toMatchObject({ status: "completed", message: "Code copied", settled: true });
  });

  it("a clipboard that refuses is a failure and never says Code copied", async () => {
    const t = targetOf(otp);
    rememberCode({ userId: "u1", account: ACCOUNT, messageId: t.action.evidence.sourceMessageId }, CODE);
    const r = await executeMailAction(t, harness({ copy: async () => { throw new Error("NotAllowedError"); } }).deps);
    expect(r.status).toBe("failed");
    expect(r.settled).toBe(false);
    expect(r.message).not.toMatch(/Code copied/i);
    expect(r.openThread).toBe(true);
    expect(JSON.stringify(r)).not.toContain(CODE);
  });

  it("when the code has left memory the exact message is read again, with no model, and the write is handed a promise of it", async () => {
    const t = targetOf(otp);
    const loadCode = vi.fn(async () => CODE);
    const seen: (string | Promise<string>)[] = [];
    const { deps, copied } = harness({ loadCode, copy: async (text) => { seen.push(text); copied.push(await text); } });
    const r = await executeMailAction(t, deps);
    expect(loadCode).toHaveBeenCalledTimes(1);
    expect(loadCode).toHaveBeenCalledWith(t);
    expect(typeof seen[0]).not.toBe("string");
    expect(copied).toEqual([CODE]);
    expect(r.message).toBe("Code copied");
    // And it is remembered for the next tap: no second read.
    await executeMailAction(t, deps);
    expect(loadCode).toHaveBeenCalledTimes(1);
  });

  it("a code remembered for another account, owner or message is not this one's", async () => {
    const t = targetOf(otp);
    const id = t.action.evidence.sourceMessageId;
    rememberCode({ userId: "someone-else", account: ACCOUNT, messageId: id }, "111111");
    rememberCode({ userId: "u1", account: "other@x.com", messageId: id }, "222222");
    rememberCode({ userId: "u1", account: ACCOUNT, messageId: "older" }, "333333");
    const { deps, copied } = harness({ loadCode: async () => CODE });
    await executeMailAction(t, deps);
    expect(copied).toEqual([CODE]);
  });

  it("an expired code is read again, not copied stale", async () => {
    const t = targetOf(otp);
    rememberCode({ userId: "u1", account: ACCOUNT, messageId: t.action.evidence.sourceMessageId }, "999999", 1000);
    const { deps, copied } = harness({ loadCode: async () => CODE, now: () => 1000 + 16 * 60e3 });
    await executeMailAction(t, deps);
    expect(copied).toEqual([CODE]);
  });

  it("ambiguous or missing code on the exact message shows View Email and copies nothing", async () => {
    const t = targetOf(otp);
    const { deps, copied } = harness({ loadCode: async () => null });
    const r = await executeMailAction(t, deps);
    expect(copied).toEqual([]);
    expect(r).toMatchObject({ status: "failed", openThread: true });
    expect(r.message).not.toMatch(/Code copied/i);
    const none = await executeMailAction(t, harness().deps);
    expect(none).toMatchObject({ status: "failed", openThread: true });
  });
});

describe("Unsubscribe: asked or opened, never confirmed", () => {
  it("a mailto is sent for the exact account and reported as asked", async () => {
    const requestUnsub = vi.fn(async () => ({ sent: true, kind: "mailto" as const }));
    const t = targetOf(newsletterBoth);
    const r = await executeMailAction(t, harness({ requestUnsub }).deps);
    expect(requestUnsub).toHaveBeenCalledWith(t.action.unsubscribe, ACCOUNT, "news@trailweekly.com");
    expect(r).toMatchObject({ status: "completed", message: "Asked them to stop", settled: true });
    expect(r.message).not.toMatch(/unsubscribed|confirmed/i);
  });
  it("a web link is opened, and that is all it says", async () => {
    const r = await executeMailAction(targetOf(newsletterWeb), harness({ requestUnsub: async () => ({ sent: true, kind: "http" as const }) }).deps);
    expect(r).toMatchObject({ status: "opened", message: "Opened unsubscribe page", settled: false });
  });
  it("a mail that did not go and a tab that did not open are failures", async () => {
    const m = await executeMailAction(targetOf(newsletterBoth), harness({ requestUnsub: async () => ({ sent: false, kind: "mailto" as const }) }).deps);
    expect(m).toMatchObject({ status: "failed", message: "Couldn't Send It · Nothing Was Asked" });
    const w = await executeMailAction(targetOf(newsletterWeb), harness({ requestUnsub: async () => ({ sent: false, kind: "http" as const }) }).deps);
    expect(w).toMatchObject({ status: "failed", fallbackUrl: "https://trailweekly.com/u/123" });
  });
  it("with no mail client it cannot run at all", async () => {
    const r = await executeMailAction(targetOf(newsletterBoth), harness().deps);
    expect(r.status).toBe("failed");
  });
});
