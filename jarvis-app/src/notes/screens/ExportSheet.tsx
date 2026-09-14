import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { JSONContent } from "@tiptap/core";
import { EXPORT_FORMATS, buildExport, formatInfo, readLastFormat, writeLastFormat, safeFilename, cleanStem, type ExportFormat, type ExportImage } from "../exportDoc";
import { docToMarkdown, docToPlainText } from "../markdown";
import { saveFile, canShareFiles } from "../../shared/saveFile";
import { showToast } from "../../shared/toast";
import { SwitchRow } from "../../shared/FormSheet";
import { FileText } from "../../shared/icons";

// EXPORT A NOTE (the writing system, wave 2, 2026-09-14). One compact sheet:
// the filename already filled from the title, the four formats with what
// each is for, one filled action, a preview and the advanced options behind
// a disclosure nobody has to open for a normal export.
//
// The file is prepared the moment the sheet opens and again whenever a
// choice changes, so the tap on Export File is the share itself, inside the
// browser's own activation window; two taps from the note header start an
// export with the suggested name and the remembered format, and the OS
// sheet is the only thing after them. A dismissed share sheet says nothing.
// Success says Shared or Downloaded, never "saved to Files", because the
// browser cannot know where a shared file went. A failure keeps the note as
// it was and offers Retry and the other formats.

export interface ExportSheetProps {
  doc: JSONContent;
  title: string;
  /** True when the document is a selection rather than the whole note. */
  selection?: boolean;
  /** Photo bytes for the formats that embed them, read before the sheet opens. */
  images: ExportImage[];
  /** Attachment names that cannot be embedded (files, unreadable photos). */
  attachmentNames: string[];
  onClose: () => void;
}

export default function ExportSheet({ doc, title, selection = false, images, attachmentNames, onClose }: ExportSheetProps) {
  const [format, setFormat] = useState<ExportFormat>(() => readLastFormat());
  const [stem, setStem] = useState(() => safeFilename(title, "x").slice(0, -2));
  const [includeTitle, setIncludeTitle] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [file, setFile] = useState<{ format: ExportFormat; includeTitle: boolean; blob: Blob } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const gen = useRef(0);
  const info = formatInfo(format);
  const filename = safeFilename(cleanStem(stem), info.ext);

  // Prepare on open and on every choice, so the tap on Export File is the
  // share itself.
  useEffect(() => {
    const mine = ++gen.current;
    setPreparing(true);
    setFailed(null);
    void buildExport(format, { doc, title, includeTitle, images, attachmentNames: [...attachmentNames] })
      .then((blob) => { if (gen.current === mine) { setFile({ format, includeTitle, blob }); setPreparing(false); } })
      .catch((e: unknown) => { if (gen.current === mine) { setFile(null); setPreparing(false); setFailed(e instanceof Error && e.message ? e.message : "The file could not be prepared"); } });
  }, [format, includeTitle, doc, title, images, attachmentNames]);

  const ready = !!file && file.format === format && file.includeTitle === includeTitle && !preparing;

  const run = async () => {
    if (!ready || busy || !file) return;
    setBusy(true);
    setFailed(null);
    try {
      const result = await saveFile(file.blob, filename, { title: title || "Note" });
      if (result === false) return;
      writeLastFormat(format);
      showToast({ message: result === "shared" ? `${filename} shared` : `${filename} downloaded` });
      onClose();
    } catch (e) {
      setFailed(e instanceof Error && e.message ? e.message : "The export did not leave the app");
    } finally {
      setBusy(false);
    }
  };

  const preview = format === "md" ? docToMarkdown(doc, { title, includeTitle }) : format === "txt" ? docToPlainText(doc, { title, includeTitle }) : docToPlainText(doc, { title, includeTitle });
  const carries: string[] = format === "pdf"
    ? ["PDF keeps accented Latin text and includes photos", "Its built-in fonts have no other scripts and no emoji, which Word keeps"]
    : format === "docx" ? ["Word keeps every character and includes photos"]
    : ["Markdown and text keep every character", "Attachments are listed by name"];
  const shareWord = canShareFiles() ? "Export File" : "Download File";

  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{selection ? "Export Selection" : "Export Note"}</div></div>
        <div className="pad-x sheet-form">
          <div className="field">
            <div className="input-label">Filename</div>
            <input className="input exp-name" aria-label="Filename" value={stem} onChange={(e) => setStem(e.target.value)} onBlur={() => setStem(cleanStem(stem) || "Note")} />
            <div className="exp-note">{filename}</div>
          </div>
          <div className="field">
            <div className="input-label">Format</div>
            <div className="exp-formats" role="group" aria-label="Format">
              {EXPORT_FORMATS.map((f) => (
                <button type="button" key={f.key} aria-pressed={format === f.key} className={"exp-format" + (format === f.key ? " on" : "")} onClick={() => setFormat(f.key)}>
                  <FileText className="ic" />
                  <span className="exp-t"><div className="exp-k">{f.label}</div><div className="exp-d">{f.desc}</div></span>
                  <span className="exp-ring" aria-hidden="true" />
                </button>
              ))}
            </div>
            {carries.map((c) => <div className="exp-note" key={c}>{c}</div>)}
          </div>
          <details className="exp-more" open={previewOpen} onToggle={(e) => setPreviewOpen((e.target as HTMLDetailsElement).open)}>
            <summary>Preview</summary>
            <pre className="exp-preview">{preview}</pre>
          </details>
          <details className="exp-more">
            <summary>More Options</summary>
            <SwitchRow tone="grey" glyph={<FileText className="ic" />} label="Include the Title" on={includeTitle} onToggle={() => setIncludeTitle((v) => !v)} ariaLabel="Include the title" />
            {(images.length > 0 || attachmentNames.length > 0) && (
              <div className="exp-note">
                {images.length > 0 && `${images.length} ${images.length === 1 ? "photo" : "photos"} embedded in PDF and Word. `}
                {attachmentNames.length > 0 && `Not included: ${attachmentNames.join(", ")}.`}
              </div>
            )}
          </details>
          {failed && (
            <div role="alert">
              <div className="exp-note">{failed}</div>
              <div className="exp-note">The note is unchanged</div>
              <div className="exp-note">Retry, or choose another format</div>
            </div>
          )}
          <div className="exp-acts">
            <button type="button" className="btn btn-primary" disabled={!ready || busy} onClick={() => void run()}>
              {busy ? "Sharing" : preparing ? "Preparing" : failed ? "Retry" : shareWord}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
