import type { DocKind, DocText, ExtractionResult, ExtractedItem, FieldConflict, FieldEnvelope, VerifiedField } from "./types";
import { CLASSIFY_SCHEMA, CLASSIFY_SYSTEM, EXTRACTED_KINDS, KIND_FIELDS, extractSchema, extractSystem, sliceUser } from "./schemas";
import { typeOf, verifyItem } from "./verify";

// EXTRACTION, BEHIND THE ONE AI DOOR (build order). Classify first, then extract per kind, slicing a long document SERVER-SIDE into
// pieces that fit the input cap and merging by CODE: never a second model opinion, and a conflict over money or a date is shown to
// the person, never won by whichever slice came last. Silent truncation is lying, so what was not read is named by page.
//
// The model is reached only through `call`, which in production is the metered, gated, capped path (api/_docWorker.ts). Nothing
// in this file can spend money or reach the network on its own.

export type AIFail = "OFF" | "CREDIT" | "BUSY" | "UNKNOWN" | "SCHEMA" | "UPSTREAM";
export type AIResult = { ok: true; json: unknown; truncated: boolean } | { ok: false; code: AIFail };
export interface AIRequest { purpose: "classify" | "extract"; system: string; user: string; schema: Record<string, unknown> }
export type AICall = (req: AIRequest) => Promise<AIResult>;

/** Characters of document text per call: under the proxy's 32 KB input cap with room for the prompt and the schema. */
export const SLICE_CHARS = 14_000;
/** Calls per document per run. A longer document is extracted in part and says which pages it did not reach. */
export const MAX_SLICES = 6;
/** How much of the start the classifier sees. */
export const CLASSIFY_CHARS = 6_000;

export type ExtractOutcome =
  | { ok: true; result: ExtractionResult; title: string }
  | { ok: false; code: AIFail; kind?: DocKind };

/** Pages grouped into slices that fit the cap. A single page bigger than the cap is cut at the cap and the rest of that page is named. */
export function sliceDoc(doc: DocText, limit = SLICE_CHARS): { pages: { page: number; text: string }[]; cutPages: number[] }[] {
  const slices: { pages: { page: number; text: string }[]; cutPages: number[] }[] = [];
  let cur: { pages: { page: number; text: string }[]; cutPages: number[] } = { pages: [], cutPages: [] };
  let size = 0;
  for (const p of doc.pages) {
    let text = doc.text.slice(p.start, p.end);
    const cut = text.length > limit;
    if (cut) text = text.slice(0, limit);
    if (cur.pages.length && size + text.length > limit) { slices.push(cur); cur = { pages: [], cutPages: [] }; size = 0; }
    cur.pages.push({ page: p.page, text });
    if (cut) cur.cutPages.push(p.page);
    size += text.length;
  }
  if (cur.pages.length) slices.push(cur);
  return slices;
}

function envelopesOf(json: unknown, kind: DocKind): { group: string; fields: FieldEnvelope[] }[] {
  const allowed = new Set(KIND_FIELDS[kind].keys);
  const items = (json as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];
  const out: { group: string; fields: FieldEnvelope[] }[] = [];
  for (const it of items) {
    const raw = (it as { fields?: unknown })?.fields;
    if (!Array.isArray(raw)) continue;
    const fields: FieldEnvelope[] = [];
    for (const f of raw) {
      const o = f as Partial<FieldEnvelope>;
      if (typeof o.key !== "string" || !allowed.has(o.key)) continue;
      if (typeof o.value !== "string" || typeof o.quote !== "string") continue;
      const basis = o.basis === "stated" || o.basis === "computed" || o.basis === "inferred" ? o.basis : "inferred";
      fields.push({ key: o.key, value: o.value, quote: o.quote, page: typeof o.page === "number" ? o.page : null, basis });
    }
    if (fields.length) out.push({ group: KIND_FIELDS[kind].group, fields });
  }
  return out;
}

const fp = (i: ExtractedItem) => i.group + "|" + i.fields.filter((f) => f.tier !== "dropped").map((f) => f.key + "=" + f.value).sort().join(";");

