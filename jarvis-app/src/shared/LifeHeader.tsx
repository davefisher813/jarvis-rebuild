import { useRef, type ReactNode } from "react";
import { Plus, Search, SlidersHorizontal, X } from "./icons";

// ONE HEADER, FIVE PAGES (Dave 2026-09-17, the Unified Headers handoff:
// "unify the headers of Tasks, Reminders, Notes, Projects and Goals using the
// attached mockups. This is a presentation and discovery improvement").
//
// Before this, five pages that do the same three things -- look at a subset,
// find something, make something -- each did them differently. Reminders led
// with a full-width red New Reminder banner and a separate Search button.
// Tasks hid its views inside a dropdown. Projects and Goals had no visible
// way to search or create at all. Notes mixed area names, workflow states and
// Recently Deleted into one wrapping filter row.
//
// The shape, top to bottom, is the mockups':
//
//   page title, with one options control in the bar
//   the page's existing section navigation, where it has any
//   a search field and a compact Add, on one row
//   one horizontally scrollable row of view chips
//   the page's own content
//
// WHAT THIS COMPONENT IS NOT. It does not own search, creation, filtering or
// any page's data. Every page keeps its own query state, its own create sheet
// and its own definition of what a view means; this renders the controls and
// hands the taps back. That is the whole point of the handoff's first rule --
// "do not build five independent versions" -- and the reason wiring a page to
// it changed no behaviour on any of them.
//
// SIZES. The handoff gives 46px for the search/Add row, a 9px gap, a 12px
// corner radius, 13px before the chips and 24px into content, with Add about
// 77px, and says plainly that these "are visual baselines, not replacements
// for catalog tokens". So the CSS spends the app's own tokens wherever one
// lands on the number and the literal only where nothing does. Touch targets
// stay at 44px even where a chip draws smaller.

/** One view chip. A LABEL AND NOTHING ELSE (2026-09-17, measured).
 *
 *  It carried a count for one day. Four chips with counts measure 458px of
 *  content at phone width in a 321px row, so the row had to scroll, and a
 *  scrolling row of large filled pills cuts one of them in half at every
 *  resting position -- which is what Dave was looking at when he said "this
 *  is simply not going to work". Without counts the same four measure 335px
 *  and the row does not scroll at all.
 *
 *  The approved mockups never had counts on these chips. They were mine. */
export interface HeaderView {
  key: string;
  label: string;
}

/** WHAT THE SEARCH IS ACTUALLY SEARCHING (handoff rule 4: "Search must have a
 *  clear scope").
 *
 *  A local search constrained by the selected chip and an Area looks exactly
 *  like a search of everything, right up until the thing you know exists does
 *  not appear. So the page says how many it found and where it looked, and
 *  offers one control to widen it -- never widening silently. */
export interface SearchScope {
  /** How many matched, in the scope actually searched. */
  count: number;
  /** The scope, named: "Active projects", "Pinned notes". */
  where: string;
  /** Widens past the selected view. Absent when the view is already All. */
  onAll?: () => void;
  /** What widening is called here: "Search all projects". */
  allLabel?: string;
}

export function OptionsButton({ onClick, label = "Options" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className="hdr-opts" aria-label={label} onClick={onClick}>
      <SlidersHorizontal className="ic" />
    </button>
  );
}

