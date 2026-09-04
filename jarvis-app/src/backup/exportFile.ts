// S3-Q16 (2026-09-04): "Export cannot save a file on the iPhone." The web
// blob-and-anchor-click trick BackupPage used for every platform has never
// worked inside the iOS WKWebView Capacitor ships in: the click is silently
// ignored by the web view, yet the old code reported success and stamped
// "Last exported today" for a file that never left the device.
//
// NATIVE (Capacitor iOS/Android): write the bundle to the app's cache
// directory with @capacitor/filesystem, then hand that file to the OS share
// sheet with @capacitor/share, so the user picks Files, AirDrop, Mail, or
// wherever else they keep backups. Cache is the right directory for this: an
// export is a file the app can always re-create, exactly what Cache is for.
// WEB (browser/PWA): unchanged, the blob-and-anchor-click a real browser
// actually honors.
//
// Both paths throw on a genuine failure (disk full, plugin error) so the
// caller never reports success for an export that did not happen. Canceling
// the native share sheet without picking anywhere to send the file is not a
// failure -- Capacitor's Share.share() resolves either way (an empty
// activityType marks a cancel) -- so it is not treated as one here either.
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import type { BackupBundle } from "./BackupService";

export function backupFilename(bundle: Pick<BackupBundle, "exportedAt">): string {
  return `jarvis-backup-${bundle.exportedAt.slice(0, 10)}.json`;
}

async function saveNative(bundle: BackupBundle): Promise<void> {
  const json = JSON.stringify(bundle, null, 2);
  const { uri } = await Filesystem.writeFile({
    path: backupFilename(bundle),
    data: json,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });
  await Share.share({ title: "JARVIS Backup", files: [uri] });
}

function saveWeb(bundle: BackupBundle): void {
  const json = JSON.stringify(bundle, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = backupFilename(bundle);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function saveBackupFile(bundle: BackupBundle): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await saveNative(bundle);
    return;
  }
  saveWeb(bundle);
}
