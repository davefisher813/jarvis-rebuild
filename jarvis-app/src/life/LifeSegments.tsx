import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

// THE LENS (ruled 2026-09-01): one tab, three zoom levels. Tasks is where the
// day lands; Projects and Goals are the same tree, further up. A segmented
// control under the page head, the app's own .segmented, remembered within
// the session and reset on launch (the same rule the filter chips follow).
export type LifeSegment = "areas" | "tasks" | "reminders" | "projects" | "goals";
export const LIFE_SEGMENTS: { key: LifeSegment; label: string }[] = [
  // AREAS TAB (LIFE_AREAS_TAB_HANDOFF, 2026-09-16): the default entry point.
  // Browsing what's filed under an area used to mean going to Brain for the
  // name and back to Life for the work; this is the one door.
  { key: "areas", label: "Areas" },
  { key: "tasks", label: "Tasks" },
  // THE REMINDERS REBUILD (push E, 2026-09-15): the page lives here as well
  // as behind Today's See All, the same component both ways.
  { key: "reminders", label: "Reminders" },
  { key: "projects", label: "Projects" },
  { key: "goals", label: "Goals" },
];

// THE ACTIVE LENS IS ALWAYS ON SCREEN, AND THE STRIP SAYS WHEN IT SCROLLS (2026-10-05, the perfect bar: "Goals" was
// cut to "Go" at the right edge in dark and to a "C" in light, so on the Goals lens no tab looked selected, and the edge
// fade sat on a strip that fit).
//
// Two things, both measured and neither assumed. (1) The strip centres the active tab whenever the lens changes (a
// jump from Today lands on Goals with the strip at its start), by scrolling the strip itself and never the page.
// (2) The edge fade is drawn only on a side that has more behind it: `data-more` is "r", "l", "lr" or "" from the
// strip's own scroll position, so a strip that fits (the usual case at 390 now that the tabs are set to fit) wears no
// fade over its last word, and one that does not (Dynamic Type) fades the side it continues on.
function moreOf(box: HTMLElement): string {
  const max = box.scrollWidth - box.clientWidth;
  if (max <= 1) return "";
  return (box.scrollLeft > 1 ? "l" : "") + (box.scrollLeft < max - 1 ? "r" : "");
}

export default function LifeSegments({ value, onPick }: { value: LifeSegment; onPick: (s: LifeSegment) => void }): ReactNode {
  const box = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState("");
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const on = el.querySelector<HTMLElement>(".seg.active");
    if (on && el.scrollWidth > el.clientWidth + 1) {
      // Measured against the strip itself: offsetLeft is relative to the nearest positioned ancestor, which is not the strip.
      const left = on.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft;
      el.scrollLeft = Math.max(0, left - (el.clientWidth - on.offsetWidth) / 2);
    }
    setMore(moreOf(el));
  }, [value]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setMore(moreOf(el));
    read();
    el.addEventListener("scroll", read, { passive: true });
    window.addEventListener("resize", read);
    return () => { el.removeEventListener("scroll", read); window.removeEventListener("resize", read); };
  }, []);
  return (
    <div className="pad-x life-seg">
      <div className="segmented" role="tablist" aria-label="Life" ref={box} data-more={more}>
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
