// A TEMPLATE PAGE LEAVES THE APP (issue #115: export and share ON the page).
//
// Sheets and Excel get the records as a clean table with the stable id in the
// first column, which is what makes the round trip work: edit it in Sheets,
// bring it back, and every row finds its record. PDF is a printable grid built
// on device by jspdf (the same library the note export uses, loaded only when
// asked for). A person gets a copy of exactly the rows and fields picked, as
// text, with no id and nothing else from the page: sharing a subset never
// exposes the whole record, and naming a person grants them nothing.

import { type PageData, type PageRecord, golfTotals, scoreOf, toParLabel, editableFields, recordName, labelOf } from "./pageModel";
import { ID_HEADER } from "./importMap";
import { standingsOf } from "./templateLogic";
import { templateDef } from "./templateDefs";
import { bowlingFrames, dartTurns, dKey, periodScore, sideTotal } from "./scoreboard";
import { toCsv, writeXlsx, XLSX_MIME } from "./tabular";

export type PageFormat = "csv" | "xlsx" | "pdf";

export const PAGE_FORMATS: { key: PageFormat; label: string; desc: string; ext: string; mime: string }[] = [
  { key: "csv", label: "Google Sheets .csv", desc: "Edit in Sheets, Then Bring It Back", ext: "csv", mime: "text/csv;charset=utf-8" },
  { key: "xlsx", label: "Excel .xlsx", desc: "Edit in Excel or Numbers", ext: "xlsx", mime: XLSX_MIME },
  { key: "pdf", label: "PDF", desc: "Read or Print", ext: "pdf", mime: "application/pdf" },
];

/** The table for Sheets and Excel: the id first, then every field the page shows, in order. */
export function pageTable(page: PageData, opts: { withId?: boolean } = {}): string[][] {
  const withId = opts.withId !== false;
  if (page.kind === "scorecard") return golfTable(page, withId);
  if (page.kind === "scoreboard" && page.score) return scoreTable(page, withId);
  if (page.kind === "standings") return standingsTable(page, withId);
  const fields = editableFields(page);
  // A lineup's order is the point of it, so it is a column of its own.
  const order = page.kind === "lineup";
  const head = [...(withId ? [ID_HEADER] : []), ...(order ? ["Order"] : []), ...fields.map((f) => f.label)];
  // A done mark reads Yes in a sheet; the import reads it back.
  const cell = (r: PageRecord, f: { key: string; type: string }) => (f.type === "check" ? (r.v[f.key] === "1" ? "Yes" : "") : r.v[f.key] ?? "");
  const rows = page.records.map((r, i) => [...(withId ? [r.id] : []), ...(order ? [String(i + 1)] : []), ...fields.map((f) => cell(r, f))]);
  return [head, ...rows];
}

/** A scoreboard: a column per period (or frame, or turn) and the total (or what is left). */
function scoreTable(page: PageData, withId: boolean): string[][] {
  const sc = page.score!;
  const name = labelOf(page, "name");
  const id = (r: PageRecord) => (withId ? [r.id] : []);
  const idH = withId ? [ID_HEADER] : [];
  if (sc.mode === "bowling") {
    return [[...idH, name, ...Array.from({ length: 10 }, (_, i) => String(i + 1)), "Total"],
      ...page.records.map((r) => [...id(r), r.v.name ?? "", ...bowlingFrames(r).map((f) => (f.total === null ? "" : String(f.total))), String(sideTotal(page, r))])];
  }
  if (sc.mode === "countdown") {
    const turns = Math.max(1, ...page.records.map((r) => dartTurns(page, r).length));
    return [[...idH, name, ...Array.from({ length: turns }, (_, i) => String(i + 1)), "Left"],
      ...page.records.map((r) => [...id(r), r.v.name ?? "", ...Array.from({ length: turns }, (_, i) => r.v[dKey(i + 1)] ?? ""), String(sideTotal(page, r))])];
  }
  if (sc.mode === "target") return [[...idH, name, "Score"], ...page.records.map((r) => [...id(r), r.v.name ?? "", String(periodScore(r, 1) ?? 0)])];
  return [[...idH, name, ...Array.from({ length: sc.periods }, (_, i) => String(i + 1)), "Total"],
    ...page.records.map((r) => [...id(r), r.v.name ?? "", ...Array.from({ length: sc.periods }, (_, i) => { const v = periodScore(r, i + 1); return v === null ? "" : String(v); }), String(sideTotal(page, r))])];
}

