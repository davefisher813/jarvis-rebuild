import { useState } from "react";
import LargeTitleNav from "../shared/LargeTitleNav";
import { readGymSettings, writeGymSettings, type GymSettings } from "../gym/settings";
import { DEFAULT_BAR, DEFAULT_PLATES } from "../gym/ramp";
import { Head, Card, Switch, Foot, focusField } from "./kit";

// S5-Q32 (2026-09-04): "bar weight and plates have no control." Every plate
// calculation and warm-up ramp already reads GymSettings.barWeight/.plates
// (gym/settings.ts) -- the store, the six readers and the rackFrom fallback
// were all built; only this page's controls were missing, so every gym was
// stuck on the 45 lb-bar imperial default and a kilos gym got wrong numbers
// on every screen. The plate list below is both standard sets at once, so he
// picks the ones his rack actually has.
//
// GYM-F-19 (2026-09-05): S5-Q32 left the bar a bare number with no unit, and
// that is exactly what stopped the ramp and the plate line being right for a
// kg lifter -- the ramp handed back the 45 lb bar with a kg label on it, and
// SetStrip suppressed plate math for kg outright. Exercises have always
// carried a unit; the rack now says which one ITS numbers are in, so the two
// convert. Default lb, which is what every rack stored before this was.
/** THE PLATES A RACK OFFERS, BY UNIT (2026-10-05, Dave "he opens the app and finds nothing"): the one list held both
 *  sets at once, so a Kg rack still showed 45, 35 and 1.25 and a 45 Kg bar. Each unit shows its own standard set. A
 *  plate already on the rack that the set does not list stays on the strip (see `platesToShow`), so nothing a person
 *  chose ever disappears. */
export const PLATE_SETS: Record<"lb" | "kg", number[]> = {
  lb: [45, 35, 25, 15, 10, 5, 2.5, 1.25],
  kg: [25, 20, 15, 10, 5, 2.5, 1.25],
};
/** The bar and the plates a fresh rack of each unit starts from. Lb is what every rack stored before the unit existed. */
const START: Record<"lb" | "kg", { bar: number; plates: number[] }> = {
  lb: { bar: DEFAULT_BAR, plates: DEFAULT_PLATES },
  kg: { bar: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25] },
};
const sameList = (a: number[], b: number[]) => a.length === b.length && [...a].sort((x, y) => x - y).every((n, i) => n === [...b].sort((x, y) => x - y)[i]);

/** WHAT CHANGING THE UNIT DOES TO THE RACK. A bar or a plate list still sitting on the OTHER unit's starting values is
 *  swapped for this unit's (a 45 Kg bar is wrong, and so is a pound set under a Kg label); one the person has set
 *  themselves is kept as typed, because it is theirs. Same unit, nothing changes. */
export function rackForUnit(cur: { rackUnit: "lb" | "kg"; barWeight: number; plates: number[] }, unit: "lb" | "kg"): { rackUnit: "lb" | "kg"; barWeight: number; plates: number[] } {
  if (cur.rackUnit === unit) return { rackUnit: unit, barWeight: cur.barWeight, plates: cur.plates };
  const was = START[cur.rackUnit];
  const to = START[unit];
  return {
    rackUnit: unit,
    barWeight: cur.barWeight === was.bar ? to.bar : cur.barWeight,
    plates: sameList(cur.plates, was.plates) ? [...to.plates] : cur.plates,
  };
}
/** The strip for a unit: its standard set plus anything else already on the rack, biggest first. */
export function platesToShow(unit: "lb" | "kg", on: number[]): number[] {
  return Array.from(new Set([...PLATE_SETS[unit], ...on])).sort((a, b) => b - a);
}

/** The line under "Plates on the Rack": one plain sentence in the field-note style. The unit is already shown by the
 *  Rack Unit row above it, so the note no longer opens with it (2026-10-05, a typed middle dot and "In Lb" jammed into
 *  the same line); the unit argument stays so a caller keeps one signature. */
export function rackHint(_unit: "lb" | "kg"): string {
  return "A lift logged in the other unit is converted both ways";
}

/** THE RACK, as one piece (Health Push C, H-40, 2026-09-12): Settings,
 *  Training and Health Settings both carry it, off the one gym store, so a
 *  bar set on either page is the bar the ramp and the plate line use. Last
 *  Time on Every Set rides along where the page asks for it. */
