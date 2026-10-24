import type { FilesService } from "../files/FilesService";
import type { FileStore } from "../files/FileStore";
import type { DeviceReader } from "./deviceOcr";
import type { ClientResult } from "./docClient";
import type { DocText } from "./types";

// THE INTAKE FUNNEL (Phase 1: an upload and a photo). One door for every way a document arrives: the row is made first (its storage path is
// built from the row's id), the bytes go up, the row says Saved, and the queue is told. Whatever fails after the bytes are safe leaves the
// document SAVED, never lost: the worker finds it, or Dave taps the row. A failed upload takes its own row back. Nothing here reads, spends or files.

export interface IntakeDeps {
  files: Pick<FilesService, "create" | "update" | "remove">;
  store: Pick<FileStore, "upload" | "remove">;
  enqueue: (fileId: string) => Promise<ClientResult<{ enqueued: boolean }>>;
  putText: (fileId: string, text: string, pages: DocText["pages"], words: number) => Promise<ClientResult<true>>;
  reader: DeviceReader | null;
  today: string;
}

export type IntakeResult = { ok: true; id: string; queued: boolean } | { ok: false; reason: string };

const ACCEPTED = /^(application\/pdf|image\/(jpeg|png|webp|heic))$/;

export async function intakeDocument(file: File, deps: IntakeDeps): Promise<IntakeResult> {
  if (!ACCEPTED.test(file.type)) return { ok: false, reason: "Documents Must Be a PDF or a Photo" };
  let id = "";
  let path = "";
  try {
    id = await deps.files.create({ name: file.name, path: "", mime: file.type, bytes: file.size, scope: "library", addedAt: deps.today, doc: { state: "uploading" } });
    const stored = await deps.store.upload(id, file);
    path = stored.path;
    await deps.files.update(id, { path: stored.path, name: stored.name, mime: stored.mime, bytes: stored.bytes, doc: { state: "stored" } });
  } catch (e) {
    // The bytes did not land: the row goes too, so no document is left that cannot be opened.
    if (id) await deps.files.remove(id).catch(() => undefined);
    if (path) await deps.store.remove([path]).catch(() => undefined);
    return { ok: false, reason: e instanceof Error && e.message ? e.message : "Couldn't Upload That File" };
  }
  // A photo is read on the phone first (law 3: not an AI call). A reader that fails or finds nothing does not stop the document being saved.
  if (file.type.startsWith("image/") && deps.reader) {
    try {
      const got = await deps.reader.read(file);
      if (got && got.text.trim()) await deps.putText(id, got.text, got.pages, got.words);
    } catch { /* saved without text; the row says so */ }
  }
  const q = await deps.enqueue(id).catch(() => ({ ok: false as const, reason: "FAILED" as const }));
  return { ok: true, id, queued: q.ok };
}