/** League standings, worked out from the games. */
function standingsTable(page: PageData, withId: boolean): string[][] {
  return [[...(withId ? [ID_HEADER] : []), labelOf(page, "name"), "Played", "W", "L", "T", "PF", "PA", "Pts"],
    ...standingsOf(page).map((t) => [...(withId ? [t.id] : []), t.name, String(t.gp), String(t.w), String(t.l), String(t.t), String(t.pf), String(t.pa), String(t.pts)])];
}

function golfTable(page: PageData, withId: boolean): string[][] {
  const g = page.golf!;
  const holes = Array.from({ length: g.holes }, (_, i) => i + 1);
  const nine = g.holes === 18;
  const head = [...(withId ? [ID_HEADER] : []), labelOf(page, "name"), ...holes.map(String), ...(nine ? ["Out", "In"] : []), "Total", "To Par"];
  const parOut = g.par.slice(0, 9).reduce((a, b) => a + b, 0);
  const parIn = g.par.slice(9, 18).reduce((a, b) => a + b, 0);
  const parRow = [...(withId ? ["par"] : []), "Par", ...holes.map((h) => String(g.par[h - 1] ?? 4)), ...(nine ? [String(parOut), String(parIn)] : []), String(nine ? parOut + parIn : parOut), ""];
  const rows = page.records.map((r) => {
    const t = golfTotals(page, r);
    return [...(withId ? [r.id] : []), r.v.name ?? "", ...holes.map((h) => { const s = scoreOf(r, h); return s === null ? "" : String(s); }),
      ...(nine ? [t.out ? String(t.out) : "", t.in ? String(t.in) : ""] : []), t.played ? String(t.total) : "", t.played ? toParLabel(t.toPar) : ""];
  });
  return [head, parRow, ...rows];
}

/** Columns a spreadsheet should read as numbers (scores), by index in pageTable's rows. */
function numericColumns(page: PageData, table: string[][]): Set<number> {
  const out = new Set<number>();
  if (page.kind === "scoreboard" || page.kind === "standings") { (table[0] ?? []).forEach((h, i) => { if (/^\d+$/.test(h) || ["Total", "Score", "Left", "Played", "W", "L", "T", "PF", "PA", "Pts"].includes(h)) out.add(i); }); return out; }
  if (page.kind !== "scorecard") return out;
  const head = table[0] ?? [];
  head.forEach((h, i) => { if (/^\d+$/.test(h) || h === "Out" || h === "In" || h === "Total") out.add(i); });
  return out;
}

export async function buildPageFile(format: PageFormat, title: string, page: PageData): Promise<Blob> {
  const info = PAGE_FORMATS.find((f) => f.key === format)!;
  // A page read from Money has no ids of its own to round-trip; its rows are made fresh from Money each time.
  const table = pageTable(page, { withId: !templateDef(page.kind)?.derived });
  if (format === "csv") return new Blob([toCsv(table)], { type: info.mime });
  if (format === "xlsx") return new Blob([writeXlsx(table, { sheet: title, numeric: numericColumns(page, table) }) as BlobPart], { type: info.mime });
  return buildPagePdf(title, page);
}

