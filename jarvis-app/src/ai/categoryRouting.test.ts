// Brain Manual v1 (Phase 1): category routing.
// Each filed category lands in its own bucket, and each Brain page that
// hosts filed rows (Dave 2026-09-28: the hub keeps its own pages) asks
// FiledRows for its own category: Decisions for decisions, What JARVIS
// Knows for facts, and the three doc pages for philosophy, values and voice.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Store, InMemoryAdapter } from "@core";
import { BrainMemoryService } from "./brainMemoryService";
import { fileMemory } from "./filingIntake";
import type { BrainMemoryCategory } from "./brainMemory";

const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(join(here, "..", p), "utf8");

const mk = () => new BrainMemoryService(new Store(new InMemoryAdapter()), "u1");

const CATS: BrainMemoryCategory[] = ["decision", "philosophy", "value", "voice", "fact"];

describe("category routing: each filing lands on its page's query", () => {
  it("listByCategory routes each of the five categories to its own bucket", async () => {
    const svc = mk();
    for (const c of CATS) {
      await svc.file(fileMemory({ category: c, text: `text for ${c}`, source: "note" }));
    }
    for (const c of CATS) {
      const rows = await svc.listByCategory(c);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.data.category).toBe(c);
    }
  });

  it("list() sees every category (FiledRows filters client-side)", async () => {
    const svc = mk();
    for (const c of CATS) {
      await svc.file(fileMemory({ category: c, text: `text for ${c}`, source: "note" }));
    }
    const all = await svc.list();
    expect(all).toHaveLength(CATS.length);
    for (const c of CATS) {
      expect(all.filter((r) => r.data.category === c)).toHaveLength(1);
    }
  });
});

describe("host wiring: each Brain page shows its own filed rows", () => {
  it("Decisions hosts filed decisions in its own row", () => {
    expect(src("decisions/DecisionsFlow.tsx")).toMatch(/<FiledRows categories=\{\["decision"\]\} rowClass="row dec-row"/);
  });
  it("What JARVIS Knows hosts filed facts in its own row", () => {
    expect(src("brain/strands/StrandsPage.tsx")).toMatch(/<FiledRows categories=\{\["fact"\]\} rowClass="row strand-row"/);
  });
  it("the doc pages map to philosophy, values and voice", () => {
    const doc = src("brain/docs/BrainDocPage.tsx");
    expect(doc).toMatch(/philosophy:\s*"philosophy"/);
    expect(doc).toMatch(/values:\s*"value"/);
    expect(doc).toMatch(/writing:\s*"voice"/);
    expect(doc).toMatch(/<FiledRows categories=\{\[FILED_FOR\[topic\]!\]\}/);
  });
});
