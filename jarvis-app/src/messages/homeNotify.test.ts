// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  mailNotices, residualLine, loadMailSnapshot, saveMailSnapshot, loadDismissed, dismissNotice, findThread,
  threadIsNoReply, type MailSnapshot, type MailThread,
} from "./home";
import { loadSnoozes, scopedNoticeKey, snoozeNotice } from "./snoozeNotice";
import { ACTION_LABEL } from "./notificationActions";
import type { NotificationAction } from "./mailContracts";

const TODAY = "2026-09-29";
const NOW = new Date("2026-09-29T09:00:00");

const snap = (over: Partial<MailSnapshot> = {}): MailSnapshot => ({
  ts: NOW.getTime(), owner: "u1", needsYou: 0, threads: [], waiting: [], promises: [], actionable: [], ...over,
});
const person = (id: string, over: Partial<MailThread> = {}): MailThread => ({
  id, from: "Wei Chen", fromEmail: "wei@northlake.org", subject: "Roster " + id, gist: "Needs the roster " + id,
  account: "me@x.com", lastMsgId: "m" + id, revision: "m" + id, ...over,
});
const act = (kind: NotificationAction["kind"], url?: string, over: Partial<NotificationAction> = {}): NotificationAction => ({
  kind, evidence: { sourceMessageId: "m", sourceRevision: "m" }, ...(url ? { url } : {}), ...over,
});
const note = (id: string, action: NotificationAction | undefined, over: Partial<MailThread> = {}): MailThread => ({
  id, from: "Sender " + id, fromEmail: "no-reply@sender" + id + ".com", subject: "Subject " + id, gist: "Gist " + id,
  account: "me@x.com", lastMsgId: "m" + id, revision: "m" + id, noReply: true, ...(action ? { action } : {}), ...over,
});

const URL_BY_KIND: Record<NotificationAction["kind"], string | undefined> = {
  grant_access: "https://docs.google.com/document/d/1/edit", open_share: "https://docs.google.com/document/d/1/edit",
  accept_invite: "https://calendar.google.com/calendar/event?action=VIEW&eid=1", sign: "https://na3.docusign.net/Signing/x",
  track: "https://ups.com/track?x=1", add_travel: undefined, fill_form: "https://docs.google.com/forms/d/e/1/viewform",
  fix_payment: "https://netflix.com/billing", copy_code: undefined, unsubscribe: undefined,
};

beforeEach(() => localStorage.clear());

describe("no Write Back for a mailbox nobody reads", () => {
  it("a no-reply needs-you thread gets View Email, never Reply", () => {
    const n = mailNotices(snap({ needsYou: 1, threads: [person("1", { fromEmail: "no-reply@acme.com", from: "Acme" })] }), TODAY, NOW);
    expect(n).toHaveLength(1);
    expect(n[0]!.kind).toBe("notify");
    expect(n[0]!.action).toBe("View Email");
    expect(n[0]!.notification).toBeUndefined();
    expect(n.some((x) => x.kind === "reply")).toBe(false);
  });
  it("a bulk sender the snapshot flagged is the same, whatever its address", () => {
    const t = person("1", { noReply: true, fromEmail: "sam@northlake.org" });
    expect(threadIsNoReply(t)).toBe(true);
    expect(mailNotices(snap({ needsYou: 1, threads: [t] }), TODAY, NOW).map((n) => n.action)).toEqual(["View Email"]);
  });
  it("a person still gets Reply", () => {
    expect(mailNotices(snap({ needsYou: 1, threads: [person("1")] }), TODAY, NOW).map((n) => n.action)).toEqual(["Reply"]);
  });
  it("a snapshot from before the flag is judged by its address and its opening words", () => {
    expect(threadIsNoReply(person("1", { fromEmail: "donotreply@x.com" }))).toBe(true);
    expect(threadIsNoReply(person("2", { snippet: "This is an automated message. Do not reply." }))).toBe(true);
    expect(threadIsNoReply(person("3"))).toBe(false);
  });
  it("a no-reply thread that has a deadline still shows the deadline, and no reply beside it", () => {
    const n = mailNotices(snap({ needsYou: 1, threads: [person("1", { fromEmail: "no-reply@acme.com", by: "today" })] }), TODAY, NOW);
    expect(n.map((x) => x.kind)).toEqual(["deadline"]);
  });
});

