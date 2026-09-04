import { useCallback, useEffect, useState } from "react";
import { useRules, useCategories } from "../data/NotesProvider";
import LargeTitleNav from "../shared/LargeTitleNav";
import { attemptWrite } from "../shared/guard";
import { showToast } from "../shared/toast";
import type { LearnedRule } from "../rules/LearnedRulesService";
import { Head, Card, Row } from "./kit";

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
      message: "Rule deleted · JARVIS asks again",
      actionLabel: "Undo",
      onAction: () => void (async () => {
        await attemptWrite(() => svc.restore(kept));
        await reload();
      })(),
    });
  };

  return (
    <div className="screen ruled">
      <LargeTitleNav title="What JARVIS Learned" back="Settings" onBack={onBack} />
      {loaded && rules.length === 0 && (
        <div className="empty-state"><div className="empty-title">Nothing Learned Yet</div>
          <div className="empty-sub">Correct JARVIS the same way twice and the rule lands here</div></div>
      )}
      {rules.length > 0 && (
        <>
          <Head label="Rules" count={rules.length} />
          <Card>
            {rules.map((r) => (
              <Row key={r.id} label={`${label(r.data.from)} means ${label(r.data.to)}`}
                meta={r.data.evidence.map((e, i) => <div key={i}>{e}</div>)}>
                <button className="pill-act row-act-pill" disabled={removing === r.id} onClick={() => void remove(r)}>{removing === r.id ? "..." : "Delete"}</button>
              </Row>
            ))}
          </Card>
        </>
      )}
      <div className="screen-foot" />
    </div>
  );
}
