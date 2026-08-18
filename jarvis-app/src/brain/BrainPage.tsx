import type { ReactNode } from "react";
import type { CategoryKind } from "../categories/types";
import PageHeader from "../shared/PageHeader";

// Inline icons so the build matches the approved preview exactly (no icon-name drift).
const svg = (children: ReactNode) => (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const Users = () => svg(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>);
const Heart = () => svg(<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z" />);
const Compass = () => svg(<><circle cx="12" cy="12" r="10" /><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" /></>);
const Pen = () => svg(<><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" /></>);
const Flag = () => svg(<><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" /></>);
const Clock = () => svg(<><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>);
// A fork with one path taken: the Decision Record mark (matches anatomy.tsx).
const Fork = () => svg(<><line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></>);
const Chev = () => (
  <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
);

// Icons a category may carry (from the template defaults). Falls back to a tag.
const Briefcase = () => svg(<><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></>);
const Dumbbell = () => svg(<><path d="m6.5 6.5 11 11" /><path d="m21 21-1-1" /><path d="m3 3 1 1" /><path d="m18 22 4-4" /><path d="m2 6 4-4" /><path d="m3 10 7-7" /><path d="m14 21 7-7" /></>);
const Wallet = () => svg(<><path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" /><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" /></>);
const User = () => svg(<><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>);
const Settings = () => svg(<><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></>);
const Folder = () => svg(<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />);
const TrendingUp = () => svg(<><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></>);
const Book = () => svg(<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />);
const Trophy = () => svg(<><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0V2Z" /></>);
const Tag = () => svg(<><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" /><circle cx="7.5" cy="7.5" r=".5" fill="currentColor" /></>);

const CAT_ICON: Record<string, () => ReactNode> = {
  briefcase: Briefcase, heart: Heart, dumbbell: Dumbbell, wallet: Wallet,
  users: Users, user: User, settings: Settings, folder: Folder,
  "trending-up": TrendingUp, book: Book, trophy: Trophy,
};

interface BrainRow { key: string; name: string; icon: ReactNode; color: string; status?: string }
const TOP_SECTIONS: { title: string; rows: BrainRow[] }[] = [
  // ONE people row (2026-08-03). Inner Circle and Adversarial were cut: a
  // list only earns a row when a feature acts on membership, and neither did.
  // The facts they organized (register, handle-with-care) live on each person
  // and keep driving how JARVIS writes. They return only as the surface of a
  // feature that uses them (staying-in-touch nudges, game plans).
  { title: "Who You Know", rows: [
    { key: "contacts", name: "Contacts", icon: <Users />, color: "ico-blue" },
  ] },
  { title: "How You Think", rows: [
    // Decision Record (brainstorm shipment 1): why you chose this, kept.
    { key: "decisions", name: "Decisions", icon: <Fork />, color: "cat-bg-purple" },
    { key: "philosophy", name: "Life Philosophy", icon: <Compass />, color: "cat-bg-blue" },
    { key: "writing", name: "How You Write", icon: <Pen />, color: "cat-bg-green" },
    { key: "values", name: "Values", icon: <Flag />, color: "cat-bg-yellow" },
  ] },
  { title: "How You Live", rows: [
    { key: "routine", name: "Your Routine", icon: <Clock />, color: "cat-bg-teal" },
  ] },
];
// The Setup section (Onboarding, Backup) was removed 2026-08-03: both rows
// were Settings wearing a Brain costume, and both dead-ended in "coming soon"
// screens. Backup lives in Settings, where it always did; a row that leads
// nowhere teaches users that rows might not go anywhere.

export interface BrainCategory { id: string; name: string; color: string; icon?: string; kind?: CategoryKind }

// Your Categories groups by kind (2026-08-05) rather than one flat list, so
// the categories with a real page behind them (Health's training, an Org's
// projects and season) read as distinct from a plain category, which still
// gets a complete page, just not a module. This is purely a grouping of the
// same rows into labeled clusters: nothing here hides, merges, or deletes a
// category.
//
// Money does not get a row here at all (2026-08-10). It first routed to the
// real Money tab instead of a dead-end page, but Dave: "it looks the same. i
// only want one money category": a Brain row that just re-opens a tab
// already sitting in the bottom nav is still two visible doors to the same
// room, even once both doors lead somewhere. The category itself is
// untouched: it still exists, still tags tasks and bills, still shows up in
// Settings -> Categories to rename or recolor. It just is not ALSO a
// destination here, because it is not a destination, it is the Money tab.
type BrainGroupKind = Exclude<CategoryKind, "money">;
const KIND_GROUP_LABEL: Record<BrainGroupKind, string> = {
  org: "Orgs", health: "Health", people: "People", plain: "General",
};
const KIND_GROUP_ORDER: BrainGroupKind[] = ["org", "health", "people", "plain"];

export default function BrainPage({
  onOpen,
  categories = [],
}: {
  onOpen: (key: string, name: string) => void;
  categories?: BrainCategory[];
}) {
  // Catalog V3.1 library form (approved 2026-08-18, the Apple Music look):
  // bare colored glyphs, large names, inset hairlines. Each glyph keeps its
  // systemic color; the tile background goes, the color stays.
  const fgOf = (color: string) => color.replace(/^cat-bg-/, "cat-fg-").replace(/^ico-/, "cat-fg-");
  const Row = (r: BrainRow) => (
    <div className="lib-row" key={r.key} role="button" tabIndex={0} onClick={() => onOpen(r.key, r.name)}>
      <div className={"lib-ico " + fgOf(r.color)}>{r.icon}</div>
      <div className="lib-name">{r.name}</div>
      {r.status && <span className="row-status fg-good">{r.status}</span>}
      <Chev />
    </div>
  );
  const Section = (title: string, rows: BrainRow[]) => (
    <div key={title}>
      <div className="sh2"><span className="t">{title}</span></div>
      {rows.map(Row)}
    </div>
  );

  const catRow = (c: BrainCategory): BrainRow => ({
    key: c.id,
    name: c.name,
    color: "cat-bg-" + c.color,
    icon: (CAT_ICON[c.icon ?? ""] ?? Tag)(),
  });
  const groups = KIND_GROUP_ORDER
    .map((kind) => ({ kind, rows: categories.filter((c) => (c.kind ?? "plain") === kind).map(catRow) }))
    .filter((g) => g.rows.length > 0);
  // A single kind present reads as noise (a lone sub-label saying what the
  // list already shows); the grouping only earns its keep once it is
  // actually distinguishing something.
  const showGroupLabels = groups.length > 1;

  return (
    <div className="screen">
      <PageHeader title="Brain" />
      {TOP_SECTIONS.map((sec) => Section(sec.title, sec.rows))}
      {groups.length > 0 && (
        <div>
          <div className="sh2"><span className="t">Your Categories</span><span className="n">{categories.length}</span></div>
          {groups.map((g) => (
            <div className="cat-group" key={g.kind}>
              {showGroupLabels && <div className="cat-group-label eyebrow">{KIND_GROUP_LABEL[g.kind]}</div>}
              {g.rows.map(Row)}
            </div>
          ))}
        </div>
      )}
      <div className="screen-foot" />
    </div>
  );
}
