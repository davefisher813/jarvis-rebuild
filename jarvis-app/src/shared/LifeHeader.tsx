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

/** One view chip. `count` is optional and only drawn when a page has an
 *  honest number for it -- a chip that says 0 is worse than a chip that says
 *  nothing, and a chip that guesses is worse than both. */
export interface HeaderView {
  key: string;
  label: string;
  count?: number;
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
  scope, menu, menuSide,
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
  /** Present only while a local search is running. */
  scope?: SearchScope;
  /** THE ONE CONTROL BESIDE THE CHIPS (Dave 2026-09-17: "maybe chips for
   *  standard options and a drop down to sort by category and in other way").
   *
   *  The chips are VIEWS and they scroll. This is not a view -- it is the
   *  cut across whichever view is chosen -- so it does not scroll with them,
   *  and it is pinned where filtering happens rather than buried in a sheet
   *  the athlete has to go looking for. Absent on a page with nothing to cut
   *  by. */
  menu?: ReactNode;
  /** Which end it is pinned to. Default is the row's end. */
  menuSide?: "start" | "end";
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
      {/* ONE ROW, SCROLLING, NEVER WRAPPING (handoff rule 2). Two or three
          wrapping rows of chips is the shape this replaces. */}
      <div className="hdr-chip-line">
        {menu && menuSide === "start" && <div className="hdr-menu lead">{menu}</div>}
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
              {typeof v.count === "number" && v.count > 0 && <span className="hdr-chip-n">{v.count}</span>}
            </button>
          ))}
        </div>
        {menu && menuSide !== "start" && <div className="hdr-menu">{menu}</div>}
      </div>
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
