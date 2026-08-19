import { useCallback, useEffect, useState } from "react";
import type { AIService } from "../ai/AIService";
import { useAIContext, todayISO } from "../ai/useAIContext";
import { suggestionsSystemPrompt, parseSuggestions, type Suggestion } from "../ai/suggestions";
import { useTasks, useProfile, useBrainDocs, useSchedule, useRoutine } from "../data/NotesProvider";
import { haptics } from "../shared/haptics";
import { showToast } from "../shared/toast";
import { patternObservation, isPatternDismissed, dismissPattern, appendHabit, type PatternObservation } from "./patterns";
import { planningPatternObservation, readDurationCorrections } from "./planningPatterns";
import { routineBlockCandidate } from "./routinePatterns";
import type { ProtectedBlock } from "../routine/types";
import { emit } from "../events";
import { rankOpen } from "../upnext/upnext";

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
  const scheduleSvc = useSchedule();
  const routineSvc = useRoutine();
  const today = todayISO();
  const [cache, setCache] = useState<DayCache | null | undefined>(undefined); // undefined = loading
  // Pattern awareness (Phase 2 stretch): one deterministic observation from
  // the check-in history, pinned above the AI rows. Works with AI off too.
  // A pattern row is an observation plus what accepting it DOES. Habit rows
  // write the habits doc (the original pipeline); routine rows (2026-08-09)
  // append a learned block to the routine itself. Same dismiss memory, same
  // one-row rule, different landing place for the tap.
  const [pattern, setPattern] = useState<(PatternObservation & { routineBlock?: ProtectedBlock }) | null>(null);
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
    void (async () => {
      const [prof, events, routine] = await Promise.all([
        profileSvc.get(),
        scheduleSvc.listEvents(),
        routineSvc.get(),
      ]);
      if (!on) return;
      // Priority when several exist: mood (wellbeing outranks everything),
      // then a learned routine block (structure beats a tip), then the
      // planning-duration tip. One row, first non-dismissed candidate wins;
      // the dismiss-memory works on any observation id, unmodified.
      const routineC = routineBlockCandidate(events, routine, Date.now());
      const candidates: (PatternObservation & { routineBlock?: ProtectedBlock })[] = [
        ...(patternObservation(prof?.checkin, today) ? [patternObservation(prof?.checkin, today)!] : []),
        ...(routineC ? [{ id: routineC.id, text: routineC.text, routineBlock: routineC.block }] : []),
        ...(planningPatternObservation(readDurationCorrections(), Date.now()) ? [planningPatternObservation(readDurationCorrections(), Date.now())!] : []),
      ];
      setPattern(candidates.find((c) => !isPatternDismissed(c.id, today)) ?? null);
    })();
    return () => { on = false; };
  }, [profileSvc, scheduleSvc, routineSvc, today]);

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
      {/* No head of its own: this is one card in the Heads Up stream now
          (Dave 2026-08-19). Dismiss rides the card's own corner. */}
      <div className="pad-x"><div className="card">
        <button
          className="promo-x"
          aria-label="Dismiss"
          onClick={() => {
            haptics.selection();
            if (pattern) { dismissPattern(pattern.id, today); setPattern(null); emit({ type: "suggestion.dismissed", props: { kind: "pattern" } }); }
            else if (aiPick) dismiss(aiPick.i);
          }}
        >
          &times;
        </button>
        {pattern ? (
          <div className="suggestion-row" key={"pattern-" + pattern.id}>
            <div className="sug-title">{pattern.text}</div>
            <button
              className="btn-sm"
              onClick={async () => {
                // Explicit tap only, never silent, both paths. A habit row
                // writes the Brain doc every AI feature reads; a routine row
                // (2026-08-09) appends the learned block to the routine, so
                // the planner starts honoring it the next time it runs.
                haptics.selection();
                if (pattern.routineBlock) {
                  const r = await routineSvc.get();
                  await routineSvc.save({ protectedBlocks: [...(r.protectedBlocks ?? []), pattern.routineBlock] });
                  emit({ type: "suggestion.accepted", props: { kind: "routine" } });
                  showToast({ message: "Added to your routine" });
                } else {
                  const cur = await docs.get("habits");
                  await docs.save("habits", appendHabit(cur, pattern.text, today));
                  emit({ type: "suggestion.accepted", props: { kind: "pattern" } });
                  showToast({ message: "Saved to your Brain" });
                }
                dismissPattern(pattern.id, today);
                setPattern(null);
              }}
            >
              {pattern.routineBlock ? "Add to Routine" : "Remember This"}
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
