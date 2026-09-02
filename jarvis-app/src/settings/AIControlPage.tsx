import { useEffect, useState } from "react";
import { useProfile, useAccessToken } from "../data/NotesProvider";
import LargeTitleNav from "../shared/LargeTitleNav";
import { haptics } from "../shared/haptics";
import { apiUrl } from "../shared/apiBase";
import { AI_LEVELS, DEFAULT_AI_LEVEL, type AIControlState, type AILevel, type AIPinKey } from "../ai/aiGate";
import { setAIControl } from "../ai/levelStore";
import { Head, Card, Row, Menu } from "./kit";

const LEVEL_LABEL: Record<AILevel, string> = {
  everything: "Everything",
  draft: "Draft Only",
  request: "On Request",
  off: "Off",
};
const LEVEL_SUB: Record<AILevel, string> = {
  everything: "Acts · Receipts + undo · You send",
  draft: "Drafts ready · Nothing acts",
  request: "Only when you ask",
  off: "Zero AI calls · Nothing deleted",
};
const PIN_LABEL: Record<AIPinKey, string> = {
  emailDrafts: "Email Drafts",
  morningPlan: "Morning Plan",
  pasteFallback: "Paste Fallback",
  messageDrafts: "Message Drafts",
  estimates: "Estimates",
};
const PIN_KEYS: AIPinKey[] = ["emailDrafts", "morningPlan", "pasteFallback", "messageDrafts", "estimates"];
// Every pin is a menu (2026-09-02): the old row cycled on tap, so the
// fifth option cost four taps and nobody knew there were five.
const PIN_OPTIONS = [{ value: "match", label: "Match Master" }, ...AI_LEVELS.map((l) => ({ value: l, label: LEVEL_LABEL[l] }))];

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

  const apply = async (next: AIControlState) => {
    setCtrl(next);
    setAIControl(next);
    await svc.save({ ai: next });
  };
  const setLevel = (level: AILevel) => { haptics.selection(); void apply({ ...ctrl, level }); };
  const setPin = (key: AIPinKey, v: string) => {
    haptics.selection();
    void apply({ ...ctrl, pins: { ...ctrl.pins, [key]: v as AILevel | "match" } });
  };

  return (
    <div className="screen ruled">
      <LargeTitleNav title="AI Control" back="Settings" onBack={onBack} />
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
      <Head label="What Ran" />
      <Card>
        <Row label="AI Calls Today" value={count === null ? "Not tracked" : String(count)} onClick={calls.length ? () => setShowCalls(!showCalls) : undefined} />
        {showCalls && calls.map((c, i) => (
          <Row key={i} label={kindLabel(c.kind)} value={new Date(c.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} className="set-sub" />
        ))}
      </Card>
      <div className="screen-foot" />
    </div>
  );
}
