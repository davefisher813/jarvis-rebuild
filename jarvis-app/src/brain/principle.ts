import type { Derived } from "./derive";
import { capAfterNumber } from "../shared/casing";

// THE VALUES DETECTOR (C-63, Astra, 2026-09-12). A principle is a call he
// keeps making. Three or more decisions that rule out the same live area,
// or that point their rules at the same strand, look like a standing rule,
// and Needs You asks: That's Right writes a values strand (strength
// influence, type principle), Only Sometimes rests the question for a
// month, Not True closes it. The Values doc text is never written by the
// app; hardLines.ts stands.
//
// Deterministic and text-shy: the only words that reach the proposal are
// area names and link labels he wrote himself.

export interface DeriveDecision {
  id: string;
  decision: string;
  ruledOut?: string[];
  links?: { type: string; id: string; label: string }[];
  ruleStrandId?: string;
  createdAt: string;
}

export const MIN_PRINCIPLE_DECISIONS = 3;

const words = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
const shares = (a: string, b: string): boolean => {
  const bw = new Set(words(b));
  return words(a).some((w) => bw.has(w));
};

export function derivePrinciple(decisions: DeriveDecision[], areas: string[]): Derived | null {
  let best: { area: string; hits: DeriveDecision[] } | null = null;
  for (const area of areas) {
    if (!area.trim()) continue;
    const hits = decisions.filter((d) => (d.ruledOut ?? []).some((r) => shares(r, area)));
    if (hits.length >= MIN_PRINCIPLE_DECISIONS && (!best || hits.length > best.hits.length)) best = { area, hits };
  }
  if (!best) return null;
  const { area, hits } = best;
  // The home those decisions kept choosing instead, when there is one.
  const counts = new Map<string, number>();
  for (const d of hits) for (const l of d.links ?? []) {
    if (shares(l.label, area)) continue;
    counts.set(l.label, (counts.get(l.label) ?? 0) + 1);
  }
  const over = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  const line = over ? `${over} wins ties over ${area}` : `${area} is what gets ruled out`;
  const days = [...new Set(hits.map((d) => d.createdAt.slice(0, 10)))].sort();
  return {
    derivation: "principle",
    category: "values",
    title: `"${over ? `${over} before ${area}` : `Not ${area}`}" looks like a standing rule`,
    sub: capAfterNumber(`${hits.length} decisions`),
    strandText: line,
    evidence: days.slice(-6).map((day) => ({ day, a: hits.length })),
  };
}

// The two quiet answers, kept on the device so the question does not come
// back the next open. Only Sometimes rests it; Not True closes it.
const KEY = "jarvis.brain.principle.answers.v1";
const REST_DAYS = 30;
type Answers = Record<string, { answer: "sometimes" | "never"; on: string }>;

function readAnswers(): Answers {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Answers; } catch { return {}; }
}

export function answerPrinciple(text: string, answer: "sometimes" | "never", today: string): void {
  try {
    const cur = readAnswers();
    cur[text] = { answer, on: today };
    localStorage.setItem(KEY, JSON.stringify(cur));
  } catch { /* a private window forgets; the question simply returns */ }
}

export function principleAnswered(text: string, today: string): boolean {
  const a = readAnswers()[text];
  if (!a) return false;
  if (a.answer === "never") return true;
  const rest = new Date(a.on + "T00:00:00").getTime() + REST_DAYS * 86400000;
  return new Date(today + "T00:00:00").getTime() < rest;
}
