import type { ContactMethod } from "./types";

// Contact import (Dave 2026-07-30): parse a shared file into person drafts.
// Two formats: vCard (.vcf, what iPhone Contacts exports when you share) and
// CSV with a header row. Pure functions, no dependencies; anything that cannot
// be understood is skipped rather than guessed, so a messy file can never
// create junk people.

export interface ImportedContact {
  name: string;
  birthday?: string; // YYYY-MM-DD, or MM-DD when the year is withheld
  notes?: string;    // the source's OWN note, plus anything with no field
  email?: string;    // the primary, kept for every existing reader
  phone?: string;
  // EVERY method the file carried, labelled as the file labelled it (People
  // handoff, 2026-09-16). Before this, the first TEL and EMAIL went into the
  // fields and the rest were pushed into `notes` (vCard) or dropped outright
  // (CSV) -- which is the "a number in Notes with Phone blank" Dave
  // photographed, produced fresh on every import.
  phones?: ContactMethod[];
  emails?: ContactMethod[];
  /** The source's own stable id (vCard UID). The first thing a reimport
   *  matches on, so it never rests on a name. */
  uid?: string;
  org?: string;
  title?: string;
  urls?: string[];
  addresses?: string[];
  /** Properties this parser does not understand, as "PROP: value". Reported,
   *  never silently dropped: the handoff asks for unknown fields preserved or
   *  reported, and a discarded field a user typed is a lie by omission. */
  unknown?: string[];
}

// --- vCard ---

// Unfold per RFC 6350: a line starting with space or tab continues the
// previous line.
function unfold(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && out.length) {
      out[out.length - 1] += raw.slice(1);
    } else {
      out.push(raw);
    }
  }
  return out;
}

// "TEL;TYPE=CELL:+15550103311" -> { prop: "TEL", value: "+1555...", label: "mobile" }
//
// The parameters were thrown away before, which is why an imported number
// could never say which one it was. Only the TYPE values a phone actually
// writes are read, and only as a LABEL -- never to decide anything.
function vLine(line: string): { prop: string; value: string; label?: string } | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const parts = head.split(";");
  const prop = (parts[0] ?? "").trim().toUpperCase();
  const label = vLabel(parts.slice(1));
  return label ? { prop, value: line.slice(colon + 1).trim(), label } : { prop, value: line.slice(colon + 1).trim() };
}

