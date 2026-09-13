import { useState } from "react";
import type { MedDefEntry } from "../types";
import type { DoseRow } from "../meds";
import { pressable } from "../../shared/pressable";
import RowActionSheet from "../../shared/RowActionSheet";
import MedRows from "./MedRows";
import DoseTimeline from "./DoseTimeline";
import MedSheet from "./MedSheet";

// THE MEDICATION PAGE (Health Push D, H-38; Dave 2026-09-10: "medication
// related stuff should all be its own page"; Dave 2026-09-13: log and track,
// nothing legally risky). With meds configured, one row each with Took It;
// with none, the one-row Log a Dose the page has always had. Under it, Add a
// Medication, the timeline of what happened, and the Keeping Track doors
// (Refill Runway, The Med Window) the caller hands in.
export interface TrackRow { key: string; label: string; sub: string }

export default function MedicationScreen({
  title, meds, doses, now = Date.now(), lastWord, tracks, onTook, onLogDose, onUndo, onAddMed, onEditMed, onRemoveMed, onOpenTrack, onBack,
}: {
  title: string;
  meds: MedDefEntry[];
  doses: DoseRow[];
  now?: number;
  /** "Today", "Yesterday", or null before the first dose (no-meds row). */
  lastWord: string | null;
  tracks: TrackRow[];
  onTook: (med: MedDefEntry) => void;
  onLogDose: () => void;
  onUndo: (row: DoseRow) => void;
  onAddMed: (name: string, amount: string | undefined) => void;
  onEditMed: (id: string, name: string, amount: string | undefined) => void;
  onRemoveMed: (id: string) => void;
  onOpenTrack: (key: string) => void;
  onBack: () => void;
}) {
  const [sheet, setSheet] = useState<{ kind: "add" } | { kind: "edit"; med: MedDefEntry } | { kind: "hold"; med: MedDefEntry } | null>(null);
  const chev = <div className="chev" />;
  return (
    <div className="screen ruled health-ruled">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">{title}</div>
      </div>
      <div className="nav-large">Medication</div>
      <div className="sh2 sh2-quiet"><span className="t">Today</span></div>
      <div className="pad-x">
        {meds.length > 0 ? (
          <MedRows meds={meds} doses={doses} now={now} onTook={onTook} onHold={(med) => setSheet({ kind: "hold", med })} />
        ) : (
          <div className="card list-card-ruled">
            <div {...pressable(onLogDose)} className="task-row p2">
              <div className="task-title">
                <span className="task-name">Log a Dose</span>
                <div className="r-k"><span className="r-goal r-cat">{lastWord ? "Last dose " + lastWord.toLowerCase() : "Marks the moment, never a tally"}</span></div>
              </div>
              {chev}
            </div>
          </div>
        )}
      </div>
      <div className="pad-x"><div className="card list-card-ruled">
        <div {...pressable(() => setSheet({ kind: "add" }))} className="task-row p2">
          <div className="task-title"><span className="task-name">Add a Medication</span></div>
          {chev}
        </div>
      </div></div>
      <DoseTimeline doses={doses} now={now} onUndo={onUndo} />
      {tracks.length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Keeping Track</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {tracks.map((r) => (
              <div {...pressable(() => onOpenTrack(r.key))} className="task-row p2" key={r.key}>
                <div className="task-title">
                  <span className="task-name">{r.label}</span>
                  <div className="r-k"><span className="r-goal r-cat">{r.sub}</span></div>
                </div>
                {chev}
              </div>
            ))}
          </div></div>
        </>
      )}
      <div className="screen-foot" />
      {sheet?.kind === "add" && <MedSheet onSave={(name, amount) => { setSheet(null); onAddMed(name, amount); }} onCancel={() => setSheet(null)} />}
      {sheet?.kind === "edit" && (
        <MedSheet initial={{ name: sheet.med.data.name, amount: sheet.med.data.amount }} onSave={(name, amount) => { const id = sheet.med.id; setSheet(null); onEditMed(id, name, amount); }} onCancel={() => setSheet(null)} />
      )}
      {sheet?.kind === "hold" && (
        <RowActionSheet
          title={sheet.med.data.name}
          actions={[
            { label: "Edit", onPick: () => setSheet({ kind: "edit", med: sheet.med }) },
            { label: "Remove", destructive: true, onPick: () => { const id = sheet.med.id; setSheet(null); onRemoveMed(id); } },
          ]}
          onCancel={() => setSheet(null)}
        />
      )}
    </div>
  );
}
