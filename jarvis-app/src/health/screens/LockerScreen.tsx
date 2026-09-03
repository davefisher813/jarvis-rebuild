import { useState } from "react";
import { LOCKER_DOC_KINDS, LOCKER_DOC_LABEL, currentDocs, expiringDocs } from "../locker";
import type { LockerDocEntry, LockerDocKind } from "../types";

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
  const missing = LOCKER_DOC_KINDS.filter((k) => !present.some((d) => d.data.kind === k));

  return (
    <div className="screen ruled">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">The Locker</div>
      </div>

      <div className="pad-x"><div className="card pad">
        <div className="p3-q">Every Document In One Place</div>
        <div className="bp-sub">Storage and expiry only, nothing read or judged.</div>
      </div></div>

      {expiring.length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Worth A Look</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {expiring.map((e) => (
              <div className="row" key={e.doc.id}>
                <div className="row-grow"><div className="conn-name">{LOCKER_DOC_LABEL[e.doc.data.kind]}</div></div>
                <div className="row-value">{e.daysUntil < 0 ? "Lapsed" : e.daysUntil + " Days Left"}</div>
              </div>
            ))}
          </div></div>
        </>
      )}

      <div className="sh2 sh2-quiet"><span className="t">On File</span></div>
      <div className="pad-x"><div className="card list-card-ruled">
        {present.length === 0 ? (
          <div className="row"><div className="row-grow"><div className="conn-name">Nothing On File Yet</div></div></div>
        ) : (
          present.map((d) => (
            <div className="row" key={d.id}>
              <div className="row-grow">
                <div className="conn-name">{LOCKER_DOC_LABEL[d.data.kind]}</div>
                {d.data.expiresAt && <div className="bp-sub">Expires {d.data.expiresAt}</div>}
              </div>
              <button className="btn btn-tertiary btn-sm" onClick={() => onRemove(d.id)}>Remove</button>
            </div>
          ))
        )}
      </div></div>

      {missing.length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Add A Document</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {missing.map((k) => (
              <div className="row" role="button" tabIndex={0} key={k} onClick={() => setAddingKind(k)}>
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
