import { useCallback, useEffect, useState } from "react";
import { useRules } from "../data/NotesProvider";
import LargeTitleNav from "../shared/LargeTitleNav";
import { attemptWrite } from "../shared/guard";
import { showToast } from "../shared/toast";
import type { LearnedRule } from "../rules/LearnedRulesService";
import { Head, Card, Row } from "./kit";

export default function LearnedRulesPage({ onBack }: { onBack: () => void }) {
  const svc = useRules();
  const [rules, setRules] = useState<LearnedRule[]>([]);
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => {
    setRules(await svc.list());
    setLoaded(true);
  }, [svc]);
  useEffect(() => { void reload(); }, [reload]);

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
              <Row key={r.id} label={`${r.data.from} means ${r.data.to}`}
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
