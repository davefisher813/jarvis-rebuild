// THE APPROVED TEMPLATES (IMPLEMENTATION-SPEC.md 10, the card catalog; 10.1
// steps 2 to 5). Five kinds, each with its own explicit trigger: a bill needs
// the words that say an amount is owed; a receipt the words that say it was
// paid; a task an explicit request to the reader with a clear verb; an event
// a meeting word with a date and a clock, or an ICS; a waiting the sender's
// own promise to get something to the reader. Sender branding alone matches
// nothing. Where a template cannot read a required field it says which one,
// and the card asks; it never guesses. A bill's date never becomes a task or
// an event; a receipt is never a bill; a flight's receipt and its itinerary
// are two separate cards or none.

import type { BillPayload, CapturePayload, EventPayload, ReceiptPayload, TaskPayload, WaitingPayload } from "../contracts";
import { titleCase } from "../../shared/casing";
import { isMachineAddress } from "../../messages/noReply";
import { readIcs } from "../../messages/ics";
import { amountNear, findAmounts, type AmountHit } from "./money";
import { dateInZone, dateNear, durationIn, findDates, findTimes, instantOf, zoneIn, type DateHit, type TimeHit } from "./dates";
import { sentencesOf, tidy } from "./text";

export interface Provenance {
  /** Where the value came from: the email's text (with offsets), the sender's identity, the message's own date, a default the card shows, or the person. */
  source: "email" | "sender" | "message_date" | "default" | "user";
  text_start?: number;
  text_end?: number;
  structured_path?: string;
  note?: string;
}

export interface Extracted {
  kind: CapturePayload["kind"];
  payload: CapturePayload;
  provenance: Record<string, Provenance>;
  missing: string[];
  /** The fields that make this card the same card next time (10.1 step 7). */
  identity: Record<string, string | number | null>;
  template: string;
}

export interface TemplateInput {
  /** The one string the rules read (text.ts sourceText). */
  text: string;
  from_address: string;
  from_name: string;
  /** The mailbox's own address: a promise in the person's own words is not something they wait on. */
  account: string;
  /** The message's receipt instant. */
  internal_date: string;
  /** The reader's IANA zone, for anchoring relative words and reading an ICS. */
  zone: string;
}

const BILL_WORDS = /\b(amount due|balance due|payment due|total due|minimum (?:payment )?due|now due|is due|invoice|statement (?:is )?(?:now )?(?:ready|available)|bill is ready|your (?:\w+ )?bill\b|past due|overdue|pay by|please pay)\b/i;
const OWED_WORDS = /\b(amount due|balance due|payment due|total due|minimum (?:payment )?due|now due|is due|past due|overdue|please pay|pay by)\b/i;
const PAID_WORDS = /\b(receipt|total paid|amount paid|payment received|payment confirmation|thank you for your (?:payment|purchase|order)|thanks for your (?:payment|purchase|order)|you paid|paid in full|order confirmation|your order|was charged|has been charged|refund(?:ed)?)\b/i;
const MEETING_WORDS = /\b(call|meeting|meet|chat|appointment|interview|practice|game|session|visit|conference|webinar|class|lesson|rehearsal|checkup|check-up|consult(?:ation)?)\b/i;
const FLIGHT_WORDS = /\b(flight|depart(?:s|ure|ing)?|itinerary|boarding)\b/i;

const span = (h: { start: number; end: number }): Provenance => ({ source: "email", text_start: h.start, text_end: h.end });
const issuerOf = (input: TemplateInput): string => {
  const name = tidy(input.from_name);
  if (name) return name;
  const domain = input.from_address.split("@")[1] ?? "";
  return titleCase(domain.split(".")[0] ?? input.from_address);
};
const anchor = (input: TemplateInput): string => dateInZone(input.internal_date, input.zone);

