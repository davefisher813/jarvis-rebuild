// THE RECORD ENVELOPE (PHASE0-DESIGN.md D6; docs/jarvis-unified/VYZN-SYNC-CONTRACT.md).
//
// An outside app hands JARVIS records inside one envelope, and every record lands as a proposal on the
// inbox surface (migration 0061): an app proposes, the person's tap makes the item, and a newer revision
// of a saved record never overwrites it. This module is the TS side of that contract: the types, the
// roster that turns an agent id into a name a person can read, and the one pure mapping from the backend
// inbox's shape (family/inbox.js buildTask) to records. Nothing here reads the network or the environment;
// src/push/proxy.ts does the fetching and the deleting around it.

import { LIMITS, type RecordKind, type VyznApp } from "../gateway/protocol";

export const RECORD_PROTOCOL_VERSION = 1;

export interface RecordSource { url?: string; label?: string }

/** One record as the envelope carries it. `data` is the kind's own fields; the identity, the destination and
 *  the stamp are never inside it (the server refuses previous_item, destination_id, clientId and source there). */
export interface VyznRecord {
  source_record_id: string;
  revision: number;
  kind: RecordKind;
  data: Record<string, unknown>;
  source?: RecordSource;
  client_at?: string;
}

export interface RecordEnvelope {
  protocol_version: typeof RECORD_PROTOCOL_VERSION;
  method: "record.push";
  params: { source_app: VyznApp; records: VyznRecord[] };
}

/** What the server answers per record (jarvis_records_ingest). */
export type RecordOutcome =
  | { source_record_id: string; revision: number; outcome: "proposed"; proposal_id: string; superseded: number }
  | { source_record_id: string; revision: number; outcome: "replay"; proposal_id: string; status: "proposed" | "accepted" | "dismissed" | "superseded" | "stale" }
  | { source_record_id: string; revision: number; outcome: "already_saved"; item_id: string }
  | { source_record_id: string; revision: number; outcome: "newer_revision_proposed"; proposal_id: string; item_id: string };

export interface IngestAnswer { received: number; written: number; results: RecordOutcome[]; receipt_id: string | null; replay: boolean }

/** The agent roster (jarvis-backend family/roster.js), id to display name. The eight active seats; a
 *  retired or unknown id reads "an Agent" so no slug ever reaches a person (refutation 3.6). */
export const AGENT_NAMES: Readonly<Record<string, string>> = {
  "michael-corleone": "Michael Corleone",
  "tony-soprano": "Tony Soprano",
  "christopher-moltisanti": "Christopher Moltisanti",
  "silvio-dante": "Silvio Dante",
  "paulie-gualtieri": "Paulie Gualtieri",
  "pablo-escobar": "Pablo Escobar",
  "paulie-cicero": "Paulie Cicero",
  "frank-lucas": "Frank Lucas",
};

export function agentDisplayName(id: unknown): string {
  return (typeof id === "string" && AGENT_NAMES[id]) || "an Agent";
}

/** A backend inbox task as GET /api/memory/tasks lists it (family/inbox.js buildTask). */
export interface BackendInboxTask {
  id: string;
  kind?: string;
  text?: string;
  name?: string;
  prio?: string | null;
  due?: string | null;
  notes?: string | null;
  agent?: string | null;
  family?: string | null;
  createdAt?: number;
}

/** The backend's own id shape (family/inbox.js isInboxId). Anything else is not an inbox item and is never sent. */
const INBOX_ID = /^inbox_[0-9a-f-]{36}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const TEXT_CAP = 500;

export interface Mapped { records: VyznRecord[]; refused: string[] }

/** Backend inbox tasks to records, pure. Only inbox_<uuid> ids are mapped (others are named in `refused`
 *  and never sent); text is trimmed to 500; due is kept when it is a date; prio is folded into notes as one
 *  line; the agent's roster name becomes the source label; createdAt becomes client_at. Every record is
 *  source_app backend-inbox, revision 1, kind task: the backend has no revisions, so a changed item there
 *  is a new id, not a new revision. */
export function backendInboxToRecords(inbox: unknown): Mapped {
  const records: VyznRecord[] = [];
  const refused: string[] = [];
  if (!Array.isArray(inbox)) return { records, refused };
  for (const raw of inbox) {
    const t = (raw ?? {}) as Partial<BackendInboxTask>;
    const id = typeof t.id === "string" ? t.id : "";
    if (!INBOX_ID.test(id)) { refused.push(id || "(no id)"); continue; }
    const text = String(t.text ?? t.name ?? "").trim().slice(0, TEXT_CAP);
    if (!text) { refused.push(id); continue; }
    const data: Record<string, unknown> = { text };
    if (typeof t.due === "string" && DATE.test(t.due)) data.due = t.due;
    const lines: string[] = [];
    if (typeof t.notes === "string" && t.notes.trim()) lines.push(t.notes.trim());
    if (typeof t.prio === "string" && t.prio.trim()) lines.push(`Priority ${t.prio.trim()}`);
    if (lines.length) data.notes = lines.join("\n");
    const rec: VyznRecord = {
      source_record_id: id,
      revision: 1,
      kind: "task",
      data,
      source: { label: `Added by ${agentDisplayName(t.agent)}` },
    };
    if (typeof t.createdAt === "number" && Number.isFinite(t.createdAt)) rec.client_at = new Date(t.createdAt).toISOString();
    records.push(rec);
  }
  return { records, refused };
}

/** Records in batches the server accepts (LIMITS.recordsPerPush). */
export function batches<T>(xs: readonly T[], size = LIMITS.recordsPerPush): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}
