// Inline rich text for the writing canvas (Dave 2026-08-19: "dig deeper
// with the writing features"). Storage stays plain text with markers, the
// same markers everyone already knows: **bold**, *italic*, ==highlight==,
// ~~strike~~. Blocks render formatted when read, raw when edited, so the
// data model never grows an HTML surface and sync stays plain strings.

export interface RichSegment {
  text: string; // what the reader sees
  cls?: string; // formatting class, absent for plain runs
  rawStart: number; // where this segment starts in the raw string
  rawLen: number; // how much raw string it consumes (markers included)
  markerLen: number; // leading marker width, for caret math
}

const TOKEN = /(\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|==([^=\n]+)==|~~([^~\n]+)~~)/g;

const CLS: Record<string, string> = { "**": "t-b", "*": "t-i", "==": "t-hl", "~~": "t-strike" };

export function parseRich(raw: string): RichSegment[] {
  const out: RichSegment[] = [];
  let last = 0;
  // matchAll copies lastIndex from the shared regex; a prior test() would
  // otherwise skip the head of the string. Reset every parse.
  TOKEN.lastIndex = 0;
  for (const m of raw.matchAll(TOKEN)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ text: raw.slice(last, idx), rawStart: last, rawLen: idx - last, markerLen: 0 });
    const inner = m[2] ?? m[3] ?? m[4] ?? m[5] ?? "";
    const marker = m[2] !== undefined ? "**" : m[3] !== undefined ? "*" : m[4] !== undefined ? "==" : "~~";
    out.push({ text: inner, cls: CLS[marker], rawStart: idx, rawLen: m[1]!.length, markerLen: marker.length });
    last = idx + m[1]!.length;
  }
  if (last < raw.length) out.push({ text: raw.slice(last), rawStart: last, rawLen: raw.length - last, markerLen: 0 });
  return out;
}

export function hasRich(raw: string): boolean {
  TOKEN.lastIndex = 0;
  const hit = TOKEN.test(raw);
  TOKEN.lastIndex = 0;
  return hit;
}

// Map a caret offset in the DISPLAYED text back to the raw string, so a tap
// on formatted text puts the caret where the finger landed, not at the end.
export function displayToRawOffset(raw: string, displayOffset: number): number {
  let seen = 0;
  for (const s of parseRich(raw)) {
    if (displayOffset <= seen + s.text.length) return s.rawStart + s.markerLen + (displayOffset - seen);
    seen += s.text.length;
  }
  return raw.length;
}

// Wrap [start, end) of the raw string in a marker pair. Selecting text that
// already carries that exact marker unwraps it instead (tap bold twice).
export function wrapRange(raw: string, start: number, end: number, marker: string): { text: string; caret: number } {
  const before = raw.slice(0, start);
  const inner = raw.slice(start, end);
  const after = raw.slice(end);
  const w = marker.length;
  if (before.endsWith(marker) && after.startsWith(marker)) {
    return { text: before.slice(0, -w) + inner + after.slice(w), caret: end - w };
  }
  if (inner.startsWith(marker) && inner.endsWith(marker) && inner.length >= w * 2) {
    return { text: before + inner.slice(w, -w) + after, caret: end - w * 2 };
  }
  return { text: before + marker + inner + marker + after, caret: end + w * 2 };
}

// One place for the word count the editor shows: words across every block
// text and list item, markers stripped so formatting never inflates it.
export function countWords(chunks: string[]): number {
  const plain = chunks.join(" ").replace(/\*\*|\*|==|~~/g, " ").trim();
  return plain ? plain.split(/\s+/).length : 0;
}
