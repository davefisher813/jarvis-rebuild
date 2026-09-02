import type { ReactNode } from "react";

// THE LENS (ruled 2026-09-01): one tab, three zoom levels. Tasks is where the
// day lands; Projects and Goals are the same tree, further up. A segmented
// control under the page head, the app's own .segmented, remembered within
// the session and reset on launch (the same rule the filter chips follow).
export type LifeSegment = "tasks" | "projects" | "goals";
export const LIFE_SEGMENTS: { key: LifeSegment; label: string }[] = [
  { key: "tasks", label: "Tasks" },
  { key: "projects", label: "Projects" },
  { key: "goals", label: "Goals" },
];

export default function LifeSegments({ value, onPick }: { value: LifeSegment; onPick: (s: LifeSegment) => void }): ReactNode {
  return (
    <div className="pad-x life-seg">
      <div className="segmented" role="tablist" aria-label="Life">
        {LIFE_SEGMENTS.map((s) => (
          <button key={s.key} role="tab" aria-selected={s.key === value}
            className={"seg" + (s.key === value ? " active" : "")}
            onClick={() => { if (s.key !== value) onPick(s.key); }}>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
