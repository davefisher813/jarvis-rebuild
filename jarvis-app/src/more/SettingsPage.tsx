import { useState, type ReactNode } from "react";
import type { MoreRoute } from "./MorePage";
import PageHeader from "../shared/PageHeader";
import { filledSettingsIcon } from "../shared/filledIcons";

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
const ITEMS: Item[] = [
  { label: "Account", route: "account", group: 0 },
  { label: "Notifications", route: "notifsettings", group: 1 },
  { label: "Appearance", route: "appearance", group: 1 },
  { label: "Areas", route: "categories", group: 1 },
  { label: "Edit Tabs", route: "edittabs", group: 1 },
  { label: "Connections", route: "connections", group: 1 },
  { label: "AI Control", route: "aicontrol", group: 1 },
  { label: "What JARVIS Learned", route: "learned", group: 1 },
  { label: "Backup", route: "backup", group: 2 },
  { label: "Advanced", route: "advanced", group: 2 },
  { label: "About", route: "about", group: 2 },
];


// V4 + Dave 2026-08-18 ("settings in all red too"): Settings joins the red
// nav wash, filled brand glyphs like More and Brain.
function SettingRow({ item, onClick }: { item: Item; onClick: () => void }) {
  return (
    <div className="lib-row" role="button" tabIndex={0} onClick={onClick}>
      <div className="lib-ico lib-ico-brand">{filledSettingsIcon(item.route)}</div>
      <div className="lib-name">{item.label}</div>
      <Chev />
    </div>
  );
}

export default function SettingsPage({ onNavigate, onBack }: { onNavigate: (r: MoreRoute) => void; onBack: () => void }) {
  const [q, setQ] = useState("");
  const ql = q.trim().toLowerCase();
  // Flat list (Dave 2026-08-19: "Settings doesn't need all of those sub
  // headers, just list the settings"). Group order still drives row order.
  const rows = [0, 1, 2].flatMap((g) => ITEMS.filter((i) => i.group === g && (!ql || i.label.toLowerCase().includes(ql))));
  const anyMatch = rows.length > 0;
  return (
    <div className="screen">
      <PageHeader title="Settings" back="More" onBack={onBack}>
        <div className="pad-x settings-search"><div className="search-bar"><Mag /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" /></div></div>
      </PageHeader>
      {rows.map((i) => <SettingRow key={i.route} item={i} onClick={() => onNavigate(i.route)} />)}
      {!anyMatch && <div className="empty-state"><div className="empty-title">No Settings Match "{q}"</div>
        <button className="quiet-action" onClick={() => setQ("")}>Clear the Search</button></div>}
    </div>
  );
}
