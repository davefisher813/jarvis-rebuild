// Brain Manual v1 (Phase 1) — manual filing bypasses the AI Control gate.
// Flow doc §7, test 7 (manualBypassesApproval). Filing is a memory write
// the user initiated by tapping; it is never an AI action, so it needs no
// approval card at any AI Control level, including Off (flow doc §6). The
// filing modules take no level and consult no gate: these tests exercise
// the write path at every AI_LEVELS value and prove AI calls stay gated
// while filing stays open.

import { describe, it, expect } from "vitest";
import { AI_LEVELS, aiCallAllowed, type AILevel } from "./aiGate";
import { fileMemory, saveFiling, type FilingStore } from "./filingIntake";

const fakeStore = (): FilingStore & { created: unknown[]; deleted: string[] } => {
  const created: unknown[] = [];
  const deleted: string[] = [];
  return {
    created,
    deleted,
    async create(_owner, _type, data, id) {
      created.push({ data, id });
      return id ?? "new-id";
    },
    async delete(_owner, id) {
      deleted.push(id);
    },
  };
};

describe("manual filing bypasses the AI Control approval path", () => {
  it.each(AI_LEVELS)("writes a brain_memory row at AI level %s with no approval card", async (level) => {
    expect(["everything", "draft", "request", "off"]).toContain(level as AILevel);
    const store = fakeStore();
    const id = await saveFiling(
      { category: "fact", text: `filed while AI level is ${level}`, source: "manual-chat" },
      { store, ownerId: "u1" },
    );
    expect(id).toBe("new-id");
    expect(store.created).toHaveLength(1);
    // No approval mechanism exists on the path: the env carries no level,
    // the payload stamps LEARNED immediately, nothing is queued or held.
    const written = (store.created[0] as { data: { state: string } }).data;
    expect(written.state).toBe("LEARNED");
  });

  it("the gate still blocks AI calls at Off while filing writes", async () => {
    // The contrast that makes the rule honest: AI calls are gated, the
    // memory write is not.
    expect(aiCallAllowed("off", false)).toBe(false);
    expect(aiCallAllowed("off", true)).toBe(false);
    const store = fakeStore();
    const id = await saveFiling(
      { category: "decision", text: "Ship it", source: "task", linkedItemIds: ["task-1"] },
      { store, ownerId: "u1" },
    );
    expect(id).toBeTruthy();
    expect(store.created).toHaveLength(1);
  });

  it("fileMemory stamps LEARNED directly: manual filings skip the proposal queue", () => {
    const d = fileMemory({ category: "philosophy", text: "Discipline beats motivation.", source: "plus-menu" });
    expect(d.state).toBe("LEARNED");
  });
});
