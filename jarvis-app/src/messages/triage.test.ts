import { describe, it, expect } from "vitest";
import {
  buildTriageInput, parseTriage, fillSkipped, triageDelta,
  loadTriageCache, saveTriageCache, splitByBucket, headline, noiseLine,
  type TriageMap,
} from "./triage";
import type { ThreadRow } from "../connections/google/map";

const row = (id: string, from: string, subject: string, snippet = "", lastMsgId = id + "_m1"): ThreadRow =>
  ({ id, from, fromEmail: from.toLowerCase() + "@x.com", subject, snippet, unread: true, inInbox: true, dateMs: 1, count: 1, lastMsgId });

const ROWS = [
  row("t1", "Tucci", "Waiver", "Need the signed waiver by Friday"),
  row("t2", "Geico", "Renewal", "Your policy renews Aug 12 for $214"),
  row("t3", "DoorDash", "20% off", "Order now"),
];

describe("parseTriage", () => {
  it("parses a clean reply and keys the cache by latest message id", () => {
    const raw = JSON.stringify([
      { id: "t1", bucket: "needs_you", gist: "Tucci needs the waiver by Friday." },
      { id: "t3", bucket: "noise", gist: "DoorDash promo." },
    ]);
    const map = parseTriage(raw, ROWS)!;
    expect(map.t1).toEqual({ bucket: "needs_you", gist: "Tucci needs the waiver by Friday.", lastMsgId: "t1_m1" });
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
});

describe("triageDelta + cache", () => {
  it("only new or re-messaged threads go back to the model", () => {
    const cache: TriageMap = {
      t1: { bucket: "noise", gist: "old", lastMsgId: "t1_m1" },        // unchanged: cached
      t2: { bucket: "worth_knowing", gist: "old", lastMsgId: "STALE" }, // new message arrived: re-triage
    };
    expect(triageDelta(ROWS, cache).map((r) => r.id)).toEqual(["t2", "t3"]);
  });

  it("cache round-trips through storage and survives garbage", () => {
    let stored = "";
    const storage = { getItem: () => stored, setItem: (_k: string, v: string) => { stored = v; } };
    const map: TriageMap = { t1: { bucket: "needs_you", gist: "g", lastMsgId: "m" } };
    saveTriageCache(map, storage);
    expect(loadTriageCache(storage)).toEqual(map);
    stored = "{broken";
    expect(loadTriageCache(storage)).toEqual({});
    stored = JSON.stringify({ t9: { bucket: "explode", gist: 4 } });
    expect(loadTriageCache(storage)).toEqual({});
  });

  it("cache trims oldest-first at the cap", () => {
    let stored = "";
    const storage = { getItem: () => stored, setItem: (_k: string, v: string) => { stored = v; } };
    const big: TriageMap = {};
    for (let i = 0; i < 310; i++) big["t" + i] = { bucket: "noise", gist: "g", lastMsgId: "m" };
    saveTriageCache(big, storage);
    const back = loadTriageCache(storage);
    expect(Object.keys(back)).toHaveLength(300);
    expect(back.t9).toBeUndefined();
    expect(back.t309).toBeDefined();
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
    expect(headline(0, 0)).toBe("Inbox is quiet.");
    expect(headline(0, 12)).toBe("Nothing needs you. The rest is handled.");
    expect(headline(1, 12)).toBe("1 needs you. The rest is handled.");
    expect(headline(3, 12)).toBe("3 need you. The rest is handled.");
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
