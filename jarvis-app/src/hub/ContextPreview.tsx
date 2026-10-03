// H5 CONTEXT PREVIEW (IMPLEMENTATION-SPEC.md 05.2, 09). Exactly what would
// be shared, before anything is: purpose, project, permitted records and
// fields, what is left out, the expiry, the export caveat. Share makes the
// grant for exactly this preview (by its hash) and, for a manual assistant,
// the export file; the read receipt is written by the function. Cancel
// shares nothing. Paste what came back imports proposals into Mentioned.

import { useEffect, useState } from "react";
import PageHeader from "../shared/PageHeader";
import { showToast } from "../shared/toast";
import { exportContext, grantScope, importProposals, previewContext, type PreviewResult } from "../substrate/agentClient";
import { PROTOCOL_ERRORS } from "../substrate/gateway/protocol";
import { COMMAND_LINES } from "../substrate/commands/errors";
import { CANCEL_SHARES_NOTHING, EXPORT_CAVEAT, EXPORT_CONTEXT, PASTE_BACK, SHARE_ONCE, SHARE_PROJECT, recordsLine } from "./copy";
import { openJob, type HubConnection, type RpcClient } from "./hubClient";
import { ImportSheet } from "./sheets";

/** Hand the export to the phone's share sheet, or the clipboard, and say which. */
async function shareText(fileName: string, text: string): Promise<string> {
  const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { share?: (d: { title: string; text: string }) => Promise<void>; clipboard?: { writeText: (t: string) => Promise<void> } }) : undefined;
  try {
    if (nav?.share) { await nav.share({ title: fileName, text }); return "Shared"; }
  } catch { /* the person closed the share sheet; the clipboard is next */ }
  try {
    if (nav?.clipboard) { await nav.clipboard.writeText(text); return "Copied · Paste It Into Your Assistant"; }
  } catch { /* no clipboard either */ }
  return "Export Ready · Copy It From the Activity Receipt";
}

