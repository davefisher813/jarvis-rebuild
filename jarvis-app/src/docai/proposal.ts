import type { DocKind, ExtractionResult, FieldConflict, Tier, VerifiedField } from "./types";

// THE PROPOSAL: what JARVIS took from a document, held for Dave (laws 1 and 2). One proposal per document. Solid fields batch behind
// one Approve All; uncertain fields are pulled OUT of that batch, tagged, with the reason and the quote; a conflict shows both
// values and keeps neither. Nothing here files anything: filing.ts does that, only from a proposal Dave has decided, only through
// the ordinary doors. A dismissed proposal is never proposed again from the same extraction (the fingerprint remembers).

export type Destination = "money" | "calendar" | "note";
export type Decision = "undecided" | "keep" | "drop";

export interface ProposalField {
  id: string;
  key: string;
  label: string;
  value: string;
  quote: string;
  page: number | null;
  offsets: { start: number; end: number } | null;
  tier: Exclude<Tier, "dropped">;
  reasons: string[];
  decision: Decision;
  /** Dave typed or chose this value himself. It is his word now, solid by his say-so, and it is marked as his. */
  byUser?: boolean;
}

export interface ProposalGroup { id: string; label: string; fields: ProposalField[] }

export interface ProposalConflict extends FieldConflict { id: string; label: string; chosen: number | null; dropped: boolean }

export interface DocProposal {
  id: string;
  fileId: string;
  fileName: string;
  kind: DocKind;
  /** "Looks Like a Bill". */
  kindWords: string;
  destination: Destination;
  /** "Bill in Money". */
  destinationWords: string;
  title: string;
  groups: ProposalGroup[];
  conflicts: ProposalConflict[];
  missingPages: number[];
  fingerprint: string;
  status: "open" | "filed" | "dismissed";
}

export const KIND_WORDS: Record<DocKind, string> = {
  bill: "Looks Like a Bill",
  schedule: "Looks Like a Schedule",
  "task-list": "Looks Like a To-Do List",
  letter: "Looks Like a Letter",
  receipt: "Looks Like a Receipt",
  general: "Looks Like a Document",
};

export const DESTINATION_WORDS: Record<Destination, string> = { money: "Bill in Money", calendar: "Events on the Calendar", note: "Note" };

export const FIELD_LABELS: Record<string, string> = {
  payee: "Payee", amount: "Amount", dueDate: "Due Date", statementDate: "Statement Date", accountRef: "Account", recurrence: "Repeats",
  minimumDue: "Minimum Due", lineAmount: "Line Amount", title: "Title", date: "Date", startTime: "Starts", endTime: "Ends", location: "Where",
  what: "What", person: "Who", ask: "Asks",
};
export const labelFor = (key: string): string => FIELD_LABELS[key] ?? key;

/** Where a kind goes. Anything without a home of its own lands as a note, which is the floor: nothing is ever lost. */
export function destinationFor(kind: DocKind): Destination {
  if (kind === "bill") return "money";
  if (kind === "schedule") return "calendar";
  return "note";
}

/** A short stable hash (FNV-1a over two lanes), enough to tell one extraction from another. Not a security boundary. */
export function hashText(s: string): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    a = Math.imul(a ^ s.charCodeAt(i), 0x01000193) >>> 0;
    b = Math.imul(b ^ s.charCodeAt(s.length - 1 - i), 0x85ebca6b) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/** The same document read to the same facts has the same fingerprint, so a dismissal holds. */
export function fingerprintOf(fileId: string, kind: DocKind, groups: { fields: { key: string; value: string }[] }[]): string {
  const rows = groups.map((g) => g.fields.map((f) => f.key + "=" + f.value.trim().toLowerCase()).sort().join(";")).sort().join("|");
  return hashText(`${fileId}|${kind}|${rows}`);
}

const live = (f: VerifiedField): f is VerifiedField & { tier: "solid" | "uncertain" } => f.tier !== "dropped";

