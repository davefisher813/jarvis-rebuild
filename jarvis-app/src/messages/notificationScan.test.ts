// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { AIService } from "../ai/AIService";
import { FakeMailbox } from "./fakeMailbox";
import { refreshInboxAccount, resetInboxRefreshState } from "./inboxRefresh";
import { refreshMailSnapshot } from "./snapshotRefresh";
import { loadMailSnapshot } from "./home";
import { loadTriageFor, saveTriageFor, type TriageMap } from "./triage";
import { forgetAllCodes, recallCode } from "./notificationActions";
import { isNotificationCandidate, loadNotificationEntries, scanNotifications } from "./notificationScan";
import {
  CODE, calendarInvite, docusign, driveShare, ICS_ONE, newsletterBoth, otp, otpTwoCodes,
} from "./notificationFixtures";

const SCOPE = { userId: "u1", account: "me@x.com" };
const from = (m: { from: string; fromEmail: string }) => `${m.from} <${m.fromEmail}>`;

// Every stored key this feature owns. The inbox row cache (jarvis.mail.acct.v2)
// is Gmail's own preview line kept so the Email tab paints at once, and is not
// part of what these tests answer for.
const ours = () => JSON.stringify(Object.fromEntries(Object.keys(localStorage).filter((k) => !k.startsWith("jarvis.mail.acct.v2")).map((k) => [k, localStorage.getItem(k)])));

beforeEach(() => { localStorage.clear(); resetInboxRefreshState(); forgetAllCodes(); });

function inbox(box: FakeMailbox) {
  box.add("wei", { from: "Wei <wei@x.com>", subject: "Lunch Thursday?", snippet: "Are you free for lunch", body: "Are you free for lunch on Thursday?" });
  box.add("code", { from: from(otp), subject: otp.subject, snippet: "Your verification code is " + CODE, body: otp.body });
  box.add("sign", { from: from(docusign), subject: docusign.subject, snippet: "review and sign", body: docusign.body, html: docusign.html });
  box.add("news", { from: from(newsletterBoth), subject: newsletterBoth.subject, snippet: "Ten routes for October", body: newsletterBoth.body, headers: { "List-Unsubscribe": newsletterBoth.listUnsubscribe! } });
  box.add("hello", { from: "Acme <no-reply@acme.com>", subject: "Welcome aboard", snippet: "Thanks for joining", body: "Thanks for joining. Nothing else to do." });
}

async function rowsOf(box: FakeMailbox, account = "me@x.com") {
  const r = await refreshInboxAccount({ userId: "u1", account }, box.api(), { reason: "manual" });
  return r.rows;
}

