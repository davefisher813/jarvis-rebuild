import { useCallback, useEffect, useLayoutEffect, useState } from "react";
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
import { detectorGlyph, detectorTone } from "./strands/detectorGlyph";
import { pressable } from "../shared/pressable";
import { attemptWrite } from "../shared/guard";
import { showToast } from "../shared/toast";
import { haptics } from "../shared/haptics";
import { filledIcon } from "../shared/filledIcons";
import RowStar from "../shared/RowStar";
import { lineCase } from "../shared/casing";
import RowCtxAction from "../shared/RowCtxAction";
import RowShell from "./RowShell";
import RowSheet from "./RowSheet";
import type { ReadMemo } from "./strands/ReadinessPanel";

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
//
// CLEAN ROWS (Dave 2026-10-05, locked). No capsule sits on a row here any more. A row opens its sheet (a fading fact
// opens What JARVIS Knows' own sheet, whose first answer is Still True; a proposed rule or principle opens
// RowSheet with every answer), swipe left is the row's one quickest answer, and because these rows are asking
// for it right now (Needs You is the band of things waiting on him) that same answer is the one quiet word on the row.
// The facts are model-written sentences, so each is drawn in Title Case (Alfred 2026-10-04, "Brainstorms best at night").

type Need =
  | { kind: "fading"; s: Strand }
  // C-56: a draft-edit rule waiting for a word. C-63: a possible principle.
  | { kind: "writing"; p: WritingProposal }
  | { kind: "principle"; d: Derived };

// A default of `[]` written in the parameter list is a NEW array on every render, and `areas` is a dependency of the
// read below: a caller that passes none would re-read, set state, re-render and re-read without end.
const NO_AREAS: string[] = [];
const NEEDS_CAP = 2;
const WATCHING_CAP = 2;
const SHAPING_CAP = 3;

/** What the hub last knew, kept by BrainFlow so a back from a page paints the bands at once instead of empty. */
export interface TopMemo extends ReadMemo {
  strands?: Strand[];
  proposals?: WritingProposal[];
  principle?: Derived | null;
  bands?: number;
}

