import { useEffect, useState } from "react";
import { useProfile, useAccessToken } from "../data/NotesProvider";
import LargeTitleNav from "../shared/LargeTitleNav";
import { haptics } from "../shared/haptics";
import { apiUrl } from "../shared/apiBase";
import { AI_LEVELS, AI_PIN_KEYS, DEFAULT_AI_LEVEL, type AIControlState, type AILevel, type AIPinKey } from "../ai/aiGate";
import { setAIControl } from "../ai/levelStore";
import { estimateCost, formatTokens, formatUSD, type TokenTotals } from "../ai/tokenLog";
import { budgetMessage, formatLimit, formatMicro, type BudgetStatus } from "../ai/aiBudget";
import { clearBudgetBlock } from "../ai/budgetBlock";
import { parseDollarsToMicro } from "../ai/limitInput";
import { showToast } from "../shared/toast";
import { Head, Card, Row, Menu, Switch, focusField } from "./kit";
import { attemptWrite } from "../shared/guard";

const LEVEL_LABEL: Record<AILevel, string> = {
  everything: "Everything",
  draft: "Draft Only",
  request: "On Request",
  off: "Off",
};
const LEVEL_SUB: Record<AILevel, string> = {
  everything: "Acts with receipts and undo, you still send",
  draft: "Drafts ready, nothing acts",
  request: "Only when you ask",
  off: "Zero AI calls, nothing deleted",
};
const PIN_LABEL: Record<AIPinKey, string> = {
  emailDrafts: "Email Drafts",
  morningPlan: "Morning Plan",
  pasteFallback: "Paste Fallback",
  messageDrafts: "Message Drafts",
  estimates: "Estimates",
};
// PLUMB-F-13 (2026-09-05): was a second hand-typed copy of the same five
// names. The screen offers exactly the pins the gate declares, and no more.
const PIN_KEYS: readonly AIPinKey[] = AI_PIN_KEYS;
// Every pin is a menu (2026-09-02): the old row cycled on tap, so the
// fifth option cost four taps and nobody knew there were five.
const PIN_OPTIONS = [{ value: "match", label: "Match Master" }, ...AI_LEVELS.map((l) => ({ value: l, label: LEVEL_LABEL[l] }))];

interface Call { at: string; kind: string }

// The level to come back to when AI is switched back on (Dave 2026-09-29: one
// on/off switch). Remembered on this device only; the saved level itself is
// what decides what runs.
const RESUME_KEY = "jarvis.ai.resumeLevel";
function readResume(): AILevel {
  try {
    const v = localStorage.getItem(RESUME_KEY);
    return v && v !== "off" && (AI_LEVELS as readonly string[]).includes(v) ? (v as AILevel) : DEFAULT_AI_LEVEL;
  } catch { return DEFAULT_AI_LEVEL; }
}
function writeResume(level: AILevel): void {
  try { if (level !== "off") localStorage.setItem(RESUME_KEY, level); } catch { /* the switch still works */ }
}

/** The field's text for a limit: "5" for $5, "4.50" for $4.50. */
function limitToText(micro: number): string {
  return micro % 1_000_000 === 0 ? String(micro / 1_000_000) : (micro / 1_000_000).toFixed(2);
}

function kindLabel(kind: string): string {
  return kind ? kind.replace(/[_-]+/g, " ") : "AI call";
}

