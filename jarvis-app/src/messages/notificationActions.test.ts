import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import type { ThreadRow } from "../connections/google/map";
import type { NotificationAction } from "./mailContracts";
import {
  ACTION_LABEL, BUSY_LABEL, NOTIFICATION_ACTION_KINDS, VIEW_LABEL, analyzeNotification, buildNotificationSnapshot,
  canExecuteMailAction, extractActionEvidence, findCodes, forgetAllCodes, hostOf, labelFor, meetingFromCalendar,
  readStoredAction, recallCode, redactCodes, rememberCode, selectPrimaryMailAction, validateHttpsUrl,
  validateNotificationAction,
} from "./notificationActions";
import {
  CODE, bundleFor, calendarInvite, docusign, driveRequest, driveShare, flightOne, flightTwoLegs, googleForm,
  hotelAllDay, newsletterBoth, newsletterWeb, otp, otpInSubject, otpNoCode, otpTwoCodes, paymentFailed, shipment,
  type Sample,
} from "./notificationFixtures";

afterEach(() => { vi.restoreAllMocks(); forgetAllCodes(); });

const analyse = (m: Sample, ctx: Parameters<typeof analyzeNotification>[1] = {}) => analyzeNotification(bundleFor(m), ctx);

describe("validateHttpsUrl: what may ever be opened", () => {
  it("accepts an https URL and returns it exactly as written, query and all", () => {
    const u = "https://na3.docusign.net/Signing/EmailStart.aspx?a=abc&er=d%20ef";
    expect(validateHttpsUrl(u)).toBe(u);
  });
  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    ["file:", "file:///etc/passwd"],
    ["http:", "http://netflix.com/account"],
    ["credentials in the URL", "https://user:pw@netflix.com/pay"],
    ["a name that reads as Google in the credentials", "https://google.com@evil.example/x"],
    ["a bare IP", "https://192.168.0.1/admin"],
    ["localhost", "https://localhost/x"],
    ["a name with no dot", "https://intranet/x"],
    ["not a URL at all", "not a url"],
    ["whitespace inside", "https://exa mple.com/x"],
    ["a backslash", "https://evil.example\\@docs.google.com/x"],
    ["nothing", ""],
  ])("rejects %s", (_n, u) => { expect(validateHttpsUrl(u)).toBeNull(); });
  it("rejects a value that is not a string", () => { expect(validateHttpsUrl(undefined)).toBeNull(); expect(validateHttpsUrl(42)).toBeNull(); });
});

describe("extractActionEvidence: the message read inertly", () => {
  it("never fetches anything, whatever links it finds", () => {
    const f = vi.spyOn(globalThis, "fetch");
    bundleFor(docusign);
    bundleFor(calendarInvite);
    expect(f).not.toHaveBeenCalled();
  });

  it("reads anchors, decodes entities in the href, and gives every link a stable id", () => {
    const a = bundleFor(driveRequest);
    const b = bundleFor(driveRequest);
    const share = a.links.find((l) => l.text === "Share")!;
    expect(share.url).toBe("https://docs.google.com/document/d/1AbCdEf/edit?usp=access_request&ts=65a");
    expect(share.host).toBe("docs.google.com");
    expect(a.links.map((l) => l.id)).toEqual(b.links.map((l) => l.id));
    expect(new Set(a.links.map((l) => l.id)).size).toBe(a.links.length);
    // The same URL in another message is another id: an id belongs to its message.
    expect(bundleFor(driveRequest, { messageId: "other" }).links[0]!.id).not.toBe(a.links[0]!.id);
  });

  it("gives the model an id, a host and words: never a URL", () => {
    const b = bundleFor(docusign);
    for (const p of b.promptLinks) {
      expect(Object.keys(p).sort()).toEqual(["host", "id", "text"]);
      expect(p.host).not.toMatch(/[/:?]/);
    }
    expect(JSON.stringify(b.promptLinks)).not.toContain("https://");
    expect(b.promptLinks.find((p) => p.text === "REVIEW DOCUMENT")!.host).toBe("na3.docusign.net");
  });

  it("drops a link a person cannot see, as the reader does", () => {
    const b = bundleFor(shipment, { html: '<a href="https://evil.example/track" style="display:none">Track</a><a href="https://ups.com/track?x=1">Track</a>' });
    expect(b.links.map((l) => l.url)).toEqual(["https://ups.com/track?x=1"]);
  });

  it("finds bare URLs in the text and in the calendar file, and refuses what is unsafe", () => {
    const b = bundleFor(driveShare, {
      html: undefined,
      body: "See https://docs.google.com/spreadsheets/d/1XyZ/edit. Also http://plain.example/x and javascript:alert(1)",
      ics: ["BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20261006T160000\r\nURL:https://calendar.google.com/calendar/event?action=VIEW&eid=Z\r\nEND:VEVENT\r\nEND:VCALENDAR"],
    });
    const urls = b.links.map((l) => l.url);
    expect(urls).toContain("https://docs.google.com/spreadsheets/d/1XyZ/edit");
    expect(urls).toContain("https://calendar.google.com/calendar/event?action=VIEW&eid=Z");
    expect(urls).not.toContain("http://plain.example/x");
    expect(b.rejected).toBeGreaterThan(0);
  });

  it("a code in the words of a link never reaches the model", () => {
    const b = bundleFor(otp, { html: `<a href="https://acme.com/verify">Your verification code is ${CODE}</a>` });
    expect(JSON.stringify(b.promptLinks)).not.toContain(CODE);
  });
});

