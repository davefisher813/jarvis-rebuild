import type { SupabaseClient } from "@supabase/supabase-js";
import { buildStoragePath, prepareUpload, uploadUniquifier } from "../shared/fileStorage";

// WHERE THE BYTES GO. One interface, two homes: Supabase Storage on the
// device (the user-files bucket, migration 0020) and an in-memory shelf for
// the demo and the sandbox, where an upload becomes an object URL that
// lives as long as the page. Every upload runs through prepareUpload first
// (the size gate, the EXIF strip, the path convention), so no caller ever
// hands raw bytes to storage.

export const BUCKET = "user-files";
const SIGNED_FOR = 60 * 60; // seconds a signed read URL stays good

export interface StoredFile { path: string; name: string; mime: string; bytes: number }

export interface FileStore {
  /** Uploads under {uid}/{entityId}/{uniq}-{filename}; throws a user-facing message. */
  upload(entityId: string, file: File): Promise<StoredFile>;
  /** A URL the page can show or open, or null when the file cannot be read. */
  url(path: string): Promise<string | null>;
  /** Best effort; a missing file is not an error. */
  remove(paths: string[]): Promise<void>;
  /** Everything under {uid}/{entityId}/: what a deleted note leaves behind. */
  removeAll(entityId: string): Promise<void>;
}

export class SupabaseFileStore implements FileStore {
  private urls = new Map<string, { url: string; until: number }>();
  constructor(private client: SupabaseClient, private uid: string) {}

  async upload(entityId: string, file: File): Promise<StoredFile> {
    const prepared = await prepareUpload(file);
    const path = buildStoragePath(this.uid, entityId, prepared.filename, uploadUniquifier());
    const { error } = await this.client.storage.from(BUCKET).upload(path, prepared.bytes, {
      contentType: prepared.mimeType, upsert: true,
    });
    if (error) throw new Error("Couldn't upload that file.");
    return { path, name: prepared.filename, mime: prepared.mimeType, bytes: prepared.bytes.byteLength };
  }

  async url(path: string): Promise<string | null> {
    if (!path) return null;
    const hit = this.urls.get(path);
    if (hit && hit.until > Date.now()) return hit.url;
    const { data, error } = await this.client.storage.from(BUCKET).createSignedUrl(path, SIGNED_FOR);
    if (error || !data?.signedUrl) return null;
    // Refresh a minute before it lapses, so a page left open never shows a
    // broken image at the hour mark.
    this.urls.set(path, { url: data.signedUrl, until: Date.now() + (SIGNED_FOR - 60) * 1000 });
    return data.signedUrl;
  }

  async remove(paths: string[]): Promise<void> {
    const live = paths.filter(Boolean);
    if (live.length === 0) return;
    for (const p of live) this.urls.delete(p);
    await this.client.storage.from(BUCKET).remove(live).catch(() => undefined);
  }

  async removeAll(entityId: string): Promise<void> {
    const folder = `${this.uid}/${entityId}`;
    const { data } = await this.client.storage.from(BUCKET).list(folder, { limit: 1000 });
    const paths = (data ?? []).map((o) => `${folder}/${o.name}`);
    await this.remove(paths);
  }
}

// The demo's shelf: object URLs, gone with the page, like the rest of the
// demo's data.
export class MemoryFileStore implements FileStore {
  private shelf = new Map<string, string>();
  constructor(private uid: string) {}

  async upload(entityId: string, file: File): Promise<StoredFile> {
    const prepared = await prepareUpload(file);
    const path = buildStoragePath(this.uid, entityId, prepared.filename, uploadUniquifier());
    const old = this.shelf.get(path);
    if (old) URL.revokeObjectURL(old);
    const blob = new Blob([prepared.bytes as BlobPart], { type: prepared.mimeType });
    this.shelf.set(path, URL.createObjectURL(blob));
    return { path, name: prepared.filename, mime: prepared.mimeType, bytes: prepared.bytes.byteLength };
  }

  async url(path: string): Promise<string | null> {
    return this.shelf.get(path) ?? null;
  }

  async remove(paths: string[]): Promise<void> {
    for (const p of paths) {
      const u = this.shelf.get(p);
      if (u) { URL.revokeObjectURL(u); this.shelf.delete(p); }
    }
  }

  async removeAll(entityId: string): Promise<void> {
    const prefix = `${this.uid}/${entityId}/`;
    await this.remove([...this.shelf.keys()].filter((p) => p.startsWith(prefix)));
  }
}
