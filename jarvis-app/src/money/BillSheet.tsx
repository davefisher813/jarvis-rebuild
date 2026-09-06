import { useState } from "react";
import type { Recurrence, BillInfo } from "../notes/types";
import { FormSheet, Group, FieldRow, MenuRow, SwitchRow, DeleteRow, ErrorLine } from "../shared/FormSheet";
import { Calendar, Link2 } from "../shared/icons";
import { DollarGlyph, RepeatGlyph, WalletGlyph } from "../shared/glyphs";
import { monthDay } from "./bills";

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
export default function BillSheet({ mode, initial, paidOn, onSave, onDelete, onCancel }: {
  // UP-CORE-13 (2026-09-05): "paid" is a new bill that already happened, the
  // shape a read receipt produces. Same form, same fields; what changes is
  // that the sheet says which day it was paid and Save files it as a record
  // rather than as something still owed.
  mode: "new" | "edit" | "paid";
  initial?: BillDraft;
  // The day the receipt says it was paid. Shown, never invented: the caller
  // falls back to today, which is the one date a person can check at a glance.
  paidOn?: string;
  onSave: (d: BillDraft) => void | Promise<boolean | void>;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial?.text ?? "");
  const [amount, setAmount] = useState(initial ? String(initial.bill.amount) : "");
  const [due, setDue] = useState(initial?.due ?? "");
  // HMN-F-04 (2026-09-05): a once bill stores recurrence null, and `??`
  // read that null as "unset" and put Monthly in the menu. Saving an edit
  // (to fix an amount, say) then turned the bill recurring for good. Only a
  // NEW bill gets the monthly default; an edit shows what is stored.
  const [recurrence, setRecurrence] = useState<Recurrence | null>(initial ? initial.recurrence : "monthly");
  const [autopay, setAutopay] = useState(!!initial?.bill.autopay);
  const [payUrl, setPayUrl] = useState(initial?.bill.payUrl ?? "");
  const [touched, setTouched] = useState(false);
  // B12's fix (MoneyFlow's Account/Payday sheets), generalized: Save creates
  // a bill, so two taps created two. The first valid tap latches.
  // HMN-F-09 (2026-09-05): the latch had no way back, so a failed save read
  // "Saving" until Cancel threw the typed bill away. The parent's false (or
  // a throw) lifts it, the same unlatch every other sheet does.
  const [saving, setSaving] = useState(false);

  const valid = text.trim().length > 0 && amount.trim() !== "" && Number.isFinite(Number(amount)) && Number(amount) > 0;
  const save = () => {
    if (!valid) { setTouched(true); return; }
    if (saving) return;
    setSaving(true);
    const url = payUrl.trim();
    const r = onSave({
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
    void Promise.resolve(r).then((ok) => { if (ok === false) setSaving(false); }, () => setSaving(false));
  };

  return (
    <FormSheet title={mode === "paid" ? "From a Receipt" : mode === "new" ? "New Bill" : "Edit Bill"} onCancel={onCancel} onSave={save} saveDisabled={!valid} saveLabel={saving ? "Saving" : "Save"}>
      <Group label="Bill">
        <FieldRow tone="yellow" glyph={<WalletGlyph />} value={text} onChange={setText} placeholder="e.g. Rent" ariaLabel="Bill name"
          error={touched && !text.trim()} right={false} />
        <FieldRow tone="green" glyph={<DollarGlyph />} label="Amount" value={amount} onChange={setAmount} placeholder="0" inputMode="decimal"
          ariaLabel="Amount in dollars" error={touched && !valid && !!text.trim()} />
      </Group>
      <ErrorLine text={touched && !valid ? "Add a name and an amount." : null} />
      {/* UP-CORE-13: what this Save will record, said before it happens. The
          words are the ones bills.ts already uses for a manual payment. */}
      {mode === "paid" && paidOn && <div className="pad-x"><div className="conn-meta">Files as paid {monthDay(paidOn)}</div></div>}
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
