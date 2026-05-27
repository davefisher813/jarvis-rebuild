import { useCallback, useEffect, useState } from "react";
import { useTasks, useSchedule, useCategories, useMoney } from "../data/NotesProvider";
import { todayISO } from "../ai/useAIContext";
import { catColor } from "../shared/categories";
import { ACCOUNT_META, formatMoney, type Account } from "../money/types";
import { eventsThisWeek, openTasksByArea, accountBars, maxValue, type Bar } from "./insights";

const CHART = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>;

function BarChart({ bars }: { bars: Bar[] }) {
  const max = maxValue(bars) || 1;
  return (
    <div className="card">
      {bars.map((b, i) => (
        <div className="chart-row" key={i}>
          <div className="chart-label">{b.label}</div>
          <div className="chart-track"><div className={"chart-fill cat-bg-" + b.slot} style={{ width: Math.max(4, Math.round((b.value / max) * 100)) + "%" }} /></div>
          <div className="chart-val">{b.display}</div>
        </div>
      ))}
    </div>
  );
}

export default function InsightsFlow() {
  const tasksSvc = useTasks(); const sched = useSchedule(); const catsSvc = useCategories(); const moneySvc = useMoney();
  const [week, setWeek] = useState<Bar[]>([]);
  const [byArea, setByArea] = useState<Bar[]>([]);
  const [accts, setAccts] = useState<Bar[]>([]);
  const [hasMoney, setHasMoney] = useState(false);

  const reload = useCallback(async () => {
    const [tasks, events, cats, money] = await Promise.all([tasksSvc.listTasks(), sched.listEvents(), catsSvc.list(), moneySvc.list()]);
    const catMeta = cats.map((c) => ({ id: c.id, name: c.data.name, slot: catColor(c.id) }));
    setWeek(eventsThisWeek(events, todayISO()));
    setByArea(openTasksByArea(tasks, catMeta));
    const accounts = money as Account[];
    setHasMoney(accounts.length > 0);
    setAccts(accountBars(accounts, (k) => ACCOUNT_META[k as keyof typeof ACCOUNT_META].slot, formatMoney));
  }, [tasksSvc, sched, catsSvc, moneySvc]);
  useEffect(() => { void reload(); }, [reload]);

  const weekTotal = week.reduce((s, b) => s + b.value, 0);
  const nothing = weekTotal === 0 && byArea.length === 0 && !hasMoney;

  if (nothing) {
    return (
      <div className="screen">
        <div className="nav-bar"><div className="nav-large">Insights</div></div>
        <div className="empty-state"><div className="empty-icon">{CHART}</div><div className="empty-title">Nothing to chart yet</div>
          <div className="empty-sub">Add events, tasks, or accounts and your trends show up here.</div></div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="nav-bar"><div className="nav-large">Insights</div></div>
      {weekTotal > 0 && (<>
        <div className="sec-head"><div className="sec-left"><div className="sec-title">This week</div></div><div className="chart-cap">{weekTotal} events</div></div>
        <div className="pad-x"><BarChart bars={week} /></div>
      </>)}
      {byArea.length > 0 && (<>
        <div className="sec-head"><div className="sec-left"><div className="sec-title">Open tasks by area</div></div></div>
        <div className="pad-x"><BarChart bars={byArea} /></div>
      </>)}
      {hasMoney && (<>
        <div className="sec-head"><div className="sec-left"><div className="sec-title">Accounts</div></div></div>
        <div className="pad-x"><BarChart bars={accts} /></div>
      </>)}
      <div className="screen-foot" />
    </div>
  );
}
