import { useRef, useState, type MouseEvent } from "react";
import type { StillTherePattern, StillThereSummaryRow } from "../timelines";
import { pressable } from "../../shared/pressable";
import { shortDate } from "../../shared/dateFormat";
import { BODY_REGIONS } from "../regions";
import type { PointAtItDetail, PointAtItFeel, PointAtItLevel } from "../types";

// HOW IT FEELS (2026-09-14, the reference's discomfort form). After the tap,
// three optional words and a note. The spot alone is still a whole log, so
// Done with nothing picked is a real answer.
const FEELS: { value: PointAtItFeel; label: string }[] = [
  { value: "soreness", label: "Soreness" },
  { value: "pain", label: "Pain" },
  { value: "stiffness", label: "Stiffness" },
  { value: "unsure", label: "Not Sure" },
];
const LEVELS: { value: PointAtItLevel; label: string }[] = [
  { value: "mild", label: "Mild" },
  { value: "moderate", label: "Moderate" },
  { value: "severe", label: "Severe" },
];

// POINT AT IT (Part 6). A body map. Tap where it hurts. Three seconds, one
// hand, no words. No severity scale, no diagnosis, no condition name: the
// tap coordinate is the entire content of what gets logged.
//
// The tap reads a normal click event's own clientX/clientY relative to the
// map's bounding box, never raw touch coordinates, so this is not a second
// swipe/drag implementation and does not trip the one-swipe-controller law.
export default function PointAtItScreen({ patterns, summaries = [], onLog, onDetail, onBack, onHandToSomeone }: {
  patterns: StillTherePattern[];
  // HMN-F-23 (2026-09-05): the dated taps behind each pattern, in the same
  // order. The catalog calls this "a shareable dated summary of the taps",
  // and this screen's only action is handing it to a human, so the days are
  // on the screen rather than shut inside a function nobody called. Dates
  // only: no severity, no name for the spot, same restraint as the pattern.
  summaries?: StillThereSummaryRow[][];
  /** Health Push D (H-46): the fourth argument is the region's label when
   *  the log came from the list; the coordinate is the region's own. */
  onLog: (x: number, y: number, side: "front" | "back", region?: string) => void;
  /** 2026-09-14: the details typed after the tap, onto the tap just logged.
   *  Absent, the details card is not offered. */
  onDetail?: (detail: PointAtItDetail) => void;
  onBack: () => void;
  // BRAIN-F-26 (2026-09-05): absent when there is nobody to reach, so the row
  // is not offered rather than dialling a number that will not connect.
  onHandToSomeone?: () => void;
}) {
  const [side, setSide] = useState<"front" | "back">("front");
  const [mode, setMode] = useState<"map" | "list">("map");
  const [logged, setLogged] = useState<{ x: number; y: number; region?: string } | null>(null);
  const [feel, setFeel] = useState<PointAtItFeel | undefined>(undefined);
  const [level, setLevel] = useState<PointAtItLevel | undefined>(undefined);
  const [note, setNote] = useState("");
  const [detailSaved, setDetailSaved] = useState(false);
  const hasDetail = !!feel || !!level || note.trim().length > 0;
  const chips = <T extends string>(name: string, words: { value: T; label: string }[], value: T | undefined, pick: (v: T | undefined) => void) => (
    <div className="field">
      <div className="input-label">{name}</div>
      <div className="chip-row chip-wrap-row" role="group" aria-label={name}>
        {words.map((w) => (
          <div key={w.value} {...pressable(() => pick(value === w.value ? undefined : w.value))} className={"chip" + (value === w.value ? " active" : "")} aria-pressed={value === w.value}>{w.label}</div>
        ))}
      </div>
    </div>
  );
  const mapRef = useRef<HTMLDivElement | null>(null);

  const tap = (e: MouseEvent<HTMLDivElement>) => {
    // HMN-F-07 (2026-09-05): one tap, one log. The map kept logging on every
    // tap after the first, so an "adjusting" second tap made a second entry
    // (and, landing inside the first's network round trip, a third). Once
    // the spot is logged the map is done; Done closes the screen.
    if (logged) return;
    const el = mapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    setLogged({ x, y });
    onLog(x, y, side);
  };

  return (
    <div className="screen ruled health-ruled">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">Where It Hurts</div>
      </div>

      <div className="pad-x"><div className="card pad">
        <div className="p3-q">Where Is It</div>
        <div className="bp-sub">Tap the spot. That's the whole log, no name for it, no scale.</div>
      </div></div>

      {/* Health Push D (H-46): the list beside the map. A named region logs
          the same shape as a tap (its own coordinate on the same map), so
          Still There? clusters both the same way. */}
      <div className="pad-x">
        <div className="segmented">
          <button type="button" className={"seg" + (mode === "map" ? " active" : "")} onClick={() => setMode("map")}>Map</button>
          <button type="button" className={"seg" + (mode === "list" ? " active" : "")} onClick={() => setMode("list")}>List</button>
        </div>
      </div>

      {mode === "list" ? (
        <div className="pad-x"><div className="card list-card-ruled">
          {BODY_REGIONS.map((r) => (
            <div className="row" key={r.label} {...pressable(() => {
              if (logged) return;
              setLogged({ x: r.x, y: r.y, region: r.label });
              onLog(r.x, r.y, r.side, r.label);
            })} aria-disabled={logged ? "true" : undefined}>
              <div className="row-grow"><div className="conn-name">{r.label}</div></div>
            </div>
          ))}
        </div></div>
      ) : (
      <>
      <div className="pad-x">
        <div className="segmented">
          <button type="button" className={"seg" + (side === "front" ? " active" : "")} onClick={() => setSide("front")}>Front</button>
          <button type="button" className={"seg" + (side === "back" ? " active" : "")} onClick={() => setSide("back")}>Back</button>
        </div>
      </div>

      <div className="pad-x">
        {/* HMN-F-24 (2026-09-05) deliberately leaves this one alone. The map is a
            POINTING surface: tap() reads the coordinates of the tap to decide which
            part of the body was named, and a key press has no coordinates, so
            pressable() cannot forward Enter and Space to anything meaningful here.
            It keeps role="button" and its tab stop, because it is still the thing
            you interact with and a screen reader has to find it; giving a keyboard
            user a real way to name a body part is a design question, not a
            handler, and it is not this finding's. */}
        <div className="body-map" ref={mapRef} role="button" tabIndex={0} onClick={tap} aria-disabled={logged ? "true" : undefined} aria-label={"Tap where it hurts, " + side + " view"}>
          <div className="body-map-head" />
          <div className="body-map-torso" />
          <div className="body-map-arm body-map-arm-l" />
          <div className="body-map-arm body-map-arm-r" />
          <div className="body-map-leg body-map-leg-l" />
          <div className="body-map-leg body-map-leg-r" />
          {logged && (
            <span className="body-map-mark" style={{ left: (logged.x * 100) + "%", top: (logged.y * 100) + "%" }} />
          )}
        </div>
      </div>
      </>
      )}

      {logged && (
        <div className="pad-x"><div className="card pad">
          <div className="conn-name">{logged.region ? "Logged · " + logged.region : "Logged"}</div>
          {onDetail && !detailSaved && (
            <>
              <div className="bp-sub">How it feels, if you want to say. The spot alone is enough.</div>
              {chips("How It Feels", FEELS, feel, setFeel)}
              {chips("How Much", LEVELS, level, setLevel)}
              <div className="field">
                <div className="input-label">Note</div>
                <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" aria-label="Note" />
              </div>
            </>
          )}
          {onDetail && !detailSaved && hasDetail
            ? <button className="btn btn-secondary btn-block" onClick={() => { onDetail({ ...(feel ? { feel } : {}), ...(level ? { level } : {}), ...(note.trim() ? { note: note.trim() } : {}) }); setDetailSaved(true); }}>Save Details</button>
            : <button className="btn btn-secondary btn-block" onClick={onBack}>Done</button>}
        </div></div>
      )}

      {/* STILL THERE? The counted pattern, never a diagnosis: same spot,
          multiple sessions, a span of days. The only action is a human. */}
      {patterns.length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Still There?</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {patterns.map((p, i) => {
              const dates = summaries[i] ?? [];
              return (
                <div className="row" key={i}>
                  <div className="row-grow">
                    <div className="conn-name">{p.region ?? "Same Spot"}, {p.sessions} Sessions</div>
                    <div className="bp-sub">Over {p.days} days</div>
                    {dates.length > 0 && (
                      <div className="bp-sub">Tapped {dates.map((d) => shortDate(d.date)).join(", ")}</div>
                    )}
                  </div>
                </div>
              );
            })}
            {/* BRAIN-F-26 keeps the row out when there is nobody to reach;
                HMN-F-24 makes the row it does show answer Enter and Space. */}
            {onHandToSomeone && (
              <div className="row" {...pressable(onHandToSomeone)}>
                <div className="row-grow"><div className="conn-name">Hand It to Someone</div></div>
              </div>
            )}
          </div></div>
        </>
      )}
      <div className="screen-foot" />
    </div>
  );
}
