import { useState } from "react";
import { FormSheet } from "../../shared/FormSheet";

// ADD OR EDIT A MEDICATION (Health Push D, H-38). Two fields the person
// types: the name, and the amount in their own words ("10 mg", "2 drops").
// There is no schedule field and no times-per-day, on purpose: a medication
// here is a thing to log, never a thing to be late for.
export default function MedSheet({ initial, onSave, onCancel }: {
  initial?: { name: string; amount?: string };
  onSave: (name: string, amount: string | undefined) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [amount, setAmount] = useState(initial?.amount ?? "");
  const valid = name.trim().length > 0;
  return (
    <FormSheet title={initial ? "Edit Medication" : "Add a Medication"} onCancel={onCancel} onSave={() => { if (valid) onSave(name.trim(), amount.trim() || undefined); }} saveDisabled={!valid}>
      <div className="field">
        <div className="input-label">Name</div>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Vitamin D" aria-label="Medication name" autoFocus />
      </div>
      <div className="field">
        <div className="input-label">Amount</div>
        <input className="input" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 2000 IU" aria-label="Medication amount" />
      </div>
    </FormSheet>
  );
}