function money(hit: AmountHit | null, prov: Record<string, Provenance>, missing: string[], field = "amount"): { minor_units: number; currency: string } {
  if (!hit) { missing.push(field, "currency"); return { minor_units: 0, currency: "" }; }
  prov[field] = span(hit);
  if (hit.ambiguous || hit.minor_units === null) missing.push(field);
  if (!hit.currency) missing.push("currency");
  else prov.currency = span(hit);
  return { minor_units: hit.minor_units ?? 0, currency: hit.currency ?? "" };
}

// ---- bill -----------------------------------------------------------------

export function billTemplate(input: TemplateInput): Extracted | null {
  const { text } = input;
  if (!BILL_WORDS.test(text)) return null;
  // Words that say it was paid, and none that say it is owed: not a bill.
  if (PAID_WORDS.test(text) && !OWED_WORDS.test(text)) return null;
  const amounts = findAmounts(text);
  const hit = amountNear(amounts, text, /\b(amount|balance|payment|total|minimum|due|owed|pay)\b/i) ?? (amounts.length === 1 ? amounts[0]! : null);
  const dates = findDates(text, anchor(input));
  const due = dateNear(dates, text, /\b(due|by|before|pay|until|no later than)\b/i);
  const prov: Record<string, Provenance> = { issuer: { source: "sender" } };
  const missing: string[] = [];
  const amount = money(hit, prov, missing);
  let due_date: string | null = null;
  if (due) {
    if (due.iso && !due.relative && !due.ambiguous) { due_date = due.iso; prov.due_date = span(due); }
    else { missing.push("due_date"); prov.due_date = { ...span(due), note: due.relative ? "relative" : "ambiguous" }; }
  } else {
    missing.push("due_date");
  }
  const inv = /\binvoice\s*(?:#|no\.?|number|num\.?)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{2,24})\b/i.exec(text);
  const looksLikeYear = (s: string): boolean => /^\d{4}$/.test(s) && Number(s) >= 1900 && Number(s) <= 2100;
  const payload: BillPayload = { kind: "bill", issuer: issuerOf(input), amount, due_date, no_due_date_confirmed: false, ...(inv && !looksLikeYear(inv[1]!) ? { invoice_number: inv[1]! } : {}) };
  if (payload.invoice_number) prov.invoice_number = span({ start: inv!.index, end: inv!.index + inv![0].length });
  return {
    kind: "bill", payload, provenance: prov, missing: [...new Set(missing)],
    identity: { issuer: payload.issuer.toLowerCase(), minor_units: amount.minor_units || null, currency: amount.currency || null, due_date: due_date ?? (due?.iso ?? null) },
    template: "bill.owed",
  };
}

// ---- receipt --------------------------------------------------------------

export function receiptTemplate(input: TemplateInput): Extracted | null {
  const { text } = input;
  if (!PAID_WORDS.test(text) || OWED_WORDS.test(text)) return null;
  const amounts = findAmounts(text);
  const hit = amountNear(amounts, text, /\b(total|paid|amount|charged|payment|order|refund)\b/i) ?? (amounts.length === 1 ? amounts[0]! : null);
  if (!hit && amounts.length === 0) return null;
  const dates = findDates(text, anchor(input));
  const when = dateNear(dates, text, /\b(purchase|paid|payment|order|transaction|charged|date|on)\b/i);
  const prov: Record<string, Provenance> = { merchant: { source: "sender" } };
  const missing: string[] = [];
  const amount = money(hit, prov, missing);
  let purchase_date: string;
  if (when && when.iso && !when.relative && !when.ambiguous) { purchase_date = when.iso; prov.purchase_date = span(when); }
  else { purchase_date = anchor(input); prov.purchase_date = { source: "message_date", structured_path: "message.internal_date" }; }
  const refund = /\brefund(?:ed)?\b/i.test(text);
  const payload: ReceiptPayload = { kind: "receipt", merchant: issuerOf(input), amount, purchase_date, transaction_type: refund ? "refund" : "purchase" };
  return {
    kind: "receipt", payload, provenance: prov, missing: [...new Set(missing)],
    identity: { merchant: payload.merchant.toLowerCase(), minor_units: amount.minor_units || null, currency: amount.currency || null, purchase_date, transaction_type: payload.transaction_type },
    template: refund ? "receipt.refund" : "receipt.paid",
  };
}

// ---- task -----------------------------------------------------------------

const NOT_A_TASK_VERB = /^(find|see|note|let|feel|be|have|disregard|ignore|pay|remit|believe|know|imagine|tell|think|visit|click|unsubscribe|enjoy|rest|take|hesitate|contact|reach|call|join|meet)$/i;
const MONEY_SENTENCE = /\b(pay|payment|invoice|bill|balance|amount|due\b.*\$|\$|€|£|USD|EUR|GBP)\b/i;

export function taskTemplate(input: TemplateInput, suppressDates: Set<string>): Extracted | null {
  const { text } = input;
  const anchorISO = anchor(input);
  for (const s of sentencesOf(text)) {
    const m = /\b(?:can|could|would|will)\s+you\s+(?:please\s+)?([a-z]+)\b([^?.!\n]{0,90})/i.exec(s.text) ?? /\bplease\s+([a-z]+)\b([^?.!\n]{0,90})/i.exec(s.text) ?? /\breminder:?\s+(?:to\s+)?([a-z]+)\b([^?.!\n]{0,90})/i.exec(s.text);
    if (!m) continue;
    const verb = m[1]!;
    if (NOT_A_TASK_VERB.test(verb)) continue;
    if (MONEY_SENTENCE.test(s.text)) continue;
    const dates = findDates(s.text, anchorISO);
    const due = dates[0] ?? null;
    if (due && due.iso && suppressDates.has(due.iso)) continue;
    let rest = m[2] ?? "";
    if (due) rest = rest.replace(s.text.slice(due.start, due.end), "");
    rest = rest.replace(/\b(by|before|no later than|until|on|at|due)\s*$/i, "").replace(/\s+(by|before|no later than|until|due)\s*$/i, "");
    const title = titleCase(tidy(`${verb} ${tidy(rest)}`)).slice(0, 80);
    if (title.split(" ").length < 2) continue;
    const prov: Record<string, Provenance> = { title: span({ start: s.start + m.index, end: s.start + m.index + m[0].length }) };
    const missing: string[] = [];
    let due_date: string | null = null;
    if (due) {
      if (due.iso && !due.relative && !due.ambiguous) { due_date = due.iso; prov.due_date = span({ start: s.start + due.start, end: s.start + due.end }); }
      else { missing.push("due_date"); prov.due_date = { source: "email", text_start: s.start + due.start, text_end: s.start + due.end, note: due.relative ? "relative" : "ambiguous" }; }
    } else {
      prov.due_date = { source: "default", note: "No deadline was stated" };
    }
    const payload: TaskPayload = { kind: "task", title, due_date, notes: "" };
    return { kind: "task", payload, provenance: prov, missing, identity: { title: title.toLowerCase(), due_date }, template: "task.request" };
  }
  return null;
}

// ---- event ----------------------------------------------------------------

function eventFromClock(input: TemplateInput, title: string, date: DateHit, time: TimeHit, zoneHint: string | null, durationMin: number | null, titleProv: Provenance, uid: string | null, template: string): Extracted {
  const prov: Record<string, Provenance> = { title: titleProv, date: span(date), time: span(time) };
  const missing: string[] = [];
  const zone = time.zone ?? zoneHint;
  if (!zone) { missing.push("timezone"); prov.timezone = { source: "default", note: "No zone was stated" }; }
  else prov.timezone = time.zone ? span(time) : { source: "email", note: "Named elsewhere in the message" };
  let dateISO = date.iso;
  if (!dateISO || date.relative || date.ambiguous) { missing.push("date"); prov.date = { ...span(date), note: date.relative ? "relative" : "ambiguous" }; }
  if (!dateISO) dateISO = anchor(input);
  const mins = time.endHH !== undefined ? ((time.endHH * 60 + (time.endMM ?? 0)) - (time.hh * 60 + time.mm) + 1440) % 1440 || 60 : durationMin ?? 60;
  if (time.endHH === undefined && durationMin === null) prov.duration = { source: "default", note: "An hour, until you say otherwise" };
  else if (durationMin !== null && time.endHH === undefined) prov.duration = { source: "email", note: `${durationMin} minutes, as stated` };
  const z = zone ?? input.zone;
  const start = instantOf(dateISO, time.hh, time.mm, z);
  const endMinutes = time.hh * 60 + time.mm + mins;
  const endDate = endMinutes >= 1440 ? dateISO : dateISO;
  const end = instantOf(endDate, Math.floor((endMinutes % 1440) / 60), endMinutes % 60, z);
  if (!start.ok) {
    if (start.why === "ambiguous") { missing.push("selected_offset"); prov.selected_offset = { source: "default", note: `This clock happens twice that day · ${(start.offsets ?? []).join(" or ")}` }; }
    else if (start.why === "nonexistent") { missing.push("time"); prov.time = { ...span(time), note: "This clock does not exist that day in that zone" }; }
  }
  const startISO = start.ok ? start.iso : `${dateISO}T${String(time.hh).padStart(2, "0")}:${String(time.mm).padStart(2, "0")}:00.000Z`;
  const endISO = end.ok ? end.iso : new Date(Date.parse(startISO) + mins * 60000).toISOString();
  const payload: EventPayload = {
    kind: "event", title, location: null, external_uid: uid,
    time: { all_day: false, start_at: startISO, end_at: endISO, timezone: zone ?? "", selected_offset: start.ok ? start.offset : "" },
  };
  return { kind: "event", payload, provenance: prov, missing: [...new Set(missing)], identity: { title: title.toLowerCase(), start_at: startISO, uid }, template };
}

export function eventTemplate(input: TemplateInput, billDates: Set<string>): Extracted | null {
  const { text } = input;
  // An ICS in the text is the structured path (10.1 step 3).
  if (/BEGIN:VCALENDAR/.test(text)) {
    const read = readIcs(text, { zone: input.zone });
    const ev = read.event;
    if (ev && ev.status !== "cancelled" && ev.method !== "CANCEL") {
      const recurring = /^RRULE:/m.test(text);
      const dateHit: DateHit = { iso: ev.sourceDate ?? ev.date, start: 0, end: 0, raw: "ics", relative: false, ambiguous: false };
      const clock = ev.sourceStart ?? ev.start;
      if (clock && !ev.timeUncertain) {
        const timeHit: TimeHit = { hh: Number(clock.slice(0, 2)), mm: Number(clock.slice(3, 5)), start: 0, end: 0, zone: ev.zoneUnresolved ? null : ev.sourceZone ?? input.zone };
        const out = eventFromClock(input, titleCase(tidy(ev.title)) || "Calendar Event", dateHit, timeHit, null, ev.durationMin ?? null, { source: "email", structured_path: "ics.SUMMARY" }, ev.uid ?? null, "event.ics");
        out.provenance.date = { source: "email", structured_path: "ics.DTSTART" };
        out.provenance.time = { source: "email", structured_path: "ics.DTSTART" };
        if (recurring) { out.missing.push("recurrence"); out.provenance.recurrence = { source: "email", structured_path: "ics.RRULE", note: "Recurring Event · Open Gmail to Review" }; }
        return out;
      }
    }
  }
  const anchorISO = anchor(input);
  for (const s of sentencesOf(text)) {
    const meeting = MEETING_WORDS.exec(s.text);
    const flight = FLIGHT_WORDS.test(s.text) && /\b([A-Z]{3})\s*(?:to|-|–|→)\s*([A-Z]{3})\b/.exec(s.text);
    if (!meeting && !flight) continue;
    const dates = findDates(s.text, anchorISO);
    const times = findTimes(s.text);
    const date = dates[0];
    const time = times[0];
    if (!date || !time) continue;
    // A bill's date is never an event (10): the same date that the bill owes on is not a meeting.
    if (date.iso && billDates.has(date.iso) && !meeting) continue;
    let title: string;
    if (flight) title = `Flight ${flight[1]} to ${flight[2]}`;
    else {
      const phrase = /\b((?:(?!(?:a|an|the|our|your|my|his|her|their|this|that|have|had|has|to|for|of|in|at|on|is|was|be|we|i|you|they|and|or|with|about|from|if|so)\s)[a-z][a-z-]*\s+)?(?:call|meeting|chat|appointment|interview|practice|game|session|visit|conference|webinar|class|lesson|rehearsal|checkup|check-up|consult(?:ation)?)(?:\s+(?:about|for|with|re|regarding|to discuss)\s+[^,.?!\n]{1,40}?)?)(?=\s+(?:is|on|at|tomorrow|next|this|today|tonight|from|starts|will)\b|[,.?!\n]|$)/i.exec(s.text);
      title = titleCase(tidy(phrase?.[1] ?? meeting![1]!));
    }
    const zoneHint = zoneIn(s.text) ?? zoneIn(text);
    const duration = durationIn(s.text) ?? durationIn(text);
    const dateAbs: DateHit = { ...date, start: s.start + date.start, end: s.start + date.end };
    const timeAbs: TimeHit = { ...time, start: s.start + time.start, end: s.start + time.end };
    return eventFromClock(input, title, dateAbs, timeAbs, zoneHint, duration, { source: "email", text_start: s.start, text_end: s.end }, null, flight ? "event.flight" : "event.meeting");
  }
  return null;
}

// ---- waiting --------------------------------------------------------------

export function waitingTemplate(input: TemplateInput): Extracted | null {
  const { text } = input;
  if (isMachineAddress(input.from_address)) return null;
  if (input.from_address.trim().toLowerCase() === input.account.trim().toLowerCase()) return null;
  const anchorISO = anchor(input);
  for (const s of sentencesOf(text)) {
    const m = /\b(?:I|we)(?:'ll|’ll| will| am going to| are going to| can)\s+(get|send|have|forward|share|email|mail|pass|put|drop)\s+(?:you\s+|it\s+|that\s+|those\s+|the\s+|a\s+|an\s+|my\s+|our\s+)?([^.!?\n]{3,80}?)(?:\s+(?:to you|over to you|your way|to your inbox|across|along|over|out|by|once|when|as soon as|after|tomorrow|next|this|on)\b|[.!?\n]|$)/i.exec(s.text);
    if (!m) continue;
    const what = tidy(m[2]!).replace(/^(the|a|an|my|our)\s+/i, "");
    if (what.length < 3 || /^(back|it|you|that|this)$/i.test(what)) continue;
    const dates = findDates(s.text, anchorISO);
    const due = dates[0] ?? null;
    const title = titleCase(what).slice(0, 80);
    const counterparty = tidy(input.from_name) || input.from_address;
    const prov: Record<string, Provenance> = {
      title: span({ start: s.start + m.index, end: s.start + m.index + m[0].length }),
      waiting_for: span({ start: s.start + m.index, end: s.start + m.index + m[0].length }),
      counterparty_display: { source: "sender" },
    };
    let follow_up_on: string | null = null;
    if (due && due.iso && !due.relative && !due.ambiguous) { follow_up_on = due.iso; prov.follow_up_on = span({ start: s.start + due.start, end: s.start + due.end }); }
    const payload: WaitingPayload = { kind: "waiting", title, waiting_for: what, counterparty_display: counterparty, contact_id: null, follow_up_on };
    return { kind: "waiting", payload, provenance: prov, missing: [], identity: { title: title.toLowerCase(), counterparty: counterparty.toLowerCase() }, template: "waiting.promise" };
  }
  return null;
}