export function RackSettings({ withShowLast = false }: { withShowLast?: boolean }) {
  const [settings, setSettings] = useState<GymSettings>(() => readGymSettings());
  // 2026-10-04: the patch lands on what storage holds NOW, not on the snapshot
  // taken at mount. Health Settings writes Last Time on Every Set from a
  // sibling control, and writing {...settings, ...patch} put the stale
  // showLast back with the next plate chip, so the switch read Off while the
  // ghosts came back. Taking the fresh blob also refreshes this snapshot.
  const set = (patch: Partial<GymSettings>) => {
    const next = { ...readGymSettings(), ...patch };
    setSettings(next);
    writeGymSettings(next);
  };
  // Local text so a backspace-to-empty mid-edit does not snap back to the
  // last valid number every keystroke; only a real positive number ever
  // reaches the store (a blank or 0 bar is nonsense rackFrom would have to
  // guess around anyway).
  const [barInput, setBarInput] = useState(String(settings.barWeight));
  const rackUnit = settings.rackUnit === "kg" ? "kg" : "lb";
  const switchUnit = (u: "lb" | "kg") => {
    const cur = readGymSettings();
    const next = rackForUnit({ rackUnit: cur.rackUnit === "kg" ? "kg" : "lb", barWeight: cur.barWeight, plates: cur.plates }, u);
    set(next);
    setBarInput(String(next.barWeight));
  };
  const togglePlate = (p: number) => {
    const plates = settings.plates.includes(p) ? settings.plates.filter((x) => x !== p) : [...settings.plates, p];
    set({ plates });
  };
  return (
    <>
      <Card>
        {withShowLast && (
          <Switch label="Last Time on Every Set" meta="Last Session Beside Each Set, with Tap-to-Match" on={settings.showLast}
            onToggle={() => set({ showLast: !settings.showLast })} />
        )}
        {/* Row tap (Dave 2026-09-15, "I want all rows clickable"): the row flips between the two units; each half still
            picks its own. TWO SEGMENTS, NOT A SCROLLING CHIP STRIP (2026-10-05): the strip clipped its right edge, so Kg
            drew as a sliced pill. A segmented control is whole by construction and sits at the row's right. */}
        <div className="row set-row" onClick={() => switchUnit(rackUnit === "lb" ? "kg" : "lb")}>
          <div className="conn-name">Rack Unit</div>
          <div className="segmented set-seg" role="group" aria-label="Rack Unit">
            {(["lb", "kg"] as const).map((u) => (
              <button key={u} type="button" className={"seg" + (rackUnit === u ? " active" : "")}
                aria-pressed={rackUnit === u} onClick={(e) => { e.stopPropagation(); switchUnit(u); }}>{u === "kg" ? "Kg" : "Lb"}</button>
            ))}
          </div>
        </div>
        <div className="row set-row" onClick={focusField}>
          <div className="conn-name">Bar Weight</div>
          <input className="set-field set-field-unit" type="number" inputMode="decimal" aria-label="Bar Weight" value={barInput}
            onChange={(e) => {
              setBarInput(e.target.value);
              const n = Number(e.target.value);
              if (e.target.value !== "" && Number.isFinite(n) && n > 0) set({ barWeight: n });
            }}
            onBlur={() => setBarInput(String(settings.barWeight))} />
          <span className="set-unit" aria-hidden="true">{rackUnit === "kg" ? "Kg" : "Lb"}</span>
        </div>
      </Card>
      {/* THE UNIT NOTE SITS UNDER THE UNIT (2026-10-05, the round 2 review: it hung under the Plates card two cards below Rack Unit, so it read as a
          note about plates). It is the foot of the card that holds Rack Unit and Bar Weight, the two things it explains. */}
      <Foot>{rackHint(rackUnit)}</Foot>
      {/* THE PLATES ARE A GROUP LIKE ANY OTHER (2026-10-05, found rendering Training at 390 wide): a bold label, a note and a
          bare chip strip floated under the card in a third style. Its own quiet head, its own card, and the note under it. */}
      <Head label="Plates on the Rack" />
      <Card>
        {/* row-tap: chip strip, every inch of it is one of the plate chips */}
        <div className="row set-row">
          <div className="chip-row chip-wrap-row">
            {platesToShow(rackUnit, settings.plates).map((p) => (
              <div key={p} className={"chip" + (settings.plates.includes(p) ? " active" : "")} role="button" tabIndex={0}
                aria-pressed={settings.plates.includes(p)} onClick={() => togglePlate(p)}>{p}</div>
            ))}
          </div>
        </div>
      </Card>
      {/* The plates card says what a tap on a chip does, because nothing else on the screen does. */}
      <Foot>Tap a plate to turn it off or on</Foot>
    </>
  );
}

export default function TrainingPage({ onBack }: { onBack: () => void }) {
  return (
    <div className="screen ruled">
      <LargeTitleNav title="Training" back="Settings" onBack={onBack} />
      <Head label="In the Gym" />
      <RackSettings withShowLast />
      <div className="screen-foot" />
    </div>
  );
}
