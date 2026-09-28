// Brain Manual v1 (Phase 1) — category routing.
// Flow doc §7, test 2: each filed category lands on the right page query.
// The Brain tab pages read through BrainMemoryService: DecisionsPage calls
// listByCategory("decision"), the simple lists (Philosophy / Values / How
// You Write) call listByCategory with their category, and What JARVIS Knows
// calls list() with a per-chip category filter. This file pins the service
// queries each page actually issues, plus the Decisions status filters.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Store, InMemoryAdapter } from "@core";
import {
  BrainMemoryService,
  decisionMatchesStatus,
  type DecisionFilter,
} from "./brainMemoryService";
import { fileMemory } from "./filingIntake";
import {
  type BrainMemoryCategory,
  type BrainMemoryRow,
} from "./brainMemory";

const here = dirname(fileURLToPath(import.meta.url));
const manual = join(here, "..", "brain", "manual");

const mk = () => new BrainMemoryService(new Store(new InMemoryAdapter()), "u1");

const CATS: BrainMemoryCategory[] = ["decision", "philosophy", "value", "voice", "fact"];

const decisionRow = (
  id: string,
  status?: "active" | "reversed" | "archived",
): BrainMemoryRow => ({
  id,
  created_at: "2026-09-20T12:00:00Z",
  updated_at: "2026-09-20T12:00:00Z",
  data: {
    category: "decision",
    state: "LEARNED",
    text: "a decision",
    source: "manual-chat",
    ...(status ? { status } : {}),
  },
});

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

  it("the What JARVIS Knows query sees every category (the chips filter client-side)", async () => {
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

  it("Decisions status filters: 'all' hides archived, chips match their status", () => {
    const active = decisionRow("a", "active");
    const reversed = decisionRow("r", "reversed");
    const archived = decisionRow("x", "archived");
    const filters: DecisionFilter[] = ["all", "active", "reversed", "archived"];
    for (const f of filters) {
      expect(decisionMatchesStatus(active, f)).toBe(f === "all" || f === "active");
      expect(decisionMatchesStatus(reversed, f)).toBe(f === "all" || f === "reversed");
      expect(decisionMatchesStatus(archived, f)).toBe(f === "archived");
    }
  });

  it("a decision with no status defaults to active", () => {
    const row = decisionRow("d");
    expect(decisionMatchesStatus(row, "all")).toBe(true);
    expect(decisionMatchesStatus(row, "active")).toBe(true);
    expect(decisionMatchesStatus(row, "archived")).toBe(false);
  });
});

describe("page wiring: the queries above are the ones the pages issue", () => {
  it("DecisionsPage reads the decision category", () => {
    const src = readFileSync(join(manual, "DecisionsPage.tsx"), "utf8");
    expect(src).toMatch(/listByCategory\("decision"\)/);
  });

  it("SimpleListPage topics map to their categories", () => {
    const src = readFileSync(join(manual, "SimpleListPage.tsx"), "utf8");
    expect(src).toMatch(/philosophy:\s*\{[\s\S]*?category:\s*"philosophy"/);
    expect(src).toMatch(/values:\s*\{[\s\S]*?category:\s*"value"/);
    expect(src).toMatch(/writing:\s*\{[\s\S]*?category:\s*"voice"/);
  });

  it("KnowsPage filters its flat list by the active chip", () => {
    const src = readFileSync(join(manual, "KnowsPage.tsx"), "utf8");
    expect(src).toMatch(/r\.data\.category === chip/);
  });
});
