import { useRef, useState } from "react";
import LargeTitleNav from "../shared/LargeTitleNav";
import { useBackup } from "../data/NotesProvider";

export default function BackupPage({ onBack }: { onBack: () => void }) {
  const backup = useBackup();
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  // Import confirms before writing (2026-08-09): the file's own date and
  // count, then a second deliberate tap. Unconfirmable data writes into your
  // whole life should not ride on one file-picker dismissal.
  const [pending, setPending] = useState<{ bundle: unknown; label: string } | null>(null);
  const [lastExport, setLastExport] = useState<string>(() => {
    try { return localStorage.getItem("jarvis.backup.lastExport") ?? ""; } catch { return ""; }
  });

  const onExport = async () => {
    setBusy(true);
    try {
      const bundle = await backup.exportBundle();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `jarvis-backup-${bundle.exportedAt.slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus(`Exported ${bundle.items.length} ${bundle.items.length === 1 ? "item" : "items"}.`);
      const stamp = bundle.exportedAt.slice(0, 10);
      setLastExport(stamp);
      try { localStorage.setItem("jarvis.backup.lastExport", stamp); } catch { /* cosmetic */ }
    } catch {
      setStatus("Export failed · Try again");
    } finally {
      setBusy(false);
    }
  };

  const onPickFile = () => fileRef.current?.click();

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const bundle = JSON.parse(text) as { exportedAt?: string; items?: unknown[] };
      const when = typeof bundle.exportedAt === "string" ? bundle.exportedAt.slice(0, 10) : "unknown date";
      const count = Array.isArray(bundle.items) ? bundle.items.length : 0;
      setPending({ bundle, label: `Backup from ${when}, ${count} ${count === 1 ? "item" : "items"}.` });
      setStatus("");
    } catch {
      setStatus("Could not read that file.");
    }
  };

  const runImport = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const n = await backup.importBundle(pending.bundle as Parameters<typeof backup.importBundle>[0]);
      setStatus(n === 0 ? "Nothing new · All already here" : `Imported ${n} ${n === 1 ? "item" : "items"} · Duplicates skipped`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setPending(null);
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <LargeTitleNav title="Backup" back="Settings" onBack={onBack} />

      <div className="grp"><div className="eyebrow">Your Data</div></div>
      <div className="pad-x"><div className="card">
        <div className="row" role="button" tabIndex={0} aria-disabled={busy} onClick={() => !busy && onExport()}>
          <div className="row-grow"><div className="conn-name">Export All Data</div><div className="conn-meta">{lastExport ? `Last exported ${lastExport}` : "One JSON file · everything here"}</div></div>
        </div>
        <div className="row" role="button" tabIndex={0} aria-disabled={busy} onClick={() => !busy && onPickFile()}>
          <div className="row-grow"><div className="conn-name">Import from File</div><div className="conn-meta">Adds from a backup file</div></div>
        </div>
      </div></div>

      {pending && (
        <div className="pad-x"><div className="card pad">
          <div className="conn-name">{pending.label}</div>
          <div className="conn-meta">Identical items skipped</div>
          <div className="offer-row">
            <button className="btn btn-primary" disabled={busy} onClick={() => void runImport()}>{busy ? "Importing..." : "Import"}</button>
            <button className="quiet-action" disabled={busy} onClick={() => setPending(null)}>Cancel</button>
          </div>
        </div></div>
      )}

      {/* Catalog V3.1: the import receipt is a card row, not floating text. */}
      {status && (
        <div className="pad-x"><div className="card">
          <div className="row"><div className="row-stack"><div className="conn-meta">{status}</div></div></div>
        </div></div>
      )}

      <div className="grp"><div className="eyebrow">Account Sync</div></div>
      {/* Catalog V3.1: the explainer paragraph became three short card rows. */}
      <div className="pad-x"><div className="card">
        <div className="row"><div className="row-grow"><div className="conn-name">iCloud / Account Sync</div></div><span className="row-value">Off</span></div>
        <div className="row"><div className="row-stack"><div className="conn-name">Data Lives on This Device</div><div className="conn-meta">Export keeps your own copy</div></div></div>
        <div className="row"><div className="row-stack"><div className="conn-name">Import Adds, Never Removes</div><div className="conn-meta">Duplicates skipped · Nothing overwritten</div></div></div>
        <div className="row"><div className="row-stack"><div className="conn-name">Sync Follows Your Account</div><div className="conn-meta">Turns on with a synced sign-in</div></div></div>
      </div></div>

      <input ref={fileRef} className="visually-hidden-input" type="file" accept="application/json,.json" onChange={onFile} />
    </div>
  );
}
