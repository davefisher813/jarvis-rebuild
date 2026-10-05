// THE AI HUB (docs/jarvis-unified, IMPLEMENTATION-SPEC.md 01, 09; slice 04).
// Under Brain, three tabs and nothing more: Agents, Review, Activity. Every
// visible action goes to the substrate's functions; nothing here decides
// anything on its own. The screen inherits section 09's states: a skeleton
// on first load only, saved content with a quiet line on a failed refresh,
// an empty state only after an empty answer, an offline banner that disables
// writes and keeps everything readable.

import { useCallback, useEffect, useState } from "react";
import PageHeader from "../shared/PageHeader";
import SkeletonRows from "../shared/SkeletonRows";
import { usePushDepth } from "../shared/pushNav";
import { showToast } from "../shared/toast";
import { attemptWrite } from "../shared/guard";
import { supabase } from "../auth/supabaseClient";
import { useAccessToken, useOptionalProfile, useOptionalTasks } from "../data/NotesProvider";
import { getAIControl, setAIControl } from "../ai/levelStore";
import { useAdminAiBlocked } from "../ai/useAdminAiGate";
import { DEFAULT_AI_LEVEL, type AIControlState } from "../ai/aiGate";
import { COMMAND_LINES, failure, type CommandFailure } from "../substrate/commands/errors";
import { ADMIN_OFF, HUB_TITLE, NOTE_NOT_FOUND, TABS, sweepLine, type ActivityFilter, type HubTab } from "./copy";
import { checkDependencies, hubOverview, addManualAssistant, sweepExpiredShares, type HubOverview, type ProposalSegment, type RpcClient } from "./hubClient";
import AgentsTab from "./AgentsTab";
import AgentDetail from "./AgentDetail";
import ContextPreview from "./ContextPreview";
import ReviewTab from "./ReviewTab";
import DecisionDetail from "./DecisionDetail";
import ActivityTab from "./ActivityTab";
import ReceiptDetail from "./ReceiptDetail";
import { AddAssistantSheet } from "./sheets";
import type { DependencyOption } from "./DecisionSheet";

type Screen =
  | { kind: "root" }
  | { kind: "agent"; id: string }
  | { kind: "preview"; connectionId: string | null; projectId: string }
  | { kind: "decision"; itemId: string }
  | { kind: "receipt"; actionId: string };

export const OFFLINE_LINE = "Offline · Showing Saved Data";
export const REFRESH_FAILED = "Couldn't Refresh · Showing Saved Data";

