import { describe, it, expect, vi } from "vitest";
import { verbatimIn, evidenceIn, locateSpan, parseEvidence, anchorClaims, EVIDENCE_SYSTEM } from "./evidence";
import { anchorNeedsYou, needsAnchor } from "./evidencePass";
import { parseTriage } from "./triage";
import type { TriageMap } from "./triage";
import type { ThreadRow } from "../connections/google/map";

// UP-MIND-12. The whole feature is one promise: a claim either shows the
// sentence it came from, character for character, or shows nothing. So these
// tests are mostly about refusal.

const MSGS = [
  { id: "m1", body: "Hi Dave,\nWe need the signed waiver back by Friday.\nThanks, Nadia" },
  { id: "m2", body: "Following up. The invoice is $2,400 and is due on the 9th." },
];

describe("verbatim anchoring", () => {
  it("accepts a sentence that is really in the body, whatever the line breaks", () => {
    expect(verbatimIn("We need the signed   waiver back by Friday.", MSGS[0]!.body)).toBe(true);
  });

  it("refuses a sentence the model drifted a word on", () => {
    expect(verbatimIn("We need the signed waiver back by Thursday.", MSGS[0]!.body)).toBe(false);
  });

  it("refuses an empty span", () => {
    expect(verbatimIn("   ", MSGS[0]!.body)).toBe(false);
  });

  it("names the message the span was found in", () => {
    const ev = evidenceIn("The invoice is $2,400", MSGS)!;
    expect(ev.sourceMsgId).toBe("m2");
    expect(ev.confidence).toBe("high");
  });

  it("returns null rather than a low-confidence guess when nothing matches", () => {
    expect(evidenceIn("Forward this to collections", MSGS)).toBeNull();
  });
});

describe("the free half", () => {
  // The sender's deadline phrase was copied out of the email by triage, so
  // the sentence around it is findable without spending a model call.
  it("finds the whole sentence around the sender's own phrase", () => {
    const ev = locateSpan("Friday", MSGS)!;
    expect(ev.span).toBe("We need the signed waiver back by Friday.");
    expect(ev.sourceMsgId).toBe("m1");
  });

  it("prefers the newest message when a phrase appears twice", () => {
    const msgs = [
      { id: "a", body: "Can you send it by Friday?" },
      { id: "b", body: "Still need it by Friday please." },
    ];
    expect(locateSpan("Friday", msgs)!.sourceMsgId).toBe("b");
  });

  it("refuses a phrase too short to mean anything", () => {
    expect(locateSpan("by", MSGS)).toBeNull();
  });
});

describe("the model half", () => {
  it("drops a quote that is not in the thread", () => {
    const out = parseEvidence(JSON.stringify({ by: "You must forward this immediately." }), MSGS);
    expect(out).toEqual({});
  });

  it("keeps a quote that is", () => {
    const out = parseEvidence(JSON.stringify({ by: "We need the signed waiver back by Friday." }), MSGS);
    expect(out.by?.sourceMsgId).toBe("m1");
  });

  it("survives prose around the JSON, and refuses prose alone", () => {
    expect(parseEvidence("Sure! Here you go: {\"by\":\"We need the signed waiver back by Friday.\"}", MSGS).by).toBeTruthy();
    expect(parseEvidence("I could not find it.", MSGS)).toEqual({});
  });

  it("tells the model the thread is untrusted", () => {
    expect(EVIDENCE_SYSTEM).toContain("untrusted content");
  });
});

describe("the pass", () => {
  it("spends nothing when the free half already found the sentence", async () => {
    const complete = vi.fn(async () => "{}");
    const out = await anchorClaims({ messages: MSGS, asks: [{ key: "by", phrase: "Friday" }], complete });
    expect(complete).not.toHaveBeenCalled();
    expect(out.by?.span).toContain("waiver");
  });

  it("asks the model only for what is still unanchored", async () => {
    const complete = vi.fn(async (messages: { role: string; content: string }[], system: string) => {
      void system;
      void messages;
      return JSON.stringify({ act: "The invoice is $2,400 and is due on the 9th." });
    });
    const out = await anchorClaims({
      messages: MSGS,
      asks: [{ key: "by", phrase: "Friday" }, { key: "act", phrase: "Invoice 2026-09-09" }],
      complete,
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]![0]![0]!.content).toContain("act: Invoice 2026-09-09");
    expect(complete.mock.calls[0]![0]![0]!.content).not.toContain("by: Friday");
    expect(out.act?.sourceMsgId).toBe("m2");
  });

  it("leaves the claim alone when nothing can anchor it", async () => {
    const out = await anchorClaims({ messages: MSGS, asks: [{ key: "by", phrase: "next century" }] });
    expect(out).toEqual({});
  });
});

describe("which threads get a full-body fetch", () => {
  const map: TriageMap = {
    a: { bucket: "needs_you", gist: "waiver", by: "Friday", lastMsgId: "m1" },
    b: { bucket: "worth_knowing", gist: "receipt", by: "Friday", lastMsgId: "m9" },
    c: { bucket: "needs_you", gist: "nothing owed", lastMsgId: "m8" },
  };

  it("only needs-you threads with an unanchored claim", () => {
    expect(needsAnchor(map, "a")).toBe(true);
    expect(needsAnchor(map, "b")).toBe(false);
    expect(needsAnchor(map, "c")).toBe(false);
  });

  it("fetches those, anchors them, and leaves the rest untouched", async () => {
    const fetched: string[] = [];
    const next = await anchorNeedsYou(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      map,
      async (id) => { fetched.push(id); return { id, messages: MSGS }; },
    );
    expect(fetched).toEqual(["a"]);
    expect(next.a!.byEv?.span).toContain("waiver");
    expect(next.b).toBe(map.b);
  });

  it("keeps the map it was given when a fetch fails", async () => {
    const next = await anchorNeedsYou([{ id: "a" }], map, async () => { throw new Error("offline"); });
    expect(next.a!.byEv).toBeUndefined();
  });

  it("stops at the cap, so a hundred needy threads are not a hundred fetches", async () => {
    const big: TriageMap = {};
    const rows: { id: string }[] = [];
    for (let i = 0; i < 20; i++) {
      big["t" + i] = { bucket: "needs_you", gist: "x", by: "Friday", lastMsgId: "m" + i };
      rows.push({ id: "t" + i });
    }
    let calls = 0;
    await anchorNeedsYou(rows, big, async (id) => { calls++; return { id, messages: MSGS }; });
    expect(calls).toBe(4);
  });
});

describe("triage's own spans", () => {
  const rows: ThreadRow[] = [{
    id: "t1", from: "Nadia", fromEmail: "n@x.com", subject: "Waiver",
    snippet: "We need the signed waiver back by Friday.",
    unread: true, inInbox: true, dateMs: 0, count: 1, lastMsgId: "m1",
  }];

  it("keeps a span the model copied out of the snippet it was shown", () => {
    const raw = JSON.stringify([{ id: "t1", bucket: "needs_you", gist: "waiver", by: "Friday", bySpan: "We need the signed waiver back by Friday." }]);
    expect(parseTriage(raw, rows)!.t1!.byEv?.sourceMsgId).toBe("m1");
  });

  it("drops a span the model wrote rather than copied", () => {
    const raw = JSON.stringify([{ id: "t1", bucket: "needs_you", gist: "waiver", by: "Friday", bySpan: "Nadia says the waiver is due Friday." }]);
    expect(parseTriage(raw, rows)!.t1!.byEv).toBeUndefined();
  });
});