describe("a specialised action supersedes the generic reply", () => {
  it("shows the action's label and not Reply for the same thread", () => {
    const t = person("1", { fromEmail: "dse@docusign.net", action: act("sign", URL_BY_KIND.sign) });
    const n = mailNotices(snap({ needsYou: 1, threads: [t] }), TODAY, NOW);
    expect(n.map((x) => [x.kind, x.action])).toEqual([["notify", "Sign"]]);
  });
  it("carries account, thread and revision, and the validated action", () => {
    const t = note("7", act("track", URL_BY_KIND.track));
    const [n] = mailNotices(snap({ actionable: [t] }), TODAY, NOW);
    expect(n).toMatchObject({ kind: "notify", threadId: "7", account: "me@x.com", revision: "m7", noReply: true, action: "Track" });
    expect(n!.notification!.url).toBe("https://ups.com/track?x=1");
  });
  it("uses the exact label for every kind", () => {
    for (const kind of Object.keys(ACTION_LABEL) as NotificationAction["kind"][]) {
      const [n] = mailNotices(snap({ actionable: [note("1", act(kind, URL_BY_KIND[kind]))] }), TODAY, NOW);
      expect(n!.action, kind).toBe(ACTION_LABEL[kind]);
    }
  });
  it("shows the destination host on Sign, Fix and Track and on nothing else", () => {
    const facts = (kind: NotificationAction["kind"]) => mailNotices(snap({ actionable: [note("1", act(kind, URL_BY_KIND[kind]))] }), TODAY, NOW)[0]!.facts;
    expect(facts("sign")![0]!.text).toBe("na3.docusign.net");
    expect(facts("fix_payment")![0]!.text).toBe("netflix.com");
    expect(facts("track")![0]!.text).toBe("ups.com");
    expect(facts("open_share")).toBeUndefined();
    expect(facts("grant_access")).toBeUndefined();
  });
});

describe("worth-knowing and noise notices surface, apart from the six rows", () => {
  it("an actionable thread that is not a needs-you row appears", () => {
    const n = mailNotices(snap({ needsYou: 1, threads: [person("1")], actionable: [note("2", act("open_share", URL_BY_KIND.open_share)), note("3", act("track", URL_BY_KIND.track))] }), TODAY, NOW, 10);
    expect(n.map((x) => x.threadId).sort()).toEqual(["1", "2", "3"]);
  });
  it("a thread in both lists is one notice", () => {
    const t = note("2", act("sign", URL_BY_KIND.sign));
    expect(mailNotices(snap({ needsYou: 1, threads: [t], actionable: [t] }), TODAY, NOW, 10)).toHaveLength(1);
  });
  it("an expired code is not offered; a code mail with no single code is View Email until its time", () => {
    const now = NOW.getTime();
    const gone = note("1", act("copy_code", undefined, { expiresAt: new Date(now - 1000).toISOString() }));
    const live = note("2", act("copy_code", undefined, { expiresAt: new Date(now + 60_000).toISOString() }), { from: "Acme" });
    expect(mailNotices(snap({ actionable: [gone, live] }), TODAY, NOW, 10).map((n) => n.threadId)).toEqual(["2"]);
    const view = note("3", undefined, { viewUntil: now + 60_000 });
    const [v] = mailNotices(snap({ actionable: [view] }), TODAY, NOW, 10);
    expect(v).toMatchObject({ kind: "notify", action: "View Email" });
    expect(mailNotices(snap({ actionable: [{ ...view, viewUntil: now - 1 }] }), TODAY, NOW, 10)).toEqual([]);
  });
  it("a thread with neither an action nor a view is not surfaced", () => {
    expect(mailNotices(snap({ actionable: [note("1", undefined)] }), TODAY, NOW, 10)).toEqual([]);
  });
});

