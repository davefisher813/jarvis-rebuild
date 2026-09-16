import { catIcon } from "../../categories/icons";
import type { ColorSlot } from "../../categories/types";
import { pressable } from "../../shared/pressable";
import { capAfterNumber } from "../../shared/casing";

// HEALTH IS NOT AN AREA, IT IS A MINI-APP (LIFE_AREAS_TAB_HANDOFF, approved
// visual). Bridge, Work and the rest are task/goal/project collections;
// Health is a dashboard with its own subsystems, so it keeps the section
// preview the approved mock calls for. The leading glyph rides the same
// lib-ico lib-disc every area row wears (Dave, 2026-09-16: "it originally
// looked like this and still should for the most part") -- a category's
// glyph is the colour disc wherever it appears, mini-app or not. No chevron:
// the whole card is already the one tap target and its own content says
// where it goes.
//
// OPTION B FINAL (Dave, 2026-09-16, from the rendered comparison). Five
// sections, named, on one wrapping line, with the count stated beside the
// title. The previous cut was four labelled tiles in a 2x2 grid, each with a
// description under it; that spent two lines per section on words nobody
// reads twice and still could not fit a fifth.
const HEALTH_SECTIONS = ["Track", "Activity", "Reports", "Meds", "Privacy"];

export default function HealthMiniAppCard({ category, onOpen }: {
  // Name, icon and color ride live off the real category so a renamed or
  // recolored Health area never goes stale here; only the section names are
  // fixed content, per the handoff (no queries behind them).
  category: { name: string; color: ColorSlot; icon?: string };
  onOpen: () => void;
}) {
  return (
    <div className="lib-row health-mini-app" {...pressable(onOpen)}>
      <div className={"lib-ico lib-disc cat-bg-" + category.color}>{catIcon(category.icon)}</div>
      <div className="lib-stack">
        <div className="health-head">
          <div className="lib-name">{category.name}</div>
          {/* The count is a fact about the card, in the app's own state-word
              type, so it reads as a label and never as a control. */}
          <span className="fact st gray">{capAfterNumber(`${HEALTH_SECTIONS.length} Sections`)}</span>
        </div>
        {/* THESE ARE LABELS, NOT BUTTONS. The whole card is the door (above),
            so each name says what is inside rather than offering its own tap.
            They wear the .uchip treatment -- the app's own non-interactive
            label chip, a colour on its matching tint -- rather than an
            outline, because an outlined pill reads as a button and this app
            does not ship a button that does nothing. They sit at reading size
            instead of uchip's 10px small caps: a section name is a word to
            read, not a state word to glance at. */}
        <div className="health-sections">
          {HEALTH_SECTIONS.map((s) => (
            <span className="health-chip" key={s}>{s}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
