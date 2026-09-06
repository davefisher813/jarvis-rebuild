import type { Store, ItemData } from "@core";
import { ENTITY_BRAIN_DOC, type BrainDocData } from "./types";
import { cleanHardLines, type HardLine } from "../hardLines";

// One record per topic per user (philosophy / writing / values).
export class BrainDocService {
  constructor(private store: Store, private ownerId: string) {}

  private async record(topic: string): Promise<{ id: string; data: BrainDocData } | null> {
    const items = await this.store.listForUser(this.ownerId, ENTITY_BRAIN_DOC);
    // topic lives inside JSONB; that predicate stays in memory by design.
    const it = items.find((i) => (i.data as unknown as BrainDocData).topic === topic);
    return it ? { id: it.id, data: it.data as unknown as BrainDocData } : null;
  }

  async get(topic: string): Promise<string> {
    return (await this.record(topic))?.data.text ?? "";
  }

  // UP-MIND-20 (2026-09-05): the Values hard lines. Read back with the same
  // suspicion as everything else in this codebase: a malformed entry is
  // dropped, never repaired, because a half-read rule that stops an
  // automatic action is worse than no rule.
  async hardLines(topic = "values"): Promise<HardLine[]> {
    return cleanHardLines((await this.record(topic))?.data.hardLines);
  }

  // `lines` is optional so every existing caller saves exactly what it saved
  // before: passing nothing KEEPS whatever is stored, rather than clearing
  // it, which is the difference between editing the prose and deleting the
  // user's rules by accident.
  async save(topic: string, text: string, lines?: HardLine[]): Promise<void> {
    const r = await this.record(topic);
    const kept = lines !== undefined ? cleanHardLines(lines) : cleanHardLines(r?.data.hardLines);
    const data: BrainDocData = { topic, text, ...(kept.length ? { hardLines: kept } : {}) };
    if (r) await this.store.update(this.ownerId, r.id, data as unknown as ItemData);
    else await this.store.create(this.ownerId, ENTITY_BRAIN_DOC, data as unknown as ItemData);
  }
}