export default function LifeHeader({
  query, onQuery, placeholder,
  addLabel, onAdd,
  views, view, onView,
  drops, scope, filters,
  children,
}: {
  query: string;
  onQuery: (q: string) => void;
  /** "Search tasks", "Search notes". Names the entity, because the page
   *  title is a long way up the screen by the time the keyboard is open. */
  placeholder: string;
  /** THE ACCESSIBLE NAME, which says the type (handoff rule 5: "Use an
   *  accessible label naming the type, even though the visible button says
   *  Add"). The word on the button is Add on all five pages so the header
   *  reads the same; a screen reader gets "New Task". */
  addLabel: string;
  onAdd: () => void;
  views: HeaderView[];
  view: string;
  onView: (key: string) => void;
  /** THE CUTS THAT ARE NOT VIEWS, STACKED ON THEIR OWN LINE (Dave
   *  2026-09-17: "Make multiple dropdown chips like areas in the most
   *  logical way possible. Stack dropdowns next to each other").
   *
   *  Area, Group, Tag. A chip PICKS one of a fixed few; a dropdown holds a
   *  list that grows with the data, and states its own answer while closed.
   *  Two different jobs, so two different shapes, on two different lines --
   *  which is also the only arrangement that fits: one Area capsule beside
   *  four chips overflows a 361px row by 60px (measured), and beside three
   *  it still overflows by 6px.
   *
   *  A page passes its own HeadMenus; this reserves the line and spaces
   *  them. A page with no areas and nothing to group passes nothing and the
   *  line does not exist. */
  drops?: ReactNode;
  /** Present only while a local search is running. */
  scope?: SearchScope;
  /** WHAT IS NARROWING THE LIST, SAID OUT LOUD (handoff rule 7: "Add a
   *  concise visible indication and clear action when filters are applied;
   *  do not leave users wondering why records disappeared").
   *
   *  This is how the area cut stays findable without a control competing for
   *  room on the chip line. Nothing is showing unless something is actually
   *  filtering, and when something is, it names itself and offers one tap to
   *  undo it. */
  filters?: { label: string; onClear: () => void };
  /** The page's own section navigation, above the search row. Life's tabs;
   *  nothing on Notes, which keeps its own place in the app. */
  children?: ReactNode;
}) {
  const field = useRef<HTMLInputElement>(null);
  return (
    <div className="life-hdr">
      {children}
      <div className="hdr-find">
        {/* The whole field is the field: the glyph and the gaps focus it,
            rather than being a 20px target beside a 200px one. */}
        <div className="hdr-search" onClick={() => field.current?.focus()}>
          <Search className="ic hdr-search-ic" />
          <input
            ref={field}
            className="hdr-search-in"
            type="search"
            value={query}
            placeholder={placeholder}
            aria-label={placeholder}
            onChange={(e) => onQuery(e.target.value)}
          />
          {query.length > 0 && (
            <button type="button" className="hdr-search-x" aria-label="Clear search" onClick={() => { onQuery(""); field.current?.focus(); }}>
              <X className="ic" />
            </button>
          )}
        </div>
        {/* ADD IS NOT A SECOND PRIMARY (handoff rule 1: "Add uses a dark
            surface with a red plus; it must not become a second oversized
            primary red action"). The red is the glyph and nothing else, so
            the page's real primary -- Start Now on Tasks -- stays the one
            red block on the screen. */}
        <button type="button" className="hdr-add" aria-label={addLabel} onClick={onAdd}>
          <Plus className="ic" />
          <span>Add</span>
        </button>
      </div>
      {/* ONE ROW THAT FITS (2026-09-17). The handoff asked for one
          horizontally scrollable row, and scrolling is what broke: at every
          resting position a large filled pill was cut in half by the screen
          edge. A row that fits needs no scroll and cuts nothing, which is
          why the chips carry no counts and why a page puts at most three
          here -- measured, not estimated.
          THREE, NOT FOUR (Dave, same day: "Get rid of done"). The finished
          view is the one you visit least and it was holding a slot on the
          line you touch most; it is a row in the options sheet with its
          count, and the line below names it while it is on. */}
      <div className="chip-row hdr-chips" role="tablist" aria-label="Views">
        {views.map((v) => (
          <button
            key={v.key}
            type="button"
            role="tab"
            aria-selected={v.key === view}
            className={"chip" + (v.key === view ? " active" : "")}
            onClick={() => { if (v.key !== view) onView(v.key); }}
          >
            {v.label}
          </button>
        ))}
      </div>
      {drops && <div className="hdr-drops">{drops}</div>}
      {!scope && filters && (
        <div className="hdr-scope">
          <span className="hdr-scope-n">{filters.label}</span>
          <button type="button" className="hdr-scope-all" onClick={filters.onClear}>Clear</button>
        </div>
      )}
      {scope && (
        <div className="hdr-scope">
          {/* A count and where it looked, as facts. Never "no results": the
              records are not missing, the scope is narrow. */}
          <span className="hdr-scope-n">{`${scope.count} ${scope.count === 1 ? "result" : "results"} in ${scope.where}`}</span>
          {scope.onAll && scope.allLabel && (
            <button type="button" className="hdr-scope-all" onClick={scope.onAll}>{scope.allLabel}</button>
          )}
        </div>
      )}
    </div>
  );
}
