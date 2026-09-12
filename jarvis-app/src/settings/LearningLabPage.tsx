import { useEffect, useState } from "react";
import LargeTitleNav from "../shared/LargeTitleNav";
import { useOptionalStrands } from "../data/NotesProvider";
import { todayISO } from "../ai/useAIContext";
import ReadinessPanel, { useReadiness } from "../brain/strands/ReadinessPanel";
import type { Strand } from "../brain/strands/types";

// THE LEARNING LAB (C-39, Astra, 2026-09-12). The numbers behind each
// detector: the window they read, the day's pass, and for every detector its
// have over its need and the sentence saying what it is still waiting for.
// This is the instrument What JARVIS Knows carried since 2026-09-06, moved
// under Settings so the Knows page can say one word per detector and leave
// the arithmetic here. Same read, same rows, same gates: nothing about the
// instrument changed but its address.
export default function LearningLabPage({ onBack }: { onBack: () => void }) {
  const svc = useOptionalStrands();
  const [strands, setStrands] = useState<Strand[]>([]);
  useEffect(() => {
    if (!svc) return;
    let live = true;
    void svc.list().then((l) => { if (live) setStrands(l); });
    return () => { live = false; };
  }, [svc]);
  const read = useReadiness(strands);
  return (
    <div className="screen ruled">
      <LargeTitleNav title="Learning Lab" back="Advanced" onBack={onBack} />
      <ReadinessPanel read={read} today={todayISO()} variant="lab" />
      <div className="screen-foot" />
    </div>
  );
}
