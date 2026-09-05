import { describe, it, expect } from "vitest";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import { mapThreadFull, type GmailThreadMeta, type GmailThreadFull } from "../connections/google/map";
import { fullThreadsFor } from "./sentBodies";
import { parseSaid } from "./saidWhat";

// EMAIL-F-03 (2026-09-05): the fixture is exactly what api.ts's
// fetchThreadMetas returns for a search hit: format=metadata, headers and a
// snippet, no parts, no body data.
const META: GmailThreadMeta = {
  id: "t1",
  messages: [{
    id: "m1", snippet: "I will send the invoice Friday", labelIds: ["SENT"], internalDate: "1756000000000",
    payload: { headers: [
      { name: "From", value: "Dave <dave@x.com>" }, { name: "To", value: "Wei <wei@x.com>" },
      { name: "Subject", value: "Invoice" }, { name: "Date", value: "Mon, 24 Aug 2026 10:00:00 -0400" },
    ] },
  }],
};

const FULL: GmailThreadFull = {
  id: "t1",
  messages: [{
    id: "m1", threadId: "t1", snippet: "", internalDate: "1756000000000",
    payload: {
      mimeType: "text/plain", body: { data: btoa("Hi Wei. I will send the invoice Friday. Thanks, Dave") },
      headers: [
        { name: "From", value: "Dave <dave@x.com>" }, { name: "To", value: "Wei <wei@x.com>" },
        { name: "Subject", value: "Invoice" }, { name: "Date", value: "Mon, 24 Aug 2026 10:00:00 -0400" },
        { name: "Message-ID", value: "<a@x>" },
      ],
    },
  }],
};

describe("sentBodies: search hits have no bodies until the thread is fetched", () => {
  it("the bug: a metadata-shaped hit mapped as a full thread has an empty body, so a correct quote finds nothing", () => {
    const full = mapThreadFull(META as unknown as GmailThreadFull);
    expect(full.messages[0]!.body).toBe("");
    const items = [{ subject: full.subject, dateISO: "2026-08-24", threadId: full.id, body: full.messages[0]!.body }];
    expect(parseSaid(JSON.stringify([{ i: 0, quote: "I will send the invoice Friday." }]), items)).toEqual([]);
  });

  it("fullThreadsFor fetches the real thread per hit, and the same quote is then found", async () => {
    const fetched: string[] = [];
    const api = makeFakeGoogleApi({ getThread: async (id) => { fetched.push(id); return FULL; } });
    const fulls = await fullThreadsFor(api, [META]);
    expect(fetched).toEqual(["t1"]);
    expect(fulls[0]!.messages[0]!.body).toContain("I will send the invoice Friday");
    expect(fulls[0]!.messages[0]!.to).toBe("Wei <wei@x.com>");
    const items = fulls.map((f) => ({ subject: f.subject, dateISO: "2026-08-24", threadId: f.id, body: f.messages[0]!.body }));
    const hits = parseSaid(JSON.stringify([{ i: 0, quote: "I will send the invoice Friday." }]), items);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.quote).toBe("I will send the invoice Friday.");
  });

  it("is bounded: at most the cap is fetched, however many hits came back", async () => {
    let n = 0;
    const api = makeFakeGoogleApi({ getThread: async (id) => { n += 1; return { ...FULL, id }; } });
    const metas = Array.from({ length: 12 }, (_, i) => ({ ...META, id: "t" + i }));
    const fulls = await fullThreadsFor(api, metas);
    expect(n).toBe(8);
    expect(fulls).toHaveLength(8);
  });

  it("one thread that fails or hangs is dropped; the rest still come back", async () => {
    const api = makeFakeGoogleApi({
      getThread: async (id) => {
        if (id === "bad") throw new Error("thread 500");
        if (id === "slow") return new Promise<GmailThreadFull>(() => {});
        return { ...FULL, id };
      },
    });
    const fulls = await fullThreadsFor(api, [{ id: "bad" }, { id: "slow" }, { id: "ok" }], 8, 50);
    expect(fulls.map((f) => f.id)).toEqual(["ok"]);
  });
});
