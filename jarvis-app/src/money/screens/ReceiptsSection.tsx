import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOptionalFiles, useFileStore, useOptionalLedger, useTracker } from "../../data/NotesProvider";
import { useAI } from "../../ai/useAI";
import { attemptWrite } from "../../shared/guard";
import { showToast } from "../../shared/toast";
import MoneyRow from "../MoneyRow";
import { lineCase, titleCase } from "../../shared/casing";
import { todayISO } from "../../tasks/grouping";
import { Image as ImageGlyph, FileText, Sparkles } from "../../shared/icons";
import { ENTITY_FILE, fileStem, sizeLabel, type UserFile } from "../../files/types";
import { monthDay } from "../bills";
import { categoryChoices, lastCategoryFor } from "../categoryDefault";
import { ENTITY_MONEY_RECEIPT, type Receipt } from "../ledger/types";
import { legacyFiles, newestFirst } from "../receiptList";
import { draftFromRead, readReceiptFile } from "../receiptRead";
import { ENTITY_MONEY_TX, fmtCents, type TrackerBudget, type TrackerTx } from "../tracker";
import { useLedgerEvents } from "../useLedgerEvents";
import ReceiptSheet, { type Attachment, type ReceiptDraft } from "./ReceiptSheet";
import ReceiptDetailSheet from "./ReceiptDetailSheet";

// THE RECEIPTS SECTION OF MONEY (Money ledger, 2026-10-03). Receipts are
// RECORDS now: a vendor, an amount, a date, an optional category and an
// optional photo or file. There are four ways in and none needs a model: type
// it, take a photo, attach a file, or confirm what Read It proposed (Read It
// is only offered with AI on, and only ever fills the sheet). The email way in
// is the pipeline's, not this file's.
//
// Files uploaded before records existed stay here, visible and working, under
// their own head: open one, Read It on it to make a record, or remove it.

const emptyDraft = (today: string): ReceiptDraft => ({ vendor: "", amount: "", date: today, category: "", currency: "USD" });

type SheetState =
  | { kind: "new"; draft: ReceiptDraft; attachment: Attachment | null }
  | { kind: "detail"; id: string }
  | null;

