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

  const remove = async (r: LearnedRule) => {
    const ok = await attemptWrite(() => svc.delete(r.id));
    await reload();
    if (ok) showToast({ message: "Rule deleted. JARVIS will ask again instead." });
  };

  return (
    <div className="screen">
      <LargeTitleNav title="What JARVIS Learned" back="Settings" onBack={onBack} />
      <div className="pad-x">
        {loaded && rules.length === 0 && (
          <div className="empty-state"><div className="empty-title">Nothing learned yet</div></div>
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
                <button className="btn-sm" onClick={() => void remove(r)}>Delete</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
