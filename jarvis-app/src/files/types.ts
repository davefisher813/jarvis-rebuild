// A FILE OF YOUR OWN (Dave 2026-09-02: "both pages need to have a pic/file
// upload button (that's fully wired)"). The bytes live in Supabase Storage
// (bucket user-files, migration 0020: private, 10MB, images and PDF, every
// path pinned to the owner's uid). This entity is the ROW ABOUT a file that
// belongs to a page rather than to a note: a receipt on Money today. A
// note's own photos and files ride inside the note (Block.path), so
// deleting the note is what deletes them.
export const ENTITY_FILE = "user_file";

export type FileScope = "money";

export interface FileData {
  name: string;   // as picked, for the row
  path: string;   // storage path, {uid}/{entityId}/{filename}; "" while uploading
  mime: string;
  bytes: number;
  scope: FileScope;
  addedAt: string; // ISO date the file was added, for the row's line
}

export interface UserFile { id: string; data: FileData }

// "340 KB", "1.2 MB". Under a kilobyte says the bytes.
export function sizeLabel(bytes: number): string {
  if (!bytes || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
}

// The file's name without its extension, as a title.
export function fileStem(name: string): string {
  const stem = name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  return stem ? stem.charAt(0).toUpperCase() + stem.slice(1) : "Untitled";
}
