import { useEffect, useState } from "react";
import { useProfile, useAccessToken } from "../data/NotesProvider";
import LargeTitleNav from "../shared/LargeTitleNav";
import { haptics } from "../shared/haptics";
import { apiUrl } from "../shared/apiBase";
import { AI_LEVELS, DEFAULT_AI_LEVEL, type AIControlState, type AILevel, type AIPinKey } from "../ai/aiGate";
import { setAIControl } from "../ai/levelStore";

// AI Control (addendum items 18-21). One master dial, five per-feature pins,
// and What Ran. Everything applies instantly: tapping a level saves it and
// the very next AI call obeys it, client and server both. There is no Save
// button anywhere on this screen by design.

const LEVEL_LABEL: Record<AILevel, string> = {
  everything: "Everything",
  draft: "Draft Only",
  request: "On Request",
  off: "Off",
};

const LEVEL_SUB: Record<AILevel, string> = {
  everything: "Acts · receipts + undo · you send",
  draft: "Drafts ready · nothing acts",
  request: "Only when you ask",
  off: "Zero AI calls · nothing deleted",
};

const PIN_LABEL: Record<AIPinKey, string> = {
  emailDrafts: "Email Drafts",
  morningPlan: "Morning Plan",
  pasteFallback: "Paste Fallback",
  messageDrafts: "Message Drafts",
  estimates: "Estimates",
};

const PIN_KEYS: AIPinKey[] = ["emailDrafts", "morningPlan", "pasteFallback", "messageDrafts", "estimates"];
const PIN_CYCLE: (AILevel | "match")[] = ["match", "everything", "draft", "request", "off"];

interface Call { at: string; kind: string }

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

  useEffect(() => {
    void svc.get().then((p) => { if (p?.ai) setCtrl(p.ai); });
  }, [svc]);

  useEffect(() => {
    if (!token) return;
    void fetch(apiUrl("/api/ai-usage"), { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { count?: number | null; calls?: Call[] } | null) => {
        if (d) { setCount(d.count ?? null); setCalls(d.calls ?? []); }
      })
      .catch(() => { /* the count is a fact or absent, never a guess */ });
  }, [token]);

  // Applies instantly: local state, the session singleton, then the profile.
  const apply = async (next: AIControlState) => {
    setCtrl(next);
    setAIControl(next);
    await svc.save({ ai: next });
  };

  const setLevel = (level: AILevel) => { haptics.selection(); void apply({ ...ctrl, level }); };
  const cyclePin = (key: AIPinKey) => {
    haptics.selection();
    const cur = ctrl.pins?.[key] ?? "match";
    const next = PIN_CYCLE[(PIN_CYCLE.indexOf(cur) + 1) % PIN_CYCLE.length]!;
    void apply({ ...ctrl, pins: { ...ctrl.pins, [key]: next } });
  };

  return (
    <div className="screen">
      <LargeTitleNav title="AI Control" back="Settings" onBack={onBack} />
      <div className="pad-x">
        <div className="grp"><div className="eyebrow">AI Level</div></div>
        <div className="card">
          {AI_LEVELS.map((l) => (
            <div key={l} className="row" role="radio" aria-checked={ctrl.level === l} tabIndex={0} onClick={() => setLevel(l)}>
              <div className="row-stack">
                <div className="conn-name">{LEVEL_LABEL[l]}</div>
                <div className="conn-meta">{LEVEL_SUB[l]}</div>
              </div>
              <div className={"radio" + (ctrl.level === l ? " on" : "")} />
            </div>
          ))}
        </div>

        <div className="grp"><div className="eyebrow">Per-Feature</div></div>
        <div className="card">
          {PIN_KEYS.map((k) => {
            const v = ctrl.pins?.[k] ?? "match";
            return (
              <div key={k} className="row" role="button" tabIndex={0} onClick={() => cyclePin(k)}>
                <div className="row-grow"><div className="conn-name">{PIN_LABEL[k]}</div></div>
                <span className="row-value">{v === "match" ? "Match Master" : LEVEL_LABEL[v]}</span>
              </div>
            );
          })}
        </div>

        <div className="grp"><div className="eyebrow">What Ran</div></div>
        <div className="card">
          <div className="row" role="button" tabIndex={0} onClick={() => { if (calls.length) setShowCalls(!showCalls); }}>
            <div className="row-grow"><div className="conn-name">AI Calls Today</div></div>
            <span className="row-value">{count === null ? "Not tracked" : String(count)}</span>
          </div>
          {showCalls && calls.map((c, i) => (
            <div key={i} className="row">
              <div className="row-grow"><div className="conn-meta">{kindLabel(c.kind)}</div></div>
              <span className="row-value">{new Date(c.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
