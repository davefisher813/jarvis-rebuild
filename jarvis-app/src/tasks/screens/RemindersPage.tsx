import { useRef, useState, type ReactNode } from "react";
import type { LinkedItem } from "../../notes/types";
import { PAGE_TABS, type PageTab, type PageSection, type PageRow, whenWords, dateWord as dateWordFor, describeRepeat, repeatRuleOf, scheduleKindOf } from "../reminders";
import { actionLabelFor } from "../reminderHistory";
import { catName, catColor } from "../../shared/categories";
import PageHeader, { BarAction } from "../../shared/PageHeader";
import LifeHeader, { OptionsButton, type HeaderView } from "../../shared/LifeHeader";
import HeadMenu from "../../shared/HeadMenu";
import OptionsSheet from "../../shared/OptionsSheet";
import { rowDoor } from "../../shared/rowDoor";
import { Burst } from "../../shared/Burst";
import { Check, Search, Plus, Gauge } from "../../shared/icons";
import { fmtTime } from "../../schedule/calendar";

// THE REMINDERS PAGE (the reminders rebuild push E, 2026-09-15; row anatomy
// corrected the same day after Dave's review of the interactive preview;
// corrected again, v3, 2026-09-15: one shape, one colour dot, one amber
// signal).
// The date as an eyebrow over "Reminders."; New Reminder as the page's one
// filled red beside Search; then sections of cards, straight away.
//
// THE VIEWS ARE CHIPS, NOT A SECOND TAB BAR (Dave 2026-09-15: "we can't have
// two tab bars on one page"). Life already spends the page's one segmented
// control on Tasks / Reminders / Projects / Goals, so Today / Upcoming /
// Routines / Done take a chip row. They SCROLL rather than wrap as of
// 2026-09-17 (Unified Headers, rule 2: "Use one horizontally scrollable chip
// row without wrapping"), and they are the shared header's row now, the same
// one the other four pages spend. Chips choose, which is what these do.
//
// The "On Your Radar" hero card is gone (Dave 2026-09-15: it matched no
// other component in the app). Now / Later Today carry the same info the
// hero did, as the app's standard dotted-leader section head with a count
// (Now alone keeps the accent head, ASTRA I3 style: one page, one "look
// here").
//
// A card is a door (the whole card opens the details), and it is ONE row of
// one fixed height, never a stack: a plain checkbox leads (`.cb`, the
// existing reminder control, not a task ring: v1 drew it as one and the v3
// correction named the mistake), then a fixed time gutter for today's timed
// occurrences in plain grey, then the body (the title on one line, ellipsis,
// over one facts line that never wraps), then one action in the trailing
// slot. The facts are the area in its colour via a single dot with its name
// left plain grey, then a filled amber "Today" chip when due today (the one
// amber signal on the row now that the time is grey again, and the one
// filled chip the facts line allows, Dave 2026-09-15 v3), then the rhythm
// plain.
//
// No icon tile beside the checkbox: two shapes for one fact was the exact
// "two circles" problem the row rules elsewhere in the app already ban (Dave
// 2026-09-15). No options glyph either: it opened the same sheet the row
// already opens, so it was a third control in a row the ruling gives one.
// The trailing slot holds the linked verb when there is one and Snooze
// otherwise, Reopen on a done row, Resume on a paused one, Restore on a
// skipped one. Whatever the slot displaces is one tap away in the detail
// sheet, not dropped.

export interface PageChrome {
  back?: string;
  onBack?: () => void;
  /** Life's segmented control, when the page is a Life segment. */
  segments?: ReactNode;
}

