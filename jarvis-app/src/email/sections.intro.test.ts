// THE ONE-TIME USE GROUPED MAIL EXPLAINER, WHAT THE DEVICE REMEMBERS (issue 112, item 17; spec 2.2, AC01).
// "Shows once, dismissible, never shown again after dismissal": the flag is per person and per device, it only ever goes from
// not done to done, it is not the view choice (dismissing is not choosing), and a phone whose storage throws neither crashes
// nor keeps the card from being dismissed for the visit (the screen's own state does that; see EmailFlow.intro.test.tsx).
import { describe, it, expect } from "vitest";
import { loadGroupedIntroDone, loadView, saveGroupedIntroDone } from "./sections";

function mem(): Storage & { dump: () => Record<string, string> } {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0,
    dump: () => Object.fromEntries(m),
  } as Storage & { dump: () => Record<string, string> };
}

describe("the explainer's flag", () => {
  it("is not done until it is saved, and then it is done", () => {
    const s = mem();
    expect(loadGroupedIntroDone("u1", s)).toBe(false);
    saveGroupedIntroDone("u1", s);
    expect(loadGroupedIntroDone("u1", s)).toBe(true);
    // Saving again changes nothing: it never goes back.
    saveGroupedIntroDone("u1", s);
    expect(loadGroupedIntroDone("u1", s)).toBe(true);
  });

  it("is per person: another person signing in on this phone has not dealt with it", () => {
    const s = mem();
    saveGroupedIntroDone("u1", s);
    expect(loadGroupedIntroDone("u2", s)).toBe(false);
    expect(loadGroupedIntroDone("u1", s)).toBe(true);
  });

  it("is one key, versioned and scoped to the person, and it is not the view choice", () => {
    const s = mem();
    saveGroupedIntroDone("u1", s);
    expect(s.dump()).toEqual({ "jarvis.email.groupedIntro.v1:u1": "1" });
    // Dismissing the card is not choosing Grouped: the view still falls to its default, with nothing stored for it.
    expect(loadView("u1", s)).toBe("grouped");
    expect(s.getItem("jarvis.email.homeView.v1:u1")).toBeNull();
  });

  it("reads only the value it wrote: another value, or nothing, is not done", () => {
    const s = mem();
    s.setItem("jarvis.email.groupedIntro.v1:u1", "0");
    expect(loadGroupedIntroDone("u1", s)).toBe(false);
    s.setItem("jarvis.email.groupedIntro.v1:u1", "");
    expect(loadGroupedIntroDone("u1", s)).toBe(false);
  });

  it("a store that throws reads as not done, and saving into it does not throw", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(loadGroupedIntroDone("u1", broken)).toBe(false);
    expect(() => saveGroupedIntroDone("u1", broken)).not.toThrow();
  });

  it("no store at all (no localStorage on the page) is not done and does not throw", () => {
    expect(loadGroupedIntroDone("u1", null)).toBe(false);
    expect(() => saveGroupedIntroDone("u1", null)).not.toThrow();
  });
});
