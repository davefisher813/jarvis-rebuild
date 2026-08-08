// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { NotesProvider } from "../data/NotesProvider";
import { useAIContext, useOptionalAIContext } from "./useAIContext";

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
