import { catIcon } from "../../categories/icons";
import type { ColorSlot } from "../../categories/types";

// HEALTH IS NOT AN AREA, IT IS A MINI-APP (LIFE_AREAS_TAB_HANDOFF, approved
// visual). Bridge, Work and the rest are task/goal/project collections;
// Health is a dashboard with its own subsystems, so it keeps the section
// preview the approved mock calls for -- but rides the same gm-slot glyph
// and task-title anatomy every other area row wears (the first pass's
// mistake was building this off the Brain nav-row language instead; fixed
// 2026-09-16, Dave: "follow the design catalog"). No chevron: the approved
// visual never gave this card one, since the whole card is already the
// one tap target and its own content says where it goes.
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
    <div className="task-row p2 health-mini-app" role="button" tabIndex={0} onClick={onOpen}>
      <div className="task-check-tap"><span className={"gm-slot cat-fg-" + category.color}>{catIcon(category.icon)}</span></div>
      <div className="task-title">
        <span className="task-name">{category.name}</span>
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
