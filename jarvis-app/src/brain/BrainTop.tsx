import { useCallback, useEffect, useState } from "react";
import { useOptionalStrands, useOptionalRules, useOptionalDecisions } from "../data/NotesProvider";
import { writingProposals, type WritingProposal } from "./writingProposals";
import { derivePrinciple, answerPrinciple, principleAnswered } from "./principle";
import type { Derived } from "./derive";
import type { LearnedRule } from "../rules/LearnedRulesService";
import { linksOf } from "../decisions/types";
import { todayISO } from "../ai/useAIContext";
import { rankForRecall, fadedStrands } from "./recall";
import { useReadiness } from "./strands/ReadinessPanel";
import { stateForStrand, toneForStrandState, STRAND_STATE_LABEL, confidenceWord, isWatching } from "./strands/state";
import { NO_PATTERN_TWIN, STRAND_CATEGORY_LABEL, type Strand } from "./strands/types";
import { watchingCount, type Readiness } from "./readiness";
import { pressable } from "../shared/pressable";
import { attemptWrite } from "../shared/guard";
import { showToast } from "../shared/toast";
import { haptics } from "../shared/haptics";
import { filledIcon } from "../shared/filledIcons";
import RowStar from "../shared/RowStar";
import { lineCase } from "../shared/casing";

// THE BRAIN'S LIVE TOP (C-38, Astra, 2026-09-12). Two bands above the nav
// list. Both heads are quiet grey like every other head (Dave's pick,
// 2026-09-26: the red "live top" exemption is gone; Today's Now is the one
// red head in the app):
//
//   Shaping JARVIS Now  up to three active strands, ranked by rankForRecall,
//                       which is the order the AI reads them in. Each row is
//                       the What JARVIS Knows row (StrandsPage): purple
//                       glyph, the fact, one facts line (the state word in
//                       caps, Rule, a green High, then ONE grey: the fact's
//                       category). Where a fact is used lives on its sheet
//                       (Dave 2026-09-26, the pass-off).
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
  | { kind: "fading"; s: Strand }
  // C-56: a draft-edit rule waiting for a word. C-63: a possible principle.
  | { kind: "writing"; p: WritingProposal }
  | { kind: "principle"; d: Derived };

const NEEDS_CAP = 2;
const SHAPING_CAP = 3;

