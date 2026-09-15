import { useRef, useState, type ReactNode } from "react";
import type { LinkedItem } from "../../notes/types";
import { PAGE_TABS, type PageTab, type PageSection, type PageRow, whenWords, describeRepeat, repeatRuleOf, scheduleKindOf } from "../reminders";
import { actionLabelFor } from "../reminderHistory";
import { catName, catColor } from "../../shared/categories";
import PageHeader, { BarAction } from "../../shared/PageHeader";
import { rowDoor } from "../../shared/rowDoor";
import { Burst } from "../../shared/Burst";
import { Check, Search, Plus, Ellipsis, Gauge } from "../../shared/icons";
import { fmtTime } from "../../schedule/calendar";

// THE REMINDERS PAGE (the reminders rebuild push E, 2026-09-15; row anatomy
// corrected the same day after Dave's review of the interactive preview;
// corrected again, v3, 2026-09-15: one shape, one colour dot, one amber
// signal).
// The date as an eyebrow over "Reminders."; New Reminder as the page's one
// filled red beside Search; four views as a segmented control; sections of
// cards.
//
// The "On Your Radar" hero card is gone (Dave 2026-09-15: it matched no
// other component in the app). Now / Later Today carry the same info the
// hero did, as the app's standard dotted-leader section head with a count
// (Now alone keeps the accent head, ASTRA I3 style: one page, one "look
// here").
//
// A card is a door (the whole card opens the details): a plain checkbox
// leads (`.cb`, the existing reminder control, not a task ring: v1 drew it
// as one and the v3 correction named the mistake), a fixed time gutter for
// today's timed occurrences in plain grey, the title on one line, a facts
// line of inline words (the area in its colour via a single dot, its name
// left plain grey, then a filled amber "Today" chip when due today, the
// one amber signal on the row now that the time is grey again, and the one
// filled chip the facts line allows, Dave 2026-09-15 v3), the options
// glyph, and exactly one action pill: the linked verb when there is one,
// otherwise Snooze. No icon tile beside the checkbox: two shapes for one
// fact was the exact "two circles" problem the row rules elsewhere in the
// app already ban (Dave 2026-09-15). Every other action (including Snooze
// when a linked verb already has the slot) lives one tap away in the detail
// sheet. A done card offers Reopen Occurrence, a paused one Resume
// Reminder, a skipped one Restore Occurrence.

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

  const card = (it: PageRow, current: boolean) => {
    const r = it.reminder;
    const link = r.linkedItem;
    const area = it.category ? catName(it.category) : "";
    const timed = scheduleKindOf(r) === "timed" && !r.paused;
    const rule = repeatRuleOf(r);
    // A fixed left time gutter only for today's timed occurrences (Ready
    // Now, Later Today): the common case, and the one Dave reviewed. Every
    // other case (unscheduled, paused, a future date, a context trigger,
    // skipped) keeps the existing whenWords() phrase in the facts line,
    // where a bare clock time wouldn't say enough on its own.
    const dueToday = it.state === "open" && timed && it.date === today && !!it.time;
    const when = it.state === "skipped" ? "Skipped · " + whenWords(r, it.date, it.time, today, area) : whenWords(r, it.date, it.time, today, area);
    const tone = it.state === "open" && it.date === today ? "when" : "later";
    // Exactly one action pill (never two beside the ring): the linked verb
    // when there is one, Snooze otherwise. The one it displaces is still one
    // tap away in the detail sheet, not dropped.
    const primaryAct = link && onOpenLinked
      ? { label: actionLabelFor(link), onClick: () => onOpenLinked(link) }
      : timed ? { label: "Snooze", onClick: () => onSnooze(it.id) } : null;
    return (
      <div key={it.id + (it.skippedDate ?? "")} className={"card rem-card" + (current ? " current" : "") + (it.state === "done" ? " done" : "")} {...rowDoor(() => onOpen(it.id))}>
        <div className="rem-card-top">
          {it.state === "open" ? ring(it) : <span className="rem-card-cb-space" aria-hidden="true" />}
          {dueToday && <div className="rem-time-gutter">{fmtTime(it.time!).time}<span className="ampm">{fmtTime(it.time!).ap}</span></div>}
          <div className="rem-card-body">
            <div className="rem-card-title">{it.text}</div>
            <div className="facts">
              {!dueToday && <span className={"fact " + (it.state === "open" ? tone : "")}>{when}</span>}
              {area && <span className="fact cat"><span className={"cd cat-bg-" + catColor(it.category)} />{area}</span>}
              {dueToday && <span className="fact rem-flag-today">Today</span>}
              {timed && rule.kind !== "once" && <span className="fact">{describeRepeat(rule)}</span>}
            </div>
          </div>
          <button type="button" className="rem-card-more" aria-label={"Options for " + it.text} onClick={() => onOpen(it.id)}><Ellipsis className="ic" /></button>
        </div>
        {it.state === "open" && primaryAct && (
          <div className="rem-card-acts">
            <button type="button" className="pill-act" onClick={primaryAct.onClick}>{primaryAct.label}</button>
          </div>
        )}
        {it.state === "done" && <div className="rem-card-acts"><button type="button" className="pill-act pill-quiet" onClick={() => onTick(it.id, false)}>Reopen Occurrence</button></div>}
        {it.state === "paused" && <div className="rem-card-acts"><button type="button" className="pill-act" onClick={() => onResume(it.id)}>Resume Reminder</button></div>}
        {it.state === "skipped" && it.skippedDate && <div className="rem-card-acts"><button type="button" className="pill-act" onClick={() => onRestore(it.id, it.skippedDate!)}>Restore Occurrence</button></div>}
      </div>
    );
  };

  const gear = <BarAction label="Reminder Settings" onClick={onSettings}><Gauge className="ic" /></BarAction>;
  return (
    <div className="screen ruled rem-page">
      {chrome.segments
        ? <PageHeader title="Life" actions={gear}>{chrome.segments}</PageHeader>
        : <PageHeader title="Reminders" back={chrome.back} onBack={chrome.onBack} actions={gear}
            hero={<div className="rem-hero"><div className="eyebrow">{dateWord}</div><div className="pagehead-title">Reminders<span className="rem-hero-dot">.</span></div></div>} />}

      <div className="pad-x">
        <div className="rem-toolbar">
          <button type="button" className="btn btn-primary" onClick={onNew}><Plus className="ic" />New Reminder</button>
          <button type="button" className={"btn btn-secondary" + (searchOpen ? " on" : "")} aria-pressed={searchOpen} onClick={onSearchToggle}><Search className="ic" />Search</button>
        </div>
        <div className="segmented" role="tablist" aria-label="Reminder views">
          {PAGE_TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={t.key === tab} className={"seg" + (t.key === tab ? " active" : "")} onClick={() => onTab(t.key)}>{t.label}</button>
          ))}
        </div>
      </div>
      {searchOpen && (
        <div className="sub-bar">
          <div className="search-bar">
            <Search className="ic search-ic" />
            <input placeholder="Search" aria-label="Find a reminder" value={query} onChange={(e) => onQuery(e.target.value)} />
          </div>
        </div>
      )}

      {sections.length === 0 && (
        <div className="pad-x"><div className="card list-card-ruled"><div className="empty-state">
          <div className="empty-title">Nothing Here Right Now</div>
          <div className="empty-sub">{query ? "Nothing matches that." : "Reminders appear here when they match this view."}</div>
          <button className="row row-act" onClick={onNew}><Plus className="ic" />Add a Reminder</button>
        </div></div></div>
      )}
      {sections.map((s) => (
        <div key={s.label}>
          <div className={"sh2" + (s.label === "Now" ? "" : " sh2-quiet")}>
            {s.label === "Now" && <span className="rem-now-dot" aria-hidden="true" />}
            <span className="t">{s.label}</span><span className="n">{s.rows.length}</span>
          </div>
          <div className="pad-x">{s.rows.map((it, i) => card(it, s.label === "Now" && i === 0))}</div>
        </div>
      ))}
      <div className="screen-foot" />
    </div>
  );
}
