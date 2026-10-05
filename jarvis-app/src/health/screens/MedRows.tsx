import { rowDoor } from "../../shared/rowDoor";
import { useState } from "react";
import type { MedDefEntry } from "../types";
import { repeatWithin, lastDose, whenShort, type DoseRow } from "../meds";
import RowActionSheet from "../../shared/RowActionSheet";
import RowShell from "../../brain/RowShell";
import RowSheet from "../../brain/RowSheet";

// THE MED ROWS (Health Push D, H-38). One row per configured med: the name,
// the amount and when it was last taken. CLEAN ROWS (Dave 2026-10-05, locked):
// Took It is not a capsule on the row any more. A tap opens the med's sheet
// (Took It filled, then Edit and Remove), swipe left is Took It, and so is
// swipe right (it is the one thing to complete). It is never surfaced as a
// word on the row: this page says no dose is ever due (meds.ts), so no row's
// moment has come. The amount is the
// row's one grey and the last time a neutral time in small caps (§AM F5): blue
// was the medication area's hue on words, and in Health blue means cool-down.
// The second tap on the same med inside ten minutes asks first (meds.ts's
// repeatWithin); every log's receipt and Undo ride the caller's toast, so
// this list never says "Logged" itself. A hold on a row is the caller's door
// to Edit and Remove, the same hold every other row in the app answers.
export default function MedRows({ meds, doses, now = Date.now(), onTook, onEdit, onRemove }: {
  meds: MedDefEntry[];
  doses: DoseRow[];
  now?: number;
  onTook: (med: MedDefEntry) => void;
  /** Edit and Remove are the med's sheet; a caller with neither shows only Took It. */
  onEdit?: (med: MedDefEntry) => void;
  onRemove?: (med: MedDefEntry) => void;
}) {
  const [ask, setAsk] = useState<MedDefEntry | null>(null);
  const [open, setOpen] = useState<MedDefEntry | null>(null);
  const took = (med: MedDefEntry) => {
    if (repeatWithin(doses, med.id, Date.now())) setAsk(med);
    else onTook(med);
  };
  return (
    <>
      <div className="card list-card-ruled shell-rows">
        {meds.map((m) => <MedRow key={m.id} med={m} last={lastDose(doses, m.id)?.at ?? null} now={now} onTook={() => took(m)} onOpen={() => setOpen(m)} />)}
      </div>
      {open && (
        <RowSheet
          eyebrow="Medication"
          text={open.data.name}
          facts={open.data.amount ? <span className="fact">{open.data.amount}</span> : undefined}
          answers={[
            { label: "Took It", onPick: () => took(open) },
            ...(onEdit ? [{ label: "Edit", onPick: () => onEdit(open) }] : []),
            ...(onRemove ? [{ label: "Remove", destructive: true, onPick: () => onRemove(open) }] : []),
          ]}
          onClose={() => setOpen(null)}
        />
      )}
      {ask && (
        <RowActionSheet
          title={"Log Another? · " + ask.data.name}
          actions={[
            { label: "Log Another", onPick: () => { const m = ask; setAsk(null); onTook(m); } },
            { label: "Never Mind", onPick: () => setAsk(null) },
          ]}
          onCancel={() => setAsk(null)}
        />
      )}
    </>
  );
}

function MedRow({ med, last, now, onTook, onOpen }: {
  med: MedDefEntry;
  last: number | null;
  now: number;
  onTook: () => void;
  onOpen: () => void;
}) {
  return (
    <RowShell verb={{ label: "Took It", run: onTook }} onRight={onTook} rightLabel="Took It">
      <div className="row" {...rowDoor(onOpen)}>
        <div className="row-grow">
          <div className="conn-name">{med.data.name}</div>
          <div className="facts">
            {med.data.amount && <span className="fact">{med.data.amount}</span>}
            {last !== null && <span className="fact date">Last {whenShort(last, now)}</span>}
          </div>
        </div>
        <div className="chev" />
      </div>
    </RowShell>
  );
}