describe("every action, from a real-shaped message", () => {
  const cases: [string, Sample, NotificationAction["kind"], string | undefined][] = [
    ["a Drive access request", driveRequest, "grant_access", "https://docs.google.com/document/d/1AbCdEf/edit?usp=access_request&ts=65a"],
    ["a new share", driveShare, "open_share", "https://docs.google.com/spreadsheets/d/1XyZ/edit?usp=sharing&ts=1"],
    ["a calendar invite", calendarInvite, "accept_invite", "https://calendar.google.com/calendar/event?action=RESPOND&eid=EID1&rst=1&tok=T&ctz=America/New_York"],
    ["a DocuSign request", docusign, "sign", "https://na3.docusign.net/Signing/EmailStart.aspx?a=abc&er=def"],
    ["a UPS parcel", shipment, "track", "https://wwwapps.ups.com/track?loc=en_US&tracknum=1Z999AA10123456784"],
    ["a Google Form", googleForm, "fill_form", "https://docs.google.com/forms/d/e/1FAIpQLSfXYZ/viewform?usp=sf_link"],
    ["a failed payment", paymentFailed, "fix_payment", "https://www.netflix.com/youraccount?nftoken=xyz"],
    ["a one-time code", otp, "copy_code", undefined],
    ["a newsletter", newsletterBoth, "unsubscribe", undefined],
    ["a flight", flightOne, "add_travel", undefined],
  ];
  it.each(cases)("%s", (_n, m, kind, url) => {
    const r = analyse(m);
    expect(r.action?.kind).toBe(kind);
    expect(r.action?.url).toBe(url);
    expect(r.action?.evidence.sourceMessageId).toBe(m.messageId);
    expect(r.action?.evidence.sourceRevision).toBe(m.messageId);
  });

  it("covers every kind in the contract, each with a button label and a busy label", () => {
    expect(new Set(cases.map((c) => c[2]))).toEqual(new Set(NOTIFICATION_ACTION_KINDS));
    expect(ACTION_LABEL).toEqual({
      grant_access: "Grant Access", open_share: "Open", accept_invite: "Accept", sign: "Sign", track: "Track",
      add_travel: "Add to Schedule", fill_form: "Fill Out", fix_payment: "Fix", copy_code: "Copy Code", unsubscribe: "Unsubscribe",
    });
    for (const k of NOTIFICATION_ACTION_KINDS) expect(BUSY_LABEL[k]).toMatch(/…$/);
    expect(labelFor(undefined)).toBe(VIEW_LABEL);
    expect(VIEW_LABEL).toBe("View Email");
  });

  it("the hostname of a Sign, Fix or Track action is kept, read off the validated URL", () => {
    expect(hostOf(analyse(docusign).action?.url)).toBe("na3.docusign.net");
    expect(hostOf(analyse(paymentFailed).action?.url)).toBe("www.netflix.com");
    expect(hostOf(analyse(shipment).action?.url)).toBe("wwwapps.ups.com");
  });

  it("an access request offers Grant Access, not Open: the sentence decides", () => {
    expect(analyse(driveRequest).action?.kind).toBe("grant_access");
    expect(analyse(driveShare).action?.kind).toBe("open_share");
  });
});

