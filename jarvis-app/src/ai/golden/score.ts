// Exact-match scoring for the golden set. Pure; shared by the offline suite
// and the live harness so "the score" can never mean two different things.

import type { CaptureResult } from "../capture";
import type { CaptureGold, TriageGold } from "./goldenSet";
import type { TriageMap } from "../../messages/triage";

export interface CaseScore {
  name: string;
  pass: boolean;
  // Human-readable mismatches, empty when pass. "field: expected -> got".
  misses: string[];
}

export interface SetScore {
  cases: CaseScore[];
  passed: number;
  total: number;
}

const norm = (s: string | undefined) => (s ?? "").trim().toLowerCase();

// A capture is exact when kind matches, title matches case-insensitively, and
// every optional field matches what the gold declares: a declared value must
// equal it, an undeclared one must be absent or empty. "date they didn't say"
// is a miss, not a bonus.
export function scoreCapture(gold: CaptureGold, actual: CaptureResult | null): CaseScore {
  const misses: string[] = [];
  if (!actual) {
    return { name: gold.name, pass: false, misses: ["no parseable result"] };
  }
  if (actual.kind !== gold.expect.kind) misses.push(`kind: ${gold.expect.kind} -> ${actual.kind}`);
  if (norm(actual.title) !== norm(gold.expect.title)) misses.push(`title: ${gold.expect.title} -> ${actual.title}`);
  for (const field of ["date", "start", "category"] as const) {
    const want = gold.expect[field];
    const got = actual[field];
    if (want !== undefined) {
      if (norm(got) !== norm(want)) misses.push(`${field}: ${want} -> ${got ?? "(absent)"}`);
    } else if (got) {
      misses.push(`${field}: (absent) -> ${got}`);
    }
  }
  return { name: gold.name, pass: misses.length === 0, misses };
}

// A triage batch is exact when every expected id got its bucket, and every
// declared "by" matches exactly, including the empty string, which asserts
// that no deadline was invented. Gist is prose and is not scored.
export function scoreTriage(gold: TriageGold, actual: TriageMap | null): CaseScore {
  const misses: string[] = [];
  if (!actual) {
    return { name: gold.name, pass: false, misses: ["no parseable result"] };
  }
  for (const [id, want] of Object.entries(gold.expect)) {
    const got = actual[id];
    if (!got) {
      misses.push(`${id}: missing`);
      continue;
    }
    if (got.bucket !== want.bucket) misses.push(`${id} bucket: ${want.bucket} -> ${got.bucket}`);
    if (want.by !== undefined) {
      const gotBy = got.by ?? "";
      if (norm(gotBy) !== norm(want.by)) misses.push(`${id} by: "${want.by}" -> "${gotBy}"`);
    }
  }
  return { name: gold.name, pass: misses.length === 0, misses };
}

export function summarize(cases: CaseScore[]): SetScore {
  return { cases, passed: cases.filter((c) => c.pass).length, total: cases.length };
}