describe("ranking and the visible limit still hold", () => {
  it("a stated deadline and a code come before a share and an unsubscribe", () => {
    const actionable = [
      note("u", act("unsubscribe")), note("s", act("open_share", URL_BY_KIND.open_share)),
      note("c", act("copy_code", undefined, { expiresAt: new Date(NOW.getTime() + 60_000).toISOString() })),
    ];
    const n = mailNotices(snap({ needsYou: 1, threads: [person("d", { by: "today" })], actionable }), TODAY, NOW, 10);
    expect(n.map((x) => x.threadId)).toEqual(["d", "c", "s", "u"]);
  });
  it("cuts at the limit, and the residual line counts the notifications the cut left out", () => {
    const actionable = [1, 2, 3, 4, 5].map((i) => note(String(i), act("track", `https://ups.com/track?x=${i}`)));
    const s = snap({ actionable });
    const shown = mailNotices(s, TODAY, NOW, 3);
    expect(shown).toHaveLength(3);
    const all = mailNotices(s, TODAY, NOW, 50);
    const cut = all.slice(3).filter((n) => n.kind === "notify").map((n) => n.threadId);
    expect(residualLine(s, shown.map((n) => n.threadId), cut)).toBe("2 More Emails in Your Inbox");
    expect(residualLine(s, shown.map((n) => n.threadId))).toBe("");
  });
});

describe("two things that read alike are not one thing", () => {
  it("the same title on two accounts is two notices", () => {
    const a = note("1", act("sign", URL_BY_KIND.sign), { account: "a@x.com", from: "DocuSign", gist: "Lease to sign" });
    const b = note("1", act("sign", URL_BY_KIND.sign), { account: "b@x.com", from: "DocuSign", gist: "Lease to sign" });
    const n = mailNotices(snap({ actionable: [a, b] }), TODAY, NOW, 10);
    expect(n).toHaveLength(2);
    expect(new Set(n.map((x) => x.key)).size).toBe(2);
    expect(n.map((x) => x.account).sort()).toEqual(["a@x.com", "b@x.com"]);
  });
  it("two messages from one sender with different links are two notices", () => {
    const one = note("1", act("track", "https://ups.com/track?x=1"), { from: "UPS", gist: "Package on its way" });
    const two = note("2", act("track", "https://ups.com/track?x=2"), { from: "UPS", gist: "Package on its way" });
    expect(mailNotices(snap({ actionable: [one, two] }), TODAY, NOW, 10)).toHaveLength(2);
  });
  it("two replies that read alike from two accounts are two cards; from one account they still collapse", () => {
    const a = person("1", { account: "a@x.com" }), b = person("2", { account: "b@x.com", subject: a.subject, gist: a.gist });
    expect(mailNotices(snap({ needsYou: 2, threads: [a, b] }), TODAY, NOW, 10)).toHaveLength(2);
    const twin = person("3", { account: "a@x.com", subject: a.subject, gist: a.gist });
    expect(mailNotices(snap({ needsYou: 2, threads: [a, twin] }), TODAY, NOW, 10)).toHaveLength(1);
  });
});

