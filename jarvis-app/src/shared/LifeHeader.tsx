import { useRef, type ReactNode } from "react";
import { Plus, Search, SlidersHorizontal, X } from "./icons";
import HeadMenu from "./HeadMenu";

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

/** One view. A LABEL, AND A COUNT WHEN THE PAGE HAS ONE (2026-09-18).
 *
 *  It was a chip for a day. Chips carry their whole list on the screen, so
 *  the list has to be short enough to fit: four with counts measured 458px
 *  of content in a 361px row, four without measured 351, and there was never
 *  room beside them for the Area control the same page needs. A menu carries
 *  one capsule and hands the rest to a panel, so every view can come back --
 *  Overdue, Daily, From Email, Done -- with the counts the chips could not
 *  afford. */
export interface HeaderView {
  key: string;
  label: string;
  /** Drawn inside the menu, beside its option. Never a zero. */
  count?: number;
  /** WHAT THE CLOSED CAPSULE SAYS, when the full label is too long for a
   *  line that also carries the page's cuts. Notes' "Recently Deleted" is
   *  16 characters and pushed the line 17px past a 393px screen; the panel
   *  still names it in full, because that is where the choosing happens. */
  short?: string;
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
  /** THE CUTS THAT ARE NOT THE VIEW (Dave 2026-09-17: "Make multiple
   *  dropdown chips like areas in the most logical way possible. Stack
   *  dropdowns next to each other"; 2026-09-18: "everything is on one row
   *  directly across").
   *
   *  Area, Group, Tag, after the view on the same line. A page passes its
   *  own HeadMenus rather than a description of them -- moving a control is
   *  not the same as rebuilding it -- and a page with nothing to cut by
   *  passes nothing. */
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
      {/* ONE LINE ACROSS (Dave 2026-09-18, on a header wearing two rows:
          "All of these chips that are on the second row should be on the
          first row... It should be one line across on every single page. If
          you drop down, make the chips drop down so everything is on one row
          directly across").

          He is right that each row looked half empty, and right that they
          cannot simply be joined: three view chips and two capsules measure
          522px of content in a 361px row. One shape wins, and the menu is
          the one that scales -- a chip must fit its whole list on the
          screen, a menu need only fit its answer.

          So: the view, then the page's own cuts, left to right, all of them
          capsules, all of them on this line. Nothing scrolls at an ordinary
          size, nothing is cut in half, and every view the page has is back
          with its count beside it. */}
      <div className="hdr-controls">
        <HeadMenu
          lead
          ariaLabel="View"
          value={view}
          label={views.find((v) => v.key === view)?.short}
          options={views.map((v) => ({ value: v.key, label: v.label, count: v.count }))}
          onPick={onView}
        />
        {drops}
      </div>
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
