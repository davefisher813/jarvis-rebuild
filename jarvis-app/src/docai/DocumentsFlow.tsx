import { useCallback, useEffect, useRef, useState } from "react";
import LargeTitleNav from "../shared/LargeTitleNav";
import OptionsSheet from "../shared/OptionsSheet";
import MoneyRow from "../money/MoneyRow";
import { useFileStore, useOptionalFiles, useOptionalLedger, useOptionalNotes, useOptionalSchedule } from "../data/NotesProvider";
import { FileText, Image as ImageGlyph } from "../shared/icons";
import { showToast } from "../shared/toast";
import { attemptWrite } from "../shared/guard";
import { titleCase } from "../shared/casing";
import { todayISO } from "../tasks/grouping";
import { effectiveLevel } from "../ai/aiGate";
import { getAIControl } from "../ai/levelStore";
import { fileStem, type UserFile } from "../files/types";
import { decideProposal, enqueueDoc, filedHere, markFiledHere, openProposal, putDeviceText, readDocText } from "./docClient";
import { deviceReader } from "./deviceOcr";
import { ordinaryDoors } from "./doors";
import { fileProposal } from "./filing";
import { intakeDocument } from "./intake";
import { rowWords } from "./lifecycle";
import { decisionRecord } from "./record";
import ProposalSheet from "./ProposalSheet";
import type { DocProposal } from "./proposal";
import type { DocText } from "./types";

// DOCUMENTS (Doc AI Phase 1). Upload a PDF or take a photo; JARVIS reads it, and when it finds something to do it says "Ready to Review".
// A row's tap is its one door: a proposal opens the review sheet, a filed document opens the file, a stuck one tries again. Nothing is
// ever filed from this screen except through File It on the review sheet. Section actions live in the head (rule: never inside a card),
// and a section with nothing in it is its head and the capsule, no empty plate.

const POLL_MS = 4000;

type Sheet = { kind: "options" } | { kind: "review"; fileId: string; proposalId: string; proposal: DocProposal; text: DocText | null } | null;

