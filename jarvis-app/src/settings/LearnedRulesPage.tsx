import { useCallback, useEffect, useState } from "react";
import { useRules } from "../data/NotesProvider";
import LargeTitleNav from "../shared/LargeTitleNav";
import { attemptWrite } from "../shared/guard";
import { showToast } from "../shared/toast";
import type { LearnedRule } from "../rules/LearnedRulesService";

// What JARVIS Learned (addendum item 25 + unification law): the ONE
// auditable, deletable list governing every learned behavior. Each rule
// shows its evidence (facts, not editable) and has a real Delete. Deleting
// the row fully reverts the behavior; there is nothing else to turn off.
export default function LearnedRulesPage({ onBack }: { onBack: () => void }) {
  const svc = useRules();
  const [rules, setRules] = useState<LearnedRule[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    setRules(await svc.list());
    setLoaded(true);
  }, [svc]);
  useEffect(() => { void reload(); }, [reload]);

  // B10/B12 (2026-08-24): the delete says which row it is working on (keyed,
  // because this is a list and a lone boolean would grey every button), and
  // it hands back the way to change your mind.
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
    <div className="screen">
      <LargeTitleNav title="What JARVIS Learned" back="Settings" onBack={onBack} />
      <div className="pad-x">
        {loaded && rules.length === 0 && (
          // B14: rules are EARNED, so a button here would be a lie. The sub
          // says what earns one instead of leaving a bare title.
          <div className="empty-state"><div className="empty-title">Nothing Learned Yet</div>
            <div className="empty-sub">Correct JARVIS the same way twice and the rule lands here</div></div>
        )}
        {rules.length > 0 && (
          <div className="card">
            {rules.map((r) => (
              <div key={r.id} className="row">
                <div className="row-stack">
                  <div className="conn-name">{r.data.from} means {r.data.to}</div>
                  {r.data.evidence.map((e, i) => (
                    <div key={i} className="conn-meta">{e}</div>
                  ))}
                </div>
                <button className="btn-sm" disabled={removing === r.id} onClick={() => void remove(r)}>{removing === r.id ? "..." : "Delete"}</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
