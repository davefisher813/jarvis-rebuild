import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useCategories, useGoals, useProjects, useGym, useTasks, useRules, useOptionalSeal } from "../data/NotesProvider";
import type { MonthSeal, MonthSealData } from "./seal";
import { prevMonthKey, computeSeal } from "./seal";
import { readWindow, type WindowClient } from "../brain/window";
import { supabase } from "../auth/supabaseClient";
import { todayISO } from "../tasks/grouping";
import { buildReport, type MonthReport, type CarriedTask } from "./report";
import RollingNumber from "../shared/RollingNumber";
import { showToast } from "../shared/toast";
import { capAfterNumber } from "../shared/casing";
import type { TaskData } from "../notes/types";
import { TargetGlyph, CheckCircleGlyph, WarningGlyph, LockGlyph } from "../shared/glyphs";
import { filledIcon } from "../shared/filledIcons";

// THE MONTHLY REPORT (2026-08-25, built from the approved v3 preview).
// Reassurance leads, numbers and color carry it, sentences live behind the
// taps. Exactly one proposed change, and it ends in a setting, not a
// feeling. Every section renders only what its month can prove.

const SEEN_KEY = "jarvis.report.seen.v1";

export function markReportSeen(month: string): void {
  try { localStorage.setItem(SEEN_KEY, month); } catch { /* convenience only */ }
}
export function reportSeen(): string | null {
  try { return localStorage.getItem(SEEN_KEY); } catch { return null; }
}

const TARGET = <TargetGlyph />;

