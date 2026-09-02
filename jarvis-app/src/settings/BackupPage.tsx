import { useRef, useState } from "react";
import LargeTitleNav from "../shared/LargeTitleNav";
import { useBackup } from "../data/NotesProvider";
import { Head, Card, Row, Foot } from "./kit";

export default function BackupPage({ onBack }: { onBack: () => void }) {
  const backup = useBackup();
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
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
    <div className="screen ruled">
      <LargeTitleNav title="Backup" back="Settings" onBack={onBack} />
      <Head label="Your Data" />
      <Card>
        <Row label="Export All Data" meta={lastExport ? `Last exported ${lastExport}` : "One JSON file · Everything here"} onClick={onExport} disabled={busy} chev />
        <Row label="Import from File" meta="Adds from a backup file" onClick={onPickFile} disabled={busy} chev />
      </Card>
      {pending && (
        <div className="set-gap"><Card>
          <Row label={pending.label} meta="Identical items skipped" />
          <Row label={busy ? "Importing..." : "Import"} onClick={() => void runImport()} disabled={busy} className="set-act" />
          <Row label="Cancel" onClick={() => setPending(null)} disabled={busy} className="set-quiet" />
        </Card></div>
      )}
      {/* Catalog V3.1: the import receipt is a card row, not floating text. */}
      {status && <Foot>{status}</Foot>}
      <Head label="Account Sync" />
      {/* Catalog V3.1: the explainer paragraph became three short card rows. */}
      <Card>
        <Row label="iCloud / Account Sync" value="Off" />
        <Row label="Data Lives on This Device" meta="Export keeps your own copy" />
        <Row label="Import Adds, Never Removes" meta="Duplicates skipped · Nothing overwritten" />
        <Row label="Sync Follows Your Account" meta="Turns on with a synced sign-in" />
      </Card>
      <input ref={fileRef} className="visually-hidden-input" type="file" accept="application/json,.json" onChange={onFile} />
      <div className="screen-foot" />
    </div>
  );
}