export default function BrainTop({ onOpenFact, onOpenWatching, onBands, areas = NO_AREAS, memo }: {
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
  /** The hub's memory of its last read (BrainFlow keeps it across the screens that open over the hub). */
  memo?: TopMemo;
}) {
  const svc = useOptionalStrands();
  const rulesSvc = useOptionalRules();
  const decisionsSvc = useOptionalDecisions();
  const today = todayISO();
  const [strands, setStrands] = useState<Strand[]>(memo?.strands ?? []);
  const [proposals, setProposals] = useState<WritingProposal[]>(memo?.proposals ?? []);
  const [principle, setPrinciple] = useState<Derived | null>(memo?.principle ?? null);
  const [tick, setTick] = useState(0);
  const [asking, setAsking] = useState<Need | null>(null);
  const reload = useCallback(async () => {
    if (svc) { const list = await svc.list(); setStrands(list); if (memo) memo.strands = list; }
    try { if (rulesSvc) { const ps = writingProposals(await rulesSvc.list()); setProposals(ps); if (memo) memo.proposals = ps; } } catch { /* no proposals */ }
    try {
      if (decisionsSvc && areas.length > 0) {
        const ds = await decisionsSvc.list();
        const d = derivePrinciple(ds.map((x) => ({ id: x.id, decision: x.data.decision, ruledOut: x.data.ruledOut, links: linksOf(x.data), ruleStrandId: x.data.ruleStrandId, createdAt: x.data.createdAt })), areas);
        const p = d && !principleAnswered(d.strandText, today) ? d : null;
        setPrinciple(p);
        if (memo) memo.principle = p;
      }
    } catch { /* no principle */ }
  }, [svc, rulesSvc, decisionsSvc, areas, today, tick]);
  useEffect(() => { void reload(); }, [reload]);
  // The same read What JARVIS Knows makes, skipped entirely when there is no
  // strand store to put a band over (a harness, a tree outside the provider).
  const read = useReadiness(strands, svc !== null, memo);

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
    ...faded.map((s): Need => ({ kind: "fading", s })),
    ...proposals.map((p): Need => ({ kind: "writing", p })),
    ...(principle && !principleHeld ? [{ kind: "principle" as const, d: principle }] : []),
  ].slice(0, NEEDS_CAP);
  // WATCHING IS NOT A NEED (Dave 2026-10-05, the review: "'Needs You' rows say nothing is needed"). A detector past its
  // close share is JARVIS counting, and nothing is asked of him until it speaks, so it sits in a band of its own after
  // Needs You instead of among the things that are waiting on him.
  const watching = read.rows.filter((r) => isWatching(r.state)).slice(0, WATCHING_CAP);

  const bands = (shaping.length > 0 ? 1 : 0) + (needs.length > 0 ? 1 : 0) + (watching.length > 0 ? 1 : 0);
  // Before paint, so the Explore head over the nav list is there on the frame the hub returns on, not a beat after.
  useLayoutEffect(() => { if (memo) memo.bands = bands; onBands?.(bands); }, [bands, onBands, memo]);

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
    if (!id) { showToast({ message: "The Brain Is Full · Prune It in What JARVIS Knows" }); return; }
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
      showToast({ message: outcome === "full" ? "The Brain Is Full · Prune It in What JARVIS Knows" : "Saved to Values" });
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
          <div className="pad-x"><div className="card list-card-ruled glyph-rows">
            {shaping.map((s) => {
              const st = stateForStrand(s, today);
              const rr = s.data.source === "watched" || s.data.source === "uploaded" ? readinessFor(s) : undefined;
              const conf = rr ? confidenceWord(rr.have, rr.need) : null;
              return (
                <div {...pressable(() => onOpenFact(s.id))} className="row strand-row" key={s.id}>
                  <RowStar on={!!s.data.link} />
                  <div className="lib-ico cat-fg-purple">{filledIcon("knows")}</div>
                  <div className="row-grow">
                    <div className="conn-name">{lineCase(s.data.text)}</div>
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
          <div className="pad-x"><div className="card list-card-ruled shell-rows glyph-rows">
            {needs.map((n) => n.kind === "writing" ? (
              <RowShell key={"w-" + n.p.rule.id} verb={{ label: "That's Right", run: () => void confirmWriting(n.p) }}>
                <div {...pressable(() => setAsking(n))} className="row strand-row">
                  <div className="lib-ico cat-fg-purple">{filledIcon("writing")}</div>
                  <div className="row-grow">
                    <div className="conn-name">{lineCase(n.p.text)}</div>
                    <div className="facts"><span className="fact st warn">Needs Confirmation</span><span className="fact">{lineCase(`${n.p.edits} edits`)}</span></div>
                  </div>
                  <RowCtxAction when label="That's Right" ariaLabel={"That's Right, " + lineCase(n.p.text)} onAct={() => void confirmWriting(n.p)} />
                </div>
              </RowShell>
            ) : n.kind === "principle" ? (
              <RowShell key="principle" verb={{ label: "That's Right", run: () => void answerPrincipleWith(n.d, "right") }}>
                <div {...pressable(() => setAsking(n))} className="row strand-row">
                  <div className="lib-ico cat-fg-purple">{filledIcon("values")}</div>
                  <div className="row-grow">
                    <div className="conn-name">{lineCase(n.d.title)}</div>
                    <div className="facts"><span className="fact st warn">Needs Confirmation</span><span className="fact">{lineCase(n.d.sub)}</span></div>
                  </div>
                  <RowCtxAction when label="That's Right" ariaLabel={"That's Right, " + lineCase(n.d.title)} onAct={() => void answerPrincipleWith(n.d, "right")} />
                </div>
              </RowShell>
            ) : (
              <RowShell key={n.s.id} verb={{ label: "Still True", run: () => void confirm(n.s) }}>
                <div {...pressable(() => onOpenFact(n.s.id))} className="row strand-row">
                  <RowStar on={!!n.s.data.link} />
                  <div className="lib-ico cat-fg-purple">{filledIcon("knows")}</div>
                  <div className="row-grow">
                    <div className="conn-name">{lineCase(n.s.data.text)}</div>
                    {/* The same fading row What JARVIS Knows draws (§AK, one
                        grey): Fading already says it has gone a season, the
                        sheet gives the day it was last confirmed, and the one
                        grey is the category. */}
                    <div className="facts">
                      <span className="fact st warn">Fading</span>
                      <span className="fact">{STRAND_CATEGORY_LABEL[n.s.data.category]}</span>
                    </div>
                  </div>
                  {/* Fading is the moment: the same answer as the swipe, as one quiet word. */}
                  <RowCtxAction when label="Still True" ariaLabel={"Still True, " + lineCase(n.s.data.text)} onAct={() => void confirm(n.s)} />
                </div>
              </RowShell>
            ))}
          </div></div>
        </>
      )}
      {watching.length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Watching</span><span className="n">{watching.length}</span></div>
          <div className="pad-x"><div className="card list-card-ruled shell-rows glyph-rows">
            {watching.map((r) => (
              <RowShell key={"w-" + r.key}>
                <div {...pressable(() => onOpenWatching(r.key))} className="row strand-row needs-watch-row">
                  {/* The detector's own glyph, bare like the Explore rows below it (one icon style on the screen, round 2
                      review) and in its subject's tone (a task's red, training's green, a person's teal), never a grey disc.
                      The one grey is how far it has got: the head says Watching, so no row repeats the word (Dave
                      2026-10-05, the review). */}
                  <div className={"lib-ico " + detectorTone(r.key)}>{detectorGlyph(r.key)}</div>
                  <div className="row-grow">
                    <div className="conn-name">{r.label}</div>
                    <div className="facts"><span className="fact">{watchingCount(r)}</span></div>
                  </div>
                  <div className="chev" />
                </div>
              </RowShell>
            ))}
          </div></div>
        </>
      )}
      {asking && asking.kind === "writing" && (
        <RowSheet eyebrow="Needs Confirmation" text={lineCase(asking.p.text)} facts={<span className="fact">{lineCase(`${asking.p.edits} edits`)}</span>}
          answers={[{ label: "That's Right", onPick: () => void confirmWriting(asking.p) }]} onClose={() => setAsking(null)} />
      )}
      {asking && asking.kind === "principle" && (
        <RowSheet eyebrow="Needs Confirmation" text={lineCase(asking.d.title)} facts={<span className="fact">{lineCase(asking.d.sub)}</span>}
          answers={[
            { label: "That's Right", onPick: () => void answerPrincipleWith(asking.d, "right") },
            { label: "Only Sometimes", onPick: () => void answerPrincipleWith(asking.d, "sometimes") },
            { label: "Not True", onPick: () => void answerPrincipleWith(asking.d, "never") },
          ]} onClose={() => setAsking(null)} />
      )}
    </>
  );
}