function ReceiptsSheet({ title, lines, onDone }: { title: string; lines: string[]; onDone: () => void }) {
  return createPortal(
    <div className="sheet-scrim" onClick={onDone}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Receipts</div></div>
        <div className="pad-x sheet-form">
          <div className="rep-question">{title}</div>
          <div className="card rep-gap">
            {lines.map((l, i) => (
              <div className="row" key={i}><div className="row-grow"><div className="rep-title">{l}</div></div></div>
            ))}
          </div>
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-secondary btn-block" onClick={onDone}>Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const WIN_TONES = ["rep-win-good", "rep-win-blue", "rep-win-purple", "rep-win-warn"];

export function ReportScreen({ report, capped, onCap, onOpenTask, onDropTask, onBack, stillOpen }: {
  report: MonthReport;
  capped: boolean;
  onCap: () => void;
  onOpenTask?: (id: string) => void;
  onDropTask?: (t: CarriedTask) => void;
  onBack: () => void;
  /** The live current month: labeled, and never marked as a seen arrival. */
  stillOpen?: boolean;
}) {
  const [receipts, setReceipts] = useState<{ title: string; lines: string[] } | null>(null);
  // The open animation: bars grow into place once, numbers roll via the
  // shared RollingNumber. One orchestrated moment, then still; reduced
  // motion gets the finished frame (CSS side).
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setGrown(true), 60);
    return () => window.clearTimeout(t);
  }, []);
  useEffect(() => { if (!stillOpen) markReportSeen(report.month); }, [report.month, stillOpen]);

  const maxHour = Math.max(1, ...report.hours?.byHour ?? [1]);

  return (
    <div className="screen ruled">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">{report.monthName}</div>
        <button className="nav-action-text" onClick={onBack}>Done</button>
      </div>

      {/* HERO: the month's one number, then its named wins. */}
      <div className="pad-x rep-hero">
        <div className="rep-eyebrow">{stillOpen ? "Your Month · Still Open" : "Your Month"}</div>
        <div className="rep-big"><RollingNumber value={Number(report.hero.big)} /></div>
        <div className="rep-big-label">
          {report.hero.label}
          {report.hero.anchor && <span className="rep-anchor">{report.hero.anchor}</span>}
        </div>
        {report.hero.wins.length > 0 && (
          <div className="rep-wins">
            {report.hero.wins.map((w) => (
              <div className={"rep-win " + (WIN_TONES[w.tone] ?? "rep-win-good")} key={w.name}>
                <div className="rep-win-name">{w.name}</div>
                <div className="rep-win-val">{w.value}</div>
              </div>
            ))}
          </div>
        )}
        <div className="rep-hint">Tap anything for its receipts</div>
      </div>

      {/* THE MONTH: tiles with deltas, the hours strip, where it went. */}
      {(report.tiles.length > 0 || report.hours || report.went || report.time) && (
        <div className="sh2 sh2-quiet"><span className="t">The Month</span></div>
      )}
      <div className="pad-x">
        {report.tiles.length > 0 && (
          <div className="rep-grid">
            {report.tiles.map((t) => (
              <div className={"stat-tile stat-" + t.tint} key={t.label}>
                <div className="stat-num">{/^\d+$/.test(t.num) ? <RollingNumber value={Number(t.num)} /> : t.num}</div>
                {t.delta && <div className={"rep-delta " + (t.delta.up ? "rep-delta-up" : "")}>{t.delta.text}</div>}
                <div className="stat-label">{t.label}</div>
              </div>
            ))}
          </div>
        )}

        {report.hours && (
          <div className="card pad rep-gap" role="button" tabIndex={0}
            onClick={() => setReceipts({ title: `Your hours: ${report.hours!.label}`, lines: [capAfterNumber(`${report.tiles.find((t) => t.label === "Done")?.num ?? 0} finishes this month; the tallest bars are your band`)] })}>
            <div className="rep-split"><span className="rep-eyebrow rep-quiet">Your Hours</span><b>{report.hours.label}</b></div>
            <div className="rep-hours">
              {report.hours.byHour.map((n, h) => (
                <i
                  key={h}
                  className={h >= report.hours!.bandStart && h < report.hours!.bandStart + 3 ? "hot" : undefined}
                  style={{ height: grown ? `${Math.max(6, Math.round((n / maxHour) * 100))}%` : "6%" }}
                />
              ))}
            </div>
          </div>
        )}

        {/* WHERE THE HOURS WENT (handoff item 13, Dave's option A). The same
            stack and legend "Where It Went" already uses, because it is the
            same shape of fact about a different unit: that one counts things
            finished, this one counts time scheduled. No target line and no
            ideal split is drawn, so there is nothing here to fall short of.
            The quiet line names live-goal areas with nothing on the calendar
            and stops there; whether that is a problem is the reader's call. */}
        {report.time && (
          <div className="card pad rep-gap">
            <div className="rep-eyebrow rep-quiet">Where the Hours Went</div>
            <div className="rep-stack">
              {report.time.rows.map((r) => (
                <i key={r.id || "rest"} className={"cat-bg-" + r.color} style={{ width: grown ? `${Math.max(4, r.pct)}%` : "25%" }} />
              ))}
            </div>
            <div className="rep-leg">
              {report.time.rows.map((r) => (
                <span key={r.id || "rest"}><i className={"cat-bg-" + r.color} />{r.name} {r.label}</span>
              ))}
            </div>
            <div className="eyebrow rep-gap">{report.time.total} on the calendar</div>
            {report.time.quiet.length > 0 && (
              <div className="eyebrow">
                Nothing scheduled for {report.time.quiet.map((q) => q.name).join(", ")}
              </div>
            )}
          </div>
        )}

        {report.went && (
          <div className="card pad rep-gap">
            <div className="rep-eyebrow rep-quiet">Where It Went</div>
            <div className="rep-stack">
              {(() => {
                const total = report.went.reduce((a, x) => a + x.n, 0) || 1;
                return report.went.map((s) => (
                  <i key={s.id} className={"cat-bg-" + s.color} style={{ width: grown ? `${Math.max(4, (s.n / total) * 100)}%` : "25%" }} />
                ));
              })()}
            </div>
            <div className="rep-leg">
              {report.went.map((s) => (
                <span key={s.id}><i className={"cat-bg-" + s.color} />{s.name} {s.n}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* WORTH A LOOK: each gap keeps its exit. */}
      {report.worth.length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Worth a Look</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {report.worth.map((w) => (
              <div key={w.id}>
                <div className="row" role="button" tabIndex={0} onClick={() => setReceipts({ title: w.title, lines: w.receipts })}>
                  {w.id === "cut" && <div className="row-glyph rep-good-glyph"><CheckCircleGlyph /></div>}
                  <div className="row-grow">
                    <div className="rep-title">{w.title}</div>
                    {w.sub && <div className="eyebrow">{w.sub}</div>}
                  </div>
                  <div className="chev" />
                </div>
                {w.id === "carried" && w.carried && w.carried.length > 0 && (onOpenTask || onDropTask) && (
                  <div className="rep-btnrow">
                    {onOpenTask && <button className="pill-act" onClick={() => onOpenTask(w.carried![0]!.id)}>Do One</button>}
                    {onDropTask && <button className="pill-act" onClick={() => onDropTask(w.carried![0]!)}>Drop One</button>}
                  </div>
                )}
              </div>
            ))}
          </div></div>
        </>
      )}

      {/* PATTERNS: one line, one number, receipts behind the tap. */}
      {report.patterns.length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Patterns</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {report.patterns.map((p) => (
              <div className="row" role="button" tabIndex={0} key={p.id} onClick={() => setReceipts({ title: p.title, lines: p.receipts })}>
                <div className="row-grow">
                  <div className="rep-title">{p.title}</div>
                  {p.sub && <div className="eyebrow">{p.sub}</div>}
                </div>
                {p.chip && <span className={"rep-chip rep-chip-" + p.chip.tone}>{p.chip.text}</span>}
                <div className="chev" />
              </div>
            ))}
          </div></div>
        </>
      )}

      {/* JARVIS: what it learned and did, the one change, the seal. */}
      {(report.learned || report.did || report.closer) && (
        <div className="sh2 sh2-quiet"><span className="t">JARVIS</span></div>
      )}
      <div className="pad-x">
        {(report.learned || report.did) && (
          <div className="card">
            {report.learned && (
              <div className="row">
                <div className="row-grow">
                  <div className="rep-title">{report.learned.title}</div>
                  {report.learned.sub && <div className="eyebrow">{report.learned.sub}</div>}
                </div>
              </div>
            )}
            {report.did && (
              <div className="row">
                <div className="row-grow">
                  <div className="rep-title">{report.did.title}</div>
                  {report.did.sub && <div className="eyebrow">{report.did.sub}</div>}
                </div>
              </div>
            )}
          </div>
        )}

        {report.closer && (
          <div className="card pad rep-one rep-gap">
            <div className="rep-eyebrow">One Change</div>
            <div className="rep-question">{report.closer.question}</div>
            <div className="rep-title rep-quiet2">{report.closer.sub}</div>
            <div className="rep-one-acts">
              {capped
                ? <button className="btn btn-block" disabled>Capped ✓</button>
                : (
                  <>
                    <button className="btn btn-primary" onClick={onCap}>Turn It On</button>
                    <button className="btn" onClick={onBack}>No Thanks</button>
                  </>
                )}
            </div>
            <div className="eyebrow rep-one-foot">{report.closer.foot}</div>
          </div>
        )}

        {/* A month still open is NOT sealed, and the lock card would be a
            lie on it; the eyebrow already says Still Open (2026-08-25). */}
        {!stillOpen && (
          <div className="card rep-gap">
            <div className="row">
              <div className="row-glyph lib-ico-neutral"><LockGlyph /></div>
              <div className="row-grow">
                <div className="rep-title">{report.sealed.title}</div>
                <div className="eyebrow">{report.sealed.sub}</div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="screen-foot" />
      {receipts && <ReceiptsSheet title={receipts.title} lines={receipts.lines} onDone={() => setReceipts(null)} />}
    </div>
  );
}

/** Loads a month's report, assembles the model, wires the actions. With no
 *  props beyond navigation it opens the latest sealed month (the arrival
 *  path). `month` opens that sealed month from the shelf. `live` builds the
 *  CURRENT month from the live window through the same computeSeal, so the
 *  page is one engine wearing one honest extra label: Still Open. */
export default function ReportFlow({ onBack, onOpenTask, month, live }: {
  onBack: () => void;
  onOpenTask?: (id: string) => void;
  month?: string;
  live?: boolean;
}) {
  const sealSvc = useOptionalSeal();
  const cats = useCategories();
  const goalsSvc = useGoals();
  const projectsSvc = useProjects();
  const gym = useGym();
  const tasksSvc = useTasks();
  const rules = useRules();
  const [report, setReport] = useState<MonthReport | null>(null);
  const [none, setNone] = useState(false);
  const [capped, setCapped] = useState(false);
  const [taskById, setTaskById] = useState<Map<string, TaskData>>(new Map());

  const load = useCallback(async () => {
    if (!sealSvc) { setNone(true); return; }
    const [seals, cs, gl, pj, ws, tk, capRule] = await Promise.all([
      sealSvc.list(),
      cats.list(),
      goalsSvc.list(),
      projectsSvc.list(),
      gym.listWorkouts(),
      tasksSvc.listTasks(),
      // S4-Q26 (2026-09-04): this used to ask profile.planCap, a field with
      // no UI to unset it. The rules list is the one place learned behaviour
      // lives (types.ts's own doctrine), so a deleted row here genuinely
      // un-caps the day and this closer can offer it again next month.
      rules.resolve("plan.cap", "day"),
    ]);
    // create() pre-announces (its own toast at creation says more than the
    // generic one would), so this is a no-op in the normal case; it stays
    // wired for the same reason every other rule reader is: consulting a
    // rule without ever confirming it announced itself is exactly the gap
    // this doctrine exists to close.
    if (capRule) await rules.announceIfFirstUse(capRule);
    let sealData: MonthSealData | null = null;
    if (live) {
      // The month in progress, through the SAME fold the boundary uses.
      const now = Date.now();
      const rows = await readWindow(supabase as unknown as WindowClient | null, now, 35);
      sealData = computeSeal(todayISO().slice(0, 7), { rows, workouts: ws, goals: gl, sealedAt: now });
    } else {
      const wanted: MonthSeal | undefined = month
        ? seals.find((x) => x.data.month === month)
        : seals[seals.length - 1];
      if (!wanted) { setNone(true); return; }
      sealData = wanted.data;
    }
    const prev = seals.find((s) => s.data.month === prevMonthKey(sealData!.month + "-15")) ?? null;
    const open = new Map(tk.filter((t) => !t.data.done).map((t) => [t.id, t.data] as const));
    setTaskById(open);
    setCapped(!!capRule);
    setReport(buildReport({
      seal: sealData,
      prev: prev?.data ?? null,
      categories: cs.map((c) => ({ id: c.id, name: c.data.name, color: c.data.color })),
      goals: gl,
      projects: pj,
      workouts: ws,
      openTaskText: (id) => open.get(id)?.text ?? null,
      alreadyCapped: !!capRule,
    }));
  }, [sealSvc, cats, goalsSvc, projectsSvc, gym, tasksSvc, rules, month, live]);
  useEffect(() => { void load(); }, [load]);

  // S4-Q26 (2026-09-04): one tap, one step. create() is idempotent and
  // announces nothing (the toast right here is the announcement), so this
  // is a real row in What JARVIS Learned the instant it fires, not a
  // pending observation waiting on a second one that will never come.
  const onCap = async () => {
    await rules.create("tuning", "plan.cap", "day", "3", "Chosen from the monthly report: first picks finish, later picks mostly do not");
    setCapped(true);
    showToast({ message: "Capped at 3 · Starting tomorrow" });
  };

  const onDropTask = async (c: CarriedTask) => {
    const data = taskById.get(c.id);
    await tasksSvc.deleteTask(c.id);
    showToast({
      message: "Task dropped",
      actionLabel: "Undo",
      onAction: async () => {
        if (data) await tasksSvc.recreateFrom(data);
        await load();
      },
    });
    await load();
  };

  if (none) {
    return (
      <div className="screen">
        <div className="nav-bar">
          <button className="nav-back" aria-label="Back" onClick={onBack}></button>
          <div className="nav-title">Your Month</div>
          <span className="nav-action"></span>
        </div>
        <div className="empty-state">
          <div className="empty-icon">{TARGET}</div>
          <div className="empty-title">No Month Sealed Yet</div>
          <div className="empty-sub">Your first report arrives on the 1st, unannounced</div>
        </div>
      </div>
    );
  }
  if (!report) return <div className="screen" />;
  return (
    <ReportScreen
      report={report}
      capped={capped}
      onCap={() => void onCap()}
      onOpenTask={onOpenTask}
      onDropTask={(c) => void onDropTask(c)}
      onBack={onBack}
      stillOpen={live}
    />
  );
}
