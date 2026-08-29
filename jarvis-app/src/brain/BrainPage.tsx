import type { ReactNode } from "react";
import type { CategoryKind } from "../categories/types";
import PageHeader from "../shared/PageHeader";
import { filledIcon } from "../shared/filledIcons";

// Inline icons so the build matches the approved preview exactly (no icon-name drift).
const svg = (children: ReactNode) => (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const Chev = () => (
  <div className="chev" />
);

// Icons a category may carry (from the template defaults). Falls back to a tag.
const Heart = () => svg(<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z" />);
const Users = () => svg(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>);
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
// CATALOG V4 (Dave 2026-08-18, "the brain has way too many sections"): the
// three labeled sections collapsed into ONE flat headerless nav list, glyphs
// filled brand red (Apple Music Library form). ONE people row survives from
// 2026-08-03 (Inner Circle / Adversarial stay cut).
const NAV_ROWS: BrainRow[] = [
  // Brain Layer 2 (item 04): the genome made visible. One row, keeping the
  // hub's one-flat-list law; the strands live on their own page behind it.
  { key: "knows", name: "What JARVIS Knows", icon: filledIcon("knows"), color: "lib-ico-brand" },
  // Insights (2026-08-25, the Life View): this month still open, the sealed
  // shelf, and the life layer. The key stays "month" so old deep links and
  // the report's arrival path keep working. One row, same flat-list law.
  { key: "month", name: "Insights", icon: filledIcon("month"), color: "lib-ico-brand" },
  { key: "contacts", name: "Contacts", icon: filledIcon("contacts"), color: "lib-ico-brand" },
  { key: "decisions", name: "Decisions", icon: filledIcon("decisions"), color: "lib-ico-brand" },
  { key: "philosophy", name: "Life Philosophy", icon: filledIcon("philosophy"), color: "lib-ico-brand" },
  { key: "writing", name: "How You Write", icon: filledIcon("writing"), color: "lib-ico-brand" },
  { key: "values", name: "Values", icon: filledIcon("values"), color: "lib-ico-brand" },
  { key: "routine", name: "Your Routine", icon: filledIcon("routine"), color: "lib-ico-brand" },
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
// V4: the per-kind sub-labels (Orgs/Health/People/General) are retired; the
// glyph color already says it. Kinds still ORDER the flat list so orgs lead.
type BrainGroupKind = Exclude<CategoryKind, "money">;
const KIND_GROUP_ORDER: BrainGroupKind[] = ["org", "health", "people", "plain"];

export default function BrainPage({
  onOpen,
  categories = [],
}: {
  onOpen: (key: string, name: string) => void;
  categories?: BrainCategory[];
}) {
  // Catalog V3.1 library form (approved 2026-08-18, the Apple Music look):
  // ICON LAW (Dave 2026-08-22): in a list, an icon is FILLED, and color says
  // whose it is. JARVIS's own rows wear the filled brand-red glyph exactly as
  // before; a category row wears a disc in ITS color with a white glyph --
  // the same fill language, aimed at his content. Outline glyphs are the
  // inside-a-card state and no longer appear in nav lists.
  const Row = (r: BrainRow) => (
    <div className="lib-row" key={r.key} role="button" tabIndex={0} onClick={() => onOpen(r.key, r.name)}>
      {r.color === "lib-ico-brand"
        ? <div className="lib-ico lib-ico-brand">{r.icon}</div>
        : <div className={"lib-ico lib-disc " + r.color}>{r.icon}</div>}
      <div className="lib-name">{r.name}</div>
      {r.status && <span className="row-status fg-good">{r.status}</span>}
      <Chev />
    </div>
  );

  const catRow = (c: BrainCategory): BrainRow => ({
    key: c.id,
    name: c.name,
    color: "cat-bg-" + c.color,
    icon: (CAT_ICON[c.icon ?? ""] ?? Tag)(),
  });
  // One flat categories block, ordered by kind (orgs first), no sub-labels.
  const catRows = KIND_GROUP_ORDER
    .flatMap((kind) => categories.filter((c) => (c.kind ?? "plain") === kind))
    .map(catRow);

  return (
    <div className="screen">
      <PageHeader title="Brain" />
      {NAV_ROWS.map(Row)}
      {catRows.length > 0 && (
        <div>
          {/* The one mini-caps boundary label (Brain 4, Dave's pick): it
              marks where user content begins in a nav list. */}
          <div className="sh2 sh2-caps"><span className="t">Your Areas</span><span className="n">{categories.length}</span></div>
          {catRows.map(Row)}
        </div>
      )}
      <div className="screen-foot" />
    </div>
  );
}
