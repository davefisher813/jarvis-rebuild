// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { loadNetted, saveNetted, netCandidates, guardLine, seedFirstRun, NET_DAYS, NET_MAX_PER_PASS } from "./safetyNet";
import type { ThreadRow } from "../connections/google/map";

const DAY = 86400000;
const NOW = 1785900000000;

function row(id: string, ageDays: number): ThreadRow {
  return {
    id, from: "Tucci", fromEmail: "t@x.com", subject: "Waiver", snippet: "",
    unread: true, inInbox: true, dateMs: NOW - ageDays * DAY, count: 1, lastMsgId: id + "m",
  };
}

describe("email safety net", () => {
  beforeEach(() => localStorage.clear());

  it("catches only threads that have needed him longer than the window, oldest first", () => {
    const rows = [row("fresh", 1), row("edge", NET_DAYS), row("old", 9)];
    const got = netCandidates(rows, [], NOW).map((r) => r.id);
    expect(got).toEqual(["old", "edge"]);
  });

  it("never dumps the whole backlog in one pass", () => {
    const many = Array.from({ length: 30 }, (_, i) => row("t" + i, 10 + i));
    const got = netCandidates(many, [], NOW);
    expect(got).toHaveLength(NET_MAX_PER_PASS);
    expect(got[0]!.id).toBe("t29"); // the oldest of all of them
  });

  it("absorbs the existing backlog silently on the very first run", () => {
    const rows = [row("a", 9), row("b", 20)];
    expect(seedFirstRun(rows)).toBe(true);           // first ever: seeded
    expect(netCandidates(rows, loadNetted(), NOW)).toHaveLength(0);
    expect(seedFirstRun(rows)).toBe(false);          // never seeds twice
    // Something that goes stale AFTER the seed is still caught.
    const fresh = [row("c", 9)];
    expect(netCandidates(fresh, loadNetted(), NOW).map((r) => r.id)).toEqual(["c"]);
  });

  it("never nets the same thread twice, which is the whole point", () => {
    const rows = [row("old", 9)];
    expect(netCandidates(rows, [], NOW)).toHaveLength(1);
    expect(netCandidates(rows, ["old"], NOW)).toHaveLength(0);
  });

  it("ignores threads with no usable date rather than guessing", () => {
    const r = { ...row("nodate", 9), dateMs: 0 };
    expect(netCandidates([r], [], NOW)).toHaveLength(0);
  });

  it("round-trips the marker and survives a corrupt store", () => {
    saveNetted(["a", "b"]);
    expect(loadNetted()).toEqual(["a", "b"]);
    localStorage.setItem("jarvis.mail.netted.v1", "{not json");
    expect(loadNetted()).toEqual([]);
  });

  it("caps the marker without ever forgetting the newest ids", () => {
    const many = Array.from({ length: 400 }, (_, i) => "t" + i);
    saveNetted(many);
    const back = loadNetted();
    expect(back).toHaveLength(300);
    expect(back[back.length - 1]).toBe("t399");
  });

  it("derives the guard line, or renders nothing at all", () => {
    expect(guardLine(0)).toBe("");
    expect(guardLine(1)).toBe("1 email older than 3 days moved to your tasks.");
    expect(guardLine(4)).toBe("4 emails older than 3 days moved to your tasks.");
  });

  it("uses no shame vocabulary", () => {
    const line = guardLine(3).toLowerCase();
    for (const word of ["overdue", "ignored", "neglected", "failed", "behind", "still"]) {
      expect(line).not.toContain(word);
    }
  });
});