export default function BrainTop({ onOpenFact, onOpenWatching, onBands, areas = [] }: {
  onOpenFact: (id: string) => void;
  // C-38 fix (2026-09-13, Dave: "whatever you click on, that's not what
  // you're clicking on"): every watching row called this with no way to say
  // WHICH readiness detector was tapped, so any of them landed on the exact
  // same generic screen state. The key lets the destination land on and
  // highlight the one he actually tapped.
  onOpenWatching: (key: string) => void;
  /** How many bands rendered, so the page can put its Explore head over the nav list. */
  onBands?: (n: number) => void;
  /** C-63: the user's live area names, for the values detector. */
  areas?: string[];
}) {
  const svc = useOptionalStrands();
  const rulesSvc = useOptionalRules();
  const decisionsSvc = useOptionalDecisions();
  const today = todayISO();
  const [strands, setStrands] = useState<Strand[]>([]);
  const [proposals, setProposals] = useState<WritingProposal[]>([]);
  const [principle, setPrinciple] = useState<Derived | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(async () => {
    if (svc) setStrands(await svc.list());
    try { if (rulesSvc) setProposals(writingProposals(await rulesSvc.list())); } catch { /* no proposals */ }
    try {
      if (decisionsSvc && areas.length > 0) {
        const ds = await decisionsSvc.list();
        const d = derivePrinciple(ds.map((x) => ({ id: x.id, decision: x.data.decision, ruledOut: x.data.ruledOut, links: linksOf(x.data), ruleStrandId: x.data.ruleStrandId, createdAt: x.data.createdAt })), areas);
        setPrinciple(d && !principleAnswered(d.strandText, today) ? d : null);
      }
    } catch { /* no principle */ }
  }, [svc, rulesSvc, decisionsSvc, areas, today, tick]);
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
  // A principle already held as a strand is not a question.
  const principleHeld = principle ? strands.some((s) => s.data.text === principle.strandText) : false;
  const needs: Need[] = [
    ...read.rows.filter((r) => isWatching(r.state)).map((r): Need => ({ kind: "watching", r })),
    ...faded.map((s): Need => ({ kind: "fading", s })),
    ...proposals.map((p): Need => ({ kind: "writing", p })),
    ...(principle && !principleHeld ? [{ kind: "principle" as const, d: principle }] : []),
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

  // C-56: That's Right on a draft-edit rule. The strand lands on the email
  // channel and the rule is marked announced; the row leaves.
  const confirmWriting = async (p: WritingProposal) => {
    if (!svc || !rulesSvc) return;
    haptics.selection();
    let id: string | null = null;
    const ok = await attemptWrite(async () => {
      id = await svc.add(p.text, "writing", today, "influence", "pattern");
      if (id) { const made = (await svc.list()).find((s) => s.id === id); if (made) await svc.setChannel(made, "email"); }
      await rulesSvc.markAnnounced(p.rule as LearnedRule);
    });
    if (!ok) return;
    if (!id) { showToast({ message: "The Brain is full · Prune it in What JARVIS Knows" }); return; }
    showToast({ message: "Saved to Writing" });
    setTick((t) => t + 1);
  };
  // C-63: the three answers. That's Right writes the values strand through
  // accept (watched, with its receipts) and marks it a principle; the other
  // two rest or close the question on this device.
  const answerPrincipleWith = async (d: Derived, answer: "right" | "sometimes" | "never") => {
    if (!svc) return;
    haptics.selection();
    if (answer === "right") {
      let outcome: string | null = null;
      const ok = await attemptWrite(async () => {
        const r = await svc.accept(d.strandText, "values", d.derivation, d.evidence, today);
        outcome = r.outcome;
        if (r.outcome === "created") { const made = (await svc.list()).find((s) => s.id === r.id); if (made) await svc.setType(made, "principle"); }
      });
      if (!ok) return;
      showToast({ message: outcome === "full" ? "The Brain is full · Prune it in What JARVIS Knows" : "Saved to Values" });
    } else {
      answerPrinciple(d.strandText, answer, today);
      showToast({ message: answer === "sometimes" ? "Asked again in a month" : "Closed" });
    }
    setTick((t) => t + 1);
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
          <div className="sh2 sh2-quiet"><span className="t">Shaping JARVIS Now</span><span className="n">{shaping.length}</span></div>
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
                      {/* §AM, 2026-09-26: Rule is a state word like Known,
                          so it wears none of the key's colours (it is not
                          late, due or done). Confidence says High only:
                          High is on track, green; Medium, a fact at its
                          gate, is what Learned already says, and amber
                          would claim it needs him. */}
                      {s.data.strength === "rule" && <span className="fact st">Rule</span>}
                      {conf === "High" && <span className="fact good">High</span>}
                      {/* THE ROW'S ONE GREY IS THE CATEGORY (Dave 2026-09-26,
                          the pass-off: "KNOWN · Work Style"). The Used By
                          list sat here: static per category, identical on
                          every fact in it, and cut off at 390px. It is on
                          the fact's sheet, where there is room to read it.
                          The row is now the What JARVIS Knows row, as its
                          comment always claimed. */}
                      <span className="fact">{STRAND_CATEGORY_LABEL[s.data.category]}</span>
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
          <div className="sh2 sh2-quiet"><span className="t">Needs You</span><span className="n">{needs.length}</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {needs.map((n) => n.kind === "writing" ? (
              // row-tap: That's Right is a Brain identity write, and the locked agency law keeps those on an explicit tap of the pill
              <div className="row strand-row" key={"w-" + n.p.rule.id}>
                <div className="lib-ico lib-disc warn-disc"><span className="disc-glyph">?</span></div>
                <div className="row-grow">
                  <div className="conn-name">{n.p.text}</div>
                  <div className="facts"><span className="fact st warn">Needs Confirmation</span><span className="fact">{lineCase(`${n.p.edits} edits`)}</span></div>
                </div>
                <button type="button" className="pill-act" onClick={(ev) => { ev.stopPropagation(); void confirmWriting(n.p); }}>That's Right</button>
              </div>
            ) : n.kind === "principle" ? (
              // row-tap: That's Right is a Brain identity write, and the locked agency law keeps those on an explicit tap of the pill
              <div className="row strand-row" key="principle">
                <div className="lib-ico lib-disc warn-disc"><span className="disc-glyph">?</span></div>
                <div className="row-grow">
                  <div className="conn-name">{n.d.title}</div>
                  <div className="facts"><span className="fact st warn">Needs Confirmation</span><span className="fact">{n.d.sub}</span></div>
                  <div className="dec-outcome-acts">
                    <button type="button" className="quiet-action" onClick={(ev) => { ev.stopPropagation(); void answerPrincipleWith(n.d, "sometimes"); }}>Only Sometimes</button>
                    <button type="button" className="quiet-action" onClick={(ev) => { ev.stopPropagation(); void answerPrincipleWith(n.d, "never"); }}>Not True</button>
                  </div>
                </div>
                <button type="button" className="pill-act" onClick={(ev) => { ev.stopPropagation(); void answerPrincipleWith(n.d, "right"); }}>That's Right</button>
              </div>
            ) : n.kind === "watching" ? (
              <div {...pressable(() => onOpenWatching(n.r.key))} className="row strand-row needs-watch-row" key={"w-" + n.r.key}>
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
                  {/* The same fading row What JARVIS Knows draws (§AK, one
                      grey): Fading already says it has gone a season, the
                      sheet gives the day it was last confirmed, and the one
                      grey is the category. "264 Days Unconfirmed" beside
                      the Still True capsule clipped both the state word and
                      itself at 390px (pass-off, 2026-09-26). */}
                  <div className="facts">
                    <span className="fact st warn">Fading</span>
                    <span className="fact">{STRAND_CATEGORY_LABEL[n.s.data.category]}</span>
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
