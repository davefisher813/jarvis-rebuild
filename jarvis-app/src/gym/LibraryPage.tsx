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
export default function LibraryPage({ rows, todayIso, onOpen, onRename, onMerge, onMergePreview, onToggleHidden, onToggleFavorite, onSetGoal, onBack }: {
  rows: LibraryRow[];
  todayIso: string;
  onOpen: (row: LibraryRow) => void;
  onRename: (row: LibraryRow, name: string) => void;
  /** loser folds into survivor. Only ever offered between lifts that log the
   *  same way: numbers from two different measures cannot share a series. */
  onMerge: (loser: LibraryRow, survivorKey: string) => void;
  onToggleHidden: (row: LibraryRow) => void;
  /** Part 3 wave 1 (2026-09-13): what a merge would reach, for the review
   *  card before it runs. Absent, the merge runs straight from the picker. */
  onMergePreview?: (loser: LibraryRow, survivorKey: string) => { sessions: number; programDays: number };
  /** Part 3 wave 1: star or unstar a lift; starred lifts lead every picker. */
  onToggleFavorite?: (row: LibraryRow) => void;
  /** THE GOAL OPTION, WHERE THE EXERCISE IS (Dave 2026-09-12: "the list of
   *  exercises there's a goal option"). Optional so a caller with no goal
   *  wiring at all (there is none today) still renders this page exactly as
   *  it did before -- the pill is absent with the prop. */
  onSetGoal?: (row: LibraryRow) => void;
  onBack: () => void;
}) {
  const [editing, setEditing] = useState<LibraryRow | null>(null);
  const [draft, setDraft] = useState("");
  const [merging, setMerging] = useState<LibraryRow | null>(null);
  const [mergeReview, setMergeReview] = useState<{ loser: LibraryRow; survivor: LibraryRow; sessions: number; programDays: number } | null>(null);
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
                  {/* H-23: the names it used to go by, in the reading hue; and
                      the star, as a word, since the star glyph is the Brain's. */}
                  {((r.aliases && r.aliases.length > 0) || r.favorite) && (
                    <div className="facts">
                      {r.favorite && <span className="pill pill-good">Favorite</span>}
                      {r.aliases && r.aliases.length > 0 && <span className="fact cyan">{"Also " + r.aliases.join(", ")}</span>}
                    </div>
                  )}
                </div>
                <div className="lib-row-acts">
                  {onSetGoal && <button className="pill-act" onClick={(e) => { e.stopPropagation(); onSetGoal(r); }}>Goal</button>}
                  <button className="pill-act" onClick={(e) => { e.stopPropagation(); openEdit(r); }}>Edit</button>
                </div>
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
          {onToggleFavorite && (
            <button className="btn btn-secondary btn-block" onClick={() => { const r = editing; setEditing(null); onToggleFavorite(r); }}>
              {editing.favorite ? "Remove From Favorites" : "Add to Favorites"}
            </button>
          )}
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
          onPick={(ids) => {
            const r = merging; setMerging(null);
            if (!ids[0]) return;
            // Part 3 wave 1: a merge is reviewed before it runs. The card says
            // what it reaches; Merge is the one tap that writes.
            const survivor = rows.find((x) => x.key === ids[0]);
            if (onMergePreview && survivor) setMergeReview({ loser: r, survivor, ...onMergePreview(r, ids[0]) });
            else onMerge(r, ids[0]);
          }}
          onCancel={() => setMerging(null)}
        />
      )}

      {mergeReview && (
        <div className="pad-x"><div className="card pad">
          <div className="conn-name">Merge {mergeReview.loser.name} Into {mergeReview.survivor.name}</div>
          <div className="facts">
            <span className="fact">{mergeReview.sessions} {mergeReview.sessions === 1 ? "session" : "sessions"}</span>
            <span className="fact">{mergeReview.programDays} program {mergeReview.programDays === 1 ? "day" : "days"}</span>
          </div>
          <div className="bp-sub">Every one of them will read as {mergeReview.survivor.name}, and {mergeReview.loser.name} stays searchable as its old name. Undo on the receipt puts it all back.</div>
          <button className="btn btn-primary btn-block" onClick={() => { const m = mergeReview; setMergeReview(null); onMerge(m.loser, m.survivor.key); }}>Merge</button>
          <button className="btn btn-secondary btn-block" onClick={() => setMergeReview(null)}>Cancel</button>
        </div></div>
      )}
      <div className="screen-foot" />
    </div>
  );
}
