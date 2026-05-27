import { useState, type ReactNode } from "react";
import type { MoreRoute } from "./MorePage";

const svg = (children: ReactNode) => (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const User = () => svg(<><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>);
const Bell = () => svg(<><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></>);
const Paint = () => svg(<><circle cx="13.5" cy="6.5" r=".5" fill="currentColor" /><circle cx="8.5" cy="7.5" r=".5" fill="currentColor" /><circle cx="6.5" cy="12.5" r=".5" fill="currentColor" /><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.504 5.555-5.555C21.965 6.012 17.461 2 12 2z" /></>);
const Gear = () => svg(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>);
const Layout = () => svg(<><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="9" y1="15" x2="9" y2="21" /><line x1="15" y1="15" x2="15" y2="21" /></>);
const Cloud = () => svg(<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />);
const Sliders = () => svg(<><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></>);
const Info = () => svg(<><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></>);
const LinkIco = () => svg(<><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>);
const Mag = () => svg(<><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>);
const Chev = () => (
  <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
);

interface Item { label: string; route: MoreRoute; tile: string; icon: ReactNode; group: number; }
const ITEMS: Item[] = [
  { label: "Account", route: "account", tile: "ico-blue", icon: <User />, group: 0 },
  { label: "Notifications", route: "notifsettings", tile: "cat-bg-red", icon: <Bell />, group: 1 },
  { label: "Appearance", route: "appearance", tile: "cat-bg-pink", icon: <Paint />, group: 1 },
  { label: "Categories", route: "categories", tile: "cat-bg-yellow", icon: <Gear />, group: 1 },
  { label: "Edit Tabs", route: "edittabs", tile: "cat-bg-teal", icon: <Layout />, group: 1 },
  { label: "Connections", route: "connections", tile: "cat-bg-sky", icon: <LinkIco />, group: 1 },
  { label: "Backup", route: "backup", tile: "ico-good", icon: <Cloud />, group: 2 },
  { label: "Advanced", route: "advanced", tile: "cat-bg-graphite", icon: <Sliders />, group: 2 },
  { label: "About", route: "about", tile: "ico-surface", icon: <Info />, group: 2 },
];

function SettingRow({ item, onClick }: { item: Item; onClick: () => void }) {
  return (
    <div className="row settings-row" role="button" tabIndex={0} onClick={onClick}>
      <div className={"sec-ico " + item.tile}>{item.icon}</div>
      <div className="row-grow"><div className="conn-name">{item.label}</div></div>
      <Chev />
    </div>
  );
}

export default function SettingsPage({ onNavigate, onBack }: { onNavigate: (r: MoreRoute) => void; onBack: () => void }) {
  const [q, setQ] = useState("");
  const ql = q.trim().toLowerCase();
  const groups = [0, 1, 2].map((g) => ITEMS.filter((i) => i.group === g && (!ql || i.label.toLowerCase().includes(ql))));
  const anyMatch = groups.some((g) => g.length > 0);
  return (
    <div className="screen">
      <div className="nav-bar"><button className="nav-back" onClick={onBack}>More</button></div>
      <div className="nav-large">Settings</div>
      <div className="pad-x settings-search"><div className="search-bar"><Mag /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" /></div></div>
      {groups.map((items, gi) => items.length > 0 && (
        <div className="pad-x settings-group" key={gi}><div className="card">
          {items.map((i) => <SettingRow key={i.route} item={i} onClick={() => onNavigate(i.route)} />)}
        </div></div>
      ))}
      {!anyMatch && <div className="empty-state"><div className="empty-title">No settings match "{q}"</div></div>}
    </div>
  );
}
