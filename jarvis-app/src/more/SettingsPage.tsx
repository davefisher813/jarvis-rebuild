import { useEffect, useState, type ReactNode } from "react";
import type { MoreRoute } from "./MorePage";
import PageHeader from "../shared/PageHeader";
import { filledSettingsIcon } from "../shared/filledIcons";
import { useProfile } from "../data/NotesProvider";

const svg = (children: ReactNode) => (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const Chev = () => (
  <div className="chev" />
);
const Mag = () => svg(<><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>);

interface Item { label: string; route: MoreRoute; group: number; }
// SECTIONS ARE LABELED, ALWAYS (universal sectioning law, Dave 2026-08-18:
// "I want universal rules"). These groups used to be whitespace clusters;
// FOUR CARDS, NOT ONE LONG ONE (Dave 2026-10-05, "he opens the app and finds nothing": thirteen rows in one card
// read as an undifferentiated list). The groups are still headless (2026-08-19, "just list the settings"); the gap
// between the cards is the boundary: you, how the app looks and sounds, what JARVIS knows and connects to, the system.
const ITEMS: Item[] = [
  { label: "Account", route: "account", group: 0 },
  { label: "Notifications", route: "notifsettings", group: 1 },
  { label: "Appearance", route: "appearance", group: 1 },
  { label: "Feedback Style", route: "feedbackstyle", group: 1 },
  { label: "Areas", route: "categories", group: 1 },
  { label: "Training", route: "training", group: 1 },
  { label: "Booking", route: "booking", group: 1 },
  { label: "Edit Tabs", route: "edittabs", group: 1 },
  { label: "Connections", route: "connections", group: 2 },
  { label: "Email Sections", route: "emailsections", group: 2 },
  { label: "AI Control", route: "aicontrol", group: 2 },
  { label: "What JARVIS Learned", route: "learned", group: 2 },
  // Brain Manual v1: Export and Erase live one level below Settings, next to
  // the brain's own row, not out on the More hub.
  { label: "Brain", route: "brainsettings", group: 2 },
  { label: "Backup", route: "backup", group: 3 },
  { label: "Advanced", route: "advanced", group: 3 },
  { label: "About", route: "about", group: 3 },
];
const GROUPS = [0, 1, 2, 3];

// ONE ICON SYSTEM: THE SAME 30PX TILE ON EVERY ROW (2026-10-05, the round 2 review: "rainbow filled glyphs, a gradient tile and grey chrome"; "bare
// glyphs of mixed weight while the sheets use tiles"). Every row wears its glyph from the one filled set, at one size, on one rounded tile washed
// in its own hue (.lib-ico-tile). A settings page is chrome, not an entity, so no row borrows a type's colour: Booking is no longer Event's sky and
// Training no longer the Task's red (the key's red is for tasks, sky for events). The hues are the ones the rest of the app gives its own surfaces:
// Notifications orange (as on More), Email Sections teal (Email's own tile), Brain, AI Control and What JARVIS Learned purple and yellow, the
// system cluster graphite. The light and dark inks come from .cat-fg-* (--cat-ic-* in light, --cat-dtx-* in dark), never the text ink, never the brand red.
const TONE: Record<string, string> = {
  account: "cat-fg-graphite", notifsettings: "cat-fg-orange", appearance: "cat-fg-indigo", feedbackstyle: "cat-fg-pink",
  categories: "cat-fg-green", training: "cat-fg-lime", booking: "cat-fg-cyan", edittabs: "cat-fg-graphite",
  connections: "cat-fg-blue", emailsections: "cat-fg-teal", aicontrol: "cat-fg-purple", learned: "cat-fg-yellow",
  brainsettings: "cat-fg-purple", backup: "cat-fg-graphite", advanced: "cat-fg-graphite", about: "cat-fg-graphite",
};

/** The profile when there is one to read. The page also renders where no profile service is mounted (a bare
 *  render), and an Account row without a name is still an Account row. */
function useOptionalProfile() {
  try { return useProfile(); } catch { return null; }
}


function SettingRow({ item, onClick, who }: { item: Item; onClick: () => void; who?: string }) {
  return (
    <div className="lib-row" role="button" tabIndex={0} onClick={onClick}>
      <div className={"lib-ico lib-ico-tile " + (TONE[item.route] ?? "cat-fg-graphite")}>{filledSettingsIcon(item.route)}</div>
      {who ? <div className="lib-stack"><div className="lib-name">{item.label}</div><div className="lib-sub">{who}</div></div> : <div className="lib-name">{item.label}</div>}
      <Chev />
    </div>
  );
}

export default function SettingsPage({ onNavigate, onBack }: { onNavigate: (r: MoreRoute) => void; onBack: () => void }) {
  const [q, setQ] = useState("");
  const svc = useOptionalProfile();
  const [who, setWho] = useState("");
  useEffect(() => {
    let on = true;
    void svc?.get().then((p) => { if (on) setWho(p?.name?.trim() ?? ""); });
    return () => { on = false; };
  }, [svc]);
  const ql = q.trim().toLowerCase();
  // Flat list (Dave 2026-08-19: "Settings doesn't need all of those sub
  // headers, just list the settings"). Group order still drives row order.
  const rows = GROUPS.flatMap((g) => ITEMS.filter((i) => i.group === g && (!ql || i.label.toLowerCase().includes(ql))));
  const anyMatch = rows.length > 0;
  // THE LIST IN CARDS (Brain onto the rulings, 2026-09-02, the same day the
  // hub and More moved): the three groups as three cards, still with no
  // heads (Dave 2026-08-19: "just list the settings"); the gap between
  // cards is the boundary. A search narrows to one card.
  const groups = ql ? [rows] : GROUPS.map((g) => rows.filter((i) => i.group === g)).filter((g) => g.length > 0);
  return (
    <div className="screen ruled">
      <PageHeader title="Settings" back="More" onBack={onBack}>
        <div className="pad-x settings-search"><div className="search-bar"><Mag /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" /></div></div>
      </PageHeader>
      {groups.map((g, gi) => (
        <div className={"pad-x" + (gi > 0 ? " nav-card-gap" : "")} key={gi}><div className="card list-card-ruled nav-card">
          {g.map((i) => <SettingRow key={i.route} item={i} who={i.route === "account" ? who : undefined} onClick={() => onNavigate(i.route)} />)}
        </div></div>
      ))}
      {!anyMatch && <div className="empty-state"><div className="empty-title">No Settings Match "{q}"</div>
        <button className="quiet-action" onClick={() => setQ("")}>Clear the Search</button></div>}
      <div className="screen-foot" />
    </div>
  );
}
