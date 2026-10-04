// ONE EXPORT, TWO DOORS (slice 09 QA, 2026-10-04). Settings > Advanced > Export
// Data used to open the Backup page, so a person who tapped Export saw another
// screen and no file. Both doors now run this: read every record, hand the
// file to the platform, and say honestly what happened. Backup's "Last
// exported" stamp is written here, so it is right whichever door was used.
import type { BackupService } from "./BackupService";
import { saveBackupFile } from "./exportFile";

export const LAST_EXPORT_KEY = "jarvis.backup.lastExport";

export type ExportOutcome =
  | { kind: "sent"; count: number; stamp: string }
  /** The person closed the share sheet. Nothing failed and nothing left the app, so nothing is claimed. */
  | { kind: "cancelled" }
  | { kind: "failed" };

export async function runBackupExport(backup: Pick<BackupService, "exportBundle">): Promise<ExportOutcome> {
  try {
    const bundle = await backup.exportBundle();
    const sent = await saveBackupFile(bundle);
    if (!sent) return { kind: "cancelled" };
    const stamp = bundle.exportedAt.slice(0, 10);
    try { localStorage.setItem(LAST_EXPORT_KEY, stamp); } catch { /* cosmetic */ }
    return { kind: "sent", count: bundle.items.length, stamp };
  } catch {
    return { kind: "failed" };
  }
}
