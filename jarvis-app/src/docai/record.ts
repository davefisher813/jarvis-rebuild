import type { DocProposal } from "./proposal";
import type { FilingResult } from "./filing";

// THE DECISION RECORD (build order: "decision-record provenance"). When Dave files or dismisses a proposal, this is what is written beside it:
// every field the proposal held, what he decided, whose value it ended as, and the words and page it came from. It is the proof of law 4 and
// law 5 after the fact: a filed bill can always be traced to the sentence in the document and to the tap that approved it.

export interface RecordedField {
  group: string;
  key: string;
  value: string;
  quote: string;
  page: number | null;
  tier: "solid" | "uncertain";
  reasons: string[];
  decision: "keep" | "drop" | "undecided";
  /** The value is Dave's own (he typed it or chose a side of a conflict). */
  byUser: boolean;
}

export interface DecisionRecord {
  decidedAt: string;
  decidedBy: "user";
  outcome: "filed" | "dismissed";
  fingerprint: string;
  fileId: string;
  kind: string;
  fields: RecordedField[];
  conflicts: { key: string; chosen: string | null; dropped: boolean; candidates: { value: string; quote: string; page: number | null }[] }[];
  filed: { type: string; id: string; label: string }[];
  skipped: string[];
}

export function decisionRecord(p: DocProposal, outcome: "filed" | "dismissed", result: FilingResult | null, now: Date = new Date()): DecisionRecord {
  return {
    decidedAt: now.toISOString(), decidedBy: "user", outcome, fingerprint: p.fingerprint, fileId: p.fileId, kind: p.kind,
    fields: p.groups.flatMap((g) => g.fields.map((f) => ({
      group: g.label, key: f.key, value: f.value, quote: f.quote, page: f.page, tier: f.tier, reasons: f.reasons, decision: f.decision, byUser: !!f.byUser,
    }))),
    conflicts: p.conflicts.map((c) => ({
      key: c.key, chosen: c.chosen === null ? null : c.candidates[c.chosen]?.value ?? null, dropped: c.dropped, candidates: c.candidates,
    })),
    filed: result && result.ok ? result.records.map((r) => ({ type: r.type, id: r.id, label: r.label })) : [],
    skipped: result && result.ok ? result.skipped : [],
  };
}
