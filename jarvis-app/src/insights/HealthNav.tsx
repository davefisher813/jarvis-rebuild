// THE LOCAL HEALTH NAVIGATION (the approved Health design, 2026-09-14). The
// concept's bottom bar (Health, Insights, History) becomes one segmented
// control at the top of every Health page, so the app's own tab bar keeps
// its job and the three destinations are always one tap apart.
export type HealthView = "health" | "insights" | "data";

export default function HealthNav({ view, onView }: { view: HealthView; onView: (v: HealthView) => void }) {
  const tabs: { key: HealthView; label: string }[] = [
    { key: "health", label: "Health" },
    { key: "insights", label: "Insights" },
    { key: "data", label: "All Data" },
  ];
  return (
    <div className="pad-x h-tabs">
      <div className="segmented" role="tablist" aria-label="Health views">
        {tabs.map((t) => (
          <button type="button" role="tab" aria-selected={view === t.key} className={"seg" + (view === t.key ? " active" : "")} key={t.key} onClick={() => onView(t.key)}>{t.label}</button>
        ))}
      </div>
    </div>
  );
}