/** A printable grid. Wide tables (a full scorecard) go landscape; long ones flow onto more pages with the head again. */
export async function buildPagePdf(title: string, page: PageData): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  // A profile is one person: the one-pager reads down the page (field, then value), not across a one-row table.
  const rec = page.records[0];
  const table = page.kind === "profile" && rec
    ? [["Field", "Value"], ...editableFields(page).filter((f) => (rec.v[f.key] ?? "").trim()).map((f) => [f.label, rec.v[f.key]!.trim()])]
    : pageTable(page, { withId: false });
  const cols = table[0]?.length ?? 1;
  const landscape = cols > 6;
  const pdf = new jsPDF({ unit: "pt", format: "letter", orientation: landscape ? "landscape" : "portrait" });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const M = 40;
  let y = M;
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(18); pdf.setTextColor(20);
  pdf.text(title || "Page", M, y + 14); y += 34;
  const sub = pdfSubtitle(page);
  if (sub) { pdf.setFont("helvetica", "normal"); pdf.setFontSize(10); pdf.setTextColor(90); pdf.text(sub, M, y); y += 20; }
  const size = cols > 14 ? 8 : 10;
  pdf.setFontSize(size);
  // The first column (a name) takes what the rest do not need.
  const avail = W - 2 * M;
  const narrow = page.kind === "scorecard" ? Math.min(28, (avail * 0.7) / Math.max(1, cols - 1)) : avail / cols;
  const widths = table[0]!.map((_, i) => (i === 0 && page.kind === "scorecard" ? avail - narrow * (cols - 1) : narrow));
  const rowH = size + 8;
  const drawRow = (r: string[], head: boolean) => {
    if (y + rowH > H - M) { pdf.addPage(); y = M; drawRow(table[0]!, true); }
    pdf.setFont("helvetica", head ? "bold" : "normal");
    pdf.setTextColor(head ? 20 : 40);
    let x = M;
    r.forEach((c, i) => {
      const w = widths[i]!;
      const text = (pdf.splitTextToSize(c, w - 4) as string[])[0] ?? "";
      pdf.text(text, x + 2, y + size);
      x += w;
    });
    pdf.setDrawColor(210);
    pdf.line(M, y + rowH, W - M, y + rowH);
    y += rowH;
  };
  drawRow(table[0]!, true);
  for (const r of table.slice(1)) drawRow(r, false);
  return pdf.output("blob");
}

function pdfSubtitle(page: PageData): string {
  if (page.golf) return [page.golf.course, page.golf.date, `${page.golf.holes} Holes`].filter(Boolean).join("  ");
  if (page.lineup) return [page.lineup.teamTitle, page.lineup.date].filter(Boolean).join("  ");
  if (page.score) return [page.score.label, page.score.date].filter(Boolean).join("  ");
  return "";
}

/** What a person is sent: the picked rows and fields as plain lines, nothing else. */
export function shareText(title: string, page: PageData, fieldKeys: string[], recordIds: string[]): string {
  const keep = new Set(recordIds);
  const fields = editableFields(page).filter((f) => fieldKeys.includes(f.key));
  const lines: string[] = [title];
  if (page.golf) {
    for (const r of page.records.filter((x) => keep.has(x.id))) {
      const t = golfTotals(page, r);
      lines.push(`${r.v.name ?? ""}: ${t.played ? `${t.total} (${toParLabel(t.toPar)}) through ${t.thru}` : "no scores yet"}`);
    }
    return lines.join("\n");
  }
  if (page.score) {
    for (const r of page.records.filter((x) => keep.has(x.id))) lines.push(`${r.v.name ?? ""}: ${sideTotal(page, r)}`);
    return lines.join("\n");
  }
  if (page.kind === "standings") {
    for (const t of standingsOf(page).filter((x) => keep.has(x.id))) lines.push(`${t.name}: ${t.w}-${t.l}${t.t ? "-" + t.t : ""}, ${t.pts} Pts`);
    return lines.join("\n");
  }
  page.records.filter((r) => keep.has(r.id)).forEach((r: PageRecord, i) => {
    const parts = fields.map((f) => (r.v[f.key] ?? "").trim() ? `${f.label}: ${r.v[f.key]!.trim()}` : "").filter(Boolean);
    const lead = page.kind === "lineup" ? `${i + 1}. ` : "";
    lines.push(lead + (parts.length ? parts.join(", ") : recordName(page, r)));
  });
  return lines.join("\n");
}
