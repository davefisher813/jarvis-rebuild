import { useState } from "react";
import { FormSheet, Group, FieldRow, MenuRow, Row, DeleteRow, ErrorLine } from "../../shared/FormSheet";
import { Calendar, FolderKanban, Link2, Paperclip, Tag } from "../../shared/icons";
import { DollarGlyph } from "../../shared/glyphs";
import { showToast } from "../../shared/toast";
import { lineCase } from "../../shared/casing";
import { parseCents } from "../ledger/cents";
import type { Receipt } from "../ledger/types";
import { fmtCents, fmtDay, type TrackerTx } from "../tracker";
import HistoryList from "./HistoryList";

// ONE RECEIPT (Money ledger, 2026-10-03): edit it, open what was attached,
// see whether it is matched to a payment (and undo that), delete it with a way
// back, and read its history. The edit writes through correctReceipt, which
// records what changed.

export default function ReceiptDetailSheet({ receipt, linked, categories, attachmentName, attachmentUrl, onSave, onUnmatch, onDelete, onCancel }: {
  receipt: Receipt;
  /** The payment this receipt is matched to, when it still exists. */
  linked: TrackerTx | undefined;
  categories: string[];
  /** The attached file's name, when one is attached and still stored. */
  attachmentName: string | undefined;
  /** A ready URL, resolved ahead of the tap so opening it stays inside the tap. */
  attachmentUrl: string | null;
  onSave: (c: { vendor: string; amount: string; transactionDate: string; category: string }) => Promise<boolean>;
  onUnmatch: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const d = receipt.data;
  const [vendor, setVendor] = useState(d.vendor);
  const [amount, setAmount] = useState((d.amountCents / 100).toFixed(2));
  const [date, setDate] = useState(d.transactionDate);
  const [category, setCategory] = useState(d.category ?? "");
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const valid = vendor.trim().length > 0 && parseCents(amount) !== null && /^\d{4}-\d{2}-\d{2}$/.test(date);
  const save = () => {
    if (!valid) { setTouched(true); return; }
    if (saving) return;
    setSaving(true);
    void onSave({ vendor, amount, transactionDate: date, category }).then((ok) => { if (!ok) setSaving(false); }, () => setSaving(false));
  };
  const open = () => {
    if (!attachmentUrl) { showToast({ message: "Couldn't Open That File · Try Again in a Moment" }); return; }
    window.open(attachmentUrl, "_blank", "noopener");
  };
  // A category the record already has stays pickable even if no other record uses it.
  const names = category && !categories.includes(category) ? [category, ...categories] : categories;
  const options = [{ value: "", label: "None" }, ...names.map((c) => ({ value: c, label: c }))];

  return (
    <FormSheet title="Receipt" onCancel={onCancel} onSave={save} saveDisabled={!valid} saveLabel={saving ? "Saving" : "Save"}>
      <Group label="Receipt">
        <FieldRow tone="red" glyph={<Tag className="ic" />} label="Vendor" ariaLabel="Vendor" value={vendor} onChange={setVendor}
          error={touched && !vendor.trim()} />
        <FieldRow tone="green" glyph={<DollarGlyph />} label="Amount" ariaLabel="Amount" value={amount} onChange={setAmount}
          inputMode="decimal" error={touched && parseCents(amount) === null} />
        <FieldRow tone="orange" glyph={<Calendar className="ic" />} label="Date" ariaLabel="Date" type="date" value={date}
          onChange={setDate} error={touched && !date} />
        <MenuRow tone="purple" glyph={<FolderKanban className="ic" />} label="Category" ariaLabel="Category" value={category}
          word={category || "None"} off={!category} options={options} onPick={setCategory} />
      </Group>
      <ErrorLine text={touched && !valid ? "A vendor and an amount" : null} />
      {attachmentName && (
        <Group label="Attachment">
          <Row tone="indigo" glyph={<Paperclip className="ic" />} label={attachmentName} meta="Tap to Open" onClick={open} chev />
        </Group>
      )}
      <Group label="Match">
        {d.linkedTransactionId ? (
          <Row tone="green" glyph={<Link2 className="ic" />} label="Matched to a Payment"
            meta={linked
              ? lineCase(`${linked.data.merchant} ${fmtCents(linked.data.amountCents)} ${fmtDay(linked.data.date)}`)
              : "That Payment Is Gone"}
            onClick={onUnmatch}>
            <button type="button" className="pill-act" onClick={(e) => { e.stopPropagation(); onUnmatch(); }}>Unmatch</button>
          </Row>
        ) : (
          <Row tone="graphite" glyph={<Link2 className="ic" />} label="Not Matched" meta="Counts on Its Own" />
        )}
      </Group>
      <HistoryList history={d.history} />
      <Group className="xs-actions"><DeleteRow label="Delete Receipt" onClick={onDelete} /></Group>
    </FormSheet>
  );
}
