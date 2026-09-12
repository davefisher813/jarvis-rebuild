import { useCallback, useEffect, useState } from "react";
import { useOptionalStrands } from "../data/NotesProvider";
import { todayISO } from "../ai/useAIContext";
import { rankForRecall, fadedStrands, daysSince } from "./recall";
import { useReadiness } from "./strands/ReadinessPanel";
import { stateForStrand, toneForStrandState, STRAND_STATE_LABEL, confidenceWord, isWatching } from "./strands/state";
import { usedBy } from "./strands/usedBy";
import { NO_PATTERN_TWIN, type Strand } from "./strands/types";
import { watchingCount, type Readiness } from "./readiness";
import { pressable } from "../shared/pressable";
import { attemptWrite } from "../shared/guard";
import { showToast } from "../shared/toast";
import { haptics } from "../shared/haptics";
import { filledIcon } from "../shared/filledIcons";
import RowStar from "../shared/RowStar";

// THE BRAIN'S LIVE TOP (C-38, Astra, 2026-09-12). Two bands above the nav
// list, both sh2 heads because they are the page's live top, not furniture:
//
//   Shaping JARVIS Now  up to three active strands, ranked by rankForRecall,
//                       which is the order the AI reads them in. Each row:
//                       purple glyph, the fact, one facts line (state word,
//                       confidence word, the surfaces that use it).
//   Needs You           capped at two, in this order: a readiness detector
//                       that is WATCHING (past CLOSE_SHARE of its gate, or
//                       past the gate and not yet accepted), then a faded
//                       strand with its Still True. Identity-level proposals
//                       (C-56 writing rules, C-63 principles) join this band
//                       when those detectors land (Push G).
//
// When both bands are empty nothing renders and the hub is the nav list it
// has been since V4. No headline count, no Recent Learning, no Coverage grid.
//
// A WATCHING row opens What JARVIS Knows under the Watching filter rather
// than running an accept here: a detector past 0.6 of its gate has not
// spoken yet, so there is no sentence to accept, and the one that has (ready)
// is offered by TodaySuggestions on that page with its evidence beside it.
// One accept flow, one place.

type Need =
  | { kind: "watching"; r: Readiness }
  | { kind: "fading"; s: Strand };

const NEEDS_CAP = 2;
const SHAPING_CAP = 3;

export default function BrainTop({ onOpenFact, onOpenWatching, onBands }: {
  onOpenFact: (id: string) => void;
  onOpenWatching: () => void;
  /** How many bands rendered, so the page can put its Explore head over the nav list. */
  onBands?: (n: number) => void;
}) {
  const svc = useOptionalStrands();
  const today = todayISO();
  const [strands, setStrands] = useState<Strand[]>([]);
  const reload = useCallback(async () => { if (svc) setStrands(await svc.list()); }, [svc]);
  useEffect(() => { void reload(); }, [reload]);
  // The same read What JARVIS Knows makes, skipped entirely when there is no
  // strand store to put a band over (a harness, a tree outside the provider).
  const read = useReadiness(strands, svc !== null);

  // A fading fact is still active and still read, but it sits in Needs You
  // with its question; one row in two bands on one screen would be the hub
  // asking and asserting the same thing at once.
  const faded = fadedStrands(strands, today);
  const fadedIds = new Set(faded.map((s) => s.id));
  const active = strands.filter((s) => s.data.status === "active" && !fadedIds.has(s.id));
  const shaping = rankForRecall(active, today).slice(0, SHAPING_CAP);
  const needs: Need[] = [
    ...read.rows.filter((r) => isWatching(r.state)).map((r): Need => ({ kind: "watching", r })),
    ...faded.map((s): Need => ({ kind: "fading", s })),
  ].slice(0, NEEDS_CAP);

  const bands = (shaping.length > 0 ? 1 : 0) + (needs.length > 0 ? 1 : 0);
  useEffect(() => { onBands?.(bands); }, [bands, onBands]);

  // C-47's Still True, here as on the list: the same confirm, guarded, with
  // a receipt. The row leaves the band because the fact is no longer faded.
  const confirm = async (s: Strand) => {
    if (!svc) return;
    haptics.selection();
    const ok = await attemptWrite(() => svc.confirm(s, today));
    if (!ok) return;
    await reload();
    showToast({ message: "Confirmed" });
  };

  if (!svc || bands === 0) return null;

  const readinessFor = (s: Strand): Readiness | undefined => {
    const d = s.data.derivation;
    if (!d) return undefined;
    return read.rows.find((r) => r.key === d || NO_PATTERN_TWIN[r.key] === d);
  };

  return (
    <>
      {shaping.length > 0 && (
        <>
          <div className="sh2"><span className="t">Shaping JARVIS Now</span><span className="n">{shaping.length}</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {shaping.map((s) => {
              const st = stateForStrand(s, today);
              const rr = s.data.source === "watched" || s.data.source === "uploaded" ? readinessFor(s) : undefined;
              const conf = rr ? confidenceWord(rr.have, rr.need) : null;
              return (
                <div {...pressable(() => onOpenFact(s.id))} className="row strand-row" key={s.id}>
                  <RowStar on={!!s.data.link} />
                  <div className="lib-ico lib-disc strand-disc">{filledIcon("knows")}</div>
                  <div className="row-grow">
                    <div className="conn-name">{s.data.text}</div>
                    <div className="facts">
                      {st && <span className={"fact st " + toneForStrandState(st)}>{STRAND_STATE_LABEL[st]}</span>}
                      {s.data.strength === "rule" && <span className="fact st red">Rule</span>}
                      {conf && <span className={"fact " + (conf === "High" ? "good" : "warn")}>{conf}</span>}
                      {usedBy(s.data.category).map((u) => <span className="fact" key={u}>{u}</span>)}
                    </div>
                  </div>
                  <div className="chev" />
                </div>
              );
            })}
          </div></div>
        </>
      )}
      {needs.length > 0 && (
        <>
          <div className="sh2"><span className="t">Needs You</span><span className="n">{needs.length}</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {needs.map((n) => n.kind === "watching" ? (
              <div {...pressable(onOpenWatching)} className="row strand-row" key={"w-" + n.r.key}>
                <div className="lib-ico lib-disc warn-disc"><span className="disc-glyph">?</span></div>
                <div className="row-grow">
                  <div className="conn-name">{n.r.label}</div>
                  <div className="facts">
                    <span className="fact st warn">Watching</span>
                    <span className="fact">{watchingCount(n.r)}</span>
                  </div>
                </div>
                <div className="chev" />
              </div>
            ) : (
              <div {...pressable(() => onOpenFact(n.s.id))} className="row strand-row" key={n.s.id}>
                <RowStar on={!!n.s.data.link} />
                <div className="lib-ico lib-disc strand-disc">{filledIcon("knows")}</div>
                <div className="row-grow">
                  <div className="conn-name">{n.s.data.text}</div>
                  <div className="facts">
                    <span className="fact st warn">Fading</span>
                    <span className="fact">{daysSince(n.s.data.lastConfirmed, today)} days unconfirmed</span>
                  </div>
                </div>
                <button type="button" className="pill-act" onClick={(ev) => { ev.stopPropagation(); void confirm(n.s); }}>Still True</button>
              </div>
            ))}
          </div></div>
        </>
      )}
    </>
  );
}
