import type { LedgerService } from "../money/ledger/LedgerService";
import type { ScheduleService } from "../schedule/ScheduleService";
import type { NotesService } from "../notes/NotesService";
import type { FilingDoors } from "./filing";

// THE ORDINARY DOORS (law 6). Doc AI files through the services the rest of the app uses and through nothing else: no new writer, no
// side table, no Brain document. Each door is the same call a person's own tap makes, so every rule those services already enforce
// (validation, duplicates, history, provenance) applies here too.

export function ordinaryDoors(svc: { ledger: LedgerService | null; schedule: ScheduleService | null; notes: NotesService | null }): FilingDoors {
  return {
    async addBill(input) {
      if (!svc.ledger) return { ok: false, reason: "Money is not available" };
      // "manual", by the user: Dave confirmed it. Recurrence is deliberately not passed; a document never schedules a bill by inference.
      const r = await svc.ledger.addBill(
        { vendor: input.vendor, amount: input.amount, dueDate: input.dueDate ?? null, notes: input.notes ?? null, attachmentFileId: input.attachmentFileId },
        "manual", "user",
      );
      return r.ok ? { ok: true, id: r.id, duplicate: r.duplicate } : { ok: false, reason: "Money refused it" };
    },
    async createEvent(title, opts) {
      if (!svc.schedule) return null;
      return svc.schedule.createEvent(title, { date: opts.date, start: opts.start, end: opts.end, location: opts.location, source: opts.source });
    },
    async createNote(title, lines, source) {
      if (!svc.notes) return null;
      const id = await svc.notes.createNote(title, "", [], source);
      if (!id) return null;
      if (lines.length) {
        await svc.notes.appendToDoc(id, lines.map((t) => ({ type: "paragraph", content: [{ type: "text", text: t }] })));
      }
      return id;
    },
  };
}