describe("scanNotifications: bodies only for likely notifications, answered once", () => {
  it("reads a body for machine mail and notification-shaped subjects, never for a person", async () => {
    const box = new FakeMailbox("me@x.com");
    inbox(box);
    const rows = await rowsOf(box);
    const res = await scanNotifications({ ...SCOPE, api: box.api(), rows, triage: {} });
    expect(box.counters.bodies).toBe(4); // code, sign, news, hello; not Wei
    expect(res).toMatchObject({ scanned: 4, reads: 4, failed: 0, wrote: true });
    const entries = loadNotificationEntries(SCOPE);
    expect(Object.keys(entries).sort()).toEqual(["code", "hello", "news", "sign"]);
    expect(entries.code!.action?.kind).toBe("copy_code");
    expect(entries.sign!.action?.kind).toBe("sign");
    expect(entries.news!.action?.kind).toBe("unsubscribe");
    expect(entries.news!.bulk).toBe(true);
  });

  it("caches 'nothing to do': a scan of the same inbox reads nothing", async () => {
    const box = new FakeMailbox("me@x.com");
    inbox(box);
    const rows = await rowsOf(box);
    await scanNotifications({ ...SCOPE, api: box.api(), rows, triage: {} });
    expect(loadNotificationEntries(SCOPE).hello!.action).toBeNull();
    box.counters.bodies = 0;
    const again = await scanNotifications({ ...SCOPE, api: box.api(), rows, triage: {} });
    expect(box.counters.bodies).toBe(0);
    expect(again).toMatchObject({ scanned: 0, reads: 0, wrote: false });
  });

  it("a newer message in a thread is read once; the older answer is never used for it", async () => {
    const box = new FakeMailbox("me@x.com");
    inbox(box);
    let rows = await rowsOf(box);
    await scanNotifications({ ...SCOPE, api: box.api(), rows, triage: {} });
    box.receive("code", { from: from(otp), snippet: "Your verification code is 118822", body: "Your verification code is 118822." });
    rows = await rowsOf(box);
    box.counters.bodies = 0;
    await scanNotifications({ ...SCOPE, api: box.api(), rows, triage: {} });
    expect(box.counters.bodies).toBe(1);
    const e = loadNotificationEntries(SCOPE).code!;
    expect(e.rev).toBe(rows.find((r) => r.id === "code")!.lastMsgId);
    expect(recallCode({ ...SCOPE, messageId: e.action!.evidence.sourceMessageId })).toBe("118822");
  });

  it("a read that fails is not cached as 'nothing to do': the thread is offered again", async () => {
    const box = new FakeMailbox("me@x.com");
    inbox(box);
    const rows = await rowsOf(box);
    let fail = true;
    const api = box.api({ getThread: async (id) => { if (fail && id === "sign") throw new Error("500"); return box.api().getThread(id); } });
    const first = await scanNotifications({ ...SCOPE, api, rows, triage: {} });
    expect(first.failed).toBe(1);
    expect(loadNotificationEntries(SCOPE).sign).toBeUndefined();
    fail = false;
    await scanNotifications({ ...SCOPE, api, rows, triage: {} });
    expect(loadNotificationEntries(SCOPE).sign!.action?.kind).toBe("sign");
  });

  it("the code is in memory and nowhere else: not in the cache, not in any storage", async () => {
    const box = new FakeMailbox("me@x.com");
    inbox(box);
    const rows = await rowsOf(box);
    await scanNotifications({ ...SCOPE, api: box.api(), rows, triage: {} });
    const id = loadNotificationEntries(SCOPE).code!.action!.evidence.sourceMessageId;
    expect(recallCode({ ...SCOPE, messageId: id })).toBe("004291");
    expect(ours()).not.toContain(CODE);
    expect(ours()).toContain("jarvis.mail.notify.v1");
  });

  it("two accounts with the same thread id and title keep separate answers", async () => {
    const a = new FakeMailbox("a@x.com");
    const b = new FakeMailbox("b@x.com");
    a.add("same", { from: from(docusign), subject: "Please DocuSign: Lease", snippet: "sign", body: "Please sign", html: '<a href="https://na3.docusign.net/Signing/EmailStart.aspx?a=A">REVIEW DOCUMENT</a>' });
    b.add("same", { from: from(docusign), subject: "Please DocuSign: Lease", snippet: "sign", body: "Please sign", html: '<a href="https://na3.docusign.net/Signing/EmailStart.aspx?a=B">REVIEW DOCUMENT</a>' });
    for (const [box, account] of [[a, "a@x.com"], [b, "b@x.com"]] as const) {
      const rows = await rowsOf(box, account);
      await scanNotifications({ userId: "u1", account, api: box.api(), rows, triage: {} });
    }
    expect(loadNotificationEntries({ userId: "u1", account: "a@x.com" }).same!.action!.url).toContain("a=A");
    expect(loadNotificationEntries({ userId: "u1", account: "b@x.com" }).same!.action!.url).toContain("a=B");
    expect(loadNotificationEntries({ userId: "u2", account: "a@x.com" })).toEqual({});
  });

  it("reads a calendar file inline for free and an attached one with one extra fetch", async () => {
    const inline = new FakeMailbox("me@x.com");
    inline.add("inv", { from: from(calendarInvite), subject: calendarInvite.subject, snippet: "invited", body: calendarInvite.body, html: calendarInvite.html, ics: ICS_ONE });
    await scanNotifications({ ...SCOPE, api: inline.api(), rows: await rowsOf(inline), triage: {} });
    expect(inline.attachmentReads).toBe(0);
    expect(loadNotificationEntries(SCOPE).inv!.action!.meeting?.title).toBe("Practice Plan");

    localStorage.clear(); resetInboxRefreshState();
    const attached = new FakeMailbox("me@x.com");
    attached.add("inv", { from: from(calendarInvite), subject: calendarInvite.subject, snippet: "invited", body: calendarInvite.body, html: calendarInvite.html, ics: ICS_ONE, icsAsAttachment: true });
    await scanNotifications({ ...SCOPE, api: attached.api(), rows: await rowsOf(attached), triage: {} });
    expect(attached.attachmentReads).toBe(1);
    expect(loadNotificationEntries(SCOPE).inv!.action!.meeting?.start).toBe("16:00");
  });

  it("is bounded per pass, newest first, and finishes on the next", async () => {
    const box = new FakeMailbox("me@x.com");
    for (let i = 1; i <= 5; i++) box.add("n" + i, { from: "Acme <no-reply@acme.com>", subject: "Notice " + i, snippet: "x", body: "Nothing to do" });
    const rows = await rowsOf(box);
    await scanNotifications({ ...SCOPE, api: box.api(), rows, triage: {}, limit: 2 });
    expect(Object.keys(loadNotificationEntries(SCOPE)).sort()).toEqual(["n4", "n5"]);
    await scanNotifications({ ...SCOPE, api: box.api(), rows, triage: {}, limit: 10 });
    expect(Object.keys(loadNotificationEntries(SCOPE))).toHaveLength(5);
  });

  it("the optional model reading is a kind and a link id from this message: a made-up id is dropped, and it needs no model to work", async () => {
    const box = new FakeMailbox("me@x.com");
    box.add("p", { from: "Shop <orders@shop.example.com>", subject: "Your order", snippet: "x", body: "Thanks for your order.", html: '<a href="https://shop.example.com/orders/5">Order</a><a href="https://shop.example.com/track/5?s=1">Track it</a><a href="https://evil.example/x">Offer</a>' });
    const rows = await rowsOf(box);
    // The triage kind is what made a person-shaped sender worth a body read.
    const hint: TriageMap = { p: { bucket: "worth_knowing", gist: "Order", lastMsgId: rows[0]!.lastMsgId, action: "track" } };
    const probe = await scanNotifications({ ...SCOPE, api: box.api(), rows, triage: hint, classificationFor: () => ({ kind: "track", linkId: "Linvented" }) });
    expect(probe.scanned).toBe(1);
    expect(loadNotificationEntries(SCOPE).p!.action).toBeNull();
    localStorage.clear(); resetInboxRefreshState();
    // The id the extractor gave the link is the only way to point at it.
    const { bundleFor } = await import("./notificationFixtures");
    const id = bundleFor({ threadId: "p", messageId: box.messageIdsOf("p")[0]!, fromEmail: "orders@shop.example.com", from: "Shop", subject: "Your order", body: "Thanks for your order.", html: '<a href="https://shop.example.com/orders/5">Order</a><a href="https://shop.example.com/track/5?s=1">Track it</a><a href="https://evil.example/x">Offer</a>' }).links.find((l) => l.text === "Track it")!.id;
    await scanNotifications({ ...SCOPE, api: box.api(), rows: await rowsOf(box), triage: hint, classificationFor: () => ({ kind: "track", linkId: id }) });
    expect(loadNotificationEntries(SCOPE).p!.action).toMatchObject({ kind: "track", url: "https://shop.example.com/track/5?s=1" });
    // A link on a host that is not the sender's is refused even with a real id.
    localStorage.clear(); resetInboxRefreshState();
    const evil = bundleFor({ threadId: "p", messageId: box.messageIdsOf("p")[0]!, fromEmail: "orders@shop.example.com", from: "Shop", subject: "Your order", body: "Thanks for your order.", html: '<a href="https://shop.example.com/orders/5">Order</a><a href="https://shop.example.com/track/5?s=1">Track it</a><a href="https://evil.example/x">Offer</a>' }).links.find((l) => l.text === "Offer")!.id;
    await scanNotifications({ ...SCOPE, api: box.api(), rows: await rowsOf(box), triage: hint, classificationFor: () => ({ kind: "track", linkId: evil }) });
    expect(loadNotificationEntries(SCOPE).p!.action).toBeNull();
  });

  it("an itinerary the brief read is used when the message has no calendar file", async () => {
    const box = new FakeMailbox("me@x.com");
    box.add("f", { from: "Delta <DeltaAirLines@e.delta.com>", subject: "Your flight itinerary", snippet: "x", body: "Flight DL 412 departs Oct 9 at 7:15 AM." });
    const rows = await rowsOf(box);
    const meeting = { id: "brief:1", sourceMessageId: "m", sourceQuote: "q", title: "DL 412", status: "agreed" as const, date: "2026-10-09", start: "07:15", missing: [], durationSource: "default" as const };
    await scanNotifications({ ...SCOPE, api: box.api(), rows, triage: {}, meetingsFor: () => [meeting] });
    expect(loadNotificationEntries(SCOPE).f!.action).toMatchObject({ kind: "add_travel", meeting: { id: "brief:1" } });
  });

  it("a thread that left the window takes its answer with it", async () => {
    const box = new FakeMailbox("me@x.com");
    inbox(box);
    await scanNotifications({ ...SCOPE, api: box.api(), rows: await rowsOf(box), triage: {} });
    box.archive("sign");
    await scanNotifications({ ...SCOPE, api: box.api(), rows: await rowsOf(box), triage: {} });
    expect(loadNotificationEntries(SCOPE).sign).toBeUndefined();
  });

  it("a triage kind makes a person's mail a candidate; a person's mail with none is not", () => {
    const row = { fromEmail: "ana@northlake.org", subject: "Hi", snippet: "Hello there" };
    expect(isNotificationCandidate(row)).toBe(false);
    expect(isNotificationCandidate(row, { action: "fill_form" })).toBe(true);
    expect(isNotificationCandidate({ ...row, subject: "Please sign the waiver" })).toBe(true);
    expect(isNotificationCandidate({ ...row, fromEmail: "drive-shares-noreply@google.com" })).toBe(true);
  });

  it("works with no model at all and never asks one", async () => {
    const box = new FakeMailbox("me@x.com");
    inbox(box);
    const complete = vi.fn();
    const ai = new AIService({ available: false });
    ai.complete = complete as never;
    await scanNotifications({ ...SCOPE, api: box.api(), rows: await rowsOf(box), triage: {} });
    expect(complete).not.toHaveBeenCalled();
    expect(loadNotificationEntries(SCOPE).sign!.action?.kind).toBe("sign");
  });
});

