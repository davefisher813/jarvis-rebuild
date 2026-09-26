import { useState } from "react";
import { LOCKER_DOC_KINDS, LOCKER_DOC_LABEL, currentDocs, expiringDocs } from "../locker";
import type { LockerDocEntry, LockerDocKind } from "../types";
import { pressable } from "../../shared/pressable";

// THE LOCKER (Part 8). Document storage with expiry tracking. Zero medical
// judgment, just storage: this screen never reads or shows what a document
// says, only that it exists and when it lapses.
export default function LockerScreen({
  docs, today, onAdd, onRemove, onBack,
}: {
  docs: LockerDocEntry[];
  today: string;
  onAdd: (kind: LockerDocKind, expiresAt: string) => void;
  onRemove: (id: string) => void;
  onBack: () => void;
}) {
  const [addingKind, setAddingKind] = useState<LockerDocKind | null>(null);
  const [expiresAt, setExpiresAt] = useState("");
  const present = currentDocs(docs);
  const expiring = expiringDocs(docs, today);
  // Row tap (Dave 2026-09-15, "I want all rows clickable"): a document on
  // file opens the same form Add does, filled with its date. Saving files a
  // newer entry, which is the one the Locker reads; Remove stays a button.
  const openDoc = (kind: LockerDocKind, current?: string) => { setAddingKind(kind); setExpiresAt(current ?? ""); };
  const missing = LOCKER_DOC_KINDS.filter((k) => !present.some((d) => d.data.kind === k));

  return (
    <div className="screen ruled health-ruled">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">The Locker</div>
      </div>

      <div className="pad-x"><div className="card pad">
        <div className="p3-q">Every Document in One Place</div>
        <div className="bp-sub">Storage and expiry only, nothing read or judged.</div>
      </div></div>

      {expiring.length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Worth a Look</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {expiring.map((e) => (
              <div className="row" key={e.doc.id} {...pressable(() => openDoc(e.doc.data.kind, e.doc.data.expiresAt))}>
                {/* A lapsed document is late (red, §AM); one inside the window
                    needs you soon (the Health amber). Not the row's grey. */}
                <div className="row-grow">
                  <div className="conn-name">{LOCKER_DOC_LABEL[e.doc.data.kind]}</div>
                  <div className="facts"><span className={"fact " + (e.daysUntil < 0 ? "red" : "amber")}>{e.daysUntil < 0 ? "Lapsed" : e.daysUntil + " Days Left"}</span></div>
                </div>
              </div>
            ))}
          </div></div>
        </>
      )}

      <div className="sh2 sh2-quiet"><span className="t">On File</span></div>
      <div className="pad-x"><div className="card list-card-ruled">
        {present.length === 0 ? (
          <div className="row"><div className="row-grow"><div className="conn-name">Nothing on File Yet</div></div></div>
        ) : (
          present.map((d) => (
            <div className="row" key={d.id} {...pressable(() => openDoc(d.data.kind, d.data.expiresAt))}>
              <div className="row-grow">
                <div className="conn-name">{LOCKER_DOC_LABEL[d.data.kind]}</div>
                {/* The date itself is neutral, small caps (§AM F5). What it
                    means, lapsed or days left, is stated once, in its key
                    colour, on the Worth a Look row above. */}
                {d.data.expiresAt && <div className="facts"><span className="fact date">Expires {d.data.expiresAt}</span></div>}
              </div>
              {/* HMN-F-22 (2026-09-05): a document still in the pending
                  queue carries a placeholder id, so Remove on it deleted
                  nothing while looking like it had. It comes back the moment
                  the write lands and the row has a real id. */}
              {!d.pending && <button className="btn btn-tertiary btn-sm" onClick={(ev) => { ev.stopPropagation(); onRemove(d.id); }}>Remove</button>}
            </div>
          ))
        )}
      </div></div>

      {missing.length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Add a Document</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {missing.map((k) => (
              <div className="row" {...pressable(() => setAddingKind(k))} key={k}>
                <div className="row-grow"><div className="conn-name">{LOCKER_DOC_LABEL[k]}</div></div>
              </div>
            ))}
          </div></div>
        </>
      )}

      {addingKind && (
        <div className="pad-x"><div className="card pad">
          <div className="conn-name">{LOCKER_DOC_LABEL[addingKind]}</div>
          <div className="field">
            <div className="input-label">Expires On</div>
            <input className="input" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </div>
          <button className="btn btn-primary btn-block" disabled={!expiresAt} onClick={() => { onAdd(addingKind, expiresAt); setAddingKind(null); setExpiresAt(""); }}>
            Save It
          </button>
        </div></div>
      )}
      <div className="screen-foot" />
    </div>
  );
}