describe("malformed, malicious and absent links", () => {
  const withLinks = (base: Sample, hrefs: string[]): Sample => ({
    ...base, html: hrefs.map((h) => `<a href="${h}">Update Payment Now</a>`).join(""),
  });
  it.each([
    "javascript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "file:///etc/passwd",
    "http://www.netflix.com/youraccount",
    "https://user:pw@www.netflix.com/youraccount",
    "https://www.netflix.com@evil.example/youraccount",
    "not a link",
  ])("a payment mail whose only link is %s has no action", (href) => {
    expect(analyse(withLinks(paymentFailed, [href])).action).toBeNull();
  });

  it("a payment mail with no link at all has no action", () => {
    expect(analyse({ ...paymentFailed, html: undefined }).action).toBeNull();
  });

  it("a payment link on a host that is not the sender's organisation is refused", () => {
    expect(analyse(withLinks(paymentFailed, ["https://netflix-billing.evil.example/youraccount"])).action).toBeNull();
  });

  it("a sign link on a host nobody signs on, from a sender who is not that host, is refused", () => {
    const m: Sample = { ...docusign, fromEmail: "dse@docusign.net", html: '<a href="https://evil.example/Signing/EmailStart.aspx">REVIEW DOCUMENT</a>' };
    expect(analyse(m).action).toBeNull();
  });

  it.each([
    ["a subdomain of a lookalike", "https://docs.google.com.evil.example/document/d/1/edit"],
    ["a hyphenated twin", "https://docs-google.com/document/d/1/edit"],
    ["a punycode twin", "https://xn--docs-google-2fb.com/document/d/1/edit"],
    ["the real name only in the path", "https://evil.example/docs.google.com/document/d/1/edit"],
    ["a different Google host", "https://sites.google.com/document/d/1/edit"],
    ["http", "http://docs.google.com/document/d/1/edit"],
  ])("a Google access request whose link is %s is refused", (_n, href) => {
    expect(analyse({ ...driveRequest, html: `<a href="${href}">Share</a>` }).action).toBeNull();
  });

  it("a Google access request from a stranger is not Grant Access even with a real Google link", () => {
    expect(analyse({ ...driveRequest, fromEmail: "someone@evil.example" }).action).toBeNull();
  });

  it("a Google Form link that is a response edit page is refused", () => {
    const m: Sample = { ...googleForm, html: '<a href="https://docs.google.com/forms/d/e/1FAIpQLSfXYZ/viewform?edit2=2_ABC">Fill out form</a>' };
    expect(analyse(m).action).toBeNull();
  });

  it("an invite with no Google Calendar link has no Accept", () => {
    expect(analyse({ ...calendarInvite, html: '<a href="https://evil.example/calendar/event?action=RESPOND&rst=1">Yes</a>' }).action).toBeNull();
  });
});

