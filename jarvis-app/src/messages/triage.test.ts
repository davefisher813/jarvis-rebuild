import { describe, it, expect } from "vitest";
import { selfBlankGuard,
  buildTriageInput, parseTriage, fillSkipped, triageDelta,
  loadTriageFor, saveTriageFor, isAnalysed, splitByBucket, headline, noiseLine,
  applyKnownPeople, knownSenderEmails,
  type TriageMap,
} from "./triage";
import type { ThreadRow } from "../connections/google/map";

const row = (id: string, from: string, subject: string, snippet = "", lastMsgId = id + "_m1"): ThreadRow =>
  ({ id, from, fromEmail: from.toLowerCase() + "@x.com", subject, snippet, unread: true, inInbox: true, dateMs: 1, count: 1, lastMsgId });

const ROWS = [
  row("t1", "Ridgeley", "Waiver", "Need the signed waiver by Friday"),
  row("t2", "Geico", "Renewal", "Your policy renews Aug 12 for $214"),
  row("t3", "DoorDash", "20% off", "Order now"),
];

describe("parseTriage", () => {
  it("parses a clean reply and keys the cache by latest message id", () => {
    const raw = JSON.stringify([
      { id: "t1", bucket: "needs_you", gist: "Ridgeley needs the waiver by Friday." },
      { id: "t3", bucket: "noise", gist: "DoorDash promo." },
    ]);
    const map = parseTriage(raw, ROWS)!;
    expect(map.t1).toEqual({ bucket: "needs_you", gist: "Ridgeley needs the waiver by Friday.", lastMsgId: "t1_m1" });
    expect(map.t3!.bucket).toBe("noise");
  });

  it("strips prose and fences, drops unknown ids, coerces bad buckets to worth_knowing", () => {
    const raw = "Sure!\n```json\n" + JSON.stringify([
      { id: "t1", bucket: "urgent!!", gist: "g" },
      { id: "ghost", bucket: "noise", gist: "g" },
    ]) + "\n```";
    const map = parseTriage(raw, ROWS)!;
    expect(map.t1!.bucket).toBe("worth_knowing");
    expect(map.ghost).toBeUndefined();
  });

  it("missing gist falls back to the snippet; never invents", () => {
    const map = parseTriage(JSON.stringify([{ id: "t2", bucket: "worth_knowing" }]), ROWS)!;
    expect(map.t2!.gist).toBe("Your policy renews Aug 12 for $214");
  });

  it("returns null for garbage rather than fabricating a triage", () => {
    expect(parseTriage("I could not do that.", ROWS)).toBeNull();
    expect(parseTriage("[]", ROWS)).toBeNull();
    expect(parseTriage("{broken", ROWS)).toBeNull();
  });
});

describe("fillSkipped", () => {
  it("a thread the model skipped is surfaced as worth_knowing, never hidden", () => {
    const map = fillSkipped({ t1: { bucket: "needs_you", gist: "g", lastMsgId: "t1_m1" } }, ROWS);
    expect(map.t2!.bucket).toBe("worth_knowing");
    expect(map.t2!.gist).toBe("Your policy renews Aug 12 for $214");
    expect(map.t1!.bucket).toBe("needs_you"); // untouched
  });

  it("but it is a FALLBACK: flagged, so it never passes for an answer", () => {
    const map = fillSkipped({ t1: { bucket: "needs_you", gist: "g", lastMsgId: "t1_m1" } }, ROWS);
    expect(map.t2!.fallback).toBe(true);
    expect(isAnalysed(map.t2)).toBe(false);
    expect(isAnalysed(map.t1)).toBe(true);
  });

  it("counts its attempts, and never overwrites a real answer for the same content", () => {
    const once = fillSkipped({}, ROWS);
    expect(once.t2!.tries).toBe(1);
    expect(fillSkipped(once, ROWS).t2!.tries).toBe(2);
    const real = { t2: { bucket: "noise" as const, gist: "real", lastMsgId: ROWS[1]!.lastMsgId } };
    expect(fillSkipped(real, ROWS).t2).toEqual(real.t2);
  });
});