export function buildProposal(args: { fileId: string; fileName: string; title: string; extraction: ExtractionResult }): DocProposal {
  const { extraction: x } = args;
  const groups: ProposalGroup[] = x.items.map((it, gi) => ({
    id: "g" + gi,
    label: x.kind === "schedule" ? (it.fields.find((f) => f.key === "title")?.value ?? "Event " + (gi + 1)) : x.kind === "bill" ? "Bill" : "Item " + (gi + 1),
    fields: it.fields.filter(live).map((f, fi) => ({
      id: `g${gi}f${fi}`, key: f.key, label: labelFor(f.key), value: f.value, quote: f.quote, page: f.page, offsets: f.offsets,
      tier: f.tier, reasons: f.reasons, decision: "undecided" as Decision,
    })),
  }));
  const conflicts: ProposalConflict[] = x.conflicts.map((c, ci) => ({ ...c, id: "c" + ci, label: labelFor(c.key), chosen: null, dropped: false }));
  const dest = destinationFor(x.kind);
  const fp = fingerprintOf(args.fileId, x.kind, [...groups, ...conflicts.map((c) => ({ fields: c.candidates.map((k) => ({ key: c.key, value: k.value })) }))]);
  return {
    id: "dp_" + fp, fileId: args.fileId, fileName: args.fileName, kind: x.kind, kindWords: KIND_WORDS[x.kind], destination: dest,
    destinationWords: DESTINATION_WORDS[dest], title: args.title, groups, conflicts, missingPages: x.missingPages, fingerprint: fp, status: "open",
  };
}

/** True when an extraction is worth showing at all: something to keep, or something to decide. */
export const hasContent = (p: DocProposal): boolean => p.groups.some((g) => g.fields.length) || p.conflicts.length > 0;

const mapFields = (p: DocProposal, f: (x: ProposalField) => ProposalField): DocProposal => ({ ...p, groups: p.groups.map((g) => ({ ...g, fields: g.fields.map(f) })) });

/** LAW 1, structurally: Approve All can only reach a SOLID, still undecided field. An uncertain one is not in its reach at any confidence. */
export function approveAllSolid(p: DocProposal): DocProposal {
  return mapFields(p, (f) => (f.tier === "solid" && f.decision === "undecided" ? { ...f, decision: "keep" } : f));
}

/** The fields Approve All would take: shown on the button as a count, so the batch is never a surprise. */
export const solidPending = (p: DocProposal): number => p.groups.reduce((t, g) => t + g.fields.filter((f) => f.tier === "solid" && f.decision === "undecided").length, 0);
export const uncertainPending = (p: DocProposal): number => p.groups.reduce((t, g) => t + g.fields.filter((f) => f.tier === "uncertain" && f.decision === "undecided").length, 0);

export function decide(p: DocProposal, fieldId: string, decision: Decision): DocProposal {
  return mapFields(p, (f) => (f.id === fieldId ? { ...f, decision } : f));
}

/** Dave edits a value. It is kept, marked as his own words, and solid by his say-so (an edit re-tags the entry as entered by him). */
export function editField(p: DocProposal, fieldId: string, value: string): DocProposal {
  return mapFields(p, (f) => (f.id === fieldId ? { ...f, value: value.trim(), decision: value.trim() ? "keep" : "drop", tier: "solid", reasons: [], byUser: true } : f));
}

/** Dave picks one side of a conflict. The chosen value joins the first group as a kept field he chose. */
export function resolveConflict(p: DocProposal, conflictId: string, candidate: number | "drop"): DocProposal {
  const c = p.conflicts.find((x) => x.id === conflictId);
  if (!c) return p;
  if (candidate === "drop") return { ...p, conflicts: p.conflicts.map((x) => (x.id === conflictId ? { ...x, dropped: true, chosen: null } : x)) };
  const k = c.candidates[candidate];
  if (!k) return p;
  const group = p.groups[0] ?? { id: "g0", label: "Bill", fields: [] };
  const field: ProposalField = {
    id: `${conflictId}-picked`, key: c.key, label: labelFor(c.key), value: k.value, quote: k.quote, page: k.page, offsets: null,
    tier: "solid", reasons: [], decision: "keep", byUser: true,
  };
  const groups = p.groups.length ? p.groups.map((g, i) => (i === 0 ? { ...g, fields: [...g.fields.filter((f) => f.id !== field.id), field] } : g)) : [{ ...group, fields: [field] }];
  return { ...p, groups, conflicts: p.conflicts.map((x) => (x.id === conflictId ? { ...x, chosen: candidate, dropped: false } : x)) };
}

export const keptFields = (g: ProposalGroup): ProposalField[] => g.fields.filter((f) => f.decision === "keep");
export const unresolvedConflicts = (p: DocProposal): number => p.conflicts.filter((c) => c.chosen === null && !c.dropped).length;

/** File It is ready when something is kept and no conflict is left hanging. An undecided uncertain field simply stays behind. */
export function readyToFile(p: DocProposal): boolean {
  return p.status === "open" && unresolvedConflicts(p) === 0 && p.groups.some((g) => keptFields(g).length > 0);
}

/** Dismissed fingerprints are never proposed again. */
export const alreadyDismissed = (fingerprint: string, dismissed: readonly string[]): boolean => dismissed.includes(fingerprint);