export default function HubFlow({ onBack, onOpenEntity, onOpenEmail, client: given, initialTab = "agents" }: {
  onBack: () => void;
  onOpenEntity?: (kind: string, id: string) => void;
  onOpenEmail?: () => void;
  /** The session's client. A test passes a fake; undefined means the app's. */
  client?: RpcClient | null;
  initialTab?: HubTab;
}) {
  const client: RpcClient | null = given === undefined ? supabase : given;
  const [tab, setTab] = useState<HubTab>(initialTab);
  const [screen, setScreen] = useState<Screen>({ kind: "root" });
  const [overview, setOverview] = useState<HubOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<CommandFailure | null>(null);
  const [offline, setOffline] = useState(typeof navigator !== "undefined" && navigator.onLine === false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [segment, setSegment] = useState<ProposalSegment>("decided");
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [refreshKey, setRefreshKey] = useState(0);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const pushCls = usePushDepth(screen.kind === "root" ? 0 : 1);

  const load = useCallback(async (check = false) => {
    if (!client) { setLoading(false); setError(failure("UNAVAILABLE")); return; }
    setLoading(true);
    if (check) await checkDependencies(client);
    const r = await hubOverview(client);
    if (r.ok) {
      setOverview(r.value);
      setError(null);
      setProjectId((p) => p && r.value.projects.some((x) => x.id === p) ? p : r.value.projects[0]?.id ?? null);
    } else setError(r);
    setLoading(false);
    setRefreshKey((k) => k + 1);
  }, [client]);
  useEffect(() => { void load(true); }, [load]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const on = () => { setOffline(false); void load(); };
    const off = () => setOffline(true);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, [load]);

  // The AI switch, the same truth AI Control writes: the profile, mirrored
  // into the session the instant it is tapped, put back if the write fails.
  const profile = useOptionalProfile();
  const adminOff = useAdminAiBlocked();
  const [ctrl, setCtrl] = useState<AIControlState>(() => getAIControl());
  const aiOn = !adminOff && ctrl.level !== "off";
  // Clear Expired Shares: the context sweep, on the person's own tap (nothing in this deployment runs on a timer).
  const token = useAccessToken();
  const [sweeping, setSweeping] = useState(false);
  const sweep = async () => {
    if (sweeping) return;
    setSweeping(true);
    const r = await sweepExpiredShares(token);
    setSweeping(false);
    showToast({ message: r.ok ? sweepLine(r.value.expired, r.value.purged) : COMMAND_LINES[r.code] });
  };
  const toggleAI = async () => {
    if (adminOff) { showToast({ message: ADMIN_OFF }); return; }
    if (!profile) { showToast({ message: COMMAND_LINES.UNAVAILABLE }); return; }
    const prev = ctrl;
    const next: AIControlState = aiOn ? { ...ctrl, level: "off" } : { ...ctrl, level: DEFAULT_AI_LEVEL };
    setCtrl(next); setAIControl(next);
    const ok = await attemptWrite(() => profile.save({ ai: next }));
    if (!ok) { setCtrl(prev); setAIControl(prev); }
  };

  // The project's open tasks, as dependency options for a decision.
  const tasks = useOptionalTasks();
  const [taskOptions, setTaskOptions] = useState<DependencyOption[]>([]);
  useEffect(() => {
    let on = true;
    if (!tasks || !projectId) { setTaskOptions([]); return; }
    void tasks.listTasks().then((list) => {
      if (!on) return;
      setTaskOptions(list.filter((t) => (t.data as { projectId?: string }).projectId === projectId && !t.data.done)
        .map((t) => ({ id: t.id, label: t.data.text || "Task", kindLabel: "Task" })));
    }).catch(() => { if (on) setTaskOptions([]); });
    return () => { on = false; };
  }, [tasks, projectId, refreshKey]);

  const changed = async () => { await load(); };

  const add = async (name: string) => {
    if (!client) return;
    setBusy("add");
    const r = await addManualAssistant(client, name);
    setBusy(null);
    if (!r.ok) { showToast({ message: COMMAND_LINES[r.code] }); return; }
    setAdding(false);
    showToast({ message: `Added Assistant · ${name}` });
    await load();
    setScreen({ kind: "agent", id: r.value.connection_id });
  };

  // A kept exploration lives in Review > Mentioned, under its project: the Hub
  // opens it itself, because the shell's Notes screen cannot load one and landed
  // on an empty editor (2026-10-04). A note that is no longer in the overview
  // says so and stays put.
  const openItem = onOpenEntity ? (kind: string, id: string) => {
    if (kind !== "exploration") { onOpenEntity(kind, id); return; }
    const note = overview?.exploration_notes.find((n) => n.id === id);
    if (!note) { showToast({ message: NOTE_NOT_FOUND }); return; }
    if (note.project_id) setProjectId(note.project_id);
    setSegment("mentioned");
    setTab("review");
    setScreen({ kind: "root" });
  } : undefined;
  const connectionOf = (id: string) => overview?.connections.find((c) => c.id === id) ?? null;
  const projectTitle = (id: string) => overview?.projects.find((p) => p.id === id)?.title ?? "Project";

  if (client && overview && screen.kind === "agent") {
    const c = connectionOf(screen.id);
    if (c) return <div className={pushCls}><AgentDetail client={client} connection={c} projects={overview.projects} aiAllowed={aiOn} adminOff={adminOff} offline={offline}
      onBack={() => setScreen({ kind: "root" })} onChanged={changed} onPreview={(connectionId, pid) => setScreen({ kind: "preview", connectionId, projectId: pid })} /></div>;
  }
  if (client && overview && screen.kind === "preview") {
    return <div className={pushCls}><ContextPreview client={client} connection={screen.connectionId ? connectionOf(screen.connectionId) : null} projectId={screen.projectId} projectTitle={projectTitle(screen.projectId)} offline={offline}
      onBack={() => setScreen(screen.connectionId ? { kind: "agent", id: screen.connectionId } : { kind: "root" })}
      onImported={() => { void load(); setProjectId(screen.projectId); setSegment("mentioned"); setTab("review"); setScreen({ kind: "root" }); }} /></div>;
  }
  if (client && overview && screen.kind === "decision") {
    return <div className={pushCls}><DecisionDetail client={client} itemId={screen.itemId} overview={overview} offline={offline} taskOptions={taskOptions}
      onBack={() => setScreen({ kind: "root" })} onChanged={changed} onOpenItem={openItem} /></div>;
  }
  if (client && screen.kind === "receipt") {
    return <div className={pushCls}><ReceiptDetail client={client} actionId={screen.actionId} offline={offline} back={HUB_TITLE} onBack={() => setScreen({ kind: "root" })} onChanged={changed} onOpenItem={openItem} /></div>;
  }

  return (
    <div className={"screen ruled hub " + pushCls}>
      <PageHeader title={HUB_TITLE} back="Brain" onBack={onBack}>
        <div className="pad-x">
          <div className="segmented" role="tablist" aria-label="AI Hub">
            {TABS.map((t) => (
              <button key={t.key} role="tab" aria-selected={tab === t.key} className={"seg" + (tab === t.key ? " active" : "")} onClick={() => setTab(t.key)}>{t.label}</button>
            ))}
          </div>
        </div>
      </PageHeader>

      {offline && <div className="hub-note">{OFFLINE_LINE}</div>}
      {loading && !overview && <SkeletonRows rows={3} />}
      {error && !overview && !loading && (
        <div className="pad-x"><div className="card list-card-ruled">
          <div className="row"><div className="row-grow"><div className="conn-name">{COMMAND_LINES[error.code]}</div></div></div>
          <button className="row row-act hub-quiet" onClick={() => void load(true)}>Retry</button>
        </div></div>
      )}
      {error && overview && (
        <div className="pad-x"><div className="card list-card-ruled">
          <div className="row"><div className="conn-name">{REFRESH_FAILED}</div></div>
          <button className="row row-act hub-quiet" onClick={() => void load()}>Retry</button>
        </div></div>
      )}

      {overview && client && tab === "agents" && (
        <AgentsTab connections={overview.connections} aiOn={aiOn} adminOff={adminOff} canToggle={!!profile} onToggleAI={() => void toggleAI()}
          onOpenAgent={(id) => setScreen({ kind: "agent", id })} onAdd={() => setAdding(true)} onSweep={() => void sweep()} sweeping={sweeping} />
      )}
      {overview && client && tab === "review" && (
        <ReviewTab client={client} overview={overview} projectId={projectId} onPickProject={setProjectId} segment={segment} onSegment={setSegment} offline={offline} taskOptions={taskOptions}
          onOpenDecision={(itemId) => setScreen({ kind: "decision", itemId })} onOpenEmail={onOpenEmail} onImport={(pid) => setScreen({ kind: "preview", connectionId: null, projectId: pid })} onChanged={changed} />
      )}
      {overview && client && tab === "activity" && (
        <ActivityTab client={client} overview={overview} refreshKey={refreshKey} filter={filter} onFilter={setFilter}
          onOpenReceipt={(actionId) => setScreen({ kind: "receipt", actionId })} onOpenDecision={(itemId) => setScreen({ kind: "decision", itemId })} onOpenEmail={onOpenEmail} onOpenReview={() => setTab("review")} />
      )}
      <div className="screen-foot" />
      {adding && <AddAssistantSheet busy={busy === "add"} onSave={(n) => void add(n)} onCancel={() => setAdding(false)} />}
    </div>
  );
}
