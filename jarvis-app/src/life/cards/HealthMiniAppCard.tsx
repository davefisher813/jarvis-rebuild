import type { ReactNode } from "react";
import { catIcon } from "../../categories/icons";
import type { ColorSlot } from "../../categories/types";
import { pressable } from "../../shared/pressable";
import { capAfterNumber } from "../../shared/casing";
import { ShieldAlert } from "../../shared/icons";

// HEALTH IS NOT AN AREA, IT IS A MINI-APP (LIFE_AREAS_TAB_HANDOFF). Restyled
// to Dave's reference on 2026-09-16: the same card shape as every area, on
// the good tint ("we can keep the green background"), its words in white
// ("keep the font white in the health section"), the count as its second
// line, and the five sections as icon chips on the tint. The chips are
// labels, not buttons: the whole card is the door, and the chips say what
// is inside. No shading on any tile: flat colour, white glyph.
const HEALTH_SECTIONS: { label: string; glyph: ReactNode }[] = [
  { label: "Track", glyph: catIcon("trending-up") },
  { label: "Train", glyph: catIcon("dumbbell") },
  { label: "Reports", glyph: catIcon("chart") },
  { label: "Meds", glyph: catIcon("pill") },
  { label: "Privacy", glyph: <ShieldAlert className="ic" /> },
];

export default function HealthMiniAppCard({ category, onOpen }: {
  // Name, icon and color ride live off the real category so a renamed or
  // recolored Health area never goes stale here; only the section names are
  // fixed content, per the handoff (no queries behind them).
  category: { name: string; color: ColorSlot; icon?: string };
  onOpen: () => void;
}) {
  return (
    <div className="card area-card area-card-health" {...pressable(onOpen)}>
      <div className="area-card-top">
        <div className={"area-tile cat-bg-" + category.color}>{catIcon(category.icon)}</div>
        <div className="area-stack">
          <div className="area-name">{category.name}</div>
          <div className="area-sub">{capAfterNumber(`${HEALTH_SECTIONS.length} sections`)}</div>
        </div>
        <div className="area-chev"><div className="chev" /></div>
      </div>
      <div className="health-sections">
        {HEALTH_SECTIONS.map((s) => (
          <span className="health-chip" key={s.label}>{s.glyph}{s.label}</span>
        ))}
      </div>
    </div>
  );
}
