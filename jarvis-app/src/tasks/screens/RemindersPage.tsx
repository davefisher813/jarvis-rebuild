import { useRef, useState, type ReactNode } from "react";
import type { LinkedItem } from "../../notes/types";
import { PAGE_TABS, type PageTab, type PageSection, type PageRow, whenWords, describeRepeat, repeatRuleOf, scheduleKindOf } from "../reminders";
import { actionLabelFor } from "../reminderHistory";
import { catName, catColor } from "../../shared/categories";
import PageHeader, { BarAction } from "../../shared/PageHeader";
import { rowDoor } from "../../shared/rowDoor";
import { Burst } from "../../shared/Burst";
import { Check, Search, Plus, Ellipsis, Forward, ListChecks, FileText, CalendarDays, Lightbulb, User, Gauge } from "../../shared/icons";
import { BellGlyph } from "../../shared/glyphs";

// THE REMINDERS PAGE (the reminders rebuild push E, 2026-09-15, Dave's
// interactive preview, on the app's own chrome). The date as an eyebrow
// over "Reminders." with the gear; the On Your Radar card with today's
// count and Take the Next Step; New Reminder as the page's one filled red
// beside Search; four views as a segmented control; sections of cards.
//
// A card is a door (the whole card opens the details), with the symbol
// tile, the words, a facts line of inline coloured words (the when in
// amber, the area in its colour, the rhythm plain; never filled chips,
// Dave 2026-09-15), the options glyph, and one row of answers: the linked
// verb, Snooze, and the ring that marks it done. A done card offers Reopen
// Occurrence, a paused one Resume Reminder, a skipped one Restore
// Occurrence. Nothing here completes a reminder except the ring.

const GLYPH: Record<string, ReactNode> = {
  task: <ListChecks className="ic" />, note: <FileText className="ic" />, event: <CalendarDays className="ic" />,
  decision: <Lightbulb className="ic" />, contact: <User className="ic" />, healthItem: <Gauge className="ic" />, email: <Forward className="ic" />,
};

export interface PageChrome {
  back?: string;
  onBack?: () => void;
  /** Life's segmented control, when the page is a Life segment. */
  segments?: ReactNode;
}

export default function RemindersPage({
  chrome, sections, tab, onTab, todayCount, nextId, query, onQuery, searchOpen, onSearchToggle, today,
  onNew, onSettings, onOpen, onTick, onSnooze, onOpenLinked, onResume, onRestore,
}: {
  chrome: PageChrome;
  sections: PageSection[];
  tab: PageTab;
  onTab: (t: PageTab) => void;
  todayCount: number;
  /** The reminder Take the Next Step opens, or null when there is none. */
  nextId: string | null;
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
    const when = it.state === "skipped" ? "Skipped · " + whenWords(r, it.date, it.time, today, area) : whenWords(r, it.date, it.time, today, area);
    const tone = it.state === "open" && it.date === today ? "when" : "later";
    return (
      <div key={it.id + (it.skippedDate ?? "")} className={"card rem-card" + (current ? " current" : "") + (it.state === "done" ? " done" : "")} {...rowDoor(() => onOpen(it.id))}>
        <div className="rem-card-top">
          <div className={"row-ico cat-bg-" + catColor(it.category || undefined)}>{link ? GLYPH[link.type] ?? <BellGlyph /> : <BellGlyph />}</div>
          <div className="rem-card-body">
            <div className="rem-card-title">{it.text}</div>
            <div className="facts">
              <span className={"fact " + (it.state === "open" ? tone : "")}>{when}</span>
              {area && <span className="fact cat"><span className={"cd cat-bg-" + catColor(it.category)} />{area}</span>}
              {timed && rule.kind !== "once" && <span className="fact">{describeRepeat(rule)}</span>}
            </div>
          </div>
          <button type="button" className="rem-card-more" aria-label={"Options for " + it.text} onClick={() => onOpen(it.id)}><Ellipsis className="ic" /></button>
        </div>
        {it.state === "open" && (
          <div className="rem-card-acts">
            {link && onOpenLinked && <button type="button" className="pill-act" onClick={() => onOpenLinked(link)}>{actionLabelFor(link)}</button>}
            {timed && <button type="button" className="pill-act" onClick={() => onSnooze(it.id)}>Snooze</button>}
            {ring(it)}
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
        <div className="card rem-overview">
          <div className="rem-overview-body">
            <div className="eyebrow">On Your Radar</div>
            <div className="rem-overview-count"><span className="n">{todayCount}</span><span className="w">{todayCount === 1 ? " for today" : " for today"}</span></div>
            <div className="rem-overview-line">{todayCount > 0 ? "Your next step is ready." : "Space for what comes next."}</div>
          </div>
          {nextId
            ? <button type="button" className="rem-orbit" onClick={() => onOpen(nextId)}><Forward className="ic" /><span>Take the Next Step</span></button>
            : <div className="rem-orbit still" aria-hidden="true"><Check className="ic" /><span>All Clear</span></div>}
        </div>
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
          <div className={"sh2" + (s.label === "Ready Now" ? "" : " sh2-quiet")}><span className="t">{s.label}</span><span className="n">{s.rows.length}</span></div>
          <div className="pad-x">{s.rows.map((it, i) => card(it, s.label === "Ready Now" && i === 0))}</div>
        </div>
      ))}
      <div className="screen-foot" />
    </div>
  );
}
