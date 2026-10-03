// REVIEW THIS CAPTURE (docs/jarvis-unified, slice 06; IMPLEMENTATION-SPEC.md
// 08 E08, E09, E24; 09 M3; 10.1 steps 4, 6, 8; 13). One sheet for every
// kind: the typed fields, the words that came from the email beside the words
// the person typed, the source quoted, and ONE primary that commits exactly
// what the fields say (Save Bill, Save Receipt, Add Task, Add to Schedule,
// Track This), once, with no second question. Save Changes keeps an edit on
// the card and writes nothing anywhere else. A field the rules could not
// read is named, and the primary stays shut until it is filled; a time that
// happens twice asks for the offset; a module that is not ready says so and
// keeps its door shut while the card stays. Manual capture is this sheet
// with empty fields: it needs no model and no network beyond the save.

import { useEffect, useMemo, useState } from "react";
import { FormSheet, Group, FieldRow, MenuRow, Note, SwitchRow, TextRow, ErrorLine } from "../shared/FormSheet";
import { Calendar, Clock, DollarSign, Hourglass, Tag } from "../shared/icons";
import { showToast } from "../shared/toast";
import { approveCapture, editCandidate, undoCapture, UNDO_TOAST_MS } from "../substrate/commands/captures";
import { lineFor, type RpcClient } from "../substrate/commands/errors";
import { adapterFor } from "../substrate/destinations/registry";
import type { DestinationAdapter, PrepareContext } from "../substrate/destinations/types";
import type { CaptureKind, CapturePayload } from "../substrate/contracts";
import { readNumber } from "../substrate/extract/money";
import { instantOf } from "../substrate/extract/dates";
import { EMAIL_CHANGED, ENTERED_BY_YOU, FROM_THE_EMAIL, KEEP_IN_EMAIL, NOT_SAVED_YET, NO_DUE_DATE, SAVES_ONLY, SAVE_CHANGES, SOURCE_EVIDENCE, UNDO } from "./copy";
import { KIND_WORD, PRIMARY, shortZone, toCard, type Candidate } from "./candidates";
import type { InboxRow } from "./emailClient";

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "NZD", "CHF", "MXN"];
const ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "UTC", "Europe/London", "Europe/Berlin"];

type Draft = Record<string, string | boolean>;