/** A bill is ONE record: its slices are folded into one item, and disagreement on any single-valued field is a conflict, not a pick. */
function mergeSingle(items: ExtractedItem[], group: string): { item: ExtractedItem | null; conflicts: FieldConflict[] } {
  const byKey = new Map<string, VerifiedField[]>();
  for (const it of items) for (const f of it.fields) { if (f.tier === "dropped") continue; byKey.set(f.key, [...(byKey.get(f.key) ?? []), f]); }
  const fields: VerifiedField[] = [];
  const conflicts: FieldConflict[] = [];
  for (const [key, list] of byKey) {
    if (key === "lineAmount") { fields.push(...list); continue; }
    const values = new Set(list.map((f) => f.value.trim().toLowerCase()));
    if (values.size === 1) { fields.push(list.find((f) => f.tier === "solid") ?? list[0]!); continue; }
    conflicts.push({ key, group, candidates: list.map((f) => ({ value: f.value, quote: f.quote, page: f.page })) });
  }
  return { item: fields.length ? { group, fields } : null, conflicts };
}

export async function extractDocument(doc: DocText, call: AICall, today: Date): Promise<ExtractOutcome> {
  // 1. What is it, and is there anything to do? Only the start is read; this is a short, cheap call.
  const head = doc.text.slice(0, CLASSIFY_CHARS);
  const cls = await call({ purpose: "classify", system: CLASSIFY_SYSTEM, user: head, schema: CLASSIFY_SCHEMA as unknown as Record<string, unknown> });
  if (!cls.ok) return { ok: false, code: cls.code };
  const c = cls.json as { kind?: string; actionable?: boolean; title?: string };
  const said = (["bill", "schedule", "task-list", "letter", "receipt", "general"] as const).find((k) => k === c.kind) ?? "general";
  const title = typeof c.title === "string" ? c.title.trim().slice(0, 120) : "";
  if (c.actionable === false) {
    return { ok: true, title, result: { kind: said, actionable: false, items: [], conflicts: [], missingPages: [], droppedCount: 0 } };
  }
  // A kind with no schema of its own yet is read as general; the proposal still says what the document looked like.
  const kind: DocKind = EXTRACTED_KINDS.includes(said) ? said : "general";

  // 2. Extract, slice by slice. A refusal, a missing credit or an unknown outcome stops the run and names its code; nothing partial is filed.
  const slices = sliceDoc(doc);
  const reached = slices.slice(0, MAX_SLICES);
  const missing = new Set<number>(doc.failedPages);
  for (const s of slices.slice(MAX_SLICES)) for (const p of s.pages) missing.add(p.page);
  const verified: ExtractedItem[] = [];
  for (const s of reached) {
    const r = await call({ purpose: "extract", system: extractSystem(kind), user: sliceUser(s.pages), schema: extractSchema(kind) });
    if (!r.ok) return { ok: false, code: r.code, kind: said };
    // A reply cut off by the output cap is partial for those pages, said so, never trusted as whole.
    if (r.truncated) for (const p of s.pages) missing.add(p.page);
    for (const p of s.cutPages) missing.add(p);
    for (const e of envelopesOf(r.json, kind)) verified.push(verifyItem(e.group, e.fields, { doc, today }));
  }

  // 3. Merge by code.
  let items: ExtractedItem[];
  let conflicts: FieldConflict[] = [];
  if (kind === "bill") {
    const m = mergeSingle(verified, KIND_FIELDS.bill.group);
    items = m.item ? [m.item] : [];
    conflicts = m.conflicts;
  } else {
    const seen = new Set<string>();
    items = [];
    for (const it of verified) {
      const live = { ...it, fields: it.fields.filter((f) => f.tier !== "dropped") };
      if (!live.fields.length) continue;
      const k = fp(live);
      if (seen.has(k)) continue;
      seen.add(k);
      items.push(live);
    }
  }
  const droppedCount = verified.reduce((t, i) => t + i.fields.filter((f) => f.tier === "dropped").length, 0);
  // Keep the strict types honest: any amount or date that reached the result is stated or computed, never inferred.
  for (const it of items) for (const f of it.fields) if (typeOf(f.key) !== "text" && f.basis === "inferred") throw new Error("INVARIANT: inferred amount or date reached the result");
  return {
    ok: true,
    title,
    result: { kind, actionable: items.length > 0 || conflicts.length > 0, items, conflicts, missingPages: [...missing].sort((a, b) => a - b), droppedCount },
  };
}
