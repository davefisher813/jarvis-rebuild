// STORE FIRST, TRANSFORM SECOND (issue #115's pipeline). A file or a paste
// is kept as it came, on the page, before a single row is read: if the
// mapping is never confirmed, the original is still there, named on the page
// and openable, and its rows can be brought in later. The bytes go to the
// person's private storage through the app's one file pipeline; a text table
// that cannot be stored there (no connection, an older bucket) is kept on the
// page as text instead, so the original is never lost to a failed upload.

import type { FileStore } from "../../files/FileStore";
import type { PageData, PageOriginal } from "./pageModel";
import { parseDelimited, readTable, tableKind, tableMime, type TableIn } from "./tabular";

export type TableSource = { file: File; name: string } | { text: string; name: string };

/** Keeps the original and returns the page with it listed. Throws only for a file that is not a table at all. */
export async function keepOriginal(fileStore: FileStore | null, noteId: string, page: PageData, src: TableSource, now: number): Promise<{ page: PageData; original: PageOriginal; stored: boolean }> {
  let original: PageOriginal;
  let stored = true;
  if ("text" in src) {
    original = { at: now, name: src.name, mime: "text/plain", bytes: new TextEncoder().encode(src.text).length, text: src.text, used: false };
  } else {
    const kind = tableKind(src.file.name, src.file.type);
    if (!kind) throw new Error("Choose a CSV or Excel File");
    const mime = tableMime(src.file.name, src.file.type);
    const file = src.file.type === mime ? src.file : new File([src.file], src.file.name, { type: mime });
    original = { at: now, name: src.file.name, mime, bytes: src.file.size, used: false };
    try {
      if (!fileStore) throw new Error("no store");
      const s = await fileStore.upload(noteId, file, { table: true });
      original.path = s.path;
    } catch {
      stored = false;
      if (kind === "csv") original.text = await src.file.text();
    }
  }
  return { page: { ...page, originals: [...(page.originals ?? []), original] }, original, stored };
}

export async function readSource(src: TableSource): Promise<TableIn> {
  if ("text" in src) return { rows: parseDelimited(src.text), notes: [] };
  return readTable(src.file);
}

/** The rows of an original already on the page, for bringing it in later. */
export async function readOriginal(fileStore: FileStore | null, o: PageOriginal): Promise<TableIn> {
  if (o.text !== undefined) return { rows: parseDelimited(o.text), notes: [] };
  if (!o.path || !fileStore) throw new Error("The original file could not be read");
  const url = await fileStore.url(o.path);
  if (!url) throw new Error("The original file could not be read");
  const res = await fetch(url);
  if (!res.ok) throw new Error("The original file could not be read");
  const buf = await res.arrayBuffer();
  return readTable({ name: o.name, type: o.mime, arrayBuffer: async () => buf });
}

export function markUsed(page: PageData, at: number): PageData {
  return { ...page, originals: (page.originals ?? []).map((o) => (o.at === at ? { ...o, used: true } : o)) };
}