const pad = (n: number): string => String(n).padStart(2, "0");
function clockIn(instant: string, zone: string): { date: string; time: string } {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(instant));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const hour = get("hour") === "24" ? "00" : get("hour");
    return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${hour}:${get("minute")}` };
  } catch {
    return { date: instant.slice(0, 10), time: instant.slice(11, 16) };
  }
}
const cents = (minor: number): string => (minor > 0 ? `${Math.floor(minor / 100)}.${pad(minor % 100)}` : "");

/** The fields as the person edits them, from the card's payload. */
export function draftOf(p: CapturePayload, zone: string): Draft {
  switch (p.kind) {
    case "bill": return { issuer: p.issuer, amount: cents(p.amount.minor_units), currency: p.amount.currency, due_date: p.due_date ?? "", no_due_date: p.no_due_date_confirmed, invoice_number: p.invoice_number ?? "" };
    case "receipt": return { merchant: p.merchant, amount: cents(p.amount.minor_units), currency: p.amount.currency, purchase_date: p.purchase_date, transaction_type: p.transaction_type };
    case "task": return { title: p.title, due_date: p.due_date ?? "", notes: p.notes };
    case "event": {
      const z = p.time.all_day ? zone : p.time.timezone || zone;
      if (p.time.all_day) return { title: p.title, date: p.time.start_date, start: "", end: "", zone: z, location: p.location ?? "", offset: "" };
      const s = clockIn(p.time.start_at, z);
      const e = clockIn(p.time.end_at, z);
      return { title: p.title, date: s.date, start: s.time, end: e.time, zone: z, location: p.location ?? "", offset: p.time.selected_offset };
    }
    case "waiting": return { title: p.title, waiting_for: p.waiting_for, counterparty: p.counterparty_display, follow_up_on: p.follow_up_on ?? "" };
  }
}

export interface Built { payload: CapturePayload; missing: string[]; offsets?: string[] }

/** The payload the fields describe, and the fields that are still empty or unreadable. */
export function payloadOf(kind: CaptureKind, d: Draft, base: CapturePayload): Built {
  const str = (k: string): string => String(d[k] ?? "").trim();
  const missing: string[] = [];
  const amountOf = (): { minor_units: number; currency: string } => {
    const n = str("amount") ? readNumber(str("amount")) : { minor_units: null, ambiguous: true };
    if (!n.minor_units) missing.push("amount");
    const currency = str("currency").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) missing.push("currency");
    return { minor_units: n.minor_units ?? 0, currency };
  };
  const dateOk = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s);
  switch (kind) {
    case "bill": {
      const amount = amountOf();
      if (!str("issuer")) missing.push("issuer");
      const no = d.no_due_date === true;
      const due = str("due_date");
      if (!no && !dateOk(due)) missing.push("due_date");
      const payload: CapturePayload = { kind: "bill", issuer: str("issuer"), amount, due_date: no ? null : dateOk(due) ? due : null, no_due_date_confirmed: no, ...(str("invoice_number") ? { invoice_number: str("invoice_number") } : {}) };
      return { payload, missing };
    }
    case "receipt": {
      const amount = amountOf();
      if (!str("merchant")) missing.push("merchant");
      if (!dateOk(str("purchase_date"))) missing.push("purchase_date");
      return { payload: { kind: "receipt", merchant: str("merchant"), amount, purchase_date: str("purchase_date"), transaction_type: str("transaction_type") === "refund" ? "refund" : "purchase" }, missing };
    }
    case "task": {
      if (!str("title")) missing.push("title");
      const due = str("due_date");
      if (due && !dateOk(due)) missing.push("due_date");
      return { payload: { kind: "task", title: str("title"), due_date: dateOk(due) ? due : null, notes: str("notes") }, missing };
    }
    case "event": {
      if (!str("title")) missing.push("title");
      const date = str("date");
      const start = str("start");
      const end = str("end");
      const zone = str("zone");
      if (!dateOk(date)) missing.push("date");
      if (!/^\d{2}:\d{2}$/.test(start)) missing.push("time");
      if (!zone) missing.push("timezone");
      const prior = base.kind === "event" ? base : null;
      let time: CapturePayload extends infer _ ? Extract<CapturePayload, { kind: "event" }>["time"] : never;
      let offsets: string[] | undefined;
      if (dateOk(date) && /^\d{2}:\d{2}$/.test(start) && zone) {
        const [sh, sm] = start.split(":").map(Number) as [number, number];
        const s = instantOf(date, sh, sm, zone, str("offset") || undefined);
        const [eh, em] = (/^\d{2}:\d{2}$/.test(end) ? end : start).split(":").map(Number) as [number, number];
        const endMinutes = /^\d{2}:\d{2}$/.test(end) ? eh * 60 + em : sh * 60 + sm + 60;
        const e = instantOf(date, Math.floor((endMinutes % 1440) / 60), endMinutes % 60, zone, str("offset") || undefined);
        if (!s.ok) {
          if (s.why === "ambiguous") { missing.push("selected_offset"); offsets = s.offsets; }
          else if (s.why === "nonexistent") missing.push("time");
          else missing.push("timezone");
        }
        if (s.ok && e.ok && Date.parse(e.iso) <= Date.parse(s.iso)) missing.push("end");
        time = { all_day: false, start_at: s.ok ? s.iso : `${date}T${start}:00.000Z`, end_at: e.ok ? e.iso : `${date}T${start}:00.000Z`, timezone: zone, selected_offset: s.ok ? s.offset : "" };
      } else {
        time = prior?.time ?? { all_day: false, start_at: new Date(0).toISOString(), end_at: new Date(0).toISOString(), timezone: zone, selected_offset: "" };
      }
      return { payload: { kind: "event", title: str("title"), time, location: str("location") || null, external_uid: prior?.external_uid ?? null }, missing, ...(offsets ? { offsets } : {}) };
    }
    case "waiting": {
      if (!str("title")) missing.push("title");
      if (!str("waiting_for")) missing.push("waiting_for");
      if (!str("counterparty")) missing.push("counterparty_display");
      const f = str("follow_up_on");
      if (f && !dateOk(f)) missing.push("follow_up_on");
      const prior = base.kind === "waiting" ? base : null;
      return { payload: { kind: "waiting", title: str("title"), waiting_for: str("waiting_for"), counterparty_display: str("counterparty"), contact_id: prior?.contact_id ?? null, follow_up_on: dateOk(f) ? f : null }, missing };
    }
  }
}

const FIELD_WORD: Record<string, string> = {
  issuer: "Issuer", merchant: "Merchant", amount: "Amount", currency: "Currency", due_date: "Due Date", purchase_date: "Purchase Date", title: "Title", date: "Date", time: "Start",
  end: "End", timezone: "Time Zone", selected_offset: "Offset", waiting_for: "Waiting For", counterparty_display: "From", follow_up_on: "Follow Up", transaction_type: "Type", notes: "Notes", location: "Location",
};
export const missingLine = (missing: string[]): string | null => (missing.length ? `Needs ${missing.map((m) => FIELD_WORD[m] ?? m).join(", ")}` : null);

export default function CaptureSheet({ client, candidate, row, ctx, ready, readyLine, offline, evidenceText, onClose, onChanged }: {
  client: RpcClient;
  candidate: Candidate;
  row: Pick<InboxRow, "id" | "thread_id" | "account" | "snippet">;
  ctx: PrepareContext;
  ready: (kind: CaptureKind) => boolean;
  readyLine: (kind: CaptureKind) => string;
  offline: boolean;
  /** The message's text, when it is open; the snippet otherwise. */
  evidenceText?: string;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const kind = candidate.kind;
  const initial = useMemo(() => draftOf(candidate.payload, ctx.zone), [candidate.payload, ctx.zone]);
  const [d, setD] = useState<Draft>(initial);
  const [line, setLine] = useState<string | null>(null);
  const [busy, setBusy] = useState<"edit" | "save" | null>(null);
  const [check, setCheck] = useState<{ ok: boolean; missing: string[]; reason: string | null; summary: string | null }>({ ok: false, missing: candidate.missing_fields, reason: null, summary: null });
  const set = (k: string, v: string | boolean) => setD((x) => ({ ...x, [k]: v }));
  const built = useMemo(() => payloadOf(kind, d, candidate.payload), [kind, d, candidate.payload]);
  const dirty = Object.keys(initial).some((k) => initial[k] !== d[k]);
  const userFields = Object.keys(initial).filter((k) => initial[k] !== d[k]);

  // Every keystroke runs the adapter's own pure check, so the sheet says
  // exactly what the module would refuse, before anything is sent.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (built.missing.length) { setCheck({ ok: false, missing: built.missing, reason: null, summary: null }); return; }
      const adapter = adapterFor(kind) as unknown as DestinationAdapter<CapturePayload>;
      const r = await adapter.prepare(built.payload, [], ctx);
      if (!alive) return;
      if (r.ok) setCheck({ ok: true, missing: [], reason: null, summary: r.displaySummary });
      else setCheck({ ok: false, missing: r.missing, reason: r.reason, summary: null });
    })();
    return () => { alive = false; };
  }, [built, kind, ctx]);

  const excerpt = (evidenceText ?? row.snippet ?? "").slice(0, 2000);
  const prov = candidate.provenance_by_field;
  const provLine = Object.keys(d).filter((k) => k in FIELD_WORD).map((k) => {
    const typed = userFields.includes(k) || prov[k]?.entered_by_user;
    const p = prov[k];
    const from = typed ? ENTERED_BY_YOU : p?.source === "sender" ? "Sender" : p?.source === "message_date" ? "Message Date" : p?.source === "default" ? "Assumed" : p ? FROM_THE_EMAIL : null;
    return from ? `${FIELD_WORD[k]} · ${from}` : null;
  }).filter(Boolean).join(" · ");

  const saveChanges = async (): Promise<Candidate | null> => {
    const r = await editCandidate(client, candidate, built.payload as unknown as Record<string, unknown>, userFields, check.missing);
    if (!r.ok) { setLine(r.code === "SOURCE_CHANGED" ? EMAIL_CHANGED : lineFor(r)); return null; }
    return { ...candidate, revision: r.value.revision, payload_hash: r.value.payload_hash ?? candidate.payload_hash, payload: built.payload, missing_fields: check.missing, status: r.value.status as Candidate["status"] };
  };

  const onSaveChanges = async () => {
    if (busy) return;
    setBusy("edit"); setLine(null);
    const next = await saveChanges();
    setBusy(null);
    if (!next) return;
    await onChanged();
    onClose();
  };

  const commit = async () => {
    if (busy || !check.ok) return;
    if (!ready(kind)) { setLine(readyLine(kind)); return; }
    setBusy("save"); setLine(null);
    let current = candidate;
    if (dirty || candidate.missing_fields.length) {
      const next = await saveChanges();
      if (!next) { setBusy(null); return; }
      current = next;
    }
    const r = await approveCapture(client, toCard(current, excerpt), ctx, { ready });
    setBusy(null);
    if (!r.ok) {
      setLine(r.code === "SOURCE_CHANGED" ? EMAIL_CHANGED : lineFor(r));
      await onChanged();
      return;
    }
    const a = r.value;
    await onChanged();
    const canUndo = !!a.item_updated_at && !a.already;
    showToast({ message: a.safe_message, ...(canUndo ? { actionLabel: UNDO, onAction: () => void (async () => { const u = await undoCapture(client, a.action_id, a.item_updated_at!); showToast({ message: u.ok ? u.value.safe_message : lineFor(u) }); await onChanged(); })() } : {}) }, UNDO_TOAST_MS);
    onClose();
  };

  const miss = (k: string) => check.missing.includes(k) || built.missing.includes(k);
  const zoneOptions = [...new Set([...ZONES, ctx.zone])].map((z) => ({ value: z, label: shortZone(z) }));

  return (
    <FormSheet title={`${KIND_WORD[kind]} · ${NOT_SAVED_YET}`} onCancel={onClose} onSave={() => void commit()} saveLabel={PRIMARY[kind]} saveDisabled={!check.ok || !ready(kind) || offline || busy !== null} dirty={dirty}>
      {kind === "bill" && (
        <Group label="Bill">
          <FieldRow label="Issuer" value={String(d.issuer)} onChange={(v) => set("issuer", v)} placeholder="Who Is Owed" ariaLabel="Issuer" error={miss("issuer")} />
          <FieldRow label="Amount" value={String(d.amount)} onChange={(v) => set("amount", v)} placeholder="142.30" inputMode="decimal" ariaLabel="Amount" error={miss("amount")} />
          <MenuRow tone="green" glyph={<DollarSign className="ic" />} label="Currency" value={String(d.currency)} options={CURRENCIES.map((c) => ({ value: c, label: c }))} onPick={(v) => set("currency", v)} ariaLabel="Currency" word={String(d.currency) || "Pick"} />
          <FieldRow label="Due Date" type="date" value={String(d.due_date)} onChange={(v) => set("due_date", v)} ariaLabel="Due Date" error={miss("due_date")} />
          <SwitchRow tone="green" glyph={<Calendar className="ic" />} label={NO_DUE_DATE} on={d.no_due_date === true} onToggle={() => set("no_due_date", d.no_due_date !== true)} ariaLabel={NO_DUE_DATE} />
          <FieldRow label="Invoice Number" value={String(d.invoice_number)} onChange={(v) => set("invoice_number", v)} placeholder="Optional" ariaLabel="Invoice Number" />
        </Group>
      )}
      {kind === "receipt" && (
        <Group label="Receipt">
          <FieldRow label="Merchant" value={String(d.merchant)} onChange={(v) => set("merchant", v)} placeholder="Who Was Paid" ariaLabel="Merchant" error={miss("merchant")} />
          <FieldRow label="Amount" value={String(d.amount)} onChange={(v) => set("amount", v)} placeholder="284.10" inputMode="decimal" ariaLabel="Amount" error={miss("amount")} />
          <MenuRow tone="green" glyph={<DollarSign className="ic" />} label="Currency" value={String(d.currency)} options={CURRENCIES.map((c) => ({ value: c, label: c }))} onPick={(v) => set("currency", v)} ariaLabel="Currency" word={String(d.currency) || "Pick"} />
          <FieldRow label="Purchase Date" type="date" value={String(d.purchase_date)} onChange={(v) => set("purchase_date", v)} ariaLabel="Purchase Date" error={miss("purchase_date")} />
          <MenuRow tone="green" glyph={<Tag className="ic" />} label="Type" value={String(d.transaction_type)} options={[{ value: "purchase", label: "Purchase" }, { value: "refund", label: "Refund" }]} onPick={(v) => set("transaction_type", v)} ariaLabel="Type" word={d.transaction_type === "refund" ? "Refund" : "Purchase"} />
        </Group>
      )}
      {kind === "task" && (
        <Group label="Task">
          <FieldRow label="Title" value={String(d.title)} onChange={(v) => set("title", v)} placeholder="What to Do" ariaLabel="Title" error={miss("title")} />
          <FieldRow label="Due Date" type="date" value={String(d.due_date)} onChange={(v) => set("due_date", v)} ariaLabel="Due Date" error={miss("due_date")} />
          <TextRow value={String(d.notes)} onChange={(v) => set("notes", v)} placeholder="Notes" ariaLabel="Notes" rows={2} />
        </Group>
      )}
      {kind === "event" && (
        <Group label="Event">
          <FieldRow label="Title" value={String(d.title)} onChange={(v) => set("title", v)} placeholder="What It Is" ariaLabel="Title" error={miss("title")} />
          <FieldRow label="Date" type="date" value={String(d.date)} onChange={(v) => set("date", v)} ariaLabel="Date" error={miss("date")} />
          <FieldRow label="Start" type="time" value={String(d.start)} onChange={(v) => set("start", v)} ariaLabel="Start" error={miss("time")} />
          <FieldRow label="End" type="time" value={String(d.end)} onChange={(v) => set("end", v)} ariaLabel="End" error={miss("end")} />
          <MenuRow tone="blue" glyph={<Clock className="ic" />} label="Time Zone" value={String(d.zone)} options={zoneOptions} onPick={(v) => set("zone", v)} ariaLabel="Time Zone" word={d.zone ? shortZone(String(d.zone)) : "Pick"} />
          {built.offsets && (
            <MenuRow tone="blue" glyph={<Clock className="ic" />} label="Offset" value={String(d.offset)} options={built.offsets.map((o) => ({ value: o, label: `UTC${o}` }))} onPick={(v) => set("offset", v)} ariaLabel="Offset" word={String(d.offset) || "Pick"} />
          )}
          <FieldRow label="Location" value={String(d.location)} onChange={(v) => set("location", v)} placeholder="Optional" ariaLabel="Location" />
        </Group>
      )}
      {kind === "waiting" && (
        <Group label="Waiting On">
          <FieldRow label="Title" value={String(d.title)} onChange={(v) => set("title", v)} placeholder="What You're Waiting For" ariaLabel="Title" error={miss("title")} />
          <FieldRow label="Waiting For" value={String(d.waiting_for)} onChange={(v) => set("waiting_for", v)} placeholder="The Thing" ariaLabel="Waiting For" error={miss("waiting_for")} />
          <FieldRow label="From" value={String(d.counterparty)} onChange={(v) => set("counterparty", v)} placeholder="Who" ariaLabel="From" error={miss("counterparty_display")} />
          <FieldRow label="Follow Up" type="date" value={String(d.follow_up_on)} onChange={(v) => set("follow_up_on", v)} ariaLabel="Follow Up" error={miss("follow_up_on")} />
          <Note><Hourglass className="ic" /> {SAVES_ONLY.waiting}</Note>
        </Group>
      )}
      <ErrorLine text={line ?? check.reason ?? missingLine(check.missing)} />
      {check.summary && <Note>{check.summary}</Note>}
      {!ready(kind) && <Note>{readyLine(kind)}</Note>}
      <Group label={SOURCE_EVIDENCE}>
        <div className="email-evidence">{excerpt || row.snippet}</div>
        {provLine && <Note>{provLine}</Note>}
        <Note>{SAVES_ONLY[kind]}</Note>
      </Group>
      <div className="email-sheet-acts">
        <button className="quiet-action" onClick={() => void onSaveChanges()} disabled={!dirty || busy !== null}>{SAVE_CHANGES}</button>
        <button className="quiet-action" onClick={onClose}>{KEEP_IN_EMAIL}</button>
      </div>
    </FormSheet>
  );
}
