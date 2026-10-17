import { useRef, useState } from "react";
import { draftStore } from "../../shared/draftStore";
import { FormSheet, Group, FieldRow, MenuRow, Row, ErrorLine } from "../../shared/FormSheet";
import { Calendar, Camera, FolderKanban, Paperclip, Sparkles, Tag } from "../../shared/icons";
import { DollarGlyph } from "../../shared/glyphs";
import { parseCents } from "../ledger/cents";
import { sizeLabel } from "../../files/types";

// THE RECEIPT SHEET (Money ledger, 2026-10-03). One sheet for every way in:
// type it, take a photo, attach a file, or confirm what Read It proposed. It
// opens ready to type: the date is today, the category is the one this vendor
// usually gets, and nothing about a photo is required. Save is the only
// commit, and a read receipt is only ever a candidate in these fields.

export interface ReceiptDraft {
  vendor: string;
  /** What the person typed; the ledger parses it strictly. */
  amount: string;
  /** YYYY-MM-DD; today unless changed. */
  date: string;
  /** Blank is no category (it counts as Uncategorized). */
  category: string;
  /** USD unless a read receipt said otherwise. */
  currency: string;
}

/** A picture or file that goes with the receipt: not yet uploaded ("new"), or a
 *  file already stored ("existing", the legacy rows Read It starts from). */
export type Attachment =
  | { kind: "new"; file: File; camera?: boolean }
  | { kind: "existing"; id: string; name: string; mime: string; bytes: number };

const nameOf = (a: Attachment): string => (a.kind === "new" ? a.file.name : a.name);
const mimeOf = (a: Attachment): string => (a.kind === "new" ? a.file.type : a.mime);
const bytesOf = (a: Attachment): number => (a.kind === "new" ? a.file.size : a.bytes);

// A DRAFT THAT SURVIVES THE APP (the Logging Standard, rule 8, 2026-10-17):
// this sheet only ever makes a NEW receipt, so its vendor is written on every
// keystroke and spent by the save that used it or by an explicit Cancel; the
// scrim keeps it. A vendor a scan handed in wins only when there is no draft.
const RECEIPT_DRAFT = draftStore("jarvis.receipt.draft.v1");

