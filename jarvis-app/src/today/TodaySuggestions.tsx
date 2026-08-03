import { useCallback, useEffect, useState } from "react";
import type { AIService } from "../ai/AIService";
import { useAIContext, todayISO } from "../ai/useAIContext";
import { suggestionsSystemPrompt, parseSuggestions, type Suggestion } from "../ai/suggestions";
import { useTasks, useProfile, useBrainDocs } from "../data/NotesProvider";
import { haptics } from "../shared/haptics";
import { showToast } from "../shared/toast";
import { patternObservation, isPatternDismissed, dismissPattern, appendHabit, type PatternObservation } from "./patterns";
import { emit } from "../events";
import { rankOpen } from "../upnext/upnext";

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
  const docs = useBrainDocs();
  const today = todayISO();
  const [cache, setCache] = useState<DayCache | null | undefined>(undefined); // undefined = loading
  // Pattern awareness (Phase 2 stretch): one deterministic observation from
  // the check-in history, pinned above the AI rows. Works with AI off too.
  const [pattern, setPattern] = useState<PatternObservation | null>(null);
  // Texts of the tasks already visible in Up Next: a suggestion that echoes
  // one of them is repetition, not value (Dave 2026-07-30), and is hidden.
  const [visibleTaskTexts, setVisibleTaskTexts] = useState<Set<string> | null>(null);

  const persist = useCallback((c: DayCache) => { setCache(c); writeCache(today, c); }, [today]);

  useEffect(() => {
    let on = true;
    tasksSvc.listTasks().then((items) => {
      if (!on) return;
      setVisibleTaskTexts(new Set(rankOpen(items, today).slice(0, 3).map((t) => t.data.text.toLowerCase())));
    });
    return () => { on = false; };
  }, [tasksSvc, today]);

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

  // "JARVIS Noticed" shows at most ONE row, and only when it says something no
  // visible list already says: the deterministic pattern first, else the first
  // AI suggestion that does not echo an Up Next task. Most days: nothing, and
  // nothing renders. Repetition is not value.
  const aiOn = ai.available && cache !== null;
  const items = aiOn ? cache?.items ?? null : null;
  const hidden = new Set([...(cache?.dismissed ?? []), ...(cache?.acted ?? [])]);
  const nonEcho = items
    ? items
        .map((s, i) => ({ s, i }))
        .filter((x) => !hidden.has(x.i))
        .filter((x) => !x.s.task || !visibleTaskTexts?.has(x.s.task.toLowerCase()))
    : [];
  const aiPick = !pattern && visibleTaskTexts !== null ? nonEcho[0] ?? null : null;
  if (!pattern && !aiPick) return null;

  const addToToday = async (idx: number, taskText: string) => {
    const all = await tasksSvc.listTasks();
    const hit = all.find((t) => !t.data.done && t.data.text.toLowerCase() === taskText.toLowerCase());
    if (hit) await tasksSvc.setDue(hit.id, today);
    haptics.success();
    // Accepted vs dismissed is how the Brain learns what a "proper
    // suggestion" means for this user (durable log, Session 6.5).
    emit({ type: "suggestion.accepted", props: { kind: "ai" } });
    if (cache) persist({ ...cache, acted: [...cache.acted, idx] });
  };
  const dismiss = (idx: number) => {
    haptics.selection();
    emit({ type: "suggestion.dismissed", props: { kind: "ai" } });
    if (cache) persist({ ...cache, dismissed: [...cache.dismissed, idx] });
  };

  return (
    <>
      <div className="sec-head">
        <div className="sec-left">
          <div className="sec-ico ico-good">{ZAP}</div>
          <div className="sec-title">JARVIS Noticed</div>
        </div>
        <button
          className="see-all quiet-action"
          aria-label="Dismiss"
          onClick={() => {
            haptics.selection();
            if (pattern) { dismissPattern(pattern.id, today); setPattern(null); emit({ type: "suggestion.dismissed", props: { kind: "pattern" } }); }
            else if (aiPick) dismiss(aiPick.i);
          }}
        >
          &times;
        </button>
      </div>
      <div className="pad-x"><div className="card">
        {pattern ? (
          <div className="suggestion-row" key={"pattern-" + pattern.id}>
            <div className="sug-title">{pattern.text}</div>
            <button
              className="btn-sm"
              onClick={async () => {
                // The writable Brain: an approved observation becomes a habit
                // every AI feature knows. Explicit tap only, never silent.
                haptics.selection();
                const cur = await docs.get("habits");
                await docs.save("habits", appendHabit(cur, pattern.text, today));
                dismissPattern(pattern.id, today);
                setPattern(null);
                emit({ type: "suggestion.accepted", props: { kind: "pattern" } });
                showToast({ message: "Saved to your Brain" });
              }}
            >
              Remember This
            </button>
          </div>
        ) : aiPick ? (
          <div className="suggestion-row" key={aiPick.i}>
            <div className="sug-title">{aiPick.s.text}</div>
            {aiPick.s.task ? (
              <button className="btn-sm" onClick={() => addToToday(aiPick.i, aiPick.s.task!)}>Add to Today</button>
            ) : null}
          </div>
        ) : null}
      </div></div>
    </>
  );
}
