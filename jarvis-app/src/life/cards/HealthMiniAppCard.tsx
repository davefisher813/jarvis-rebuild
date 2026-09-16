import { catIcon } from "../../categories/icons";
import type { ColorSlot } from "../../categories/types";
import { pressable } from "../../shared/pressable";

// HEALTH IS NOT AN AREA, IT IS A MINI-APP (LIFE_AREAS_TAB_HANDOFF, approved
// visual). Bridge, Work and the rest are task/goal/project collections;
// Health is a dashboard with its own subsystems, so it keeps the section
// preview the approved mock calls for. CORRECTED 2026-09-16 (Dave, showing
// the old Brain "Your Areas" screenshot: "it originally looked like this
// and still should for the most part"): the leading glyph rides the same
// lib-ico lib-disc every area row wears now, not GoalRowRuled's gm-slot --
// a category's glyph is the colour disc wherever it appears, mini-app or
// not. No chevron: the approved visual never gave this card one, since the
// whole card is already the one tap target and its own content says where
// it goes.
const HEALTH_SECTIONS = [
  { label: "Log It", desc: "Workouts, sleep, fuel, mood" },
  { label: "Reports", desc: "Recovery, trends, doctor" },
  { label: "Meds", desc: "Prescriptions, refills, taken" },
  { label: "Privacy", desc: "Consent, sharing, kid's room" },
];

export default function HealthMiniAppCard({ category, onOpen }: {
  // Name, icon and color ride live off the real category so a renamed or
  // recolored Health area never goes stale here; only the four sections
  // are fixed content, per the handoff (no queries behind them).
  category: { name: string; color: ColorSlot; icon?: string };
  onOpen: () => void;
}) {
  return (
    <div className="lib-row health-mini-app" {...pressable(onOpen)}>
      <div className={"lib-ico lib-disc cat-bg-" + category.color}>{catIcon(category.icon)}</div>
      <div className="lib-stack">
        <div className="lib-name">{category.name}</div>
        <div className="health-sections">
          {HEALTH_SECTIONS.map((s) => (
            <div className="health-section-item" key={s.label}>
              <div className="health-section-label">{s.label}</div>
              <div className="health-section-desc">{s.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
