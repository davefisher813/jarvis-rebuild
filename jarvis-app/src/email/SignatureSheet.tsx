// THE SIGNATURE BUILDER (issue 113; Dave 2026-10-13: "Upload a pic. It auto scales. Enter your info and it creates a perfect
// signature." and "It should be super simple."). One screen, three steps in that order: a picture (any photo or logo; it fits
// itself, there is nothing to crop), six details (a blank one simply does not appear), and a preview that is the very HTML the
// email carries. One Save. The plain type-or-paste editor stays as the quiet alternative at the foot, so nobody who wants
// plain words is made to build.
//
// Reached from Settings, Email Signatures; from Email, Accounts, Edit Signature; and from a draft's Add Signature. Whichever
// the door, an account with no signature opens here, and an account whose signature was typed opens in the plain editor with
// the builder one tap away. The words are the account's own (migration 0072): the lines go in the draft as they always did;
// the picture is a small file in the person's own private folder, sent only beside the exact lines it was built with.

import { useEffect, useMemo, useRef, useState } from "react";
import { FormSheet, Group, FieldRow, Row, TextRow, Note, ErrorLine } from "../shared/FormSheet";
import { pressable } from "../shared/pressable";
import { Image as ImageGlyph } from "../shared/icons";
import { usePickFile, PICK_IMAGE } from "../shared/usePickFile";
import { prepareUpload } from "../shared/fileStorage";
import { showToast } from "../shared/toast";
import { lineFor, type RpcClient } from "../substrate/commands/errors";
import type { FileStore } from "../files/FileStore";
import { useFileUrl } from "../files/useFileUrl";
import { setBuiltSignature, setSignature, type EmailAccount } from "./emailClient";
import { sha256Hex } from "./drafts";
import { fitPicture, type FittedPicture } from "./signaturePicture";
import SignaturePaper from "./SignaturePaper";
import { cleanFields, composeSignatureText, pictureSize, signatureBodyHtml, SIGNATURE_DELIM, SIGNATURE_FIELDS, type SignatureField, type SignatureFields, type SignatureImage } from "./signature";
import type { SignatureSaved } from "./signatureBus";
import {
  EDIT_SIGNATURE, SIG_DETAILS_LABEL, SIG_DETAILS_NOTE, SIG_FIELD_LABELS, SIG_NEEDS_DETAIL, SIG_PICTURE_ADD, SIG_PICTURE_CHANGE, SIG_PICTURE_FITTING, SIG_PICTURE_LABEL,
  SIG_PICTURE_NOTE, SIG_PICTURE_REMOVE, SIG_PICTURE_SAVE_FAILED, SIG_PICTURE_UNREADABLE, SIG_PREVIEW_LABEL, SIG_PREVIEW_NOTE, SIG_USE_BUILDER, SIG_WRITE_IT,
  SIGNATURE_LABEL, SIGNATURE_NOTE, SIGNATURE_SAVED,
} from "./copy";

type Mode = "build" | "plain";
/** The picture in play: none, the one already saved, or one just picked (fitted, waiting for Save). */
type Pic = { kind: "none" } | { kind: "saved" } | { kind: "new"; fitted: FittedPicture; url: string };

/** What a phone's keyboard and autofill may offer for each detail. */
const AUTOFILL: Record<SignatureField, { type: "text" | "email" | "tel" | "url"; autoComplete: string }> = {
  name: { type: "text", autoComplete: "name" },
  title: { type: "text", autoComplete: "organization-title" },
  organization: { type: "text", autoComplete: "organization" },
  phone: { type: "tel", autoComplete: "tel" },
  email: { type: "email", autoComplete: "email" },
  website: { type: "url", autoComplete: "url" },
};