describe("the snapshot: a Today revisit costs nothing", () => {
  function countingAI(triage: (ids: string[]) => TriageMap | unknown[]) {
    const calls = { n: 0 };
    const ai = new AIService({
      available: true,
      getToken: () => "tok",
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        calls.n++;
        const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: { content: string }[] };
        const text = body.messages?.[0]?.content ?? "";
        const ids = [...text.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]!);
        return { ok: true, status: 200, json: async () => ({ text: JSON.stringify(triage(ids)) }), text: async () => "" };
      }) as unknown as typeof fetch,
    });
    return { ai, calls };
  }
  const TRIAGE: Record<string, { bucket: string; gist: string }> = {
    wei: { bucket: "needs_you", gist: "Lunch Thursday" },
    sign: { bucket: "worth_knowing", gist: "Lease to sign" },
    share: { bucket: "noise", gist: "Budget shared" },
    code: { bucket: "noise", gist: "Verification code" },
  };
  const answer = (ids: string[]) => ids.filter((i) => TRIAGE[i]).map((i) => ({ id: i, ...TRIAGE[i]! }));

  function seed(box: FakeMailbox) {
    box.add("wei", { from: "Wei <wei@x.com>", subject: "Lunch Thursday?", snippet: "Are you free", body: "Are you free for lunch?" });
    box.add("sign", { from: from(docusign), subject: docusign.subject, snippet: "review and sign", body: docusign.body, html: docusign.html });
    box.add("share", { from: from(driveShare), subject: driveShare.subject, snippet: "shared", body: driveShare.body, html: driveShare.html });
    box.add("code", { from: from(otp), subject: otp.subject, snippet: "Your verification code is " + CODE, body: otp.body, at: Date.now() });
  }

  it("a worth-knowing and a noise notice both surface, apart from the needs-you rows", async () => {
    const box = new FakeMailbox("me@x.com");
    seed(box);
    const { ai } = countingAI(answer);
    await refreshMailSnapshot({ userId: "u1", apis: () => [{ email: "me@x.com", api: box.api() }], ai });
    const snap = loadMailSnapshot();
    expect(snap.owner).toBe("u1");
    expect(snap.threads.map((t) => t.id)).toEqual(["wei"]);
    const byId = Object.fromEntries((snap.actionable ?? []).map((t) => [t.id, t]));
    expect(byId.sign!.action!.kind).toBe("sign");
    expect(byId.share!.action!.kind).toBe("open_share");
    for (const t of Object.values(byId)) {
      expect(t.account).toBe("me@x.com");
      expect(t.revision).toBe(t.lastMsgId);
    }
    // A Drive share comes from a no-reply address; a DocuSign does not, and
    // the button on it is its own action either way.
    expect(byId.share!.noReply).toBe(true);
    // The person's row is still a reply to a person, and says so.
    expect(snap.threads[0]!.noReply).toBeUndefined();
    expect(snap.threads[0]!.revision).toBeTruthy();
  });

  it("no code is in the stored snapshot, the triage cache or the model's prompt", async () => {
    const box = new FakeMailbox("me@x.com");
    seed(box);
    const prompts: string[] = [];
    const ai = new AIService({
      available: true, getToken: () => "tok",
      fetchImpl: (async (_u: string, init?: RequestInit) => {
        prompts.push(String(init?.body ?? ""));
        return { ok: true, status: 200, json: async () => ({ text: JSON.stringify([{ id: "code", bucket: "noise", gist: "Your code " + CODE }]) }), text: async () => "" };
      }) as unknown as typeof fetch,
    });
    await refreshMailSnapshot({ userId: "u1", apis: () => [{ email: "me@x.com", api: box.api() }], ai });
    expect(prompts.length).toBeGreaterThan(0);
    for (const p of prompts) expect(p).not.toContain(CODE);
    // A model that echoes the code into its own gist is redacted on the way in.
    expect(ours()).not.toContain(CODE);
    expect(loadMailSnapshot().actionable!.find((t) => t.id === "code")!.action!.kind).toBe("copy_code");
  });

  it("an unchanged revisit: zero AI calls and zero body refetches", async () => {
    const box = new FakeMailbox("me@x.com");
    seed(box);
    const { ai, calls } = countingAI(answer);
    const apis = () => [{ email: "me@x.com", api: box.api() }];
    await refreshMailSnapshot({ userId: "u1", apis, ai });
    const bodies = box.counters.bodies;
    const aiCalls = calls.n;
    expect(bodies).toBeGreaterThan(0);
    expect(aiCalls).toBeGreaterThan(0);
    const before = loadMailSnapshot().actionable!.map((t) => t.id).sort();
    await refreshMailSnapshot({ userId: "u1", apis, ai });
    await refreshMailSnapshot({ userId: "u1", apis, ai });
    expect(box.counters.bodies).toBe(bodies);
    expect(box.attachmentReads).toBe(0);
    expect(calls.n).toBe(aiCalls);
    expect(loadMailSnapshot().actionable!.map((t) => t.id).sort()).toEqual(before);
  });

  it("with AI unavailable the actions still appear, from the message alone", async () => {
    const box = new FakeMailbox("me@x.com");
    seed(box);
    await refreshMailSnapshot({ userId: "u1", apis: () => [{ email: "me@x.com", api: box.api() }], ai: new AIService({ available: false }) });
    const kinds = Object.fromEntries((loadMailSnapshot().actionable ?? []).map((t) => [t.id, t.action?.kind]));
    expect(kinds).toMatchObject({ sign: "sign", share: "open_share", code: "copy_code" });
  });

  it("one read per thread per pass: the anchor pass and the scan share it", async () => {
    const box = new FakeMailbox("me@x.com");
    box.add("sign", { from: from(docusign), subject: docusign.subject, snippet: "sign by Friday", body: docusign.body, html: docusign.html });
    const { ai } = countingAI((ids) => ids.map((id) => ({ id, bucket: "needs_you", gist: "Sign by Friday", by: "Friday" })));
    await refreshMailSnapshot({ userId: "u1", apis: () => [{ email: "me@x.com", api: box.api() }], ai });
    // The scan wanted the body (a DocuSign), and so did the deadline anchor (it has a "by"): one request.
    expect(box.counters.bodies).toBe(1);
  });

  it("a thread the tab already triaged is not re-sent to the model, and its notification is still read", async () => {
    const box = new FakeMailbox("me@x.com");
    seed(box);
    const rows = await rowsOf(box);
    const cache: TriageMap = {};
    for (const r of rows) cache[r.id] = { bucket: "noise", gist: "Cached", lastMsgId: r.lastMsgId };
    saveTriageFor(SCOPE, cache);
    const { ai, calls } = countingAI(answer);
    await refreshMailSnapshot({ userId: "u1", apis: () => [{ email: "me@x.com", api: box.api() }], ai });
    expect(calls.n).toBe(0);
    expect(loadTriageFor(SCOPE).sign!.gist).toBe("Cached");
    expect(loadMailSnapshot().actionable!.some((t) => t.id === "sign")).toBe(true);
  });

  it("a failed notification read never fails the snapshot", async () => {
    const box = new FakeMailbox("me@x.com");
    seed(box);
    const api = box.api({ getThread: async () => { throw new Error("500"); } });
    await refreshMailSnapshot({ userId: "u1", apis: () => [{ email: "me@x.com", api }], ai: new AIService({ available: false }) });
    expect(loadMailSnapshot().ts).toBeGreaterThan(0);
    expect(loadMailSnapshot().actionable).toEqual([]);
  });

  it("two accounts with the same thread id and title both surface", async () => {
    const a = new FakeMailbox("a@x.com");
    const b = new FakeMailbox("b@x.com");
    for (const [box, tok] of [[a, "A"], [b, "B"]] as const) {
      box.add("same", { from: from(docusign), subject: "Please DocuSign: Lease", snippet: "sign", body: "Please sign", html: `<a href="https://na3.docusign.net/Signing/EmailStart.aspx?a=${tok}">REVIEW DOCUMENT</a>` });
    }
    await refreshMailSnapshot({
      userId: "u1", ai: new AIService({ available: false }),
      apis: () => [{ email: "a@x.com", api: a.api() }, { email: "b@x.com", api: b.api() }],
    });
    const list = loadMailSnapshot().actionable!;
    expect(list.map((t) => t.account).sort()).toEqual(["a@x.com", "b@x.com"]);
    expect(list.map((t) => t.action!.url).sort()).toEqual([
      "https://na3.docusign.net/Signing/EmailStart.aspx?a=A", "https://na3.docusign.net/Signing/EmailStart.aspx?a=B",
    ]);
  });

  it("an ambiguous code mail surfaces as View Email for a few minutes, with no code stored", async () => {
    const box = new FakeMailbox("me@x.com");
    box.add("two", { from: from(otpTwoCodes), subject: otpTwoCodes.subject, snippet: "Your verification code is " + CODE, body: otpTwoCodes.body, at: Date.now() });
    await refreshMailSnapshot({ userId: "u1", apis: () => [{ email: "me@x.com", api: box.api() }], ai: new AIService({ available: false }) });
    const t = loadMailSnapshot().actionable!.find((x) => x.id === "two")!;
    expect(t.action).toBeUndefined();
    expect(t.viewUntil).toBeGreaterThan(Date.now());
    expect(JSON.stringify(localStorage.getItem("jarvis.mail.home.v1"))).not.toContain(CODE);
  });
});

describe("the anchor pass over full bodies", () => {
  it("never sends a code to the model", async () => {
    const { anchorNeedsYou } = await import("./evidencePass");
    const prompts: string[] = [];
    const map: TriageMap = { t1: { bucket: "needs_you", gist: "Confirm", by: "the 15th", lastMsgId: "m1" } };
    await anchorNeedsYou(
      [{ id: "t1", account: "me@x.com" }], map,
      async () => ({ id: "t1", messages: [{ id: "m1", body: `Your verification code is ${CODE}. Please confirm before the fifteenth.` }] }),
      async (messages) => { prompts.push(JSON.stringify(messages)); return "[]"; },
    );
    expect(prompts.length).toBeGreaterThan(0);
    for (const p of prompts) expect(p).not.toContain(CODE);
  });
});
