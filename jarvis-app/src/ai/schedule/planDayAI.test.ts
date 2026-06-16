import { describe, it, expect } from "vitest";
import { parseAIPlan, aiPlanDay } from "./planDayAI";

describe("parseAIPlan", () => {
  it("parses a clean JSON array, preserving order", () => {
    const r = parseAIPlan('[{"id":"a","minutes":30},{"id":"b","minutes":60}]', ["a", "b"]);
    expect(r).toEqual([{ id: "a", minutes: 30 }, { id: "b", minutes: 60 }]);
  });

  it("strips code fences", () => {
    const r = parseAIPlan('```json\n[{"id":"a","minutes":45}]\n```', ["a"]);
    expect(r).toEqual([{ id: "a", minutes: 45 }]);
  });

  it("drops unknown ids and rounds/clamps minutes to 5-min steps in 10-180", () => {
    const r = parseAIPlan('[{"id":"a","minutes":7},{"id":"zzz","minutes":30},{"id":"b","minutes":999}]', ["a", "b"]);
    expect(r).toEqual([{ id: "a", minutes: 10 }, { id: "b", minutes: 180 }]);
  });

  it("appends tasks the model dropped, so every pick is planned", () => {
    const r = parseAIPlan('[{"id":"b","minutes":30}]', ["a", "b"]);
    expect(r.map((x) => x.id).sort()).toEqual(["a", "b"]);
    expect(r.find((x) => x.id === "a")?.minutes).toBe(45);
  });

  it("falls back to all-defaults on non-JSON", () => {
    const r = parseAIPlan("sorry, I cannot do that", ["a", "b"]);
    expect(r).toEqual([{ id: "a", minutes: 45 }, { id: "b", minutes: 45 }]);
  });
});

const pick = (id: string) => ({ id, text: id, category: "", overdue: false });

describe("aiPlanDay", () => {
  it("returns parsed items on success", async () => {
    const ai = { complete: async () => '[{"id":"a","minutes":30}]' } as never;
    const r = await aiPlanDay(ai, [pick("a")], [], 540, 1260);
    expect(r).toEqual([{ id: "a", minutes: 30 }]);
  });

  it("propagates errors so the sheet can fall back to the simple plan", async () => {
    const ai = { complete: async () => { throw new Error("boom"); } } as never;
    await expect(aiPlanDay(ai, [pick("a")], [], 540, 1260)).rejects.toThrow();
  });

  it("rejects when the call exceeds the timeout, so the sheet falls back", async () => {
    const ai = { complete: () => new Promise<string>(() => { /* never resolves */ }) } as never;
    await expect(aiPlanDay(ai, [pick("a")], [], 540, 1260, 10)).rejects.toThrow(/timed out/);
  });
});
