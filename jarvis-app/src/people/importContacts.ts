// Contact import (Dave 2026-07-30): parse a shared file into person drafts.
// Two formats: vCard (.vcf, what iPhone Contacts exports when you share) and
// CSV with a header row. Pure functions, no dependencies; anything that cannot
// be understood is skipped rather than guessed, so a messy file can never
// create junk people.

export interface ImportedContact {
  name: string;
  birthday?: string; // YYYY-MM-DD when parseable
  notes?: string;    // phone / email / org folded into notes lines
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

// "FN;CHARSET=UTF-8:Mike Tucci" -> { prop: "FN", value: "Mike Tucci" }
function vLine(line: string): { prop: string; value: string } | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const prop = (head.split(";")[0] ?? "").trim().toUpperCase();
  return { prop, value: line.slice(colon + 1).trim() };
}

// BDAY comes as 1990-04-20, 19900420, or --04-20 (year withheld). Normalize
// to YYYY-MM-DD; drop year-withheld and unparseable forms.
function vBirthday(v: string): string | undefined {
  const iso = v.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return undefined;
}

export function parseVCard(text: string): ImportedContact[] {
  const out: ImportedContact[] = [];
  let cur: { fn?: string; n?: string; bday?: string; extras: string[] } | null = null;
  for (const line of unfold(text)) {
    const p = vLine(line);
    if (!p) continue;
    if (p.prop === "BEGIN" && p.value.toUpperCase() === "VCARD") { cur = { extras: [] }; continue; }
    if (p.prop === "END" && p.value.toUpperCase() === "VCARD") {
      if (cur) {
        const name = (cur.fn || cur.n || "").trim();
        if (name) {
          const c: ImportedContact = { name };
          if (cur.bday) c.birthday = cur.bday;
          if (cur.extras.length) c.notes = cur.extras.join("\n");
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
    else if (p.prop === "TEL" && p.value) cur.extras.push(p.value);
    else if (p.prop === "EMAIL" && p.value) cur.extras.push(p.value);
    else if (p.prop === "ORG" && p.value) cur.extras.push(p.value.replace(/;+$/, ""));
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
const NOTE_HEADERS = ["phone", "mobile", "tel", "email", "e-mail", "org", "organization", "company", "notes", "note"];

export function parseContactsCSV(text: string): ImportedContact[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];
  const headers = csvFields(lines[0]!).map((h) => h.toLowerCase());
  const idx = (names: string[]) => headers.findIndex((h) => names.includes(h));
  const nameI = idx(NAME_HEADERS);
  const firstI = idx(FIRST_HEADERS);
  const lastI = idx(LAST_HEADERS);
  const bdayI = idx(BDAY_HEADERS);
  const noteIs = headers.map((h, i) => (NOTE_HEADERS.includes(h) ? i : -1)).filter((i) => i >= 0);
  if (nameI < 0 && firstI < 0) return []; // no recognizable name column: refuse, do not guess

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
    const extras = noteIs.map((i) => f[i]).filter((v): v is string => !!v && v.trim() !== "");
    if (extras.length) c.notes = extras.join("\n");
    out.push(c);
  }
  return out;
}

// Entry point: pick the parser from the file name / content shape.
export function parseContactsFile(fileName: string, text: string): ImportedContact[] {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".vcf") || /BEGIN:VCARD/i.test(text)) return parseVCard(text);
  if (lower.endsWith(".csv")) return parseContactsCSV(text);
  return [];
}
