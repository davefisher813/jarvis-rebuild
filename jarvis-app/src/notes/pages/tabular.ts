// TABLES IN AND OUT (issue #115: Sheets and Excel as three honest promises).
//
// CSV is read and written per RFC 4180, with the delimiter detected (a paste
// from Sheets or Numbers is tab separated, a European Excel CSV uses
// semicolons). XLSX is written as a real Office Open XML workbook, one sheet,
// every cell an inline string or a number, zipped without compression so no
// library is needed; Excel, Numbers and Google Sheets all open it. XLSX is
// read from the first worksheet, shared and inline strings and cached values;
// what a table cannot carry (other sheets, formulas, which come in as their
// last values) is listed in `notes` so the import can say so, never dropped
// in silence.

export interface TableIn { rows: string[][]; notes: string[] }

// ---------------------------------------------------------------------------
// CSV

export function detectDelimiter(text: string): string {
  const head = text.split(/\r?\n/).slice(0, 5).join("\n");
  const count = (d: string) => head.split(d).length - 1;
  const tabs = count("\t"), commas = count(","), semis = count(";");
  if (tabs > 0 && tabs >= commas) return "\t";
  if (semis > commas) return ";";
  return ",";
}

export function parseDelimited(input: string, delim?: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const d = delim ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") { quoted = true; continue; }
    if (ch === d) { row.push(cell); cell = ""; continue; }
    if (ch === "\r") continue;
    if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return trimTable(rows.map((r) => r.map(unguard)));
}

/** Drops wholly empty rows and trailing empty columns, so a sheet with stray formatting reads as its data. */
export function trimTable(rows: string[][]): string[][] {
  const kept = rows.filter((r) => r.some((c) => c.trim() !== ""));
  const width = kept.reduce((w, r) => {
    let last = r.length;
    while (last > 0 && r[last - 1]!.trim() === "") last--;
    return Math.max(w, last);
  }, 0);
  return kept.map((r) => Array.from({ length: width }, (_, i) => (r[i] ?? "").trim()));
}

// A cell that opens with = or @, or with + or - before something that is not
// a number, is a formula to a spreadsheet. On the way out it is written with a
// leading apostrophe so it is shown, not run; on the way back in the
// apostrophe comes off. "+2" (a score to par) is a number and is left alone.
const FORMULA = /^(?:[=@]|[+-](?![\d.]))/;
export function guard(cell: string): string {
  return FORMULA.test(cell) ? "'" + cell : cell;
}
function unguard(cell: string): string {
  return cell.startsWith("'") && FORMULA.test(cell.slice(1)) ? cell.slice(1) : cell;
}

export function toCsv(rows: string[][]): string {
  const esc = (c: string) => {
    const g = guard(c);
    return /[",\r\n]/.test(g) ? '"' + g.replace(/"/g, '""') + '"' : g;
  };
  // The byte order mark is what makes Excel read the file as UTF-8, so an
  // accented name survives the trip.
  return "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// ZIP, the container both directions need.

let CRC: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!CRC) {
    CRC = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const enc = (s: string) => new TextEncoder().encode(s);

export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc(f.name);
    const crc = crc32(f.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // names are UTF-8
    lv.setUint16(8, 0, true); // stored
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.data.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local, f.data);
    centrals.push(central);
    offset += local.length + f.data.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, end];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot open that Excel file; save it as CSV and try again");
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  void writer.write(data as unknown as BufferSource).then(() => writer.close()).catch(() => {});
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as Uint8Array);
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

export async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("That file is not a readable Excel workbook");
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true);
    const nlen = v.getUint16(p + 28, true);
    const xlen = v.getUint16(p + 30, true);
    const clen = v.getUint16(p + 32, true);
    const lho = v.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
    const lnlen = v.getUint16(lho + 26, true);
    const lxlen = v.getUint16(lho + 28, true);
    const start = lho + 30 + lnlen + lxlen;
    const raw = bytes.subarray(start, start + csize);
    if (method === 0) out.set(name, raw);
    else if (method === 8) out.set(name, await inflateRaw(raw));
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

// ---------------------------------------------------------------------------
// XLSX

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  // Control characters are not legal in XML 1.0; a pasted one would make the whole file unreadable.
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const xmlUnesc = (s: string) => s.replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

