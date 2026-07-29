import { useCallback, useEffect, useState } from "react";
import type { AIService } from "../ai/AIService";
import { useAIContext, todayISO } from "../ai/useAIContext";
import { suggestionsSystemPrompt, parseSuggestions, type Suggestion } from "../ai/suggestions";
import { useTasks, useProfile } from "../data/NotesProvider";
import { haptics } from "../shared/haptics";
import { patternObservation, isPatternDismissed, dismissPattern, type PatternObservation } from "./patterns";

const ZAP = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
);

// Proactive nudges on Today, made actionable and polite:
// - one AI call per day (cached on device), so no burn on every open
// - yesterday's and today's suggestions are passed back as "do not repeat"
// - a suggestion tied to a real task gets a one-tap "Add To Today"
// - dismissals persist for the day (an assistant that re-nags gets deleted)
type DayCache = { items: Suggestion[]; dismissed: number[]; acted: number[] };
const KEY = (d: string) => "jarvis.suggestions." + d;

function readCache(d: string): DayCache | null {
  try { return JSON.parse(localStorage.getItem(KEY(d)) || "null") as DayCache | null; } catch { return null; }
}
function writeCache(d: string, c: DayCache) {
  try { localStorage.setItem(KEY(d), JSON.stringify(c)); } catch { /* private mode */ }
}

export default function TodaySuggestions({ ai }: { ai: AIService }) {
  const gather = useAIContext();
  const tasksSvc = useTasks();
  const profileSvc = useProfile();
  const today = todayISO();
  const [cache, setCache] = useState<DayCache | null | undefined>(undefined); // undefined = loading
  // Pattern awareness (Phase 2 stretch): one deterministic observation from
  // the check-in history, pinned above the AI rows. Works with AI off too.
  const [pattern, setPattern] = useState<PatternObservation | null>(null);

  const persist = useCallback((c: DayCache) => { setCache(c); writeCache(today, c); }, [today]);

  useEffect(() => {
    let on = true;
    profileSvc.get().then((prof) => {
      if (!on) return;
      const o = patternObservation(prof?.checkin, today);
      setPattern(o && !isPatternDismissed(o.id, today) ? o : null);
    });
    return () => { on = false; };
  }, [profileSvc, today]);

  useEffect(() => {
    if (!ai.available) return;
    const existing = readCache(today);
    if (existing) { setCache(existing); return; }
    let on = true;
    (async () => {
      try {
        const ctx = await gather();
        const yesterday = readCache(todayISO(new Date(Date.now() - 86400000)));
        const avoid = (yesterday?.items ?? []).map((s) => s.text);
        const raw = await ai.complete(
          [{ role: "user", content: "What should I focus on today?" }],
          suggestionsSystemPrompt(ctx, today, avoid),
        );
        if (!on) return;
        const c: DayCache = { items: parseSuggestions(raw), dismissed: [], acted: [] };
        setCache(c); writeCache(today, c);
      } catch {
        if (on) setCache(null);
      }
    })();
    return () => { on = false; };
  }, [ai, gather, today]);

  // AI rows render when AI is on and produced something; the pattern row
  // renders on its own merit. Nothing at all to show = no section.
  const aiOn = ai.available && cache !== null;
  const items = aiOn ? cache?.items ?? null : null;
  const hidden = new Set([...(cache?.dismissed ?? []), ...(cache?.acted ?? [])]);
  const visible = items ? items.map((s, i) => ({ s, i })).filter((x) => !hidden.has(x.i)) : [];
  const aiEmpty = !aiOn || (items !== null && visible.length === 0);
  if (aiEmpty && !pattern) return null;

  const addToToday = async (idx: number, taskText: string) => {
    const all = await tasksSvc.listTasks();
    const hit = all.find((t) => !t.data.done && t.data.text.toLowerCase() === taskText.toLowerCase());
    if (hit) await tasksSvc.setDue(hit.id, today);
    haptics.success();
    if (cache) persist({ ...cache, acted: [...cache.acted, idx] });
  };
  const dismiss = (idx: number) => {
    haptics.selection();
    if (cache) persist({ ...cache, dismissed: [...cache.dismissed, idx] });
  };

  return (
    <>
      <div className="sec-head">
        <div className="sec-left">
          <div className="sec-ico ico-accent">{ZAP}</div>
          <div className="sec-title">JARVIS Suggestions</div>
        </div>
      </div>
      <div className="pad-x"><div className="card">
        {pattern && (
          <div className="suggestion-row" key={"pattern-" + pattern.id}>
            <div className="sug-title">{pattern.text}</div>
            <button className="conn-remove" aria-label="Dismiss" onClick={() => { haptics.selection(); dismissPattern(pattern.id, today); setPattern(null); }}>&times;</button>
          </div>
        )}
        {aiOn && cache === undefined ? (
          <div className="suggestion-row"><div className="sug-title sug-dim">Thinking about your day...</div></div>
        ) : (
          visible.map((x) => (
            <div className="suggestion-row" key={x.i}>
              <div className="sug-title">{x.s.text}</div>
              {x.s.task ? (
                <button className="btn-sm" onClick={() => addToToday(x.i, x.s.task!)}>Add To Today</button>
              ) : null}
              <button className="conn-remove" aria-label="Dismiss" onClick={() => dismiss(x.i)}>&times;</button>
            </div>
          ))
        )}
      </div></div>
    </>
  );
}
