// Brain Manual v1 (Phase 1) — voice guardrails at the service seam.
// Flow doc §7, test 5 (voiceGuards). The pure voiceGuard cases and the
// 6th-sample replacement flow live in filing.test.ts and
// filingSurfaces.test.ts; this file covers the gaps: a short sample warns
// but is NOT blocked (the caller's "save anyway" path), a duplicate notice
// means nothing is written, and non-voice rows never count toward the cap.

import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { BrainMemoryService } from "./brainMemoryService";
import { fileMemory } from "./filingIntake";
import { oldestVoiceSample } from "./filingIntake";
import { VOICE_SAMPLE_CAP, type BrainMemoryRow } from "./brainMemory";

const mk = () => new BrainMemoryService(new Store(new InMemoryAdapter()), "u1");

const LONG = (seed: string) =>
  Array.from({ length: 60 }, (_, i) => `${seed}${i}`).join(" ");

const voiceRow = (id: string, created: string): BrainMemoryRow => ({
  id,
  created_at: created,
  updated_at: created,
  data: { category: "voice", state: "LEARNED", text: "sample", source: "email" },
});

describe("voice guards: warn, never block (flow doc §4.4)", () => {
  it("a short sample warns, and the caller may still file it (save anyway)", async () => {
    const svc = mk();
    expect(await svc.voiceCheck("too short")).toBe("too-short");
    const filed = await svc.saveVoiceSample("too short");
    expect(filed.id).toBeTruthy();
    expect((await svc.voiceSamples()).length).toBe(1);
  });

  it("a duplicate notice means the caller files nothing: no double save", async () => {
    const svc = mk();
    await svc.saveVoiceSample(LONG("once"));
    expect(await svc.voiceCheck(LONG("once"))).toBe("duplicate");
    // The door honors the skip — it does not call saveVoiceSample again.
    expect((await svc.voiceSamples()).length).toBe(1);
  });

  it("non-voice rows never count toward the 5-sample cap", () => {
    const rows: BrainMemoryRow[] = [
      ...[1, 2, 3, 4, 5].map((i) => voiceRow(`v${i}`, `2026-09-0${i}T00:00:00Z`)),
      {
        id: "fact-1",
        created_at: "2026-09-01T00:00:00Z",
        updated_at: "2026-09-01T00:00:00Z",
        data: { category: "fact", state: "LEARNED", text: "not a voice sample", source: "note" },
      },
    ];
    const oldest = oldestVoiceSample(rows);
    expect(oldest?.id).toBe("v1");
  });

  it("replacing the oldest keeps the newest-first voiceSamples list intact", async () => {
    const svc = mk();
    await svc.saveVoiceSample(LONG("first"));
    for (const s of ["b", "c", "d", "e"]) await svc.saveVoiceSample(LONG(s));
    const sixth = await svc.saveVoiceSample(LONG("sixth"));
    expect(sixth.replaced).toBeTruthy();
    const samples = await svc.voiceSamples();
    expect(samples).toHaveLength(VOICE_SAMPLE_CAP);
    // newest first: the 6th sample leads.
    expect(samples[0]!.id).toBe(sixth.id);
    // The replaced sample's payload survives for Undo.
    expect(sixth.replaced!.data.text).toContain("first");
    expect(fileMemory({ category: "voice", text: LONG("x"), source: "email" }).wordCount).toBe(60);
  });
});
