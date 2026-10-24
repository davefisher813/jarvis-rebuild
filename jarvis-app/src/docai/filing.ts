import type { DocProposal, ProposalField, ProposalGroup } from "./proposal";
import { keptFields, readyToFile } from "./proposal";

// FILING (law 6): Doc AI files through the ordinary doors and no other. A bill becomes a Money bill, an event becomes a calendar event,
// anything else becomes a note, and every record keeps its pointer back to the document. Only a proposal that Dave decided can reach
// here; only fields he KEPT are written; a refusal by a door is told to him in words and nothing after it is pretended. This module
// never sends, never posts, never writes Brain documents, and never writes anything for a field that is not kept.

export interface FilingDoors {
  /** Money's ledger. `duplicate` true means a bill with the same facts was already there: nothing new was made. */
  addBill(input: { vendor: string; amount: string; dueDate?: string; notes?: string; attachmentFileId: string }): Promise<{ ok: true; id: string; duplicate: boolean } | { ok: false; reason: string }>;
  createEvent(title: string, opts: { date: string; start: string; end?: string; location?: string; source: { type: "file"; ref: string; ts: number } }): Promise<string | null>;
  createNote(title: string, lines: string[], source: { type: "file"; ref: string; ts: number }): Promise<string | null>;
}

export interface FiledRecord { type: "money_bill" | "event" | "note"; id: string; label: string }

export type FilingResult =
  | { ok: true; records: FiledRecord[]; skipped: string[]; words: string }
  | { ok: false; reason: string; records: FiledRecord[] };

const val = (g: ProposalGroup, key: string): ProposalField | undefined => keptFields(g).find((f) => f.key === key);

/** "Bill in Money", "2 Events on the Calendar", "A Note": where it went, in the words the row shows. */
export function filedWords(records: FiledRecord[]): string {
  const n = (t: FiledRecord["type"]) => records.filter((r) => r.type === t).length;
  if (n("money_bill")) return "Bill in Money";
  if (n("event")) return n("event") === 1 ? "Event on the Calendar" : `${n("event")} Events on the Calendar`;
  return "Note";
}

export async function fileProposal(p: DocProposal, doors: FilingDoors, now: () => number = Date.now): Promise<FilingResult> {
  if (!readyToFile(p)) return { ok: false, reason: "Nothing is ready to file yet.", records: [] };
  const source = { type: "file" as const, ref: p.fileId, ts: now() };
  const records: FiledRecord[] = [];
  const skipped: string[] = [];

  if (p.destination === "money") {
    const g = p.groups.find((x) => val(x, "amount") && val(x, "payee")) ?? p.groups[0]!;
    const payee = val(g, "payee")?.value;
    const amount = val(g, "amount")?.value;
    // A bill needs a payee and an amount. Missing either is said plainly, never filled in.
    if (!payee || !amount) return { ok: false, reason: `Keep the ${!payee ? "payee" : "amount"} to file this as a bill.`, records };
    const extras = keptFields(g).filter((f) => !["payee", "amount", "dueDate"].includes(f.key)).map((f) => `${f.label}: ${f.value}`);
    const made = await doors.addBill({ vendor: payee, amount, dueDate: val(g, "dueDate")?.value, notes: extras.length ? extras.join("\n") : undefined, attachmentFileId: p.fileId });
    if (!made.ok) return { ok: false, reason: "Money would not take that bill.", records };
    if (made.duplicate) skipped.push(`${payee} was already in Money.`);
    records.push({ type: "money_bill", id: made.id, label: payee });
  } else if (p.destination === "calendar") {
    for (const g of p.groups) {
      const title = val(g, "title")?.value;
      const date = val(g, "date")?.value;
      const start = val(g, "startTime")?.value;
      // An event needs a name, a day and a start. One without them is left out and named, never invented.
      if (!title || !date || !start) { if (keptFields(g).length) skipped.push(`${title ?? g.label} needs a date and a start time to go on the calendar.`); continue; }
      const id = await doors.createEvent(title, { date, start, end: val(g, "endTime")?.value, location: val(g, "location")?.value, source });
      if (id) records.push({ type: "event", id, label: title });
      else skipped.push(`${title} could not be added.`);
    }
    if (!records.length) return { ok: false, reason: skipped[0] ?? "No event had both a date and a start time.", records };
  } else {
    const lines = p.groups.flatMap((g) => keptFields(g).map((f) => `${f.label}: ${f.value}`));
    const id = await doors.createNote(p.title || p.fileName, lines, source);
    if (!id) return { ok: false, reason: "The note could not be made.", records };
    records.push({ type: "note", id, label: p.title || p.fileName });
  }
  return { ok: true, records, skipped, words: filedWords(records) };
}
