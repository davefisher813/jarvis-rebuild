import { describe, it, expect } from "vitest";
import { sweepPrompt, parseSweep, needsSweep, liveSweep, loadSweep, saveSweep, type SentItem } from "./sentSweep";

const items: SentItem[] = [
  { threadId: "t1", to: "Rob", subject: "Deck", body: "I'll get you the deck Tuesday.", msgId: "m1" },
  { threadId: "t2", to: "Wei", subject: "Invoice", body: "Thanks, looks good.", msgId: "m2" },
];

describe("the promise sweep", () => {
  it("puts today in the prompt so a named day can be resolved", () => {
    expect(sweepPrompt(items, "2026-08-20")).toContain("Today is 2026-08-20");
    expect(sweepPrompt(items, "2026-08-20")).toContain("[0] to: Rob");
  });

  it("reads a clean answer", () => {
    const out = parseSweep('[{"i":0,"text":"Send Rob the Deck","due":"2026-08-25"}]', items);
    expect(out).toEqual([{ threadId: "t1", text: "Send Rob the Deck", due: "2026-08-25" }]);
  });

  it("an empty array is a correct answer", () => {
    expect(parseSweep("[]", items)).toEqual([]);
  });

  it("garbage means NO promises, never a guessed one", () => {
    expect(parseSweep("sure, here you go", items)).toEqual([]);
    expect(parseSweep("[{not json", items)).toEqual([]);
  });

  it("drops an index we never sent", () => {
    expect(parseSweep('[{"i":9,"text":"Do a thing"}]', items)).toEqual([]);
  });

  it("drops a made-up date rather than trusting it", () => {
    const out = parseSweep('[{"i":0,"text":"Send the deck","due":"sometime"}]', items);
    expect(out[0]!.due).toBeUndefined();
  });

  it("keeps one promise per thread", () => {
    const out = parseSweep('[{"i":0,"text":"Send the deck"},{"i":0,"text":"Also call him"}]', items);
    expect(out).toHaveLength(1);
  });

  it("refuses an empty or absurdly long task", () => {
    expect(parseSweep('[{"i":0,"text":"   "}]', items)).toEqual([]);
    expect(parseSweep(`[{"i":0,"text":"${"x".repeat(120)}"}]`, items)).toEqual([]);
  });

  it("costs nothing when no new mail has gone out", () => {
    const cache = { head: "m9", promises: [] };
    expect(needsSweep("m9", cache)).toBe(false);
    expect(needsSweep("m10", cache)).toBe(true);
    expect(needsSweep("", cache)).toBe(false);
  });

  it("drops a promise the catcher already turned into a task", () => {
    const cache = { head: "m9", promises: [{ threadId: "t1", text: "A" }, { threadId: "t2", text: "B" }] };
    expect(liveSweep(cache, ["t1"]).map((p) => p.threadId)).toEqual(["t2"]);
  });

  it("survives a corrupt cache", () => {
    expect(loadSweep({ getItem: () => "{" })).toEqual({ head: "", promises: [] });
  });

  it("round-trips", () => {
    let v: string | null = null;
    const st = { getItem: () => v, setItem: (_k: string, s: string) => { v = s; } };
    saveSweep({ head: "m1", promises: [{ threadId: "t1", text: "A" }] }, st);
    expect(loadSweep(st).promises).toHaveLength(1);
  });
});