describe("the model classifies; it never invents a URL", () => {
  it("a kind and a link id it was shown make the action, with the URL from the message", () => {
    const b = bundleFor(shipment, { html: '<a href="https://wwwapps.ups.com/track?tracknum=1Z9">Track Package</a><a href="https://wwwapps.ups.com/orders?o=5">Order</a>' });
    const link = b.links.find((l) => l.text === "Order")!;
    const a = validateNotificationAction({ kind: "track", linkId: link.id }, b);
    expect(a?.url).toBe("https://wwwapps.ups.com/orders?o=5");
    expect(a?.evidence.linkId).toBe(link.id);
  });
  it("an id that was never in the list drops the whole classification", () => {
    const b = bundleFor(shipment);
    expect(validateNotificationAction({ kind: "track", linkId: "Lnope" }, b)).toBeNull();
    expect(validateNotificationAction({ kind: "track", linkId: "https://evil.example/x" }, b)).toBeNull();
  });
  it("a kind outside the list is dropped", () => {
    const b = bundleFor(shipment);
    expect(validateNotificationAction({ kind: "pay_now" as never }, b)).toBeNull();
  });
  it("a listed link on the wrong kind of host is refused whoever chose it", () => {
    const b = bundleFor(shipment, { html: '<a href="https://evil.example/track?x=1">Track Package</a>' });
    expect(validateNotificationAction({ kind: "track", linkId: b.links[0]!.id }, b)).toBeNull();
    expect(validateNotificationAction({ kind: "grant_access", linkId: b.links[0]!.id }, b)).toBeNull();
  });
  it("a quote that is not in the message is dropped and the action stands without it; a real one is kept", () => {
    const b = bundleFor(docusign);
    const bad = validateNotificationAction({ kind: "sign", quote: "you owe us fifty dollars" }, b);
    expect(bad?.kind).toBe("sign");
    expect(bad?.evidence.sourceQuote).toBeUndefined();
    const good = validateNotificationAction({ kind: "sign", quote: "sent you a document to review and sign" }, b);
    expect(good?.evidence.sourceQuote).toBe("sent you a document to review and sign");
  });
  it("a model that disagrees with the reader makes it competing, which is View Email", () => {
    const b = bundleFor(docusign);
    const r = analyzeNotification(b, { classification: { kind: "track" } });
    // "track" finds no eligible link here, so it adds nothing and Sign stands.
    expect(r.action?.kind).toBe("sign");
    const both = bundleFor(shipment, { html: '<a href="https://wwwapps.ups.com/track?tracknum=1Z9">Track Package</a>', listUnsubscribe: "<https://ups.com/u/1>" });
    expect(analyzeNotification(both, { classification: { kind: "unsubscribe" } }).action?.kind).toBe("track");
  });
  it("a model-only reading with no evidence produces nothing", () => {
    const b = bundleFor({ ...otp, subject: "Hello", body: "Just saying hi." });
    expect(analyzeNotification(b, { classification: { kind: "grant_access" } }).action).toBeNull();
    expect(analyzeNotification(b, { classification: { kind: "copy_code" } }).action).toBeNull();
    expect(analyzeNotification(b, { classification: { kind: "unsubscribe" } }).action).toBeNull();
  });
});

describe("competing actions mean View Email", () => {
  it("two different tracking links are two packages: no action", () => {
    const m: Sample = { ...shipment, html: '<a href="https://wwwapps.ups.com/track?tracknum=1Z1">Track Package</a><a href="https://wwwapps.ups.com/track?tracknum=1Z2">Track Package</a>' };
    expect(analyse(m).action).toBeNull();
  });
  it("the same tracking link twice is one action", () => {
    const m: Sample = { ...shipment, html: '<a href="https://wwwapps.ups.com/track?tracknum=1Z1">Track Package</a><a href="https://wwwapps.ups.com/track?tracknum=1Z1">Track</a>' };
    expect(analyse(m).action?.kind).toBe("track");
  });
  it("a tracking mail that is also a failed payment is competing", () => {
    const m: Sample = {
      ...shipment, fromEmail: "orders@shop.example.com", subject: "Payment failed and your order shipped",
      html: '<a href="https://shop.example.com/track/1">Track your order</a><a href="https://shop.example.com/billing">Update payment</a>',
    };
    expect(analyse(m).action).toBeNull();
  });
  it("a specialised action beats Unsubscribe; two specialised ones do not beat each other", () => {
    const a = (kind: NotificationAction["kind"], url?: string): NotificationAction => ({ kind, evidence: { sourceMessageId: "m", sourceRevision: "m" }, ...(url ? { url } : {}) });
    expect(selectPrimaryMailAction([a("unsubscribe"), a("track", "https://ups.com/track?x=1")])?.kind).toBe("track");
    expect(selectPrimaryMailAction([a("track", "https://ups.com/track?x=1"), a("sign", "https://docusign.net/Signing/x")])).toBeNull();
    expect(selectPrimaryMailAction([a("unsubscribe"), a("unsubscribe")])?.kind).toBe("unsubscribe");
    expect(selectPrimaryMailAction([])).toBeNull();
  });
  it("Unsubscribe never rides on a needs-you thread", () => {
    expect(analyse(newsletterBoth, { bucket: "needs_you" }).action).toBeNull();
    expect(analyse(newsletterBoth, { bucket: "noise" }).action?.kind).toBe("unsubscribe");
  });
  it("a web-only List-Unsubscribe that is not https offers nothing", () => {
    expect(analyse({ ...newsletterWeb, listUnsubscribe: "<http://trailweekly.com/u/1>" }).action).toBeNull();
    expect(analyse(newsletterWeb).action?.unsubscribe).toEqual({ kind: "http", target: "https://trailweekly.com/u/123" });
    expect(analyse(newsletterBoth).action?.unsubscribe?.kind).toBe("mailto");
  });
});