describe("triageDelta + cache", () => {
  it("only new or re-messaged threads go back to the model", () => {
    const cache: TriageMap = {
      t1: { bucket: "noise", gist: "old", lastMsgId: "t1_m1" },        // unchanged: cached
      t2: { bucket: "worth_knowing", gist: "old", lastMsgId: "STALE" }, // new message arrived: re-triage
    };
    expect(triageDelta(ROWS, cache).map((r) => r.id)).toEqual(["t2", "t3"]);
  });

  it("a fallback is offered again only when a retry is due, and only while it has tries left", () => {
    const fb = (tries: number): TriageMap => ({ t1: { bucket: "worth_knowing", gist: "g", lastMsgId: "t1_m1", fallback: true, tries } });
    expect(triageDelta([ROWS[0]!], fb(1)).map((r) => r.id)).toEqual([]);
    expect(triageDelta([ROWS[0]!], fb(1), { retryFallback: true }).map((r) => r.id)).toEqual(["t1"]);
    expect(triageDelta([ROWS[0]!], fb(2), { retryFallback: true }).map((r) => r.id)).toEqual([]);
  });

  const SC = { userId: "u1", account: "me@example.com" };
  const store = () => { let stored = ""; return { get: () => stored, set: (v: string) => { stored = v; }, storage: { getItem: () => stored || null, setItem: (_k: string, v: string) => { stored = v; } } }; };

  it("cache round-trips through storage and survives garbage", () => {
    const st = store();
    const map: TriageMap = { t1: { bucket: "needs_you", gist: "g", lastMsgId: "m" } };
    saveTriageFor(SC, map, st.storage);
    expect(loadTriageFor(SC, st.storage)).toEqual(map);
    st.set("{broken");
    expect(loadTriageFor(SC, st.storage)).toEqual({});
    st.set(JSON.stringify({ v: 5, accounts: { [Object.keys(JSON.parse(JSON.stringify({ v: 5, accounts: {} })).accounts)[0] ?? "x"]: 1 } }));
    expect(loadTriageFor(SC, st.storage)).toEqual({});
  });

  it("entries that do not validate are dropped, and a fallback flag and tries survive the round trip", () => {
    const st = store();
    saveTriageFor(SC, {
      t1: { bucket: "worth_knowing", gist: "g", lastMsgId: "m", fallback: true, tries: 1 },
      t9: { bucket: "explode", gist: 4 } as never,
    }, st.storage);
    const back = loadTriageFor(SC, st.storage);
    expect(back.t9).toBeUndefined();
    expect(back.t1).toEqual({ bucket: "worth_knowing", gist: "g", lastMsgId: "m", fallback: true, tries: 1 });
  });

  it("is scoped: another account, or another owner, sees nothing", () => {
    const st = store();
    saveTriageFor(SC, { t1: { bucket: "noise", gist: "g", lastMsgId: "m" } }, st.storage);
    expect(loadTriageFor({ userId: "u1", account: "other@example.com" }, st.storage)).toEqual({});
    expect(loadTriageFor({ userId: "u2", account: SC.account }, st.storage)).toEqual({});
  });

  it("cache trims oldest-first at the cap", () => {
    const st = store();
    const big: TriageMap = {};
    for (let i = 0; i < 310; i++) big["t" + i] = { bucket: "noise", gist: "g", lastMsgId: "m" };
    saveTriageFor(SC, big, st.storage);
    const back = loadTriageFor(SC, st.storage);
    expect(Object.keys(back)).toHaveLength(300);
    expect(back.t9).toBeUndefined();
    expect(back.t309).toBeDefined();
  });

  it("keeps working in memory when storage refuses the write", () => {
    const full = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    saveTriageFor(SC, { t1: { bucket: "noise", gist: "g", lastMsgId: "m" } }, full);
    expect(loadTriageFor(SC, full).t1?.bucket).toBe("noise");
  });
});