export default function AIControlPage({ onBack }: { onBack: () => void }) {
  const svc = useProfile();
  const token = useAccessToken();
  const [ctrl, setCtrl] = useState<AIControlState>({ level: DEFAULT_AI_LEVEL });
  const [count, setCount] = useState<number | null>(null);
  const [calls, setCalls] = useState<Call[]>([]);
  const [showCalls, setShowCalls] = useState(false);
  // UP-PLAT-04 (2026-09-06): what the calls cost, from ai_tokens. Empty until
  // the endpoint answers, and an empty array is a legal answer: an account
  // that ran nothing today has no tokens, and no row claims otherwise.
  const [tokens, setTokens] = useState<TokenTotals[]>([]);
  // The spending limit. Only ever what the SERVER last said: a save waits for
  // the server's answer and shows that, never a hopeful local number.
  const [budget, setBudget] = useState<BudgetStatus | null>(null);
  const [limitText, setLimitText] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void svc.get().then((p) => { if (p?.ai) setCtrl(p.ai); });
  }, [svc]);

  useEffect(() => {
    if (!token) return;
    void fetch(apiUrl("/api/ai-usage"), { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { count?: number | null; calls?: Call[]; tokens?: TokenTotals[]; budget?: BudgetStatus | null } | null) => {
        if (d) {
          setCount(d.count ?? null); setCalls(d.calls ?? []); setTokens(d.tokens ?? []);
          if (d.budget) { setBudget(d.budget); setLimitText(limitToText(d.budget.limitMicrousd)); }
        }
      })
      .catch(() => { /* the count is a fact or absent, never a guess */ });
  }, [token]);

  // SHELL-F-14 (2026-09-05): the level applied to this session and then the
  // write failed silently, so the next launch was back at the old level with
  // nothing having said so. That is the worst place in the app to be wrong
  // about what was saved: it is the setting that decides what JARVIS is
  // allowed to do on its own. On a failure the session level goes back too.
  const apply = async (next: AIControlState) => {
    const prev = ctrl;
    setCtrl(next);
    setAIControl(next);
    const ok = await attemptWrite(() => svc.save({ ai: next }));
    if (!ok) { setCtrl(prev); setAIControl(prev); }
  };
  const setLevel = (level: AILevel) => { haptics.selection(); writeResume(ctrl.level); void apply({ ...ctrl, level }); };
  // ONE SWITCH (Dave 2026-09-29): off is the "off" level, on is the level it
  // was at before, so the switch and the list below never disagree.
  const aiOn = ctrl.level !== "off";
  const toggleAI = () => {
    if (aiOn) { writeResume(ctrl.level); void apply({ ...ctrl, level: "off" }); }
    else void apply({ ...ctrl, level: readResume() });
  };
  const setPin = (key: AIPinKey, v: string) => {
    haptics.selection();
    void apply({ ...ctrl, pins: { ...ctrl.pins, [key]: v as AILevel | "match" } });
  };

  // ONE explicit Save, no write per keystroke. The new limit goes to the
  // server with the version this screen last saw; on any failure the field
  // goes back to what the server holds, so the screen never shows a limit
  // that is not in force.
  const newLimit = parseDollarsToMicro(limitText);
  const dirty = budget !== null && newLimit !== null && newLimit !== budget.limitMicrousd;
  const saveLimit = async () => {
    if (!budget || newLimit === null || saving) return;
    setSaving(true);
    try {
      const r = await fetch(apiUrl("/api/ai-usage"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ limitMicrousd: newLimit, expectedVersion: budget.version }),
      });
      const d = (await r.json().catch(() => null)) as { budget?: BudgetStatus; error?: string } | null;
      if (d?.budget) { setBudget(d.budget); setLimitText(limitToText(d.budget.limitMicrousd)); }
      else setLimitText(limitToText(budget.limitMicrousd));
      if (r.ok && d?.budget) {
        // The limit changed, so a refusal remembered from before is stale.
        clearBudgetBlock();
        showToast({ message: `Limit saved. ${formatLimit(d.budget.limitMicrousd)}.` });
      } else {
        showToast({ message: d?.error || "Limit not saved, nothing changed" });
      }
    } catch {
      setLimitText(limitToText(budget.limitMicrousd));
      showToast({ message: "Limit not saved, nothing changed" });
    } finally {
      setSaving(false);
    }
  };
  const atCap = budget !== null && !budget.paused && budget.remainingMicrousd === 0 && budget.limitMicrousd > 0;
  const budgetNote = budget === null ? null
    : budget.limitMicrousd === 0 ? budgetMessage({ code: "AI_BUDGET_OFF" })
    : budget.paused ? budgetMessage({ code: "AI_BUDGET_PAUSED" })
    : atCap ? budgetMessage({ code: "AI_BUDGET_REACHED", limitMicrousd: budget.limitMicrousd })
    : null;

  // UP-PLAT-04 (2026-09-06): "N calls, ~$0.0X". The tilde is load-bearing:
  // this is list price times measured tokens, not the invoice. So the cost
  // is an estimate and wears the key's sky (§AM, 2026-09-26), and the
  // separator between the two facts is the stylesheet's.
  const usd = estimateCost(tokens);
  const callsValue = count === null
    ? "Not tracked"
    : usd === null ? String(count) : <><span className="fact">{count}</span><span className="fact est">~{formatUSD(usd)}</span></>;
  const inTok = tokens.reduce((n, t) => n + t.inputTokens + t.cacheReadTokens + t.cacheWriteTokens, 0);
  const outTok = tokens.reduce((n, t) => n + t.outputTokens, 0);
  const tokenRow = inTok + outTok > 0 ? `${formatTokens(inTok)} in, ${formatTokens(outTok)} out` : "";

  return (
    <div className="screen ruled">
      <LargeTitleNav title="AI Control" back="Settings" onBack={onBack} />
      <Card>
        <Switch label="AI" meta={aiOn ? "On" : "Off, nothing runs"} on={aiOn} onToggle={toggleAI} ariaLabel="AI on or off" />
      </Card>
      <Head label="AI Level" />
      <Card>
        {AI_LEVELS.map((l) => (
          <div key={l} className="row set-row" role="radio" aria-checked={ctrl.level === l} tabIndex={0} onClick={() => setLevel(l)}>
            <div className="row-grow">
              <div className="conn-name">{LEVEL_LABEL[l]}</div>
              <div className="conn-meta">{LEVEL_SUB[l]}</div>
            </div>
            <div className={"radio" + (ctrl.level === l ? " on" : "")} />
          </div>
        ))}
      </Card>
      <Head label="Per-Feature" />
      <Card>
        {PIN_KEYS.map((k) => (
          <Menu key={k} label={PIN_LABEL[k]} value={ctrl.pins?.[k] ?? "match"} options={PIN_OPTIONS} onPick={(v) => setPin(k, v)} />
        ))}
      </Card>
      {/* The spending limit (Dave, 2026-09-28, $5 default). Since the date it
          started, not per day or month: he has not chosen a period, so nothing
          here resets on its own. A balance can read a little low, because a
          call is held at its highest possible cost until it finishes. */}
      {budget ? (
        <>
          <Head label="AI Spending Limit" />
          <Card>
            <Row label={`${formatMicro(budget.remainingMicrousd)} remaining of ${formatLimit(budget.limitMicrousd)}`}
              meta={`Since ${new Date(budget.periodStart).toLocaleDateString([], { month: "short", day: "numeric" })}`} />
            {budget.heldMicrousd > 0 && (
              <Row label="Pending" value={`${formatMicro(budget.heldMicrousd, "up")} held`} className="set-sub" />
            )}
            <div className="row set-row" onClick={focusField}>
              <div className="conn-name">Limit in Dollars</div>
              <input className="set-field" type="text" inputMode="decimal" aria-label="Limit in dollars" value={limitText}
                onChange={(e) => setLimitText(e.target.value)} />
            </div>
            <Row label={saving ? "Saving" : "Save Limit"} onClick={dirty && !saving ? () => { void saveLimit(); } : undefined}
              disabled={!dirty || saving} />
          </Card>
          <div className="pad-x"><div className="input-hint">
            {budgetNote ?? "Zero turns paid AI off · A running call is held at its highest possible cost, so the balance can read a little low"}
          </div></div>
        </>
      ) : null}
      <Head label="What Ran" />
      <Card>
        <Row label="AI Calls Today" value={callsValue} onClick={calls.length ? () => setShowCalls(!showCalls) : undefined} />
        {/* UP-PLAT-04: the tokens row only exists when there are tokens. No
            row of zeros for an account that ran nothing, and no dollar figure
            for a model the price table does not know: the tokens are the
            fact, the cost is an estimate, and neither is invented. */}
        {tokenRow && <Row label="Tokens Today" value={tokenRow} className="set-sub" />}
        {showCalls && calls.map((c, i) => (
          <Row key={i} label={kindLabel(c.kind)} value={<span className="fact date">{new Date(c.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>} className="set-sub" />
        ))}
      </Card>
      <div className="screen-foot" />
    </div>
  );
}