describe("dismiss and snooze are about one message, one mailbox, one ask", () => {
  const scope = { owner: "u1", account: "me@x.com", threadId: "t1", revision: "m1", kind: "copy_code" };
  it("differs in every part of the scope", () => {
    const keys = new Set([
      scopedNoticeKey(scope),
      scopedNoticeKey({ ...scope, owner: "u2" }),
      scopedNoticeKey({ ...scope, account: "other@x.com" }),
      scopedNoticeKey({ ...scope, threadId: "t2" }),
      scopedNoticeKey({ ...scope, revision: "m2" }),
      scopedNoticeKey({ ...scope, kind: "view" }),
    ]);
    expect(keys.size).toBe(6);
    expect(scopedNoticeKey({ ...scope, account: "ME@x.com " })).toBe(scopedNoticeKey(scope));
  });
  it("a separator inside a part cannot forge another key", () => {
    expect(scopedNoticeKey({ ...scope, threadId: "a:b", revision: "c" })).not.toBe(scopedNoticeKey({ ...scope, threadId: "a", revision: "b:c" }));
  });
  it("dismissing yesterday's code does not hide today's, even in the same thread", () => {
    const first = note("t1", act("copy_code", undefined, { expiresAt: new Date(NOW.getTime() + 60_000).toISOString() }), { revision: "m1", lastMsgId: "m1" });
    const [n1] = mailNotices(snap({ actionable: [first] }), TODAY, NOW, 10);
    dismissNotice(n1!.key, TODAY);
    expect(mailNotices(snap({ actionable: [first] }), TODAY, NOW, 10, loadDismissed(TODAY))).toEqual([]);
    const next = { ...first, revision: "m2", lastMsgId: "m2", action: act("copy_code", undefined, { expiresAt: new Date(NOW.getTime() + 60_000).toISOString() }) };
    const n2 = mailNotices(snap({ actionable: [next] }), TODAY, NOW, 10, loadDismissed(TODAY));
    expect(n2).toHaveLength(1);
    expect(n2[0]!.key).not.toBe(n1!.key);
  });
  it("a snooze is keyed the same way", () => {
    const t = note("t1", act("sign", URL_BY_KIND.sign));
    const [n] = mailNotices(snap({ actionable: [t] }), TODAY, NOW, 10);
    snoozeNotice(n!.key, "10:00", TODAY);
    expect(Object.keys(loadSnoozes(TODAY))).toEqual([n!.key]);
    const other = mailNotices(snap({ owner: "u2", actionable: [t] }), TODAY, NOW, 10)[0]!;
    expect(loadSnoozes(TODAY)[other.key]).toBeUndefined();
  });
  it("older notice keys are unchanged", () => {
    expect(mailNotices(snap({ needsYou: 1, threads: [person("1")] }), TODAY, NOW)[0]!.key).toBe("reply:1");
  });
});

describe("stored snapshots stay readable", () => {
  it("a snapshot from before any of this loads and renders as it did", () => {
    localStorage.setItem("jarvis.mail.home.v1", JSON.stringify({
      ts: Date.now(), needsYou: 1,
      threads: [{ id: "t1", from: "Nadia", fromEmail: "n@northlake.org", subject: "Invoice", gist: "Wants it", account: "me@x.com" }],
      waiting: [], promises: [],
    }));
    const s = loadMailSnapshot();
    expect(s.actionable).toEqual([]);
    expect(s.owner).toBeUndefined();
    expect(mailNotices(s, TODAY, new Date()).map((n) => n.action)).toEqual(["Reply"]);
  });
  it("round-trips an action, and drops one whose URL no longer validates", () => {
    const good = note("1", act("sign", URL_BY_KIND.sign));
    const bad = note("2", act("sign", "javascript:alert(1)"));
    saveMailSnapshot(snap({ ts: Date.now(), actionable: [good, bad] }));
    const s = loadMailSnapshot();
    expect(s.owner).toBe("u1");
    expect(s.actionable!.find((t) => t.id === "1")!.action).toEqual(good.action);
    expect(s.actionable!.find((t) => t.id === "2")!.action).toBeUndefined();
  });
  it("findThread finds an actionable thread, and the right account's when two share an id", () => {
    const a = note("1", act("track", "https://ups.com/track?x=1"), { account: "a@x.com" });
    const b = note("1", act("track", "https://ups.com/track?x=2"), { account: "b@x.com" });
    const s = snap({ actionable: [a, b] });
    expect(findThread(s, "1", "b@x.com")!.action!.url).toContain("x=2");
    expect(findThread(s, "1")!.account).toBe("a@x.com");
    expect(findThread(s, "nope")).toBeUndefined();
  });
});
