// H5 CONTEXT PREVIEW (IMPLEMENTATION-SPEC.md 05.2, 09). Exactly what would
// be shared, before anything is: purpose, project, permitted records and
// fields, what is left out, the expiry, the export caveat. Share makes the
// grant for exactly this preview (by its hash) and, for a manual assistant,
// the export file; the read receipt is written by the function. Cancel
// shares nothing. Paste what came back imports proposals into Mentioned.

import { useEffect, useState } from "react";
import PageHeader from "../shared/PageHeader";
import { showToast } from "../shared/toast";
import { copyText, shareText } from "../shared/shareText";
import { exportContext, grantScope, importProposals, previewContext, type PreviewResult } from "../substrate/agentClient";
import { PROTOCOL_ERRORS } from "../substrate/gateway/protocol";
import { COMMAND_LINES } from "../substrate/commands/errors";
import { CANCEL_SHARES_NOTHING, COPY_EXPORT, COPY_EXPORT_FAILED, EXPORT_CAVEAT, EXPORT_CONTEXT, EXPORT_COPIED, EXPORT_NOT_SENT, PASTE_BACK, SHARE_ONCE, SHARE_PROJECT, PREVIEW_ALWAYS, recordsLine } from "./copy";
import { openJob, type HubConnection, type RpcClient } from "./hubClient";
import { ImportSheet } from "./sheets";
import HubFacts, { type HubFact, type HubFactInput } from "./HubFacts";
import { Foot } from "../settings/kit";
import { titleCase } from "../shared/casing";

// 2026-10-05 (catalog gate, R1, R3, R6 and the casing rule). The preview's rows
// drew middle-dotted strings in .conn-meta ("2 KB · Project Brief, Open Tasks,
// Decisions", "Redacted · a, b · 1 Outside This Project · Health, Money and
// Mail Are Never Shared", "15 Minutes After Sharing · A Read Receipt Is
// Written First"), a field list in raw lower-case keys, and "None" as a
// placeholder. Each is a list of facts now with the one grey per line, the
// key where it means something (over the limit is red) and a white number for
// a count with no state. The two sentences that are always true moved under
// the card as its note.
export function recordsFacts(bytes: number): HubFactInput[] {
  return [bytes > 0 && { text: `${Math.max(1, Math.round(bytes / 1024))} KB`, strong: true }, { text: "Project Brief, Open Tasks, Decisions" }];
}
export function fieldsFacts(fields: string[]): HubFactInput[] {
  const names = [...new Set(fields)].map((f) => titleCase(f.replace(/_/g, " "))).sort();
  return names.length ? [{ text: names.join(", ") }] : [];
}
export function leftOutFacts(redactions: string[], outside: number, over: number): HubFactInput[] {
  return [
    redactions.length > 0 && { text: `Redacted ${redactions.map((r) => titleCase(r.replace(/_/g, " "))).join(", ")}` },
    outside > 0 && { text: `${outside} Outside This Project`, strong: true },
    over > 0 && { text: `${over} Over the Limit`, tone: "red" },
  ];
}
// A purpose that only restates the project's own name says nothing the row's title has not.
const restates = (purpose: string | undefined, title: string) => !purpose || purpose === `Help with ${title}` || purpose === `Export ${title}`;

/** Hand the export to the share sheet, else the clipboard, and say which. Null
 *  means NEITHER took it, which the caller must not dress up as a success: the
 *  package exists only in this function's argument, and the disclosure receipt
 *  is already written (2026-10-04, it used to answer "Export Ready · Copy It From
 *  the Activity Receipt" over a receipt that never holds the package). */