export default function ReceiptsSection({ addNonce = 0 }: { addNonce?: number }) {
  const ledger = useOptionalLedger();
  const filesSvc = useOptionalFiles();
  const fileStore = useFileStore();
  const tracker = useTracker();
  const ai = useAI();
  const today = todayISO();

  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [files, setFiles] = useState<UserFile[]>([]);
  const [txs, setTxs] = useState<TrackerTx[]>([]);
  const [budgets, setBudgets] = useState<TrackerBudget[]>([]);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [reading, setReading] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ledger) return;
    const [rs, fs, t] = await Promise.all([
      ledger.listReceipts(),
      filesSvc ? filesSvc.list("money") : Promise.resolve([] as UserFile[]),
      tracker.load(),
    ]);
    setReceipts(rs);
    setFiles(fs);
    setTxs(t.txs);
    setBudgets(t.budgets);
  }, [ledger, filesSvc, tracker]);
  useEffect(() => { void load(); }, [load]);
  useLedgerEvents([ENTITY_MONEY_RECEIPT, ENTITY_MONEY_TX, ENTITY_FILE], load);

  // The header's paperclip asks for a new receipt by bumping this number.
  const seen = useRef(addNonce);
  useEffect(() => {
    if (addNonce === seen.current) return;
    seen.current = addNonce;
    setSheet({ kind: "new", draft: emptyDraft(todayISO()), attachment: null });
  }, [addNonce]);

  // A URL is resolved ahead of the tap, because a window.open after an await
  // is treated as a popup by iOS and silently blocked (B3-10, 2026-09-04).
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  useEffect(() => {
    let live = true;
    const stored = files.filter((f) => f.data.path);
    if (!fileStore || stored.length === 0) { setUrls({}); return; }
    void Promise.all(stored.map(async (f) => [f.id, await fileStore.url(f.data.path)] as const))
      .then((pairs) => { if (live) setUrls(Object.fromEntries(pairs)); });
    return () => { live = false; };
  }, [fileStore, files]);
  const openFile = (f: UserFile) => {
    const url = urls[f.id];
    if (!url) { showToast({ message: "Couldn't Open That File · Try Again in a Moment" }); return; }
    window.open(url, "_blank", "noopener");
  };

  const rows = useMemo(() => newestFirst(receipts), [receipts]);
  const loose = useMemo(() => legacyFiles(files, receipts), [files, receipts]);
  const categories = useMemo(
    () => categoryChoices({ txs, receipts, budgetNames: budgets.flatMap((b) => Object.keys(b.data.allocations)) }),
    [txs, receipts, budgets],
  );
  const categoryFor = useCallback((v: string) => lastCategoryFor(v, txs, receipts), [txs, receipts]);

  // ---- Read It: a proposal for the sheet, never a record ------------------
  const readAttachment = async (a: Attachment): Promise<Partial<ReceiptDraft> | null> => {
    if (!ai.available) return null;
    try {
      let file: File;
      if (a.kind === "new") file = a.file;
      else {
        const url = urls[a.id];
        if (!url) { showToast({ message: "Couldn't Open That File · Try Again in a Moment" }); return null; }
        const blob = await (await fetch(url)).blob();
        file = new File([blob], a.name, { type: a.mime || blob.type });
      }
      const read = await readReceiptFile(ai, file);
      if (!read) { showToast({ message: "Couldn't Read That · Try a Clearer Photo" }); return null; }
      return draftFromRead(read);
    } catch {
      showToast({ message: "Couldn't Read That Receipt · Try Again" });
      return null;
    }
  };
  // Read It on a file uploaded before records existed: read, then the sheet
  // opens with the candidate and the file attached. Save is still a tap.
  const readLegacy = async (f: UserFile) => {
    if (reading) return;
    setReading(f.id);
    try {
      const attachment: Attachment = { kind: "existing", id: f.id, name: f.data.name, mime: f.data.mime, bytes: f.data.bytes };
      const got = await readAttachment(attachment);
      if (!got) return;
      setSheet({ kind: "new", attachment, draft: { ...emptyDraft(f.data.addedAt || today), vendor: fileStem(f.data.name), ...got } });
    } finally {
      setReading(null);
    }
  };

  // ---- save a new receipt ---------------------------------------------------
  const saveNew = async (d: ReceiptDraft, a: Attachment | null): Promise<boolean> => {
    if (!ledger) return false;
    let fileId: string | undefined = a?.kind === "existing" ? a.id : undefined;
    let storedPath: string | undefined;
    // The row for a new file is made first (its path carries the row's id), and
    // taken back with its bytes if the receipt does not end up saved.
    const takeBack = async () => {
      if (a?.kind !== "new" || !fileId) return;
      await filesSvc?.remove(fileId).catch(() => undefined);
      if (storedPath) await fileStore?.remove([storedPath]).catch(() => undefined);
    };
    if (a?.kind === "new" && filesSvc && fileStore) {
      try {
        fileId = await filesSvc.create({ name: a.file.name, path: "", mime: a.file.type, bytes: a.file.size, scope: "money", addedAt: today });
        const stored = await fileStore.upload(fileId, a.file);
        storedPath = stored.path;
        await filesSvc.update(fileId, { path: stored.path, name: stored.name, mime: stored.mime, bytes: stored.bytes });
      } catch (e) {
        await takeBack();
        showToast({ message: e instanceof Error && e.message ? e.message : "Couldn't Upload That File" });
        return false;
      }
    }
    let result: Awaited<ReturnType<typeof ledger.addReceipt>> | undefined;
    const wrote = await attemptWrite(async () => {
      result = await ledger.addReceipt(
        { vendor: d.vendor, amount: d.amount, currency: d.currency, transactionDate: d.date, category: d.category, attachmentFileId: fileId },
        a?.kind === "new" && a.camera ? "camera" : "manual",
        today,
      );
    });
    if (!wrote || !result) { await takeBack(); return false; }
    if (!result.ok) { await takeBack(); showToast({ message: "Check the Vendor and Amount" }); return false; }
    if (result.duplicate) {
      // One purchase, one record: the second save changes nothing.
      await takeBack();
      showToast({ message: "Already Saved" });
    } else {
      showToast({ message: "Receipt Saved" });
    }
    setSheet(null);
    await load();
    return true;
  };

  // ---- the detail sheet's actions -------------------------------------------
  const saveEdit = async (r: Receipt, c: { vendor: string; amount: string; transactionDate: string; category: string }): Promise<boolean> => {
    if (!ledger) return false;
    let res: Awaited<ReturnType<typeof ledger.correctReceipt>> | undefined;
    if (!(await attemptWrite(async () => { res = await ledger.correctReceipt(r.id, c); })) || !res) return false;
    if (!res.ok) { showToast({ message: "Check the Vendor and Amount" }); return false; }
    setSheet(null);
    await load();
    return true;
  };

  const unmatch = async (r: Receipt) => {
    if (!ledger) return;
    const was = r.data.linkedTransactionId;
    if (!(await attemptWrite(() => ledger.unmatchReceipt(r.id)))) return;
    await load();
    showToast({
      message: "Unmatched", actionLabel: "Undo",
      onAction: () => void (async () => { if (was) await attemptWrite(() => ledger.approveReceiptMatch(r.id, was)); await load(); })(),
    });
  };

  const removeRecord = async (r: Receipt) => {
    if (!ledger) return;
    let snap: Receipt | null = null;
    if (!(await attemptWrite(async () => { snap = await ledger.removeReceipt(r.id); })) || !snap) return;
    const gone: Receipt = snap;
    // The attachment goes with it: the row now, the bytes a beat later, so
    // Undo can bring both back whole under the same ids.
    const file = files.find((f) => f.id === gone.data.attachmentFileId);
    if (file && filesSvc) await filesSvc.remove(file.id).catch(() => undefined);
    let undone = false;
    const sweep = setTimeout(() => { if (!undone && file) void fileStore?.remove([file.data.path]); }, 6000);
    setSheet(null);
    await load();
    showToast({
      message: "Receipt Deleted", actionLabel: "Undo",
      onAction: () => void (async () => {
        undone = true;
        clearTimeout(sweep);
        await attemptWrite(async () => {
          // The payment it was matched to was freed by the delete; match again
          // after the receipt is back (the service refuses if it was taken).
          const link = gone.data.linkedTransactionId;
          const back: Receipt = { id: gone.id, data: { ...gone.data } };
          delete back.data.linkedTransactionId;
          if (file && filesSvc) await filesSvc.create(file.data, file.id);
          await ledger.restoreReceipt(back);
          if (link) await ledger.approveReceiptMatch(gone.id, link);
        });
        await load();
      })(),
    });
  };

  const removeLegacy = async (f: UserFile) => {
    if (!filesSvc) return;
    if (!(await attemptWrite(() => filesSvc.remove(f.id)))) return;
    await load();
    let undone = false;
    const sweep = setTimeout(() => { if (!undone) void fileStore?.remove([f.data.path]); }, 6000);
    showToast({
      message: "Receipt Removed", actionLabel: "Undo",
      onAction: () => void (async () => { undone = true; clearTimeout(sweep); await attemptWrite(() => filesSvc.create(f.data, f.id)); await load(); })(),
    });
  };

  if (!ledger) return null;
  const open = sheet?.kind === "detail" ? receipts.find((r) => r.id === sheet.id) : undefined;
  const attachedFile = open?.data.attachmentFileId ? files.find((f) => f.id === open.data.attachmentFileId) : undefined;

  return (
    <>
      {rows.length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Receipts</span><span className="n">{rows.length}</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {rows.map((r) => {
              const f = files.find((x) => x.id === r.data.attachmentFileId);
              const image = !!f && f.data.mime.startsWith("image/");
              const openIt = () => setSheet({ kind: "detail", id: r.id });
              return (
                // A receipt's tap is its sheet (every action); the swipe and the menu are Delete, with its Undo.
                <MoneyRow key={r.id} name={titleCase(r.data.vendor)} className="file-row"
                  onDelete={() => void removeRecord(r)}
                  menu={[{ label: "Open", onPick: openIt }, { label: "Delete", destructive: true, onPick: () => void removeRecord(r) }]}
                  onOpen={openIt}>
                  {/* A receipt is MONEY, so its glyph wears Money's green, the picture's or the document's glyph in the
                      type's one tone (Dave 2026-10-05, rule 13: a type icon carries its type's colour; it was blue and the
                      brand red, and brand red is for what can be tapped). */}
                  <div className="task-check-tap"><span className="gm-slot cat-fg-green">
                    {image ? <ImageGlyph className="ic" /> : <FileText className="ic" />}
                  </span></div>
                  <div className="task-title">
                    <span className="task-name">{titleCase(r.data.vendor)}</span>
                    {/* The day is a date, small caps; the category keeps the
                        row's one grey, and a matched receipt says so in the
                        key's green (2026-10-05, visual catalog gate, R1 and
                        R3: Matched was a second grey, and linked is the
                        key's "logged"). The short toned facts lead and the
                        free-text category goes last, the one that shrinks. */}
                    <div className="facts">
                      <span className="fact date">{monthDay(r.data.transactionDate)}</span>
                      {r.data.linkedTransactionId && <span className="fact good">Matched</span>}
                      {r.data.category && <span className="fact">{lineCase(r.data.category)}</span>}
                    </div>
                  </div>
                  <div className="mt-amt">{fmtCents(r.data.amountCents)}</div>
                </MoneyRow>
              );
            })}
          </div></div>
        </>
      )}

      {loose.length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Files</span><span className="n">{loose.length}</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {loose.map((r) => {
              const image = r.data.mime.startsWith("image/");
              // Read It, on a picture the app can actually read, and only with AI on. It proposes a receipt; it never
              // saves one. It is the row's one verb (the swipe, the menu), never a pill on the row.
              const canRead = ai.available && image;
              const read = () => void readLegacy(r);
              return (
                <MoneyRow key={r.id} name={r.data.name} className="file-row"
                  verb={canRead ? { label: reading === r.id ? "Reading" : "Read It", icon: <Sparkles className="ic" />, run: read } : null}
                  onDelete={() => void removeLegacy(r)} deleteLabel="Remove"
                  menu={[
                    { label: "Open", onPick: () => openFile(r) },
                    ...(canRead ? [{ label: "Read It", onPick: read }] : []),
                    { label: "Remove", destructive: true, onPick: () => void removeLegacy(r) },
                  ]}
                  onOpen={() => openFile(r)}>
                  {/* The type is the glyph's colour: Money's green, the one tone for a receipt's picture or document. */}
                  <div className="task-check-tap"><span className="gm-slot cat-fg-green">
                    {image ? <ImageGlyph className="ic" /> : <FileText className="ic" />}
                  </span></div>
                  <div className="task-title">
                    <span className="task-name">{r.data.name}</span>
                    <div className="r-k"><span className="fact date">{monthDay(r.data.addedAt)}</span>{r.data.bytes > 0 && <span className="r-goal r-cat">{sizeLabel(r.data.bytes)}</span>}</div>
                  </div>
                </MoneyRow>
              );
            })}
          </div></div>
        </>
      )}

      {sheet?.kind === "new" && (
        <ReceiptSheet
          initial={sheet.draft}
          attachment={sheet.attachment}
          categories={categories}
          categoryFor={categoryFor}
          canAttach={!!filesSvc && !!fileStore}
          canRead={ai.available}
          onRead={readAttachment}
          onSave={saveNew}
          onCancel={() => setSheet(null)}
        />
      )}
      {open && (
        <ReceiptDetailSheet
          receipt={open}
          linked={open.data.linkedTransactionId ? txs.find((t) => t.id === open.data.linkedTransactionId) : undefined}
          categories={categories}
          attachmentName={attachedFile?.data.name}
          attachmentUrl={attachedFile ? urls[attachedFile.id] ?? null : null}
          onSave={(c) => saveEdit(open, c)}
          onUnmatch={() => void unmatch(open)}
          onDelete={() => void removeRecord(open)}
          onCancel={() => setSheet(null)}
        />
      )}
    </>
  );
}
