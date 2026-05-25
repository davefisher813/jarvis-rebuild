import { useEffect, useState } from "react";
import type { AIService } from "../ai/AIService";
import { useAIContext, todayISO } from "../ai/useAIContext";
import { suggestionsSystemPrompt, parseSuggestions } from "../ai/suggestions";

const ZAP = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
);
const CHEV = (
  <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
);

// Proactive nudges on Today. Reads context, asks the AI (via /api/ai). Hidden
// when AI is off (e.g. the demo) so nothing looks broken; dismiss clears a nudge.
export default function TodaySuggestions({ ai }: { ai: AIService }) {
  const gather = useAIContext();
  const [items, setItems] = useState<string[] | null>(null); // null = loading
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!ai.available) return;
    let on = true;
    (async () => {
      try {
        const ctx = await gather();
        const raw = await ai.complete([{ role: "user", content: "What should I focus on today?" }], suggestionsSystemPrompt(ctx, todayISO()));
        if (on) setItems(parseSuggestions(raw));
      } catch {
        if (on) setItems([]);
      }
    })();
    return () => { on = false; };
  }, [ai, gather]);

  if (!ai.available) return null;

  const visible = items ? items.map((t, i) => ({ t, i })).filter((x) => !dismissed.has(x.i)) : [];
  if (items && visible.length === 0) return null;

  return (
    <>
      <div className="sec-head">
        <div className="sec-left">
          <div className="sec-ico ico-accent">{ZAP}</div>
          <div className="sec-title">JARVIS Suggestions</div>
        </div>
      </div>
      <div className="pad-x"><div className="card">
        {items === null ? (
          <div className="suggestion-row"><div className="sug-title sug-dim">Thinking about your day...</div></div>
        ) : (
          visible.map((x) => (
            <div className="suggestion-row" role="button" tabIndex={0} key={x.i} onClick={() => setDismissed((d) => new Set(d).add(x.i))}>
              <div className="sug-title">{x.t}</div>
              {CHEV}
            </div>
          ))
        )}
      </div></div>
    </>
  );
}
