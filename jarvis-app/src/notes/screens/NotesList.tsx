import { useState } from "react";
import PageHeader, { BarAction, BarText } from "../../shared/PageHeader";
import { Check, FileText, PenLine, Search } from "../../shared/icons";
import { useSelection } from "../../shared/useSelection";
import SelectBar from "../../shared/SelectBar";
import { catColor } from "../../shared/categories";

// Matches locked frame #46 "List". The real iOS chrome (status bar, home
// indicator) is drawn by the device, so this uses the canonical .screen
// safe-area container in place of the preview's .device > .scroll wrapper.

export interface NoteListItem {
  id: string;
  title: string;
  date: string;
  category: string; // drives the category tile color
}

// Notes is a tab-level surface: there is deliberately no back button on the
// list (audit 2026-08-10 removed a dead onBack prop no parent ever passed).
export default function NotesList({
  notes,
  onOpen,
  onNewNote,
  onDeleteMany,
}: {
  notes: NoteListItem[];
  onOpen?: (id: string) => void;
  onNewNote?: () => void;
  onDeleteMany?: (ids: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const shown = query ? notes.filter((n) => n.title.toLowerCase().includes(query)) : notes;
  // The SEARCHED list, not the whole one. Select All while a search is
  // narrowing the page must mean the notes on screen: deleting the ones
  // hidden behind a query would be the worst possible version of this.
  const sel = useSelection(shown.map((n) => n.id));
  return (
    <div className="screen">
      {/* Library chassis (Design 2, approved 2026-08-18): pencil rides the
          bar, search under the title, notes as full-bleed library rows with
          the category color on a bare glyph. */}
      <PageHeader
        title="Notes"
        actions={
          sel.active ? (
            <BarText label="Done" strong onClick={sel.exit} />
          ) : (
            <>
              {onDeleteMany && shown.length > 0 && <BarText label="Select" onClick={() => sel.enter()} />}
              <BarAction label="New Note" onClick={onNewNote}><PenLine className="ic" /></BarAction>
            </>
          )
        }
      >
        <div className="sub-bar">
          <div className="search-bar">
            <Search className="ic" />
            <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      </PageHeader>

      {/* I3 APPLIES HERE TOO (Dave 2026-08-29: "mirror the home page red
          rules on all pages"). A library index is not the thing on this
          screen most worth looking at; the notes are. */}
      {/* RED IS A VERB (Dave 2026-08-30, chapter three -- history on LAW 11).
          This head spent one deploy in accent as "Notes' one red head"; his
          phone verdict made Today the reference, and Today's heads are quiet.
          A library index is information, not a verb. */}
      <div className="sh2 sh2-quiet"><span className="t">All Notes</span><span className="n">{shown.length}</span></div>
      {shown.map((n) => (
        <div
          className={"lib-row" + (sel.isSelected(n.id) ? " picked" : "")}
          role="button" tabIndex={0} key={n.id}
          onClick={() => (sel.active ? sel.toggle(n.id) : onOpen?.(n.id))}
        >
          {/* The selection box takes the glyph's column, for the reason the
              task row gives up its done-check: two round controls side by
              side saying different things is a puzzle, and the category
              glyph is decoration next to a live checkbox. */}
          {sel.active ? (
            <button
              type="button"
              className={"sel-box" + (sel.isSelected(n.id) ? " on" : "")}
              role="checkbox" aria-checked={sel.isSelected(n.id)}
              aria-label={(sel.isSelected(n.id) ? "Deselect " : "Select ") + n.title}
              onClick={(e) => { e.stopPropagation(); sel.toggle(n.id); }}
            >{sel.isSelected(n.id) && <Check className="ic" />}</button>
          ) : (
            /* An unfiled note wears yellow (Dave 2026-08-29: "default
               should be yellow") -- a legal-pad color that says "a note",
               deliberately not any category's claim. A filed note keeps its
               category's own color, which is what makes the yellow readable
               as "not filed yet". */
            <div className={"lib-ico cat-fg-" + (n.category ? catColor(n.category) : "yellow")}><FileText className="ic" /></div>
          )}
          <div className="lib-stack">
            <div className="lib-name">{n.title}</div>
            <div className="lib-sub">{n.date}</div>
          </div>
          {!sel.active && <div className="chev"></div>}
        </div>
      ))}
      {query && shown.length === 0 && (
        <div className="lib-row"><div className="lib-name">No notes match &ldquo;{q.trim()}&rdquo;</div></div>
      )}
      {onDeleteMany && (
        <SelectBar sel={sel} noun="Note" onDelete={() => { onDeleteMany(sel.selected); sel.exit(); }} />
      )}
    </div>
  );
}
