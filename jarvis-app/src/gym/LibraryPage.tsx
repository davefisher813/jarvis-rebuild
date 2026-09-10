import { useState } from "react";
import type { LibraryRow } from "./libraryEdit";
import { pressable } from "../shared/pressable";
import { agoPhraseLower } from "./summary";
import { PickSheet, type PickItem } from "./ActionSheet";

// YOUR LIFTS (UP-ATH-21, 2026-09-06). The exercise library has known every
// lift the athlete has ever used since it shipped, and the only thing that
// ever rendered it was an autocomplete inside a picker. This is the list, as
// a page: what you have, how many sessions each one carries, when you last
// did it, and the two repairs a free-text library needs.
//
// Presentational, like every screen in this folder: rows in, callbacks out.
// The writes live in gym/libraryEdit.ts and are run by GymFlow.
export default function LibraryPage({ rows, todayIso, onOpen, onRename, onMerge, onToggleHidden, onBack }: {
  rows: LibraryRow[];
  todayIso: string;
  onOpen: (row: LibraryRow) => void;
  onRename: (row: LibraryRow, name: string) => void;
  /** loser folds into survivor. Only ever offered between lifts that log the
   *  same way: numbers from two different measures cannot share a series. */
  onMerge: (loser: LibraryRow, survivorKey: string) => void;
  onToggleHidden: (row: LibraryRow) => void;
  onBack: () => void;
}) {
  const [editing, setEditing] = useState<LibraryRow | null>(null);
  const [draft, setDraft] = useState("");
  const [merging, setMerging] = useState<LibraryRow | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  const shown = rows.filter((r) => showHidden || !r.hidden);
  const hiddenCount = rows.filter((r) => r.hidden).length;
  const openEdit = (r: LibraryRow) => { setEditing(r); setDraft(r.name); };

  const mergeItems: PickItem[] = merging
    ? rows
      .filter((r) => r.key !== merging.key && r.kind === merging.kind)
      .map((r) => ({ id: r.key, label: r.name, sub: r.sessions > 0 ? r.sessions + (r.sessions === 1 ? " session" : " sessions") : "Never done" }))
    : [];

  return (
    <div className="screen ruled health-ruled">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">Your Lifts</div>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">
          <div className="empty-title">No Lifts Yet</div>
          <div className="empty-sub">Every exercise you add to a program or log in a session lands here</div>
        </div>
      ) : (
        <>
          <div className="pad-x"><div className="card list-card-ruled">
            {shown.map((r) => (
              <div className="row" key={r.key} {...pressable(() => onOpen(r))}>
                <div className="row-grow">
                  <div className="conn-name">{r.name}</div>
                  <div className="bp-sub">
                    {r.sessions > 0
                      ? r.sessions + (r.sessions === 1 ? " session" : " sessions")
                      : "Never done"}
                    {r.lastDate ? " · Last " + agoPhraseLower(r.lastDate, todayIso) : ""}
                    {r.hidden ? " · Hidden" : ""}
                  </div>
                </div>
                <button className="pill-act" onClick={(e) => { e.stopPropagation(); openEdit(r); }}>Edit</button>
              </div>
            ))}
          </div></div>
          {/* EVERY LIST HAS A FLOOR. */}
          <div className="pad-x"><div className="bp-sub">
            {shown.length === rows.length
              ? "That's every lift you have."
              : "That's every lift you have, except the hidden ones."}
          </div></div>
          {hiddenCount > 0 && (
            <div className="pad-x">
              <button className="btn btn-secondary btn-block" onClick={() => setShowHidden((v) => !v)}>
                {showHidden ? "Hide the Hidden" : "Show Hidden"}
              </button>
            </div>
          )}
        </>
      )}

      {editing && (
        <div className="pad-x"><div className="card pad">
          <div className="field">
            <div className="input-label">Name</div>
            <input className="input" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Lift Name" />
            <div className="bp-sub">Renaming keeps every session this lift already has.</div>
          </div>
          <button
            className="btn btn-primary btn-block"
            disabled={!draft.trim() || draft.trim() === editing.name}
            onClick={() => { const r = editing; setEditing(null); onRename(r, draft); }}
          >
            Save the Name
          </button>
          <button className="btn btn-secondary btn-block" onClick={() => { setMerging(editing); setEditing(null); }}>Merge Into Another Lift</button>
          <button className="btn btn-secondary btn-block" onClick={() => { const r = editing; setEditing(null); onToggleHidden(r); }}>
            {editing.hidden ? "Offer It Again" : "Hide From Suggestions"}
          </button>
          <button className="btn btn-secondary btn-block" onClick={() => setEditing(null)}>Cancel</button>
        </div></div>
      )}

      {merging && (
        <PickSheet
          title={"Merge " + merging.name + " Into"}
          items={mergeItems}
          emptyText="No other lift logs the same way, so there is nothing to merge into."
          onPick={(ids) => { const r = merging; setMerging(null); if (ids[0]) onMerge(r, ids[0]); }}
          onCancel={() => setMerging(null)}
        />
      )}
      <div className="screen-foot" />
    </div>
  );
}
