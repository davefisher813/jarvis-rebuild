import { useState } from "react";
import type { Exercise, Workout } from "./types";
import type { LibraryEntry } from "./library";
import { classOf, type ClassStore } from "./classify";
import { EQUIPMENT_LABEL, loadStyleOf } from "./equipment";
import { MUSCLE_LABEL } from "./muscles";
import { readGymSettings } from "./settings";
import { uniformStrip } from "./strip";
import LibraryPickSheet from "./LibraryPickSheet";
import ExerciseSheet from "./ExerciseSheet";
import RowCtxAction from "../shared/RowCtxAction";
import { BarbellGlyph } from "../shared/glyphs";
import { Plus } from "../shared/icons";
import { liftTitle } from "../shared/casing";
import { pressable } from "../shared/pressable";

/** How many recently trained exercises the Suggestions list offers. */
const SUGGESTIONS = 4;

/**
 * THE EMPTY WORKOUT (Dave 2026-10-09, item 3: "tap Start Workout, empty
 * session, add exercises as you go. It should be super easy to workout and
 * just log what you do"; mockup 2, adapted to the app's own palette).
 *
 * What the athlete sees between Start Workout and the first exercise. It used
 * to be the bare Add Exercise sheet standing in for a screen; it is a screen
 * now, in the session's own dress: Cancel on the left (nothing is logged yet,
 * so nothing to confirm), the one filled red, Add Exercise, inside the empty
 * state, and the exercises he trained most recently one tap away underneath.
 * There is no Finish here: with nothing logged it could only say "Nothing
 * Logged", and a control that cannot work is not drawn. The first exercise he
 * adds turns this into the normal session screen.
 */
export default function EmptyWorkoutScreen({ library, classStore, history, onAddEntry, onAddDraft, onCancel }: {
  library: LibraryEntry[];
  classStore: ClassStore;
  history: Workout[];
  /** One tap on a suggestion, or a pick from the list: it joins the workout. */
  onAddEntry: (entry: LibraryEntry) => void;
  /** A new exercise made on the Add Exercise sheet. */
  onAddDraft: (draft: Omit<Exercise, "id">) => void;
  onCancel: () => void;
}) {
  const [pickOpen, setPickOpen] = useState(false);
  const [newName, setNewName] = useState<string | null>(null);
  // Hidden exercises are not offered (UP-ATH-21), the same as every picker.
  const hidden = new Set(readGymSettings().hiddenKeys ?? []);
  const recent = library
    .filter((e) => e.lastUsed > 0 && !hidden.has(e.key))
    .sort((a, b) => b.lastUsed - a.lastUsed)
    .slice(0, SUGGESTIONS);
  // With nothing in the library yet the list would be empty, so Add Exercise
  // goes straight to making one.
  const openAdd = () => (library.length > 0 ? setPickOpen(true) : setNewName(""));

  return (
    <div className="screen ruled health-ruled screen-session">
      <div className="nav-bar">
        <button type="button" className="nav-action-text nav-action-quiet" onClick={onCancel}>Cancel</button>
        <div className="nav-title truncate">New Workout</div>
      </div>

      <div className="empty-state empty-compact">
        <div className="empty-icon"><BarbellGlyph /></div>
        <div className="empty-title">Let&rsquo;s Get to Work</div>
        <div className="empty-sub">Add Exercises as You Go, No Program Needed</div>
        <button type="button" className="btn btn-primary btn-launch btn-lg btn-block" onClick={openAdd}>
          <Plus className="ic" aria-hidden="true" />Add Exercise
        </button>
      </div>

      {recent.length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Suggestions</span>
            <button type="button" className="see-all pill-action" onClick={() => setPickOpen(true)}>See All</button></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {recent.map((entry) => {
              // Only what he has told the app: the first primary muscle and the
              // equipment. Nothing is guessed from the name.
              const c = classOf(classStore, entry, loadStyleOf(entry));
              const muscle = c.primary[0];
              const name = liftTitle(entry.name);
              return (
                <div className="row" key={entry.key} {...pressable(() => onAddEntry(entry))}>
                  <div className="row-grow">
                    <div className="conn-name truncate">{name}</div>
                    {(muscle || c.equipment) && (
                      <div className="facts">
                        {muscle && <span className="fact">{MUSCLE_LABEL[muscle]}</span>}
                        {/* Violet is equipment in the Colour Key (§AM). */}
                        {c.equipment && <span className="fact violet">{EQUIPMENT_LABEL[c.equipment]}</span>}
                      </div>
                    )}
                  </div>
                  <RowCtxAction when label="Add" ariaLabel={`Add ${name}`} onAct={() => onAddEntry(entry)} />
                </div>
              );
            })}
          </div></div>
        </>
      )}
      <div className="screen-foot" />

      {pickOpen && (
        <LibraryPickSheet
          title="Add Exercise"
          library={library}
          onPick={(entry) => { setPickOpen(false); onAddEntry(entry); }}
          onFreeText={(q) => { setPickOpen(false); setNewName(q); }}
          onCancel={() => setPickOpen(false)}
        />
      )}
      {newName !== null && (
        <ExerciseSheet
          mode="new"
          initial={newName ? { id: "", name: newName, kind: "weight_reps", sets: uniformStrip(3, { r: 8 }) } : undefined}
          library={library}
          history={history}
          onSave={(draft) => { setNewName(null); onAddDraft(draft); }}
          onCancel={() => setNewName(null)}
        />
      )}
    </div>
  );
}
