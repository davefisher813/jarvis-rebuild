// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { NotesProvider } from "../data/NotesProvider";
import { useAIContext, useOptionalAIContext, todayISO } from "./useAIContext";

// Brain Personalization Phase 3. Both hooks funnel through one gatherFrom, so
// what is worth testing is the difference between them: what happens when the
// provider is not there.

describe("useOptionalAIContext", () => {
  it("resolves null instead of throwing when NotesProvider is absent", async () => {
    const { result } = renderHook(() => useOptionalAIContext());
    await expect(result.current()).resolves.toBeNull();
  });

  it("assembles the real context when the provider is there", async () => {
    const { result } = renderHook(() => useOptionalAIContext(), {
      wrapper: ({ children }) => <NotesProvider userId="u1">{children}</NotesProvider>,
    });
    await waitFor(async () => {
      const ctx = await result.current();
      expect(ctx).not.toBeNull();
      expect(typeof ctx!.name).toBe("string");
    });
  });
});

describe("useAIContext", () => {
  // The required version stays required: features that genuinely cannot work
  // without the user's data should fail loudly, not silently reason from a
  // blank profile.
  it("throws without NotesProvider, unchanged", () => {
    expect(() => renderHook(() => useAIContext())).toThrow();
  });
});

// B2-4 (2026-09-04): "the Notifications screen rolls over at 8 PM." This
// todayISO used to read UTC. Four other callers (Chat, Today's suggestions,
// Quick Capture, the Brain's strands page) share it, and Notifications used
// it as its only notion of today with nothing local to disagree with.
describe("todayISO", () => {
  it("reads the local calendar day, not UTC's", () => {
    const prevTz = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      // 11 PM Eastern on the 3rd is already the 4th in UTC.
      const d = new Date("2026-09-03T23:00:00-04:00");
      expect(todayISO(d)).toBe("2026-09-03");
    } finally {
      process.env.TZ = prevTz;
    }
  });
});