describe("verification codes", () => {
  it("keeps the leading zeroes: 004291 stays 004291", () => {
    expect(bundleFor(otp).codes).toEqual(["004291"]);
    expect(findCodes("Your code is 004291")).toEqual(["004291"]);
  });
  it("finds the code where senders actually put it", () => {
    expect(findCodes("123456 is your Example verification code")).toEqual(["123456"]);
    expect(findCodes("Your verification code:\n\n  873 204\n\nExpires soon")).toEqual(["873204"]);
    expect(findCodes("Verification code\n739001\nDo not share")).toEqual(["739001"]);
    expect(findCodes("Use 483920 to verify your account")).toEqual(["483920"]);
    expect(findCodes("PIN: 4821")).toEqual(["4821"]);
  });
  it("does not mistake an amount, a year or a phone number for a code", () => {
    expect(findCodes("Invoice total $2400 due 2026. Call 555-0100 x1234")).toEqual([]);
    expect(findCodes("Your code is valid for 10 minutes")).toEqual([]);
  });
  it("one code makes Copy Code; the action holds no code and no quote", () => {
    const a = analyse(otp, { messageAtMs: 1_000_000 }).action!;
    expect(a.kind).toBe("copy_code");
    expect(JSON.stringify(a)).not.toContain(CODE);
    expect(a.evidence.sourceQuote).toBeUndefined();
    expect(a.expiresAt).toBe(new Date(1_000_000 + 15 * 60e3).toISOString());
    expect(analyse(otpInSubject).action?.kind).toBe("copy_code");
  });
  it("two codes are ambiguous: no Copy Code, View Email instead", () => {
    const r = analyse(otpTwoCodes);
    expect(r.action).toBeNull();
    expect(r.view).toBe("code");
  });
  it("a code mail with no code is View Email, not a guess", () => {
    const r = analyse(otpNoCode);
    expect(r.action).toBeNull();
    expect(r.view).toBe("code");
  });
  it("a mail that is merely about verification is not a code mail", () => {
    expect(analyse({ ...otp, subject: "Confirm your appointment", body: "See you Tuesday." })).toEqual({ action: null });
  });
  it("redacts every code out of anything a model or a stored snapshot may see", () => {
    expect(redactCodes(`Your verification code is ${CODE}. Never share it.`)).not.toContain(CODE);
    expect(redactCodes("123456 is your Example verification code")).not.toContain("123456");
    expect(redactCodes("Invoice $2400 due Friday")).toBe("Invoice $2400 due Friday");
  });
  it("lives in short-lived memory keyed by owner, account and message", () => {
    const scope = { userId: "u1", account: "me@x.com", messageId: "m1" };
    rememberCode(scope, CODE, 1000);
    expect(recallCode(scope, 2000)).toBe(CODE);
    expect(recallCode({ ...scope, userId: "u2" }, 2000)).toBeNull();
    expect(recallCode({ ...scope, account: "other@x.com" }, 2000)).toBeNull();
    expect(recallCode({ ...scope, messageId: "m2" }, 2000)).toBeNull();
    expect(recallCode(scope, 1000 + 16 * 60e3)).toBeNull();
    expect(recallCode(scope, 2000)).toBeNull(); // expiry forgot it
  });
});

