import { useRef, useState } from "react";
import LargeTitleNav from "../shared/LargeTitleNav";
import { useBackup } from "../data/NotesProvider";

export default function BackupPage({ onBack }: { onBack: () => void }) {
  const backup = useBackup();
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

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
    } catch {
      setStatus("Export failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const onPickFile = () => fileRef.current?.click();

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      const bundle = JSON.parse(text);
      const n = await backup.importBundle(bundle);
      setStatus(`Imported ${n} ${n === 1 ? "item" : "items"}. Reopen your tabs to see them.`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not read that file.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <LargeTitleNav title="Backup" back="Settings" onBack={onBack} />

      <div className="grp"><div className="eyebrow">Your data</div></div>
      <div className="pad-x"><div className="card">
        <div className="row" role="button" tabIndex={0} aria-disabled={busy} onClick={() => !busy && onExport()}>
          <div className="row-grow"><div className="conn-name">Export all data</div><div className="conn-meta">Save a JSON file of everything on this device</div></div>
        </div>
        <div className="row" role="button" tabIndex={0} aria-disabled={busy} onClick={() => !busy && onPickFile()}>
          <div className="row-grow"><div className="conn-name">Import from file</div><div className="conn-meta">Restore items from a JARVIS backup</div></div>
        </div>
      </div></div>

      {status && <div className="page-explainer">{status}</div>}

      <div className="grp"><div className="eyebrow">Account sync</div></div>
      <div className="pad-x"><div className="card">
        <div className="row"><div className="row-grow"><div className="conn-name">iCloud / account sync</div></div><span className="row-value">Off</span></div>
      </div></div>
      <div className="page-explainer">Your data lives on this device. Export keeps your own copy; import adds items from a backup file (it does not remove anything already here). Account sync turns on when you sign in with a synced account.</div>

      <input ref={fileRef} className="visually-hidden-input" type="file" accept="application/json,.json" onChange={onFile} />
    </div>
  );
}
