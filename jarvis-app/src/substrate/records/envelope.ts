// THE RECORD ENVELOPE (PHASE0-DESIGN.md D6; docs/jarvis-unified/VYZN-SYNC-CONTRACT.md).
//
// An outside app hands JARVIS records inside one envelope, and every record lands as a proposal on the
// inbox surface (migration 0061): an app proposes, the person's tap makes the item, and a newer revision
// of a saved record never overwrites it. This module is the TS side of that contract: the types, the
// roster that turns an agent id into a name a person can read, and the one pure mapping from the backend
// inbox's shape (family/inbox.js buildTask) to records. Nothing here reads the network or the environment;
// src/push/proxy.ts does the fetching and the deleting around it.

import { LIMITS, PARAM_SCHEMAS, type RecordKind, type VyznApp } from "../gateway/protocol";
import { validate, type Schema } from "../schema";

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
/** The notes and the priority word are capped before they are folded, so one backend item can never become a
 *  200 KB proposal (the pull calls records_import directly and bypasses the gateway's byte cap; review finding 3). */
export const NOTES_CAP = 2000;
export const PRIO_CAP = 40;
/** A client_at is sent only for a createdAt that is a real moment: finite, not before the epoch, and not more
 *  than a day ahead of this clock. 8.64e15 is a legal Date but reads +275760, which the gateway pattern refuses. */
const CLIENT_AT_SLACK_MS = 86_400_000;

/** A yyyy-mm-dd that names a real calendar day (2026-13-45 matches the regex and is not one). */
function isCalendarDate(s: string): boolean {
  if (!DATE.test(s)) return false;
  const t = Date.parse(s + "T00:00:00Z");
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

function clientAtOf(createdAt: unknown, now: number): string | undefined {
  if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) return undefined;
  if (createdAt < 0 || createdAt > now + CLIENT_AT_SLACK_MS) return undefined;
  return new Date(createdAt).toISOString();
}

/** The one record shape the gateway accepts (PARAM_SCHEMAS["record.push"].fields.records.items), read from the
 *  protocol so the pull can never send a record record.push would refuse. */
function recordItemSchema(): Schema {
  const push = PARAM_SCHEMAS["record.push"];
  const records = push.type === "object" ? push.fields.records : undefined;
  if (!records || records.type !== "array") throw new Error("record.push schema no longer carries a records list");
  return records.items;
}
export const RECORD_ITEM_SCHEMA: Schema = recordItemSchema();

/** Pure: every record that the gateway schema would refuse moves to `refused` under its source_record_id, so one
 *  bad item never stalls the batch it would have shared (the server refuses a batch whole). */
export function validateRecords(records: readonly VyznRecord[]): Mapped {
  const ok: VyznRecord[] = [];
  const refused: string[] = [];
  for (const r of records) {
    if (validate(r, RECORD_ITEM_SCHEMA).ok) ok.push(r);
    else refused.push(r.source_record_id);
  }
  return { records: ok, refused };
}

export interface Mapped { records: VyznRecord[]; refused: string[] }

/** Backend inbox tasks to records, pure. Only inbox_<uuid> ids are mapped (others are named in `refused`
 *  and never sent); text is trimmed to 500; due is kept when it is a date; prio is folded into notes as one
 *  line; the agent's roster name becomes the source label; createdAt becomes client_at. Every record is
 *  source_app backend-inbox, revision 1, kind task: the backend has no revisions, so a changed item there
 *  is a new id, not a new revision. */
export function backendInboxToRecords(inbox: unknown, now: number = Date.now()): Mapped {
  const records: VyznRecord[] = [];
  const refused: string[] = [];
  if (!Array.isArray(inbox)) return { records, refused };
  for (const raw of inbox) {
    const t = (raw ?? {}) as Partial<BackendInboxTask>;
    const id = typeof t.id === "string" ? t.id : "";
    if (!INBOX_ID.test(id)) { refused.push(id || "(no id)"); continue; }
    // The text must be a string: an object would read "[object Object]" and land as a 15 character task.
    const given = t.text ?? t.name;
    if (typeof given !== "string") { refused.push(id); continue; }
    const text = given.trim().slice(0, TEXT_CAP);
    if (!text) { refused.push(id); continue; }
    const data: Record<string, unknown> = { text };
    if (typeof t.due === "string" && isCalendarDate(t.due)) data.due = t.due;
    const lines: string[] = [];
    if (typeof t.notes === "string" && t.notes.trim()) lines.push(t.notes.trim().slice(0, NOTES_CAP));
    if (typeof t.prio === "string" && t.prio.trim()) lines.push(`Priority ${t.prio.trim().slice(0, PRIO_CAP)}`);
    if (lines.length) data.notes = lines.join("\n");
    const rec: VyznRecord = {
      source_record_id: id,
      revision: 1,
      kind: "task",
      data,
      source: { label: `Added by ${agentDisplayName(t.agent)}` },
    };
    const clientAt = clientAtOf(t.createdAt, now);
    if (clientAt) rec.client_at = clientAt;
    records.push(rec);
  }
  // The gateway's own schema has the last word, so a record it would refuse is never sent and never stalls a batch.
  const checked = validateRecords(records);
  return { records: checked.records, refused: [...refused, ...checked.refused] };
}

/** Records in batches the server accepts (LIMITS.recordsPerPush). */
export function batches<T>(xs: readonly T[], size = LIMITS.recordsPerPush): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}