describe("calendar invites and travel", () => {
  it("Accept carries a complete event read from the invitation, and nothing about it is guessed", () => {
    const a = analyse(calendarInvite).action!;
    expect(a.meeting).toMatchObject({ title: "Practice Plan", date: "2026-10-06", start: "16:00", end: "17:00", status: "requested", missing: [], durationSource: "stated" });
    expect(a.meeting!.id).toBe(meetingFromCalendar(bundleFor(calendarInvite))!.id);
  });
  it("the candidate id is stable for the same message and differs for another thread", () => {
    const one = meetingFromCalendar(bundleFor(calendarInvite))!.id;
    expect(meetingFromCalendar(bundleFor(calendarInvite))!.id).toBe(one);
    expect(meetingFromCalendar(bundleFor(calendarInvite, { threadId: "other" }))!.id).not.toBe(one);
  });
  it("a cancelled invitation has no Accept", () => {
    const cancelled = ICS_CANCEL;
    expect(analyse({ ...calendarInvite, ics: [cancelled] }).action).toBeNull();
  });
  it("a recurring or multi-event invitation still opens the page but adds nothing locally", () => {
    const two = ["BEGIN:VCALENDAR", "METHOD:REQUEST", "BEGIN:VEVENT", "DTSTART:20261006T160000", "SUMMARY:A", "END:VEVENT", "BEGIN:VEVENT", "DTSTART:20261013T160000", "SUMMARY:A", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const a = analyse({ ...calendarInvite, ics: [two] }).action!;
    expect(a.kind).toBe("accept_invite");
    expect(a.meeting).toBeUndefined();
  });
  it("a single complete flight is one tap; two legs and an all-day stay open the review flow", () => {
    expect(analyse(flightOne).action?.meeting).toMatchObject({ date: "2026-10-09", start: "07:15", missing: [] });
    const legs = analyse(flightTwoLegs).action!;
    expect(legs.kind).toBe("add_travel");
    expect(legs.meeting).toBeUndefined();
    const stay = analyse(hotelAllDay).action!;
    expect(stay.kind).toBe("add_travel");
    expect(stay.meeting).toBeUndefined();
  });
  it("an itinerary the brief read is used when there is no calendar file, and only when there is one complete leg", () => {
    const cand = (id: string, over: object = {}) => ({ id, sourceMessageId: "m1", sourceQuote: "q", title: "Flight", status: "agreed" as const, date: "2026-10-09", start: "07:15", missing: [], durationSource: "default" as const, ...over });
    const noIcs: Sample = { ...flightOne, ics: undefined };
    expect(analyse(noIcs).action).toBeNull();
    expect(analyse(noIcs, { meetings: [cand("a")] }).action?.meeting?.id).toBe("a");
    expect(analyse(noIcs, { meetings: [cand("a"), cand("b")] }).action?.meeting).toBeUndefined();
    expect(analyse(noIcs, { meetings: [cand("a", { missing: ["meridiem"], start: undefined })] }).action?.meeting).toBeUndefined();
  });
});

const ICS_CANCEL = ["BEGIN:VCALENDAR", "METHOD:CANCEL", "BEGIN:VEVENT", "DTSTART:20261006T160000", "SUMMARY:Practice Plan", "STATUS:CANCELLED", "END:VEVENT", "END:VCALENDAR"].join("\r\n");

describe("canExecuteMailAction and stored actions", () => {
  it("re-checks a stored URL before anything opens it", () => {
    const a = analyse(docusign).action!;
    expect(canExecuteMailAction(a)).toBe(true);
    expect(canExecuteMailAction({ ...a, url: "javascript:alert(1)" })).toBe(false);
    expect(canExecuteMailAction({ ...a, url: undefined })).toBe(false);
    expect(canExecuteMailAction(a, { canOpen: false })).toBe(false);
  });
  it("the others need what they use", () => {
    expect(canExecuteMailAction(analyse(otp).action!, { canCopy: false })).toBe(false);
    expect(canExecuteMailAction(analyse(newsletterBoth).action!, { hasMailApi: false })).toBe(false);
    expect(canExecuteMailAction(analyse(newsletterWeb).action!, { hasMailApi: false })).toBe(true);
    expect(canExecuteMailAction(analyse(flightOne).action!, { canSchedule: false })).toBe(false);
    expect(canExecuteMailAction(analyse(flightTwoLegs).action!, { canSchedule: false })).toBe(true);
  });
  it("readStoredAction keeps a sound action and drops one that fails its own checks", () => {
    const a = analyse(docusign).action!;
    expect(readStoredAction(JSON.parse(JSON.stringify(a)))).toEqual(a);
    expect(readStoredAction({ ...a, url: "http://na3.docusign.net/x" })).toBeUndefined();
    expect(readStoredAction({ ...a, kind: "pay_now" })).toBeUndefined();
    expect(readStoredAction({ kind: "sign" })).toBeUndefined();
    expect(readStoredAction(null)).toBeUndefined();
    const inv = analyse(calendarInvite).action!;
    expect(readStoredAction({ ...inv, meeting: { ...inv.meeting, missing: ["time"] } })?.meeting).toBeUndefined();
    const c = analyse(otp).action!;
    expect(readStoredAction({ ...c, evidence: { ...c.evidence, sourceQuote: `code ${CODE}` } })?.evidence.sourceQuote).toBeUndefined();
  });
});

describe("buildNotificationSnapshot: bounded, separate, and scoped to the account", () => {
  const row = (id: string, over: Partial<ThreadRow> = {}): ThreadRow => ({
    id, from: "Acme", fromEmail: "no-reply@acme.com", subject: "Subject " + id, snippet: "snippet " + id,
    unread: true, inInbox: true, dateMs: 1_700_000_000_000 + Number(id.replace(/\D/g, "")) * 1000, count: 1, lastMsgId: "m" + id,
    account: "me@x.com", ...over,
  });
  const entry = (r: ThreadRow, action: NotificationAction | null, over: object = {}) => ({ rev: r.lastMsgId, at: 1, action, ...over });
  const act = (kind: NotificationAction["kind"], url?: string): NotificationAction => ({ kind, evidence: { sourceMessageId: "m", sourceRevision: "m" }, ...(url ? { url } : {}) });

  it("surfaces a worth-knowing and a noise thread, apart from the needs-you rows, with account, id and revision", () => {
    const a = row("1"), b = row("2"), c = row("3");
    const table = new Map([
      [a.id, entry(a, act("track", "https://ups.com/track?x=1"))],
      [b.id, entry(b, act("open_share", "https://docs.google.com/document/d/1/edit"))],
      [c.id, entry(c, act("sign", "https://docusign.net/Signing/x"))],
    ]);
    const snap = buildNotificationSnapshot({
      owner: "u1", rows: [a, b, c],
      map: { "1": { bucket: "worth_knowing", gist: "Parcel", lastMsgId: a.lastMsgId }, "2": { bucket: "noise", gist: "Shared", lastMsgId: b.lastMsgId }, "3": { bucket: "needs_you", gist: "Sign", lastMsgId: c.lastMsgId } },
      entryFor: (_acct, id) => table.get(id),
      excludeIds: new Set(["3"]),
    });
    expect(snap.actionable.map((t) => t.id).sort()).toEqual(["1", "2"]);
    for (const t of snap.actionable) {
      expect(t.account).toBe("me@x.com");
      expect(t.revision).toBe("m" + t.id);
      expect(t.action).toBeDefined();
    }
    // The needs-you row keeps its own place and still carries its action.
    expect(snap.fields(c)).toMatchObject({ revision: "m3", action: { kind: "sign" } });
  });

  it("an entry read at another revision is never used", () => {
    const a = row("1");
    const snap = buildNotificationSnapshot({ owner: "u1", rows: [a], map: {}, entryFor: () => ({ rev: "older", at: 1, action: act("track", "https://ups.com/track?x=1") }) });
    expect(snap.actionable).toEqual([]);
  });

  it("orders time-critical first, bounds the list, and drops a code that has expired", () => {
    const rows = Array.from({ length: 12 }, (_, i) => row(String(i + 1)));
    const kinds: NotificationAction["kind"][] = ["track", "open_share", "unsubscribe", "sign", "copy_code"];
    const table = new Map(rows.map((r, i) => [r.id, entry(r, act(kinds[i % kinds.length]!, i % 5 === 3 ? "https://docusign.net/Signing/x" : i % 5 === 0 ? "https://ups.com/track?x=1" : i % 5 === 1 ? "https://docs.google.com/document/d/1/edit" : undefined))]));
    const now = 5_000_000_000_000;
    const snap = buildNotificationSnapshot({ owner: "u1", rows, map: {}, entryFor: (_a, id) => table.get(id), now, limit: 8 });
    expect(snap.actionable).toHaveLength(8);
    expect(snap.actionable[0]!.action!.kind).toBe("copy_code");
    const expiredCode = { ...act("copy_code"), expiresAt: new Date(now - 1).toISOString() };
    const one = row("99");
    expect(buildNotificationSnapshot({ owner: "u1", rows: [one], map: {}, entryFor: () => entry(one, expiredCode), now }).actionable).toEqual([]);
  });

  it("two accounts with the same thread id and title are two threads", () => {
    const a = row("1", { account: "a@x.com" }), b = row("1", { account: "b@x.com" });
    const snap = buildNotificationSnapshot({
      owner: "u1", rows: [a, b], map: {},
      entryFor: (acct) => entry(a, act("track", acct === "a@x.com" ? "https://ups.com/track?x=1" : "https://ups.com/track?x=2")),
    });
    expect(snap.actionable.map((t) => t.account).sort()).toEqual(["a@x.com", "b@x.com"]);
  });

  it("Unsubscribe is not offered for a needs-you thread or for a sender already asked from that account", () => {
    const a = row("1", { fromEmail: "news@trailweekly.com" });
    const un = act("unsubscribe");
    const base = { owner: "u1", rows: [a], entryFor: () => entry(a, un) };
    expect(buildNotificationSnapshot({ ...base, map: { "1": { bucket: "noise", gist: "", lastMsgId: a.lastMsgId } } }).actionable).toHaveLength(1);
    expect(buildNotificationSnapshot({ ...base, map: { "1": { bucket: "needs_you", gist: "", lastMsgId: a.lastMsgId } } }).actionable).toHaveLength(0);
    const asked = [{ sender: "news@trailweekly.com", askedISO: "2026-09-01", via: "header" as const, account: "me@x.com" }];
    expect(buildNotificationSnapshot({ ...base, map: {}, asked }).actionable).toHaveLength(0);
    expect(buildNotificationSnapshot({ ...base, map: {}, asked: [{ ...asked[0]!, account: "other@x.com" }] }).actionable).toHaveLength(1);
  });

  it("no code reaches the stored text, and a code mail with no single code is a View Email for a few minutes", () => {
    const r = row("1", { subject: `Your code ${CODE}`, snippet: `Your verification code is ${CODE}` });
    const snap = buildNotificationSnapshot({ owner: "u1", rows: [r], map: {}, entryFor: () => entry(r, null, { view: "code" }), now: r.dateMs + 60_000 });
    expect(snap.actionable).toHaveLength(1);
    expect(snap.actionable[0]!.action).toBeUndefined();
    expect(JSON.stringify(snap)).not.toContain(CODE);
    const later = buildNotificationSnapshot({ owner: "u1", rows: [r], map: {}, entryFor: () => entry(r, null, { view: "code" }), now: r.dateMs + 20 * 60e3 });
    expect(later.actionable).toEqual([]);
  });

  it("marks a bulk or no-reply sender so Today never offers Write Back", () => {
    const person = row("1", { fromEmail: "wei@x.com", snippet: "Can you send the roster?" });
    const bulk = row("2", { fromEmail: "wei@x.com" });
    const snap = buildNotificationSnapshot({ owner: "u1", rows: [person, bulk], map: {}, entryFor: (_a, id) => (id === "2" ? entry(bulk, null, { bulk: true }) : undefined) });
    expect(snap.fields(person).noReply).toBeUndefined();
    expect(snap.fields(bulk).noReply).toBe(true);
    expect(snap.fields(row("3")).noReply).toBe(true);
  });
});

beforeEach(() => forgetAllCodes());
