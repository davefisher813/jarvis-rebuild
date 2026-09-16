import { catIcon } from "../../categories/icons";
import type { ColorSlot } from "../../categories/types";
import { pressable } from "../../shared/pressable";

// HEALTH IS NOT AN AREA, IT IS A MINI-APP (LIFE_AREAS_TAB_HANDOFF, approved
// visual). Bridge, Work and the rest are task/goal/project collections;
// Health is a dashboard with its own subsystems, so it wears a distinct
// card -- a tinted frame and a preview of what is actually inside -- rather
// than the plain disc-and-stats row every other area gets. The four
// sections are a label, not a route each: the whole card opens the one
// Health area page (CategoryDetail), same as every other area, and the grid
// is there so tapping it is never a guess about what is behind it.
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
    <div {...pressable(onOpen)} className="row health-mini-app">
      <div className={"lib-ico lib-disc cat-bg-" + category.color}>{catIcon(category.icon)}</div>
      <div className="row-grow">
        <div className="conn-name">{category.name}</div>
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