export default function RemindersPage({
  chrome, sections, tab, onTab, query, onQuery, searchOpen, onSearchToggle, today,
  onNew, onSettings, onOpen, onTick, onSnooze, onOpenLinked, onResume, onRestore,
}: {
  chrome: PageChrome;
  sections: PageSection[];
  tab: PageTab;
  onTab: (t: PageTab) => void;
  query: string;
  onQuery: (q: string) => void;
  searchOpen: boolean;
  onSearchToggle: () => void;
  today: string;
  onNew: () => void;
  onSettings: () => void;
  onOpen: (id: string) => void;
  onTick: (id: string, done: boolean) => void;
  onSnooze: (id: string) => void;
  onOpenLinked?: (link: LinkedItem) => void;
  onResume: (id: string) => void;
  onRestore: (id: string, date: string) => void;
}) {
  const [optsOpen, setOptsOpen] = useState(false);
  /** THE AREA CUT (Dave 2026-09-17: "Put it back and make it fit. That needs
   *  to be on all pages"). Every reminder row already carries its area and
   *  already prints its name; this is the same cut the other four pages have
   *  always had, composed with whichever view is chosen rather than being a
   *  view of its own. */
  const [area, setArea] = useState<string | null>(null);
  const [burstId, setBurstId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const celebrate = (id: string) => {
    setBurstId(null);
    if (timer.current) clearTimeout(timer.current);
    requestAnimationFrame(() => { setBurstId(id); timer.current = setTimeout(() => setBurstId(null), 600); });
  };
  const dateWord = new Date(`${today}T12:00:00`).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });

  const ring = (it: PageRow) => (
    <div
      className={"cb" + (it.done ? " on" : "") + (burstId === it.id ? " just-checked" : "")}
      role="button" tabIndex={0}
      aria-label={it.done ? "Undo " + it.text : "Mark " + it.text + " done"}
      onClick={() => { if (!it.done) celebrate(it.id); onTick(it.id, !it.done); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!it.done) celebrate(it.id); onTick(it.id, !it.done); } }}
    >
      {it.done && <Check className="ic" />}
      <Burst show={burstId === it.id} />
    </div>
  );

  const card = (it: PageRow) => {
    const r = it.reminder;
    const link = r.linkedItem;
    const area = it.category ? catName(it.category) : "";
    const timed = scheduleKindOf(r) === "timed" && !r.paused;
    const rule = repeatRuleOf(r);
    // A fixed left time gutter for every open, timed occurrence (Dave
    // 2026-09-16: "Transfer funds for bills," a future date with a category
    // and a rhythm, crammed "Sep 19 · 12:00 PM" into the same facts line
    // those two were fighting over and the category lost its name entirely
    // -- three facts plus a Snooze pill simply do not fit phone width. The
    // clock now always lives in its own column, whatever the date; the
    // facts line says the DATE alone (dateWord, no time -- the gutter
    // already has that) for a future occurrence, and nothing for today's
    // (implied by which section, Ready Now or Later Today, it sits in, same
    // as before). Only unscheduled, paused, contextual and skipped rows --
    // none of which carry a bare clock reading on their own -- still run the
    // full whenWords() phrase through the facts line.
    const hasGutter = it.state === "open" && timed && !!it.time;
    const dueToday = hasGutter && it.date === today;
    const when = it.state === "skipped" ? "Skipped · " + whenWords(r, it.date, it.time, today, area) : whenWords(r, it.date, it.time, today, area);
    const tone = it.state === "open" && it.date === today ? "when" : "later";
    // ONE RIGHT-SLOT ACTION, whatever the state (Dave 2026-09-15, v3: the row
    // stacked to three lines because the pill took a line of its own under
    // the body). Open rows answer with the linked verb when there is one and
    // Snooze otherwise; the other states answer with their one verb. Whatever
    // this slot displaces is still one tap away in the detail sheet.
    const act: { label: string; quiet?: boolean; onClick: () => void } | null =
      it.state === "open"
        ? link && onOpenLinked
          ? { label: actionLabelFor(link), onClick: () => onOpenLinked(link) }
          : timed ? { label: "Snooze", onClick: () => onSnooze(it.id) } : null
        : it.state === "done" ? { label: "Reopen", quiet: true, onClick: () => onTick(it.id, false) }
        : it.state === "paused" ? { label: "Resume", onClick: () => onResume(it.id) }
        : it.state === "skipped" && it.skippedDate ? { label: "Restore", onClick: () => onRestore(it.id, it.skippedDate!) }
        : null;
    return (
      <div key={it.id + (it.skippedDate ?? "")} className={"rem-card" + (it.state === "done" ? " done" : "")} {...rowDoor(() => onOpen(it.id))}>
        <div className="rem-card-top">
          {it.state === "open" ? ring(it) : <span className="rem-card-cb-space" aria-hidden="true" />}
          {hasGutter && <div className="rem-time-gutter">{fmtTime(it.time!).time}<span className="ampm">{fmtTime(it.time!).ap}</span></div>}
          <div className="rem-card-body">
            <div className="rem-card-title">{it.text}</div>
            <div className="facts">
              {/* A gutter row's clock already lives in its own column, so
                  this fact says only the DATE (nothing at all for today's,
                  implied by the section it sits in); every other row --
                  unscheduled, paused, contextual, skipped -- has no clock to
                  split out, and keeps the full whenWords() phrase it always
                  has. */}
              {hasGutter
                ? (!dueToday && <span className={"fact " + tone}>{dateWordFor(it.date!, today)}</span>)
                : <span className={"fact " + (it.state === "open" ? tone : "")}>{when}</span>}
              {/* The area name takes its own element so IT is what gives way
                  when the line runs out of room. Its colour is already on the
                  dot beside it, so a clipped name still says which area this
                  is; a clipped urgency chip would not say anything. */}
              {area && <span className="fact cat"><span className={"cd cat-bg-" + catColor(it.category)} /><span className="cat-t">{area}</span></span>}
              {/* The urgency chip is the app's own .uchip (LAW 11 finding 2,
                  the one Tasks already wears): a tint of the tag's colour with
                  the colour on the words, never a new chip and never a solid
                  fill. It rides INSIDE a plain .fact so the line's own "·"
                  separator renders on the grey wrapper, outside the tint,
                  instead of inside the chip with it. */}
              {dueToday && <span className="fact"><span className="uchip u-today">Today</span></span>}
              {/* The rhythm is the first thing to go when the row already
                  carries a clock: on this view it was the fact that
                  overflowed, and "Every Day" is what the detail sheet and
                  the Routines view are for. Rows without a gutter (no bare
                  clock reading to begin with) keep it, where it is the
                  line's most useful word. This used to check dueToday alone,
                  so a FUTURE gutter row (Dave 2026-09-16: "Transfer funds
                  for bills," Money, Every Month, Sep 19) still tried to
                  carry rhythm beside a date and a category and squeezed the
                  category's name down to nothing -- the one fact that must
                  never be the one that gives way, since it says whose
                  reminder this is. */}
              {timed && rule.kind !== "once" && !hasGutter && <span className="fact">{describeRepeat(rule)}</span>}
            </div>
          </div>
          {act && <button type="button" className={"pill-act" + (act.quiet ? " pill-quiet" : "")} onClick={act.onClick}>{act.label}</button>}
        </div>
      </div>
    );
  };

  // ONE HEADER, FIVE PAGES (Dave 2026-09-17, Unified Headers handoff). What
  // this replaces is the handoff's own named example: "Replace the large red
  // New Reminder button and separate Search button with a visible search
  // field and a compact, labeled Add control." A full-width red primary on
  // every visit, a Search button that revealed a field, and a chip row that
  // WRAPPED. The views, their meanings and their order are untouched --
  // Today, Upcoming, Routines and Done are exactly the PAGE_TABS they were.
  // Done came off the chip row on 2026-09-17 ("Get rid of done") and is back
  // on 2026-09-18, because the views are a menu now: a menu shows one answer
  // and hands the list to a panel, so the view you open least costs the line
  // nothing at all.
  const views: HeaderView[] = PAGE_TABS.map((t) => ({ key: t.key, label: t.label }));
  const areaIds = [...new Set(sections.flatMap((s) => s.rows.map((r) => r.category)).filter((c): c is string => !!c))];
  // The area composes with the view: it cuts the rows the view already chose,
  // and a section left with none of them is not drawn at all.
  const shownSections = area
    ? sections.map((sec) => ({ ...sec, rows: sec.rows.filter((r) => r.category === area) })).filter((sec) => sec.rows.length > 0)
    : sections;
  const header = (
    <LifeHeader
      query={query}
      onQuery={onQuery}
      placeholder="Search Reminders"
      addLabel="New Reminder"
      onAdd={onNew}
      views={views}
      view={tab}
      onView={(k) => onTab(k as PageTab)}
      scope={query.trim() ? {
        count: shownSections.reduce((n, sec) => n + sec.rows.length, 0),
        where: `${PAGE_TABS.find((t) => t.key === tab)?.label ?? tab} reminders`,
        ...(tab !== "done" ? { onAll: () => onTab("done"), allLabel: "Search Done too" } : {}),
      } : undefined}
      drops={areaIds.length > 0 ? (
        <HeadMenu
          ariaLabel="Area"
          value={area ?? "all"}
          label={area ? undefined : "Area"}
          options={[{ value: "all", label: "All Areas" }, ...areaIds.map((id) => ({ value: id, label: catName(id) || "Area", dot: catColor(id) }))]}
          onPick={(v) => setArea(v === "all" ? null : v)}
        />
      ) : undefined}
    >
      {chrome.segments}
    </LifeHeader>
  );
  const opts = <OptionsButton onClick={() => setOptsOpen(true)} label="Reminders Options" />;
  return (
    <div className="screen ruled rem-page">
      {chrome.segments
        ? <PageHeader title="Life" headActions={opts}>{header}</PageHeader>
        : <PageHeader title="Reminders" back={chrome.back} onBack={chrome.onBack} headActions={opts}
            hero={<div className="rem-hero"><div className="eyebrow">{dateWord}</div><div className="pagehead-title">Reminders<span className="rem-hero-dot">.</span></div></div>}>{header}</PageHeader>}

      {shownSections.length === 0 && (
        <div className="pad-x"><div className="card list-card-ruled"><div className="empty-state">
          <div className="empty-title">Nothing Here Right Now</div>
          <div className="empty-sub">{query ? "Nothing matches that." : "Reminders appear here when they match this view."}</div>
          <button className="row row-act" onClick={onNew}><Plus className="ic" />Add a Reminder</button>
        </div></div></div>
      )}
      {shownSections.map((s) => (
        <div key={s.label}>
          <div className={"sh2" + (s.label === "Now" ? "" : " sh2-quiet")}>
            {s.label === "Now" && <span className="rem-now-dot" aria-hidden="true" />}
            <span className="t">{s.label}</span><span className="n">{s.rows.length}</span>
          </div>
          {/* ONE CARD PER SECTION, ROWS INSIDE IT (Dave 2026-09-15, holding
              Life's four segments side by side: "every other section is
              normal and then look at reminders"). Tasks, Projects and Goals
              each group a section's rows into one .list-card-ruled with a
              divider between them; Reminders was the only lens giving every
              row a card of its own, which is what made it read as bigger and
              looser than the three beside it. */}
          <div className="pad-x">
            <div className="card list-card-ruled">
              {s.rows.map((it) => card(it))}
            </div>
          </div>
        </div>
      ))}
      <div className="screen-foot" />
      {/* Reminder Settings was a gear in the bar; it is a row in the one
          options sheet all five pages share (handoff rule 7). */}
      {optsOpen && (
        <OptionsSheet title="Reminders Options" rows={[
          { key: "settings", label: "Reminder Settings", onClick: () => { setOptsOpen(false); onSettings(); } },
        ]} onClose={() => setOptsOpen(false)} />
      )}
    </div>
  );
}