export default function ReceiptSheet({ title = "New Receipt", initial, attachment: first, categories, categoryFor, canAttach, canRead, onRead, onSave, onCancel }: {
  title?: string;
  initial: ReceiptDraft;
  attachment: Attachment | null;
  categories: string[];
  /** The category this vendor was last filed under, if any. */
  categoryFor: (vendor: string) => string | undefined;
  /** A file store exists, so a photo or file can be kept. */
  canAttach: boolean;
  /** AI is on. With it off, Read It is not offered at all. */
  canRead: boolean;
  /** Propose a read of the attachment; null when nothing could be read. */
  onRead: (a: Attachment) => Promise<Partial<ReceiptDraft> | null>;
  /** True when it was saved (or was already saved) and the sheet may close. */
  onSave: (d: ReceiptDraft, a: Attachment | null) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [vendor, setVendorState] = useState(() => RECEIPT_DRAFT.read() || initial.vendor);
  const setVendor = (v: string) => { setVendorState(v); RECEIPT_DRAFT.write(v); };
  const [amount, setAmount] = useState(initial.amount);
  const [date, setDate] = useState(initial.date);
  const [currency, setCurrency] = useState(initial.currency);
  // The category follows the vendor until the person picks one themselves.
  const [picked, setPicked] = useState<string | null>(initial.category ? initial.category : null);
  const category = picked ?? categoryFor(vendor) ?? "";
  const [attachment, setAttachment] = useState<Attachment | null>(first);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState(false);
  const camera = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null);

  const valid = vendor.trim().length > 0 && parseCents(amount) !== null && /^\d{4}-\d{2}-\d{2}$/.test(date);
  const save = () => {
    if (!valid) { setTouched(true); return; }
    if (saving) return;
    setSaving(true);
    void onSave({ vendor, amount, date, category, currency }, attachment)
      .then((ok) => { if (!ok) { setSaving(false); return; } RECEIPT_DRAFT.clear(); }, () => setSaving(false));
  };
  // Cancel is the explicit discard, so it spends the draft; the scrim keeps it.
  const cancel = () => { RECEIPT_DRAFT.clear(); onCancel(); };

  const read = async () => {
    if (!attachment || reading) return;
    setReading(true);
    try {
      const got = await onRead(attachment);
      if (!got) return;
      // A candidate only: fields the person already typed are theirs.
      if (got.vendor && !vendor.trim()) setVendor(got.vendor);
      if (got.amount && !amount.trim()) setAmount(got.amount);
      if (got.date) setDate(got.date);
      if (got.currency) setCurrency(got.currency);
    } finally {
      setReading(false);
    }
  };

  const onPicked = (f: File | undefined, camera: boolean) => { if (f) setAttachment({ kind: "new", file: f, ...(camera ? { camera: true } : {}) }); };
  const readable = canRead && attachment !== null && mimeOf(attachment).startsWith("image/");

  return (
    <FormSheet title={title} onCancel={cancel} onDismiss={onCancel} onSave={save} saveDisabled={!valid} saveLabel={saving ? "Saving" : "Save"}
      dirty={attachment !== null && attachment !== first}>
      <Group label="Receipt">
        {/* A NEW RECEIPT OPENS ON ITS VENDOR, KEYBOARD UP; RETURN ON THE AMOUNT SAVES (the Logging Standard, rules 1 and 4,
            2026-10-17). One that arrives with a vendor (an edit, a read) opens quiet. */}
        <FieldRow tone="red" glyph={<Tag className="ic" />} label="Vendor" ariaLabel="Vendor" value={vendor} onChange={setVendor}
          placeholder="Who You Paid" error={touched && !vendor.trim()} autoFocus={!initial.vendor} enterKeyHint="next"
          onEnter={() => document.querySelector<HTMLInputElement>('.form-sheet input[aria-label="Amount"]')?.focus()} />
        <FieldRow tone="green" glyph={<DollarGlyph />} label="Amount" ariaLabel="Amount" value={amount} onChange={setAmount}
          placeholder="0.00" inputMode="decimal" error={touched && parseCents(amount) === null} enterKeyHint="go" onEnter={save} />
        <FieldRow tone="orange" glyph={<Calendar className="ic" />} label="Date" ariaLabel="Date" type="date" value={date}
          onChange={setDate} error={touched && !date} />
        <MenuRow tone="purple" glyph={<FolderKanban className="ic" />} label="Category" ariaLabel="Category" value={category}
          word={category || "None"} off={!category}
          options={[{ value: "", label: "None" }, ...categories.map((c) => ({ value: c, label: c }))]}
          onPick={(v) => setPicked(v)} />
        {currency !== "USD" && (
          <FieldRow tone="blue" glyph={<DollarGlyph />} label="Currency" ariaLabel="Currency" value={currency}
            onChange={(v) => setCurrency(v.toUpperCase().slice(0, 3))} />
        )}
      </Group>
      <ErrorLine text={touched && !valid ? "A vendor and an amount" : null} />
      {canAttach && (
        <>
          <Group label="Photo or File">
            {attachment ? (
              <>
                <Row tone="indigo" glyph={<Paperclip className="ic" />} label={nameOf(attachment)}
                  meta={bytesOf(attachment) > 0 ? sizeLabel(bytesOf(attachment)) : undefined} />
                {/* Taking it off is its own action row, not a text button inside the file's row (Dave 2026-10-05, locked). */}
                <Row label="Remove Attachment" onClick={() => setAttachment(null)} />
              </>
            ) : (
              <>
                {/* Each row opens the phone's picker inside its own tap: a
                    picker opened after an await is blocked by iOS. */}
                <Row tone="sky" glyph={<Camera className="ic" />} label="Take a Photo" onClick={() => camera.current?.click()} chev />
                <Row tone="indigo" glyph={<Paperclip className="ic" />} label="Attach a File" onClick={() => file.current?.click()} chev />
              </>
            )}
            {readable && (
              <Row tone="purple" glyph={<Sparkles className="ic" />} label={reading ? "Reading" : "Read It"}
                meta="You Confirm Before It Saves" onClick={() => void read()} />
            )}
          </Group>
          <input ref={camera} className="visually-hidden-input" type="file" accept="image/*" capture="environment"
            tabIndex={-1} aria-hidden="true" data-testid="receipt-camera"
            onChange={(e) => { onPicked(e.target.files?.[0], true); e.target.value = ""; }} />
          <input ref={file} className="visually-hidden-input" type="file" accept="image/*,application/pdf"
            tabIndex={-1} aria-hidden="true" data-testid="receipt-file"
            onChange={(e) => { onPicked(e.target.files?.[0], false); e.target.value = ""; }} />
        </>
      )}
    </FormSheet>
  );
}
