// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { useEffect } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { NotesProvider, useBrainMemory, usePeople } from "../data/NotesProvider";
import type { BrainMemoryService } from "./brainMemoryService";
import type { PeopleService } from "../people/PeopleService";
import { useOptionalAIContext, gatherFiledMemory } from "./useAIContext";
import { contextToText, voiceToText } from "./context";
import { chatSystemPrompt } from "../chat/chatPrompt";

// Brain Manual v1 (2026-09-27): the central gatherer fetches LEARNED
// brain_memory rows, runs the pure memory assembler, and merges the filed
// sections into the context. Voice samples ride only draft gathers; the
// citation rule rides the instructions half, after the cache breakpoint;
// an empty brain degrades to the pre-brain prompt.

function Seed({ onDone }: { onDone: () => void }) {
  const brain = useBrainMemory();
  const people = usePeople();
  useEffect(() => {
    void (async () => {
      await people.create({ name: "Kevin Hart", group: "contacts", roles: ["comedian"] });
      await brain.file({ category: "decision", state: "LEARNED", text: "Always send the Hart proposal on Fridays", why: "Inbox is quiet", source: "manual-chat", date: "2026-09-20" });
      await brain.file({ category: "fact", state: "LEARNED", text: "Kevin Hart prefers short texts", source: "manual-chat" });
      await brain.file({ category: "voice", state: "LEARNED", text: "Hey, quick one for you", source: "manual-chat", wordCount: 5 });
      await brain.file({ category: "philosophy", state: "LEARNED", text: "Done beats perfect", source: "manual-chat" });
      onDone();
    })();
  }, [brain, people, onDone]);
  return null;
}

// Captures the real services so a test can call gatherFiledMemory directly.
function Capture({ onServices }: { onServices: (s: { brain: BrainMemoryService; people: PeopleService }) => void }) {
  const brain = useBrainMemory();
  const people = usePeople();
  useEffect(() => { onServices({ brain, people }); }, [brain, people, onServices]);
  return null;
}

function seeded(userId: string, extra?: React.ReactNode) {
  let done = false;
  let svc: { brain: BrainMemoryService; people: PeopleService } | null = null;
  const { result } = renderHook(() => useOptionalAIContext(), {
    wrapper: ({ children }) => (
      <NotesProvider userId={userId}>
        <Seed onDone={() => { done = true; }} />
        <Capture onServices={(s) => { svc = s; }} />
        {extra}
        {children}
      </NotesProvider>
    ),
  });
  return { result, isSeeded: () => done, services: () => svc };
}

describe("Brain Manual v1 filed-memory wiring", () => {
  it("chat gather: filed facts, decisions and philosophy join; voice samples stay out", async () => {
    const { result, isSeeded } = seeded("u-filed-chat");
    await waitFor(() => expect(isSeeded()).toBe(true));
    const ctx = await waitFor(async () => {
      const c = await result.current(undefined, { message: "Hart proposal Friday" });
      expect(c).not.toBeNull();
      return c!;
    });
    // Filed sections present.
    expect(ctx.facts ?? []).toContain("Kevin Hart prefers short texts");
    expect((ctx.decisions ?? []).some((d) => d.includes("Always send the Hart proposal on Fridays"))).toBe(true);
    expect(ctx.philosophy).toContain("Done beats perfect");
    // Voice samples never ride normal chat context.
    expect(ctx.voiceSamples ?? []).toEqual([]);
    const text = contextToText(ctx);
    expect(text).not.toContain("Hey, quick one for you");
  });

  it("draft gather: voice samples ride along", async () => {
    const { result, isSeeded } = seeded("u-filed-draft");
    await waitFor(() => expect(isSeeded()).toBe(true));
    const ctx = await waitFor(async () => {
      const c = await result.current(undefined, { message: "Hart proposal Friday", isDraft: true });
      expect(c).not.toBeNull();
      return c!;
    });
    expect(ctx.voiceSamples).toContain("Hey, quick one for you");
    const pack = voiceToText(ctx, { channel: "text" });
    expect(pack).toContain("Hey, quick one for you");
  });

  it("gatherFiledMemory: citation instruction is present only when the brain is non-empty", async () => {
    // Empty brain: no service, no rows, the instruction is the empty string.
    const empty = await gatherFiledMemory(null, [], { message: "Hart proposal Friday", isDraft: true });
    expect(empty.instructions).toBe("");
    // Non-empty brain: the same rows, read straight through gatherFiledMemory.
    const { isSeeded, services } = seeded("u-filed-instr");
    await waitFor(() => expect(isSeeded()).toBe(true));
    await waitFor(async () => {
      const svc = services();
      expect(svc).not.toBeNull();
      expect((await svc!.brain.list()).length).toBeGreaterThan(0);
    });
    const svc = services()!;
    const people = await svc.people.list();
    const filed = await gatherFiledMemory(svc.brain, people, { message: "Hart proposal Friday", isDraft: true });
    expect(filed.instructions).toContain("filed items above");
    expect(filed.fields.facts).toContain("Kevin Hart prefers short texts");
    expect(filed.fields.voiceSamples).toContain("Hey, quick one for you");
  });

  it("chatSystemPrompt: the citation rule lives in instructions, never in the cached context", () => {
    const withRule = chatSystemPrompt("the context text", "CITE RULE");
    expect(withRule.context).toBe("the context text");
    expect(withRule.instructions).toContain("CITE RULE");
    const baseline = chatSystemPrompt("the context text");
    expect(baseline.context).toBe("the context text");
    expect(baseline.instructions).not.toContain("CITE RULE");
  });
});