// TYPE=CELL, TYPE="CELL,VOICE", or the bare "CELL" of vCard 2.1. PREF and the
// transport words (VOICE, INTERNET) say nothing a person would want to read,
// so they are not labels. An unrecognized type is left off rather than shown
// raw: the label is a convenience, and "X-CUSTOM17" helps nobody.
const TYPE_LABEL: Record<string, string> = {
  CELL: "mobile", MOBILE: "mobile", IPHONE: "mobile",
  HOME: "home", WORK: "work", MAIN: "main", FAX: "fax", PAGER: "pager",
  OTHER: "other", SCHOOL: "school",
};
function vLabel(params: string[]): string | undefined {
  for (const raw of params) {
    const p = raw.trim();
    const eq = p.indexOf("=");
    const key = (eq < 0 ? p : p.slice(0, eq)).trim().toUpperCase();
    const val = eq < 0 ? p : p.slice(eq + 1);
    const words = (key === "TYPE" || eq < 0 ? val : "").replace(/"/g, "").split(",");
    for (const w of words) {
      const hit = TYPE_LABEL[w.trim().toUpperCase()];
      if (hit) return hit;
    }
  }
  return undefined;
}

// BDAY comes as 1990-04-20, 19900420, or --04-20 (year withheld). Normalize
// to YYYY-MM-DD, or MM-DD when the year is withheld; anything else is dropped.
//
// BRAIN-F-22 (2026-09-05): the year-withheld form is what an iPhone exports
// for a contact whose birthday is set without a year, and it was thrown away
// here even though birthdayMonthDay (people/birthdays.ts:24) has accepted
// MM-DD since it shipped. The date is the birthday; the year never was.
function vBirthday(v: string): string | undefined {
  const iso = v.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const md = v.match(/^--(\d{2})-?(\d{2})$/);
  if (md) return `${md[1]}-${md[2]}`;
  return undefined;
}

// The properties this parser understands. Anything else is REPORTED on the
// contact rather than dropped, so an import can tell the user what it did not
// take instead of quietly losing a field they typed.
const KNOWN = new Set([
  "BEGIN", "END", "VERSION", "FN", "N", "BDAY", "TEL", "EMAIL", "ORG", "TITLE",
  "ROLE", "NOTE", "URL", "ADR", "UID", "NICKNAME", "PRODID", "REV", "CATEGORIES",
  "PHOTO", "X-ABLABEL", "X-ABADR",
]);

// "ADR;TYPE=HOME:;;1 Vine St;Cedar;OH;44121;USA" -> "1 Vine St, Cedar, OH 44121, USA"
// The seven ADR components are PO box, extended, street, locality, region,
// post code, country. Empty ones are skipped rather than leaving stray commas.
function vAddress(v: string): string {
  const p = v.split(";").map((x) => x.trim().replace(/\\,/g, ","));
  const line = [p[2], p[1]].filter(Boolean).join(" ");
  const region = [p[4], p[5]].filter(Boolean).join(" ");
  return [line, p[3], region, p[6]].filter(Boolean).join(", ");
}

export function parseVCard(text: string): ImportedContact[] {
  const out: ImportedContact[] = [];
  type Card = {
    fn?: string; n?: string; bday?: string; uid?: string; org?: string; title?: string;
    note: string[]; urls: string[]; addresses: string[];
    phones: ContactMethod[]; emails: ContactMethod[]; unknown: string[];
  };
  const blank = (): Card => ({ note: [], urls: [], addresses: [], phones: [], emails: [], unknown: [] });
  let cur: Card | null = null;

  for (const line of unfold(text)) {
    const p = vLine(line);
    if (!p) continue;
    if (p.prop === "BEGIN" && p.value.toUpperCase() === "VCARD") { cur = blank(); continue; }
    if (p.prop === "END" && p.value.toUpperCase() === "VCARD") {
      if (cur) {
        const name = (cur.fn || cur.n || "").trim();
        if (name) {
          const c: ImportedContact = { name };
          if (cur.bday) c.birthday = cur.bday;
          // EVERY method, labelled, with the first as the primary the rest of
          // the app reads. Nothing lands in `notes` that is really a number.
          if (cur.phones.length) { c.phones = cur.phones; c.phone = cur.phones[0]!.value; }
          if (cur.emails.length) { c.emails = cur.emails; c.email = cur.emails[0]!.value; }
          if (cur.uid) c.uid = cur.uid;
          if (cur.org) c.org = cur.org;
          if (cur.title) c.title = cur.title;
          if (cur.urls.length) c.urls = cur.urls;
          if (cur.addresses.length) c.addresses = cur.addresses;
          // The source's OWN note, which used to be dropped entirely.
          if (cur.note.length) c.notes = cur.note.join("\n");
          if (cur.unknown.length) c.unknown = cur.unknown;
          out.push(c);
        }
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    if (p.prop === "FN") cur.fn = p.value;
    else if (p.prop === "N") {
      // N is Last;First;Middle;Prefix;Suffix -> "First Last" fallback
      const parts = p.value.split(";");
      cur.n = [parts[1], parts[0]].filter(Boolean).join(" ").trim();
    } else if (p.prop === "BDAY") cur.bday = vBirthday(p.value);
    else if (p.prop === "TEL" && p.value) cur.phones.push(p.label ? { value: p.value, label: p.label } : { value: p.value });
    else if (p.prop === "EMAIL" && p.value) cur.emails.push(p.label ? { value: p.value, label: p.label } : { value: p.value });
    else if (p.prop === "ORG" && p.value) cur.org = p.value.replace(/;+$/, "").replace(/;/g, " · ");
    else if ((p.prop === "TITLE" || p.prop === "ROLE") && p.value && !cur.title) cur.title = p.value;
    else if (p.prop === "NOTE" && p.value) cur.note.push(p.value.replace(/\\n/g, "\n"));
    else if (p.prop === "URL" && p.value) cur.urls.push(p.value);
    else if (p.prop === "ADR" && p.value) { const a = vAddress(p.value); if (a) cur.addresses.push(a); }
    else if (p.prop === "UID" && p.value) cur.uid = p.value;
    else if (!KNOWN.has(p.prop) && p.value) cur.unknown.push(p.prop + ": " + p.value);
  }
  return out;
}

// --- CSV ---

// One CSV line, honoring quoted fields ("Smith, Jane") and doubled quotes.
function csvFields(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((f) => f.trim());
}

const NAME_HEADERS = ["name", "full name", "fullname", "contact"];
const FIRST_HEADERS = ["first", "first name", "firstname", "given name"];
const LAST_HEADERS = ["last", "last name", "lastname", "family name", "surname"];
const BDAY_HEADERS = ["birthday", "bday", "date of birth", "dob"];
// BRAIN-F-22 (2026-09-05): email and phone columns used to be folded into the
// notes blob with everything else, so a .csv import gave every person a note
// holding their address and number and no Call, Text or Email row on their
// card. The vCard parser has put them in the real fields since the person
// pass; this is the same rule for the other format. The prefix checks catch
// the exported shapes ("E-mail 1 - Value", "Phone 1 - Value") as well as a
// plain header.
const EMAIL_HEADERS = ["email", "e-mail", "email address", "mail"];
const PHONE_HEADERS = ["phone", "mobile", "tel", "telephone", "cell", "phone number"];
// A PREFIX CHECK MISSED THE COMMONEST HEADERS (People handoff, 2026-09-16).
// This matched "Phone 1 - Value" and "Mobile" and nothing else, so "Home
// Phone" and "Work Phone" -- what Outlook and a Google export actually write
// -- were not read as phone columns at all and their numbers were dropped.
// The word can sit anywhere in the header; the boundary keeps it from
// matching inside another word.
const isEmailHeader = (h: string) => EMAIL_HEADERS.includes(h) || /\b(e-?mail)\b/.test(h);
const isPhoneHeader = (h: string) => PHONE_HEADERS.includes(h) || /\b(phone|mobile|cell|tel)\b/.test(h);
const NOTE_HEADERS = ["org", "organization", "company", "notes", "note"];

/** The headers a file offers and what this parser made of each, so a mapping
 *  step can show the user the guess before anything is created. */
export interface CsvMapping {
  headers: string[];
  /** header index -> the field it was read as. Absent means "not used". */
  field: Record<number, "name" | "first" | "last" | "birthday" | "email" | "phone" | "note">;
}

export function csvMapping(text: string): CsvMapping | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return null;
  const raw = csvFields(lines[0]!);
  const headers = raw.map((h) => h.toLowerCase());
  const field: CsvMapping["field"] = {};
  headers.forEach((h, i) => {
    if (NAME_HEADERS.includes(h)) field[i] = "name";
    else if (FIRST_HEADERS.includes(h)) field[i] = "first";
    else if (LAST_HEADERS.includes(h)) field[i] = "last";
    else if (BDAY_HEADERS.includes(h)) field[i] = "birthday";
    else if (isEmailHeader(h)) field[i] = "email";
    else if (isPhoneHeader(h)) field[i] = "phone";
    else if (NOTE_HEADERS.includes(h)) field[i] = "note";
  });
  return { headers: raw, field };
}

/**
 * `mapping` overrides the guess, column by column, for a file whose headers
 * this parser does not recognize. Without it the guess stands, which is every
 * export from a phone or a mail provider.
 */
export function parseContactsCSV(text: string, mapping?: CsvMapping["field"]): ImportedContact[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];
  const rawHeaders = csvFields(lines[0]!);
  const guess = csvMapping(text)?.field ?? {};
  const field = mapping ?? guess;
  const cols = (kind: string) => rawHeaders.map((_, i) => i).filter((i) => field[i] === kind);
  const nameI = cols("name")[0] ?? -1;
  const firstI = cols("first")[0] ?? -1;
  const lastI = cols("last")[0] ?? -1;
  const bdayI = cols("birthday")[0] ?? -1;
  const noteIs = cols("note");
  const emailIs = cols("email");
  const phoneIs = cols("phone");
  if (nameI < 0 && firstI < 0) return []; // no name column: refuse, do not guess

  const out: ImportedContact[] = [];
  for (const line of lines.slice(1)) {
    const f = csvFields(line);
    const name = (nameI >= 0 ? f[nameI] : [f[firstI], lastI >= 0 ? f[lastI] : ""].filter(Boolean).join(" "))?.trim() ?? "";
    if (!name) continue;
    const c: ImportedContact = { name };
    if (bdayI >= 0 && f[bdayI]) {
      const b = vBirthday(f[bdayI]!.replace(/\//g, "-"));
      if (b) c.birthday = b;
    }
    // EVERY populated column of each kind, not just the first (People
    // handoff, 2026-09-16). A Google export carries "Phone 1 - Value"
    // through "Phone 4 - Value"; this kept one and dropped the rest on the
    // floor, so a contact with a mobile and a work line silently lost one.
    // The column's own header is the label, because that is what the file
    // actually said -- the parser never decides a number is a "mobile".
    const methods = (idxs: number[]): ContactMethod[] => idxs
      .map((i) => ({ value: (f[i] ?? "").trim(), label: csvLabel(rawHeaders[i] ?? "") }))
      .filter((m) => m.value !== "")
      .map((m) => (m.label ? m : { value: m.value }));
    const phones = methods(phoneIs);
    const emails = methods(emailIs);
    if (phones.length) { c.phones = phones; c.phone = phones[0]!.value; }
    if (emails.length) { c.emails = emails; c.email = emails[0]!.value; }
    const extras = noteIs.map((i) => f[i]).filter((v): v is string => !!v && v.trim() !== "");
    if (extras.length) c.notes = extras.join("\n");
    out.push(c);
  }
  return out;
}

// "Phone 1 - Type" is a column of labels, not a label. A header that is just
// the kind ("Phone", "E-mail 2 - Value") says nothing worth showing, so those
// produce no label at all rather than a noisy one.
function csvLabel(header: string): string | undefined {
  const m = header.toLowerCase().match(/\b(mobile|cell|home|work|main|fax|pager|school|other)\b/);
  if (!m) return undefined;
  return m[1] === "cell" ? "mobile" : m[1];
}

// Entry point: pick the parser from the file name / content shape.
export function parseContactsFile(fileName: string, text: string, mapping?: CsvMapping["field"]): ImportedContact[] {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".vcf") || /BEGIN:VCARD/i.test(text)) return parseVCard(text);
  if (lower.endsWith(".csv")) return parseContactsCSV(text, mapping);
  return [];
}