export default function ContextPreview({ client, connection, projectId, projectTitle, offline, onBack, onImported }: {
  client: RpcClient;
  /** Null is the person's own export, with no assistant row. */
  connection: HubConnection | null;
  projectId: string;
  projectTitle: string;
  offline: boolean;
  onBack: () => void;
  onImported: () => void;
}) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [shared, setShared] = useState<string | null>(null);
  const manual = !connection || connection.transport === "manual";

  const load = async () => {
    setError(null);
    const j = await openJob(client, connection?.id ?? null, projectId, connection ? `Help with ${projectTitle}` : `Export ${projectTitle}`);
    if (!j.ok) { setError(COMMAND_LINES[j.code]); return; }
    setJobId(j.value.job_id);
    const p = await previewContext(client, j.value.job_id);
    if (!p.ok) { setError(PROTOCOL_ERRORS[p.code].safe_message); return; }
    setPreview(p.value);
  };
  useEffect(() => { void load();
  }, [client, connection?.id, projectId]);

  const share = async (how: "once" | "project" | "export") => {
    if (!jobId || !preview || busy || offline) return;
    setBusy(how);
    const g = await grantScope(client, jobId, preview.manifest_hash, how === "project" ? "project" : "once");
    if (!g.ok) { setBusy(null); showToast({ message: PROTOCOL_ERRORS[g.code].safe_message }); if (g.code === "STALE_SCOPE") void load(); return; }
    if (how === "export") {
      const x = await exportContext(client, jobId, preview.manifest_hash);
      if (!x.ok) { setBusy(null); showToast({ message: PROTOCOL_ERRORS[x.code].safe_message }); return; }
      const said = await shareText(x.value.fileName, x.value.text);
      setShared(said);
      showToast({ message: said });
    } else {
      const line = how === "once" ? `Shared ${recordsLine(preview.record_count)} · 15 Minutes` : `Shared ${recordsLine(preview.record_count)} · For This Project`;
      setShared(line);
      showToast({ message: line });
    }
    setBusy(null);
  };

  const doImport = async (text: string) => {
    if (!jobId) return;
    setImportError(null);
    setBusy("import");
    const r = await importProposals(client, jobId, text);
    setBusy(null);
    if (!r.ok) { setImportError(r.detail ? `${PROTOCOL_ERRORS[r.code].safe_message}` : PROTOCOL_ERRORS[r.code].safe_message); return; }
    setImporting(false);
    showToast({ message: r.value.count === 1 ? "Imported 1 Suggestion · In Mentioned" : `Imported ${r.value.count} Suggestions · In Mentioned` });
    onImported();
  };

  const unauthorized = preview?.omitted_counts.unauthorized ?? 0;
  const over = preview?.omitted_counts.over_limit ?? 0;
  return (
    <div className="screen ruled hub">
      <PageHeader title="Shared Context" back={connection?.display_name ?? "AI Hub"} onBack={onBack} />
      <div className="hub-brief">{CANCEL_SHARES_NOTHING}</div>

      <div className="sh2 sh2-quiet"><span className="t">What Would Be Shared</span></div>
      <div className="pad-x"><div className="card list-card-ruled">
        <div className="row"><div className="row-grow"><div className="conn-name">{projectTitle}</div><div className="conn-meta">{preview?.purpose ?? (connection ? `Help with ${projectTitle}` : `Export ${projectTitle}`)}</div></div></div>
        {preview && (
          <>
            <div className="row"><div className="row-grow"><div className="conn-name">{recordsLine(preview.record_count)}</div><div className="conn-meta">{preview.content_bytes > 0 ? `${Math.max(1, Math.round(preview.content_bytes / 1024))} KB · Project Brief, Open Tasks, Decisions` : "Project Brief, Open Tasks, Decisions"}</div></div></div>
            <div className="row"><div className="row-grow"><div className="conn-name">Fields</div><div className="conn-meta">{[...new Set(preview.manifest.flatMap((m) => m.fields))].sort().join(", ") || "None"}</div></div></div>
            <div className="row"><div className="row-grow"><div className="conn-name">Left Out</div><div className="conn-meta">{[preview.redactions.length ? `Redacted · ${preview.redactions.join(", ")}` : null, unauthorized ? `${unauthorized} Outside This Project` : null, over ? `${over} Over the Limit` : null, "Health, Money and Mail Are Never Shared"].filter(Boolean).join(" · ")}</div></div></div>
            <div className="row"><div className="row-grow"><div className="conn-name">Expires</div><div className="conn-meta">15 Minutes After Sharing · A Read Receipt Is Written First</div></div></div>
          </>
        )}
        {!preview && !error && <div className="row"><div className="conn-name">Loading…</div></div>}
        {error && <div className="row"><div className="row-grow"><div className="conn-name">{error}</div></div></div>}
        {error && <button className="row row-act hub-quiet" onClick={() => void load()}>Retry</button>}
      </div></div>

      {preview && (
        <div className="pad-x"><div className="card list-card-ruled">
          {manual
            ? <button className="row row-act" disabled={!!busy || offline} onClick={() => void share("export")}>{busy === "export" ? "Exporting…" : EXPORT_CONTEXT}</button>
            : <>
                <button className="row row-act" disabled={!!busy || offline} onClick={() => void share("once")}>{busy === "once" ? "Sharing…" : SHARE_ONCE}</button>
                <button className="row row-act hub-quiet" disabled={!!busy || offline} onClick={() => void share("project")}>{busy === "project" ? "Sharing…" : SHARE_PROJECT}</button>
              </>}
          <button className="row row-act hub-quiet" disabled={!!busy || offline} onClick={() => setImporting(true)}>{PASTE_BACK}</button>
        </div></div>
      )}
      {shared && <div className="hub-note">{shared}</div>}
      <div className="hub-note">{EXPORT_CAVEAT}</div>
      <div className="screen-foot" />
      {importing && <ImportSheet projectTitle={projectTitle} busy={busy === "import"} error={importError} onCancel={() => { setImporting(false); setImportError(null); }} onSave={(t) => void doImport(t)} />}
    </div>
  );
}