describe("presentation", () => {
  it("splits by bucket with untriaged defaulting to worth_knowing", () => {
    const map: TriageMap = {
      t1: { bucket: "needs_you", gist: "g", lastMsgId: "m" },
      t3: { bucket: "noise", gist: "g", lastMsgId: "m" },
    };
    const s = splitByBucket(ROWS, map);
    expect(s.needsYou.map((r) => r.id)).toEqual(["t1"]);
    expect(s.worthKnowing.map((r) => r.id)).toEqual(["t2"]);
    expect(s.noise.map((r) => r.id)).toEqual(["t3"]);
  });

  it("headline counts what needs you, never unread", () => {
    // SPEC MOVED (short copy, 2026-08-15)
    // Casing sweep 3 (2026-09-27): Title Case by the whole rule (§H2); durations through shared/duration ("45 Min", "About 1 Min").
    expect(headline(0, 0)).toBe("Inbox Is Quiet");
    expect(headline(0, 12)).toBe("Nothing Needs You");
    expect(headline(1, 12)).toBe("1 Needs You · Rest Handled");
    expect(headline(3, 12)).toBe("3 Need You · Rest Handled");
  });

  it("noiseLine names senders without listing forever", () => {
    expect(noiseLine([row("a", "DoorDash", "s"), row("b", "LinkedIn", "s")])).toBe("DoorDash, LinkedIn");
    expect(noiseLine([
      row("a", "DoorDash", "s"), row("b", "LinkedIn", "s"), row("c", "Substack", "s"),
      row("d", "Nike", "s"), row("e", "Uber", "s"),
    ])).toBe("DoorDash, LinkedIn, Substack +2 more");
  });

  it("buildTriageInput ships only from/subject/snippet, snippet bounded", () => {
    const long = row("t9", "X", "S", "y".repeat(500));
    const input = buildTriageInput([long]);
    expect(input).toContain('"id":"t9"');
    expect(input).not.toContain("y".repeat(201));
    expect(input).toContain("y".repeat(200));
  });
});

describe("a blank email from yourself never needs you", () => {
  const row = (id: string, fromEmail: string, subject: string, snippet: string) =>
    ({ id, from: "David Fisher", fromEmail, subject, snippet, unread: true, inInbox: true, dateMs: 1, count: 1, lastMsgId: "m" + id });
  const needs = (id: string) => ({ [id]: { bucket: "needs_you" as const, gist: "David Fisher emailed with no subject or content.", lastMsgId: "m" + id } });

  it("demotes it to worth knowing with an honest gist", () => {
    const r = row("a", "dfisher2424@icloud.com", "", "  ");
    const out = selfBlankGuard(needs("a"), [r as never], ["DFisher2424@icloud.com"]);
    expect(out.a!.bucket).toBe("worth_knowing");
    expect(out.a!.gist).toBe("A blank note from you");
  });

  it("[edge] a blank email from someone ELSE is untouched: silence can be a signal", () => {
    const r = row("b", "wei@bffsa.org", "", "");
    const out = selfBlankGuard(needs("b"), [r as never], ["dfisher2424@icloud.com"]);
    expect(out.b!.bucket).toBe("needs_you");
  });

  it("[edge] your own mail WITH content is untouched", () => {
    const r = row("c", "dfisher2424@icloud.com", "Waiver", "");
    const out = selfBlankGuard(needs("c"), [r as never], ["dfisher2424@icloud.com"]);
    expect(out.c!.bucket).toBe("needs_you");
  });

  it("[edge] no known addresses means no guessing", () => {
    const r = row("d", "dfisher2424@icloud.com", "", "");
    const out = selfBlankGuard(needs("d"), [r as never], []);
    expect(out.d!.bucket).toBe("needs_you");
  });
});

