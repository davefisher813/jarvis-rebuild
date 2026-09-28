import { useState, type ReactNode } from "react";
import BrainTop from "./BrainTop";
import type { CategoryKind } from "../categories/types";
import PageHeader from "../shared/PageHeader";
import { filledIcon } from "../shared/filledIcons";
import { pressable } from "../shared/pressable";

// Inline icons so the build matches the approved preview exactly (no icon-name drift).
const svg = (children: ReactNode) => (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const Chev = () => (
  <div className="chev" />
);

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

export default function BrainPage({
  onOpen,
  onOpenFact,
  onOpenWatching,
  categories = [],
}: {
  onOpen: (key: string, name: string) => void;
  // C-38: a strand tapped in the top bands opens its sheet on What JARVIS
  // Knows; a WATCHING detector opens that page under its Watching filter.
  onOpenFact?: (id: string) => void;
  onOpenWatching?: (key: string) => void;
  // LIFE_AREAS_TAB_HANDOFF (2026-09-16): "Your Areas" moved to Life, as the
  // Areas tab, so a category's name and what's filed under it live in one
  // place instead of the name here and the work there. Categories still
  // reach this page -- BrainTop's values detector reads their names -- but
  // Brain no longer lists them as a destination.
  categories?: BrainCategory[];
}) {
  // C-38: how many live bands sit above the nav list. With none, the page is
  // the flat nav list it has been since V4 and Explore has nothing to be
  // apart from; with one or two, Explore is the quiet head over the eight.
  const [bands, setBands] = useState(0);
  // Catalog V3.1 library form (approved 2026-08-18, the Apple Music look):
  // ICON LAW (Dave 2026-08-22): in a list, an icon is FILLED, and color says
  // whose it is. JARVIS's own rows wear the filled brand-red glyph exactly as
  // before; a category row wears a disc in ITS color with a white glyph --
  // the same fill language, aimed at his content. Outline glyphs are the
  // inside-a-card state and no longer appear in nav lists.
  const Row = (r: BrainRow) => (
    <div {...pressable(() => onOpen(r.key, r.name))} className="lib-row" key={r.key}>
      {r.color === "lib-ico-brand"
        ? <div className="lib-ico lib-ico-brand">{r.icon}</div>
        : <div className={"lib-ico lib-disc " + r.color}>{r.icon}</div>}
      <div className="lib-name">{r.name}</div>
      {r.status && <span className="row-status fg-good">{r.status}</span>}
      <Chev />
    </div>
  );

  // THE HUB IS ONE CARD NOW (Brain onto the rulings, 2026-09-02, minus Your
  // Areas per LIFE_AREAS_TAB_HANDOFF 2026-09-16). The rows keep the library
  // anatomy and the filled brand glyph (ICON LAW 2026-08-22); only the
  // ground changed.
  return (
    <div className="screen ruled">
      <PageHeader title="Brain" />
      <BrainTop
        onOpenFact={(id) => (onOpenFact ? onOpenFact(id) : onOpen("knows", "What JARVIS Knows"))}
        onOpenWatching={(key) => (onOpenWatching ? onOpenWatching(key) : onOpen("knows", "What JARVIS Knows"))}
        onBands={setBands}
        areas={categories.map((c) => c.name)}
      />
      {bands > 0 && <div className="sh2 sh2-quiet"><span className="t">Explore</span></div>}
      <div className="pad-x"><div className="card list-card-ruled nav-card">{NAV_ROWS.map(Row)}</div></div>
      <div className="screen-foot" />
    </div>
  );
}
