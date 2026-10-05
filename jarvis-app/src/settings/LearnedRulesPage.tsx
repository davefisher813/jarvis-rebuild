import { useCallback, useEffect, useState } from "react";
import { useRules, useCategories } from "../data/NotesProvider";
import PageHeader from "../shared/PageHeader";
import { attemptWrite } from "../shared/guard";
import { showToast } from "../shared/toast";
import type { LearnedRule } from "../rules/LearnedRulesService";
import { Head, Card, Row } from "./kit";
import { Lightbulb } from "../shared/icons";
import SwipeDelete from "../shared/SwipeDelete";
import { lineCase, titleCase } from "../shared/casing";
// UP-CORE-14 (2026-09-05): an automation tuning is a rule about a CARD, not
// about a word, so "automation.goal-nudge means less" is the database
// talking. tuningLine says it the way the app says it, and returns null for
// every other kind, which keeps the sentence this page already had.
import { tuningLine } from "../rules/tuning";

export default function LearnedRulesPage({ onBack }: { onBack: () => void }) {
  const svc = useRules();
  const catsSvc = useCategories();
  const [rules, setRules] = useState<LearnedRule[]>([]);
  const [catNames, setCatNames] = useState<Map<string, string>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => {
    const [r, cats] = await Promise.all([svc.list(), catsSvc.list()]);
    setRules(r);
    setCatNames(new Map(cats.map((c) => [c.id, c.data.name])));
    setLoaded(true);
  }, [svc, catsSvc]);
  useEffect(() => { void reload(); }, [reload]);
  // B4 (2026-09-04): a rule's from/to are whatever the recording call site
  // keyed on, and for capture.category and plan.duration that is a raw
  // category id (see QuickCapture.tsx and PlanDaySheet.tsx), not a name.
  // This is the one screen built so a person can judge and delete what
  // JARVIS learned, so it has to read like the app, not like the database:
  // resolve either side that happens to be a live category id, and leave
  // anything else (a trigger phrase, a minute count, a stale id with no
  // matching category) exactly as recorded.
  const label = (v: string) => catNames.get(v) ?? v;

  const [removing, setRemoving] = useState<string | null>(null);
  const remove = async (r: LearnedRule) => {
    if (removing) return;
    setRemoving(r.id);
    const kept = r.data;
    const ok = await attemptWrite(() => svc.delete(r.id));
    setRemoving(null);
    await reload();
    if (ok) showToast({
      message: "Rule Deleted · JARVIS Asks Again",
      actionLabel: "Undo",
      onAction: () => void (async () => {
        await attemptWrite(() => svc.restore(kept));
        await reload();
      })(),
    });
  };

  return (
    <div className="screen ruled">
      {/* ONE LINE, NOT TWO (2026-10-05, the review: the title wrapped to "What JARVIS / Learned" and made this the one Settings page with a title
          twice the height). The name stays what the app calls it everywhere; the display title steps down one size so all of it fits the line. */}
      <PageHeader title="What JARVIS Learned" back="Settings" onBack={onBack}
        hero={<div className="pagehead-title pagehead-title-fit">What JARVIS Learned</div>} />
      {loaded && rules.length === 0 && (
        <div className="empty-state empty-compact">
          {/* D9: a crafted empty state, the type's glyph and colour, the title, one warm line. */}
          <div className="empty-icon cat-fg-yellow"><Lightbulb className="ic" /></div>
          <div className="empty-title">Nothing Learned Yet</div>
          <div className="empty-sub">A Rule Lands Here After You Correct JARVIS Twice</div>
        </div>
      )}
      {rules.length > 0 && (
        <>
          <Head label="Rules" count={rules.length} />
          <Card>
            {rules.map((r) => {
              const name = tuningLine(r) ?? titleCase(`${label(r.data.from)} means ${label(r.data.to)}`);
              return (
              // One line of evidence, the latest (§AK, 2026-09-26): a rule is
              // earned by two corrections, and both drawn stacked were two
              // grey runs under one title, identical for a voice rule.
              // Rules stored before 2026-09-26 carry evidence joined with a
              // typed middle dot ("Keep going \u00b7 due today \u00b7 15m"),
              // and this line renders it, so it reads as a phrase instead.
              // CATALOG PASS (2026-10-05): the row's name and its one grey line are
              // both lines the app writes, so both are Title Case ("dentist means
              // Health" and "keep going, due today, 15m" were drawn as typed).
              // CLEAN ROW, SWIPE TO DELETE (Dave 2026-10-05, locked: no pill in a row). The Delete that was a capsule on
              // the row is the swipe's one tray button now; Undo in the toast is unchanged.
              <SwipeDelete key={r.id} label={name} enabled={removing === null} onDelete={() => void remove(r)}>
                <Row label={name}
                  meta={lineCase(r.data.evidence[r.data.evidence.length - 1]?.replace(/\s*\u00b7\s*/g, ", ") ?? "") || undefined} />
              </SwipeDelete>
              );
            })}
          </Card>
        </>
      )}
      <div className="screen-foot" />
    </div>
  );
}