export default function SignatureSheet({ client, userId, account, fileStore = null, onClose, onSaved }: {
  client: RpcClient;
  userId: string;
  account: EmailAccount;
  /** Where the picture is kept. Without one the picture step is not drawn: nothing here is a dead control. */
  fileStore?: FileStore | null;
  onClose: () => void;
  /** The server's new signature_text and signature_revision once saved, and the whole record (how it was made, its details, its picture). */
  onSaved: (accountId: string, text: string, revision: number, saved: SignatureSaved) => void;
}) {
  const wasBuilt = account.signature_kind === "built";
  const startMode: Mode = wasBuilt || account.signature_text.trim() === "" ? "build" : "plain";
  const [mode, setMode] = useState<Mode>(startMode);
  // The address is the person's own, already on the account: a good first line for the one detail nobody should have to type.
  const [fields, setFields] = useState<SignatureFields>(() => (wasBuilt ? { ...account.signature_fields } : { email: account.address }));
  const [plainText, setPlainText] = useState(account.signature_text);
  const [pic, setPic] = useState<Pic>(account.signature_image ? { kind: "saved" } : { kind: "none" });
  const [scaling, setScaling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const live = useRef(true);
  const objectUrl = useRef<string | null>(null);
  useEffect(() => () => {
    live.current = false;
    if (objectUrl.current && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(objectUrl.current);
  }, []);

  const releaseUrl = () => {
    if (objectUrl.current && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
  };
  const adoptFitted = (fitted: FittedPicture) => {
    releaseUrl();
    const url = typeof URL.createObjectURL === "function" ? URL.createObjectURL(fitted.file) : "";
    objectUrl.current = url || null;
    setPic({ kind: "new", fitted, url });
  };
  const picker = usePickFile((file) => {
    setLine(null);
    setScaling(true);
    fitPicture(file)
      .then((fitted) => { if (live.current) adoptFitted(fitted); })
      .catch(() => { if (live.current) setLine(SIG_PICTURE_UNREADABLE); })
      .finally(() => { if (live.current) setScaling(false); });
  });
  const removePicture = () => { releaseUrl(); setPic({ kind: "none" }); };

  // ---- the preview: the lines and the picture, as the email will carry them ----
  const clean = useMemo(() => cleanFields(fields), [fields]);
  const text = composeSignatureText(clean);
  const savedUrl = useFileUrl(fileStore, pic.kind === "saved" ? account.signature_image?.storage_id : undefined);
  const picUrl = pic.kind === "new" ? pic.url || null : pic.kind === "saved" ? savedUrl : null;
  const picSize = pic.kind === "new" ? pic.fitted : pic.kind === "saved" ? account.signature_image ?? null : null;
  const slot = picUrl && picSize ? { src: picUrl, ...pictureSize(picSize) } : null;
  const previewHtml = useMemo(() => (text ? signatureBodyHtml(SIGNATURE_DELIM + text, clean, slot) : null), [text, clean, slot?.src, slot?.width, slot?.height]);

  const picChanged = pic.kind === "new" || (pic.kind === "none" && !!account.signature_image);
  const dirty = picChanged || mode !== startMode;

  const finish = (saved: SignatureSaved) => {
    onSaved(saved.accountId, saved.text, saved.revision, saved);
    showToast({ message: SIGNATURE_SAVED });
    onClose();
  };
  /** Typed words are the whole signature: the account goes back to plain text and any picture goes with it. */
  const savePlain = async (words: string) => {
    const r = await setSignature(client, userId, account.id, words, account.signature_revision);
    if (!r.ok) { setLine(lineFor(r)); return; }
    if (account.signature_image) void fileStore?.remove([account.signature_image.storage_id]);
    finish({ accountId: account.id, text: r.value.signature_text, revision: r.value.signature_revision, kind: "text", fields: {}, image: null });
  };
  const saveBuilt = async () => {
    let image: SignatureImage | null = pic.kind === "saved" ? account.signature_image ?? null : null;
    let uploaded: string | null = null;
    if (pic.kind === "new") {
      if (!fileStore) { setLine(SIG_PICTURE_SAVE_FAILED); return; }
      try {
        // The same hashing the composer does for an attachment: the bytes as they are stored.
        const prepared = await prepareUpload(pic.fitted.file);
        const sha256 = await sha256Hex(prepared.bytes);
        const stored = await fileStore.upload("signature-" + account.id, pic.fitted.file);
        uploaded = stored.path;
        image = { storage_id: stored.path, sha256, size_bytes: stored.bytes, mime_type: pic.fitted.mime, width: pic.fitted.width, height: pic.fitted.height };
      } catch {
        setLine(SIG_PICTURE_SAVE_FAILED);
        return;
      }
    }
    const r = await setBuiltSignature(client, userId, account.id, clean, image, account.signature_revision);
    if (!r.ok) {
      if (uploaded) void fileStore?.remove([uploaded]);
      setLine(lineFor(r));
      return;
    }
    const old = account.signature_image;
    if (old && old.storage_id !== image?.storage_id) void fileStore?.remove([old.storage_id]);
    finish({ accountId: account.id, text: r.value.signature_text, revision: r.value.signature_revision, kind: "built", fields: r.value.signature_fields ?? clean, image: r.value.signature_image ?? image });
  };
  const save = async () => {
    if (busy || scaling) return;
    setBusy(true);
    setLine(null);
    try {
      if (mode === "plain") await savePlain(plainText);
      // Nothing filled in and no picture is the same as clearing the signature: the plain editor's empty save.
      else if (text === "" && pic.kind === "none") await savePlain("");
      // A picture alone has no lines to carry it.
      else if (text === "") setLine(SIG_NEEDS_DETAIL);
      else await saveBuilt();
    } finally {
      if (live.current) setBusy(false);
    }
  };

  const toPlain = () => { setPlainText(text || account.signature_text); setLine(null); setMode("plain"); };
  const toBuilder = () => { setLine(null); setMode("build"); };

  return (
    <FormSheet title={EDIT_SIGNATURE} onCancel={onClose} onSave={() => void save()} saveDisabled={busy || scaling} dirty={dirty}>
      <div className="email-note quiet"><span>{account.address}</span></div>
      <ErrorLine text={line} />
      {mode === "build" ? (
        <>
          {fileStore && (
            <Group label={SIG_PICTURE_LABEL}>
              <div className="row xs-row sig-pic-row" {...pressable(() => picker.open(PICK_IMAGE))}>
                <span className="sig-pic">{picUrl ? <img className="sig-pic-img" src={picUrl} alt="" /> : <ImageGlyph className="ic" />}</span>
                <div className="row-grow">
                  <div className="conn-name">{pic.kind === "none" ? SIG_PICTURE_ADD : SIG_PICTURE_CHANGE}</div>
                  {scaling && <div className="conn-meta">{SIG_PICTURE_FITTING}</div>}
                </div>
                <div className="chev" />
              </div>
              {pic.kind !== "none" && <Row label={SIG_PICTURE_REMOVE} onClick={removePicture} />}
              <Note>{SIG_PICTURE_NOTE}</Note>
            </Group>
          )}
          <Group label={SIG_DETAILS_LABEL}>
            {SIGNATURE_FIELDS.map((k) => (
              <FieldRow key={k} label={SIG_FIELD_LABELS[k]} ariaLabel={SIG_FIELD_LABELS[k]} value={fields[k] ?? ""}
                onChange={(v) => setFields((f) => ({ ...f, [k]: v }))} type={AUTOFILL[k].type} autoComplete={AUTOFILL[k].autoComplete} enterKeyHint="next" />
            ))}
            <Note>{SIG_DETAILS_NOTE}</Note>
          </Group>
          {previewHtml && (
            <Group label={SIG_PREVIEW_LABEL}>
              <SignaturePaper html={previewHtml} title={SIG_PREVIEW_LABEL} />
              <Note>{SIG_PREVIEW_NOTE}</Note>
            </Group>
          )}
          {/* A picture has no lines to ride with: say so before Save does (once; Save's own line replaces this one). */}
          {!previewHtml && pic.kind !== "none" && line !== SIG_NEEDS_DETAIL && <div className="email-note quiet"><span>{SIG_NEEDS_DETAIL}</span></div>}
        </>
      ) : (
        <Group label={SIGNATURE_LABEL}>
          <TextRow value={plainText} onChange={setPlainText} placeholder={SIGNATURE_LABEL} ariaLabel={SIGNATURE_LABEL} rows={5} />
          <Note>{SIGNATURE_NOTE}</Note>
        </Group>
      )}
      {/* The other way in, standing by itself (no sentence to prop it up, no box around it). */}
      <div className="email-sheet-acts email-compose-acts">
        <button className="quiet-action" onClick={mode === "build" ? toPlain : toBuilder}>{mode === "build" ? SIG_WRITE_IT : SIG_USE_BUILDER}</button>
      </div>
      {picker.input}
    </FormSheet>
  );
}
