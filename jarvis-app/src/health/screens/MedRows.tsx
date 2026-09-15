import { rowDoor } from "../../shared/rowDoor";
import { useState } from "react";
import type { MedDefEntry } from "../types";
import { repeatWithin, lastDose, whenShort, type DoseRow } from "../meds";
import { useLongPress } from "../../shared/useLongPress";
import RowActionSheet from "../../shared/RowActionSheet";

// THE MED ROWS (Health Push D, H-38). One row per configured med: the name,
// the amount in medication blue, when it was last taken, and one red Took It.
// The second tap on the same med inside ten minutes asks first (meds.ts's
// repeatWithin); every log's receipt and Undo ride the caller's toast, so
// this list never says "Logged" itself. A hold on a row is the caller's door
// to Edit and Remove, the same hold every other row in the app answers.
export default function MedRows({ meds, doses, now = Date.now(), onTook, onHold }: {
  meds: MedDefEntry[];
  doses: DoseRow[];
  now?: number;
  onTook: (med: MedDefEntry) => void;
  onHold?: (med: MedDefEntry) => void;
}) {
  const [ask, setAsk] = useState<MedDefEntry | null>(null);
  const took = (med: MedDefEntry) => {
    if (repeatWithin(doses, med.id, Date.now())) setAsk(med);
    else onTook(med);
  };
  return (
    <>
      <div className="card list-card-ruled">
        {meds.map((m) => <MedRow key={m.id} med={m} last={lastDose(doses, m.id)?.at ?? null} now={now} onTook={() => took(m)} onHold={onHold ? () => onHold(m) : undefined} />)}
      </div>
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

function MedRow({ med, last, now, onTook, onHold }: {
  med: MedDefEntry;
  last: number | null;
  now: number;
  onTook: () => void;
  onHold?: () => void;
}) {
  const hold = useLongPress({ onLongPress: () => onHold?.(), enabled: !!onHold });
  return (
    // The row opens the med's Edit and Remove, the same door the hold opens
    // (Dave 2026-09-15: "I want all rows clickable"). Took It keeps its own tap.
    <div className="row" {...hold} {...(onHold ? rowDoor(onHold) : {})}>
      <div className="row-grow">
        <div className="conn-name">{med.data.name}</div>
        <div className="facts">
          {med.data.amount && <span className="fact hblue">{med.data.amount}</span>}
          {last !== null && <span className="fact">Last {whenShort(last, now)}</span>}
        </div>
      </div>
      <button type="button" className="pill-act" onClick={(e) => { e.stopPropagation(); onTook(); }} aria-label={"Took It, " + med.data.name}>Took It</button>
    </div>
  );
}