async function deliver(fileName: string, text: string): Promise<string | null> {
  try {
    const r = await shareText(text, fileName);
    if (r === "shared") return "Shared";
    if (r === "copied") return EXPORT_COPIED;
  } catch { /* share refused, often because this runs after an await and the tap is spent; the clipboard is next */ }
  try { await copyText(text); return EXPORT_COPIED; } catch { return null; }
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
  // The export's words, kept on screen when neither the share sheet nor the
  // clipboard took them, so they can be copied by hand (or with the button
  // below, whose tap is a fresh gesture the clipboard will accept).
  const [held, setHeld] = useState<string | null>(null);
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
    setHeld(null);
    // An export makes no grant (slice 09 QA, 2026-10-04). A grant names an assistant, and the person's own export
    // has none (its job has no agent), so scope_grant_create refused it and every export toasted "The request
    // didn't match the protocol". context_issue takes the person's tap as the authority and writes the
    // disclosure receipt itself; a grant is only for an assistant that will read later.
    if (how !== "export") {
      const g = await grantScope(client, jobId, preview.manifest_hash, how === "project" ? "project" : "once");
      if (!g.ok) { setBusy(null); showToast({ message: PROTOCOL_ERRORS[g.code].safe_message }); if (g.code === "STALE_SCOPE") void load(); return; }
    }
    if (how === "export") {
      const x = await exportContext(client, jobId, preview.manifest_hash);
      if (!x.ok) { setBusy(null); showToast({ message: PROTOCOL_ERRORS[x.code].safe_message }); if (x.code === "STALE_SCOPE") void load(); return; }
      const said = await deliver(x.value.fileName, x.value.text);
      if (said === null) setHeld(x.value.text);
      setShared(said ?? EXPORT_NOT_SENT);
      showToast({ message: said ?? EXPORT_NOT_SENT });
    } else {
      const line = how === "once" ? `Shared ${recordsLine(preview.record_count)} · 15 Minutes` : `Shared ${recordsLine(preview.record_count)} · For This Project`;
      setShared(line);
      showToast({ message: line });
    }
    setBusy(null);
  };

  const copyHeld = async () => {
    if (held === null) return;
    try {
      await copyText(held);
      setHeld(null);
      setShared(EXPORT_COPIED);
      showToast({ message: EXPORT_COPIED });
    } catch {
      showToast({ message: COPY_EXPORT_FAILED });
    }
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
      <Foot>{CANCEL_SHARES_NOTHING}</Foot>

      <div className="sh2 sh2-quiet"><span className="t">What Would Be Shared</span></div>
      <div className="pad-x"><div className="card list-card-ruled">
        <div className="row"><div className="row-grow"><div className="conn-name">{projectTitle}</div><HubFacts facts={[!restates(preview?.purpose, projectTitle) && { text: preview!.purpose }]} /></div></div>
        {preview && (
          <>
            <div className="row"><div className="row-grow"><div className="conn-name">{recordsLine(preview.record_count)}</div><HubFacts facts={recordsFacts(preview.content_bytes)} /></div></div>
            <div className="row"><div className="row-grow"><div className="conn-name">Fields</div><HubFacts facts={fieldsFacts(preview.manifest.flatMap((m) => m.fields))} /></div></div>
            <div className="row"><div className="row-grow"><div className="conn-name">Left Out</div><HubFacts facts={leftOutFacts(preview.redactions, unauthorized, over)} /></div></div>
            <div className="row"><div className="row-grow"><div className="conn-name">Expires</div><HubFacts facts={[{ text: "15 Minutes After Sharing" }]} /></div></div>
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
      {shared && <Foot>{shared}</Foot>}
      {held !== null && (
        <div className="pad-x"><div className="card list-card-ruled">
          <button className="row row-act" onClick={() => void copyHeld()}>{COPY_EXPORT}</button>
          <textarea className="copy-fallback" readOnly value={held} aria-label="The export, ready to copy" onFocus={(e) => e.currentTarget.select()} />
        </div></div>
      )}
      {preview && <Foot>{PREVIEW_ALWAYS}</Foot>}
      <Foot>{EXPORT_CAVEAT}</Foot>
      <div className="screen-foot" />
      {importing && <ImportSheet projectTitle={projectTitle} busy={busy === "import"} error={importError} onCancel={() => { setImporting(false); setImportError(null); }} onSave={(t) => void doImport(t)} />}
    </div>
  );
}
