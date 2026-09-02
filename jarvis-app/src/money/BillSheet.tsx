import { useState } from "react";
import type { Recurrence, BillInfo } from "../notes/types";
import { FormSheet, Group, FieldRow, MenuRow, SwitchRow, DeleteRow, ErrorLine } from "../shared/FormSheet";
import { Calendar, Link2 } from "../shared/icons";
import { DollarGlyph, RepeatGlyph, WalletGlyph } from "../shared/glyphs";

export interface BillDraft {
  text: string;
  due: string; // "" = none
  recurrence: Recurrence | null;
  bill: BillInfo;
}


// THE BILL SHEET ON THE SHEET BAR (2026-09-02). ~10 bills entered once, then
// it runs itself, so this form optimizes for the first five minutes: name,
// amount, when, done. The name is the row; the amount, the next due date
// and the pay link are typed at the right of their labels; Repeats opens
// the dropdown; Autopay is a switch, with the truthful frame under it (it
// changes what JARVIS SAYS about the bill, never what happens).
export default function BillSheet({ mode, initial, onSave, onDelete, onCancel }: {
  mode: "new" | "edit";
  initial?: BillDraft;
  onSave: (d: BillDraft) => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial?.text ?? "");
  const [amount, setAmount] = useState(initial ? String(initial.bill.amount) : "");
  const [due, setDue] = useState(initial?.due ?? "");
  const [recurrence, setRecurrence] = useState<Recurrence | null>(initial?.recurrence ?? "monthly");
  const [autopay, setAutopay] = useState(!!initial?.bill.autopay);
  const [payUrl, setPayUrl] = useState(initial?.bill.payUrl ?? "");
  const [touched, setTouched] = useState(false);

  const valid = text.trim().length > 0 && amount.trim() !== "" && Number.isFinite(Number(amount)) && Number(amount) > 0;
  const save = () => {
    if (!valid) { setTouched(true); return; }
    const url = payUrl.trim();
    onSave({
      text: text.trim(),
      due,
      recurrence,
      bill: {
        amount: Number(amount),
        ...(autopay ? { autopay: true } : {}),
        // Accept bare domains: "coned.com" becomes a working link.
        ...(url ? { payUrl: /^https?:\/\//i.test(url) ? url : "https://" + url } : {}),
      },
    });
  };

  return (
    <FormSheet title={mode === "new" ? "New Bill" : "Edit Bill"} onCancel={onCancel} onSave={save} saveDisabled={!valid}>
      <Group label="Bill">
        <FieldRow tone="yellow" glyph={<WalletGlyph />} value={text} onChange={setText} placeholder="e.g. Rent" ariaLabel="Bill name"
          error={touched && !text.trim()} right={false} />
        <FieldRow tone="green" glyph={<DollarGlyph />} label="Amount" value={amount} onChange={setAmount} placeholder="0" inputMode="decimal"
          ariaLabel="Amount in dollars" error={touched && !valid && !!text.trim()} />
      </Group>
      <ErrorLine text={touched && !valid ? "Add a name and an amount." : null} />
      <Group label="When">
        <FieldRow tone="orange" glyph={<Calendar className="ic" />} label="Next Due" type="date" value={due} onChange={setDue} ariaLabel="Next due" />
        <MenuRow tone="sky" glyph={<RepeatGlyph />} label="Repeats" value={recurrence ?? "once"} ariaLabel="Repeats"
          options={[{ value: "monthly", label: "Monthly" }, { value: "weekly", label: "Weekly" }, { value: "once", label: "Once" }]}
          onPick={(v) => setRecurrence(v === "once" ? null : (v as Recurrence))} />
      </Group>
      <Group label="Paying">
        <SwitchRow tone="blue" glyph={<RepeatGlyph />} label="Autopay" meta={autopay ? "It pays itself" : "I pay it"} on={autopay}
          onToggle={() => setAutopay((a) => !a)} ariaLabel="Autopay" />
        <FieldRow tone="indigo" glyph={<Link2 className="ic" />} label="Pay Link" type="url" value={payUrl} onChange={setPayUrl}
          placeholder="Optional" ariaLabel="Pay link" />
      </Group>
      {mode === "edit" && onDelete && (
        <Group className="xs-actions"><DeleteRow label="Delete Bill" onClick={onDelete} /></Group>
      )}
    </FormSheet>
  );
}