export function colName(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** One sheet. `numeric` names the columns whose numeric-looking cells are written as numbers (a score); every other
 *  cell is text, so a jersey number "07" or an id stays exactly as it was. */
export function writeXlsx(rows: string[][], opts: { sheet?: string; numeric?: Set<number> } = {}): Uint8Array {
  const sheetName = xmlEsc((opts.sheet || "Sheet1").replace(/[\\/?*[\]:]/g, " ").slice(0, 31).trim() || "Sheet1");
  const body = rows.map((r, ri) => {
    const cells = r.map((c, ci) => {
      const ref = colName(ci) + (ri + 1);
      if (ri > 0 && opts.numeric?.has(ci) && /^-?\d+(\.\d+)?$/.test(c)) return `<c r="${ref}"><v>${c}</v></c>`;
      if (c === "") return "";
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(c)}</t></is></c>`;
    }).join("");
    return `<row r="${ri + 1}">${cells}</row>`;
  }).join("");
  const files = [
    { name: "[Content_Types].xml", data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`) },
    { name: "_rels/.rels", data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: "xl/workbook.xml", data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
    { name: "xl/_rels/workbook.xml.rels", data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`) },
    { name: "xl/worksheets/sheet1.xml", data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`) },
  ];
  return zipStore(files);
}

function textOf(xml: string): string {
  // Every <t> run in an <si> or <is>, phonetic runs left out.
  const noPh = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  return [...noPh.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => xmlUnesc(m[1]!)).join("");
}

export async function readXlsx(bytes: Uint8Array): Promise<TableIn> {
  const files = await unzip(bytes);
  const dec = new TextDecoder();
  const read = (n: string) => { const f = files.get(n); return f ? dec.decode(f) : null; };
  const notes: string[] = [];
  const wb = read("xl/workbook.xml");
  if (!wb) throw new Error("That file is not a readable Excel workbook");
  const sheets = [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m) => m[0]);
  if (sheets.length > 1) notes.push(`Only the First Sheet Was Read; ${sheets.length - 1} Other ${sheets.length === 2 ? "Sheet Stays" : "Sheets Stay"} in the Original`);
  const rid = /r:id="([^"]+)"/.exec(sheets[0] ?? "")?.[1];
  const rels = read("xl/_rels/workbook.xml.rels") ?? "";
  let target = "worksheets/sheet1.xml";
  if (rid) {
    const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => r.includes(`Id="${rid}"`));
    const t = rel ? /Target="([^"]+)"/.exec(rel)?.[1] : undefined;
    if (t) target = t.replace(/^\/?xl\//, "").replace(/^\//, "");
  }
  const sheet = read("xl/" + target);
  if (!sheet) throw new Error("That workbook has no sheet to read");
  const sst = read("xl/sharedStrings.xml");
  const shared = sst ? [...sst.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]!)) : [];
  const rows: string[][] = [];
  let formulas = 0;
  for (const rm of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rIdx = Number(/\br="(\d+)"/.exec(rm[1]!)?.[1] ?? rows.length + 1) - 1;
    const row: string[] = [];
    let next = 0;
    for (const cm of rm[2]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1]!;
      const inner = cm[2] ?? "";
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const ci = ref ? colIndex(ref) : next;
      next = ci + 1;
      const t = /\bt="([^"]+)"/.exec(attrs)?.[1];
      if (/<f[\s>]/.test(inner)) formulas++;
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let val = "";
      if (t === "s") val = shared[Number(v)] ?? "";
      else if (t === "inlineStr") val = textOf(inner);
      else if (t === "b") val = v === "1" ? "TRUE" : "FALSE";
      else if (v !== undefined) val = xmlUnesc(v);
      row[ci] = val;
    }
    rows[rIdx] = Array.from({ length: row.length }, (_, i) => row[i] ?? "");
  }
  if (formulas) notes.push(formulas === 1 ? "1 Formula Came In as Its Value" : `${formulas} Formulas Came In as Their Values`);
  return { rows: trimTable(Array.from({ length: rows.length }, (_, i) => rows[i] ?? [])), notes };
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** The kind of table a file is, by its name first and its type second (iOS hands a CSV over as several types). */
export function tableKind(name: string, mime: string): "csv" | "xlsx" | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  if (ext === "xlsx" || mime === XLSX_MIME) return "xlsx";
  if (ext === "csv" || ext === "tsv" || ext === "txt" || /^text\//.test(mime) || mime === "application/csv") return "csv";
  return null;
}

/** The mime a table file is stored under, so the original keeps the type it really is. */
export function tableMime(name: string, mime: string): string {
  const k = tableKind(name, mime);
  if (k === "xlsx") return XLSX_MIME;
  if (/\.tsv$/i.test(name)) return "text/tab-separated-values";
  if (/\.txt$/i.test(name)) return "text/plain";
  return k === "csv" ? "text/csv" : mime;
}

export async function readTable(file: { name: string; type: string; arrayBuffer(): Promise<ArrayBuffer> }): Promise<TableIn> {
  const kind = tableKind(file.name, file.type);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (kind === "xlsx") return readXlsx(bytes);
  if (kind === "csv") return { rows: parseDelimited(new TextDecoder().decode(bytes)), notes: [] };
  throw new Error("Choose a CSV or Excel File");
}
