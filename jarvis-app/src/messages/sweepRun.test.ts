// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { runSentSweep, SWEEP_CAP } from "./sweepRun";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import type { GmailThreadFull } from "../connections/google/map";
import { loadSweep } from "./sentSweep";

// 2026-09-11: with two accounts, the first account's eight filled the cap and
// the second was never read, and "anything new" only watched account one.

const account = (tag: string, n: number, headId = tag + "-m0") => makeFakeGoogleApi({
  searchThreads: async () => Array.from({ length: n }, (_, i) => ({ id: `${tag}-t${i}` })),
  getThread: async (id: string) => ({
    id,
    messages: [{
      id: id === `${tag}-t0` ? headId : id + "-m",
      payload: { headers: [
        { name: "From", value: "Me <me@x.com>" },
        { name: "To", value: "Sam <sam@x.com>" },
        { name: "Subject", value: "Subject " + id },
      ] },
    }],
  }) as GmailThreadFull,
});

beforeEach(() => localStorage.clear());

describe("runSentSweep across accounts", () => {
  it("shares the cap between accounts instead of taking the first one's eight", async () => {
    let prompt = "";
    await runSentSweep({
      apis: () => [{ email: "a@x.com", api: account("a", SWEEP_CAP) }, { email: "b@x.com", api: account("b", SWEEP_CAP) }],
      complete: async (messages) => { prompt = messages[0]!.content; return "[]"; },
    });
    const subjects = prompt.match(/subject: [^\n|]*Subject [ab]-t\d/g) ?? [];
    expect(subjects).toHaveLength(SWEEP_CAP);
    expect(subjects.filter((s) => s.includes("Subject a-")).length).toBe(SWEEP_CAP / 2);
    expect(subjects.filter((s) => s.includes("Subject b-")).length).toBe(SWEEP_CAP / 2);
  });

  it("sweeps again when only the second account has sent something new", async () => {
    let runs = 0;
    const complete = async () => { runs++; return "[]"; };
    const a = account("a", 2);
    await runSentSweep({ apis: () => [{ email: "a@x.com", api: a }, { email: "b@x.com", api: account("b", 2) }], complete });
    expect(runs).toBe(1);
    // Nothing new anywhere: no second AI call.
    expect(await runSentSweep({ apis: () => [{ email: "a@x.com", api: a }, { email: "b@x.com", api: account("b", 2) }], complete })).toBeNull();
    expect(runs).toBe(1);
    // Account b's newest message changed; account a's did not.
    await runSentSweep({ apis: () => [{ email: "a@x.com", api: a }, { email: "b@x.com", api: account("b", 2, "b-new") }], complete });
    expect(runs).toBe(2);
    expect(loadSweep().head).toContain("b-new");
  });
});