// S2-6 (2026-09-04): "Triage never learns who matters." No AI tokens, works
// with AI off, and cannot be steered by anything the email itself says.
describe("applyKnownPeople", () => {
  const noise = (id: string): TriageMap => ({ [id]: { bucket: "noise", gist: "g", lastMsgId: "m" + id } });

  it("knownSenderEmails keeps only people with BOTH an email and a relationship", () => {
    const set = knownSenderEmails([
      { email: "Sister@X.com", relationship: "Sister" }, // case folds
      { email: "stranger@x.com" }, // no relationship: not "known" in this sense
      { relationship: "Client" }, // no email: nothing to match a sender against
      { email: "", relationship: "Friend" }, // blank email
      { email: "nobody@x.com", relationship: "   " }, // blank relationship
    ]);
    expect(set).toEqual(new Set(["sister@x.com"]));
  });

  it("rescues a known sender's noise into worth_knowing", () => {
    const r = row("t1", "Sister", "Hey");
    const out = applyKnownPeople(noise("t1"), [r], new Set(["sister@x.com"]));
    expect(out.t1!.bucket).toBe("worth_knowing");
    expect(out.t1!.gist).toBe("g"); // the gist survives, same as every other rule/vip pass
  });

  it("matches the sender's address case-insensitively (the header itself, e.g. Gmail's From, can be mixed-case)", () => {
    const r = { ...row("t1", "Sister", "Hey"), fromEmail: "Sister@X.com" };
    const out = applyKnownPeople(noise("t1"), [r], new Set(["sister@x.com"]));
    expect(out.t1!.bucket).toBe("worth_knowing");
  });

  it("[edge] a known sender who was NOT sorted to noise is untouched", () => {
    const r = row("t1", "Sister", "Hey");
    const already: TriageMap = { t1: { bucket: "needs_you", gist: "g", lastMsgId: "mt1" } };
    expect(applyKnownPeople(already, [r], new Set(["sister@x.com"])).t1!.bucket).toBe("needs_you");
  });

  it("[edge] only ever promotes to worth_knowing, never all the way to needs_you", () => {
    const r = row("t1", "Sister", "Hey");
    const out = applyKnownPeople(noise("t1"), [r], new Set(["sister@x.com"]));
    expect(out.t1!.bucket).not.toBe("needs_you");
  });

  it("[edge] a stranger stays noise", () => {
    const r = row("t1", "DoorDash", "20% off");
    expect(applyKnownPeople(noise("t1"), [r], new Set(["sister@x.com"])).t1!.bucket).toBe("noise");
  });

  it("[edge] no known senders is a no-op, same map reference back", () => {
    const map = noise("t1");
    expect(applyKnownPeople(map, [row("t1", "Sister", "Hey")], new Set())).toBe(map);
  });
});

// 2026-09-29: the optional action kind, and a code never reaching a model.
describe("the optional notification kind", () => {
  const withKind = (kind: unknown) => JSON.stringify([{ id: "t1", bucket: "noise", gist: "Share", action: kind }]);

  it("keeps a kind from the list and drops anything else", () => {
    expect(parseTriage(withKind("open_share"), ROWS)!.t1!.action).toBe("open_share");
    expect(parseTriage(withKind("pay_now"), ROWS)!.t1!.action).toBeUndefined();
    expect(parseTriage(withKind("https://evil.example/x"), ROWS)!.t1!.action).toBeUndefined();
    expect(parseTriage(withKind(42), ROWS)!.t1!.action).toBeUndefined();
    expect("action" in parseTriage(JSON.stringify([{ id: "t1", bucket: "noise", gist: "x" }]), ROWS)!.t1!).toBe(false);
  });

  it("survives the cache, and an entry cached before it reads as it did", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
    const scope = { userId: "u1", account: "a@x.com" };
    saveTriageFor(scope, { t1: { bucket: "noise", gist: "Share", lastMsgId: "t1_m1", action: "open_share" }, t2: { bucket: "noise", gist: "Old", lastMsgId: "t2_m1" } }, storage);
    const back = loadTriageFor(scope, storage);
    expect(back.t1!.action).toBe("open_share");
    expect(back.t2).toEqual({ bucket: "noise", gist: "Old", lastMsgId: "t2_m1" });
  });

  it("asks for a kind and never for a link or a code", () => {
    const input = buildTriageInput(ROWS);
    expect(input).toMatch(/"action"/);
    expect(input).toMatch(/never write a link, an address or a code/);
  });
});

describe("a code never reaches the model", () => {
  const codeRow = row("t9", "Acme", "Your verification code is 004291", "Your verification code is 004291. It expires in 10 minutes.");
  it("is blanked from the subject and the snippet before anything is sent", () => {
    const input = buildTriageInput([codeRow, row("t8", "Geico", "Renewal", "Your policy renews Aug 12 for $2400")]);
    expect(input).not.toContain("004291");
    expect(input).toContain("$2400"); // an amount is not a code
  });
  it("is blanked from a gist the model echoed and from a fallback gist", () => {
    const echoed = parseTriage(JSON.stringify([{ id: "t9", bucket: "noise", gist: "Code 004291" }]), [codeRow])!;
    expect(echoed.t9!.gist).not.toContain("004291");
    const skipped = parseTriage(JSON.stringify([{ id: "t9", bucket: "noise", gist: "" }]), [codeRow])!;
    expect(skipped.t9!.gist).not.toContain("004291");
    expect(fillSkipped({}, [codeRow]).t9!.gist).not.toContain("004291");
  });
});