export default function DocumentsFlow({ onBack }: { onBack: () => void }) {
  const filesSvc = useOptionalFiles();
  const fileStore = useFileStore();
  const ledger = useOptionalLedger();
  const schedule = useOptionalSchedule();
  const notes = useOptionalNotes();
  const [docs, setDocs] = useState<UserFile[]>([]);
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  const [sheet, setSheet] = useState<Sheet>(null);
  const pick = useRef<HTMLInputElement>(null);
  const photo = useRef<HTMLInputElement>(null);
  // Read at render so a change in AI Control shows on the next row without a reload.
  const aiLevel = effectiveLevel(getAIControl(), "docExtract");

  const load = useCallback(async () => {
    if (!filesSvc) return;
    setDocs(await filesSvc.list("library"));
  }, [filesSvc]);

  useEffect(() => { void load(); }, [load]);

  // While anything is being read, look again: the worker moves the row on the server and the screen follows it.
  const working = docs.some((d) => rowWords(d.data.doc, { aiLevel }).working);
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => { void load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [working, load]);

  // Signed links are resolved ahead of the tap so opening a file stays inside the tap.
  useEffect(() => {
    if (!fileStore) return;
    let live = true;
    void Promise.all(docs.filter((d) => d.data.path).map(async (d) => [d.id, await fileStore.url(d.data.path)] as const))
      .then((pairs) => { if (live) setUrls(Object.fromEntries(pairs)); }, () => undefined);
    return () => { live = false; };
  }, [fileStore, docs]);

  const openFile = (d: UserFile) => {
    const url = urls[d.id];
    if (!url) { showToast({ message: "Couldn't Open That File · Try Again in a Moment" }); return; }
    window.open(url, "_blank", "noopener");
  };

  const add = async (file: File | undefined) => {
    if (!file || !filesSvc || !fileStore) return;
    setSheet(null);
    const r = await intakeDocument(file, {
      files: filesSvc, store: fileStore, enqueue: (id) => enqueueDoc(id), putText: putDeviceText, reader: deviceReader(), today: todayISO(),
    });
    if (!r.ok) { showToast({ message: r.reason }); return; }
    showToast({ message: r.queued ? "Reading It Now" : "Kept on This Phone · Will Read When You're Back Online" });
    await load();
  };

  const retry = async (d: UserFile, requested: boolean) => {
    const r = await enqueueDoc(d.id, { retry: true, requested });
    showToast({ message: r.ok ? (requested ? "Reviewing It Now" : "Trying Again") : "Couldn't Reach JARVIS · Try Again" });
    await load();
  };

  const review = async (d: UserFile) => {
    const [p, t] = await Promise.all([openProposal(d.id), readDocText(d.id)]);
    if (!p.ok || !p.value) { showToast({ message: "Nothing to Review Here" }); return; }
    setSheet({ kind: "review", fileId: d.id, proposalId: p.value.id, proposal: p.value.body, text: t.ok ? t.value : null });
  };

  const door = (d: UserFile) => {
    const w = rowWords(d.data.doc, { aiLevel });
    if (d.data.doc?.state === "proposed") return void review(d);
    if (w.action === "retry") return void retry(d, false);
    if (w.action === "review") return void retry(d, true);
    openFile(d);
  };

  const remove = async (d: UserFile) => {
    if (!filesSvc) return;
    if (!(await attemptWrite(() => filesSvc.remove(d.id)))) return;
    await load();
    let undone = false;
    const sweep = setTimeout(() => { if (!undone) void fileStore?.remove([d.data.path]); }, 6000);
    showToast({
      message: "Document Removed", actionLabel: "Undo",
      // The read text went with the row (migration 0073), so Undo brings the row back and asks for a fresh read.
      onAction: () => void (async () => { undone = true; clearTimeout(sweep); await attemptWrite(() => filesSvc.create(d.data, d.id)); await enqueueDoc(d.id, { retry: true }); await load(); })(),
    });
  };

  const file = async (s: Extract<Sheet, { kind: "review" }>, p: DocProposal): Promise<{ ok: true } | { ok: false; reason: string }> => {
    // Filed on this device already but the decision never reached the server: finish the decision, write nothing twice.
    const before = filedHere(s.proposalId);
    if (before) {
      await decideProposal(s.proposalId, "filed", decisionRecord(p, "filed", null), before);
      setSheet(null); await load();
      return { ok: true };
    }
    const r = await fileProposal(p, ordinaryDoors({ ledger, schedule, notes }));
    if (!r.ok) return { ok: false, reason: r.reason };
    markFiledHere(s.proposalId, r.words);
    const rec = decisionRecord(p, "filed", r);
    let saved = (await decideProposal(s.proposalId, "filed", rec, r.words)).ok;
    for (let i = 0; !saved && i < 2; i++) saved = (await decideProposal(s.proposalId, "filed", rec, r.words)).ok;
    setSheet(null);
    const leftOut = r.skipped.length;
    showToast({ message: `Filed · ${r.words}${leftOut ? ` · ${leftOut} Left Out` : ""}` });
    await load();
    return { ok: true };
  };

  const dismiss = async (s: Extract<Sheet, { kind: "review" }>, p: DocProposal): Promise<boolean> => {
    const r = await decideProposal(s.proposalId, "dismissed", decisionRecord(p, "dismissed", null));
    if (!r.ok) { showToast({ message: "Couldn't Reach JARVIS · Try Again" }); return false; }
    setSheet(null);
    showToast({ message: "Dismissed · The Document Stays" });
    await load();
    return true;
  };

  if (!filesSvc || !fileStore) return null;

  return (
    <div className="screen ruled">
      <LargeTitleNav title="Documents" back="More" onBack={onBack} />
      <div className="sh2 sh2-quiet"><span className="t">Documents</span>{docs.length > 0 && <span className="n">{docs.length}</span>}
        <button className="see-all pill-action" onClick={() => setSheet({ kind: "options" })}>Add Document</button></div>

      {docs.length > 0 && (
        <div className="pad-x"><div className="card list-card-ruled">
          {docs.map((d) => {
            const w = rowWords(d.data.doc, { aiLevel });
            const image = d.data.mime.startsWith("image/");
            const name = titleCase(fileStem(d.data.name));
            return (
              <MoneyRow key={d.id} name={name} className="file-row" onOpen={() => door(d)} onDelete={() => void remove(d)} deleteLabel="Remove"
                menu={[
                  { label: "Open", onPick: () => openFile(d) },
                  ...(w.action === "retry" ? [{ label: "Try Again", onPick: () => void retry(d, false) }] : []),
                  ...(w.action === "review" ? [{ label: "Review This", onPick: () => void retry(d, true) }] : []),
                  { label: "Remove", destructive: true, onPick: () => void remove(d) },
                ]}>
                <div className="task-check-tap"><span className="gm-slot cat-fg-graphite">{image ? <ImageGlyph className="ic" /> : <FileText className="ic" />}</span></div>
                <div className="task-title">
                  <span className="task-name">{name}</span>
                  <div className="facts">
                    <span className={"fact" + (d.data.doc?.state === "proposed" ? " strong" : "")}>{w.title}</span>
                    {w.facts.map((f) => <span key={f} className="fact">{f}</span>)}
                  </div>
                </div>
              </MoneyRow>
            );
          })}
        </div></div>
      )}

      <input ref={pick} type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic" hidden onChange={(e) => { void add(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={photo} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void add(e.target.files?.[0]); e.target.value = ""; }} />

      {sheet?.kind === "options" && (
        <OptionsSheet title="Add Document" onClose={() => setSheet(null)} rows={[
          { key: "file", label: "Choose a File", onClick: () => pick.current?.click() },
          { key: "photo", label: "Take a Photo", onClick: () => photo.current?.click() },
        ]} />
      )}
      {sheet?.kind === "review" && (
        <ProposalSheet initial={sheet.proposal} text={sheet.text} onClose={() => setSheet(null)}
          onFile={(p) => file(sheet, p)} onDismiss={(p) => dismiss(sheet, p)} />
      )}
    </div>
  );
}
