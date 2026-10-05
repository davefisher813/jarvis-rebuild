import { useCallback, useEffect, useState } from "react";
import { useCategories, useGoals, useProjects, useGym, useTasks, useRules, useOptionalSeal, useSchedule, useOptionalPeople, useOptionalDecisions } from "../data/NotesProvider";
import type { MonthSeal, MonthSealData } from "./seal";
import { prevMonthKey, computeSeal } from "./seal";
import { readWindow, type WindowClient } from "../brain/window";
import { supabase } from "../auth/supabaseClient";
import { todayISO } from "../tasks/grouping";
import { buildReport, boldCounts, type MonthReport, type CarriedTask, type ReportFact, type LifeCard } from "./report";
import RollingNumber from "../shared/RollingNumber";
import { showToast } from "../shared/toast";
import { attemptWrite } from "../shared/guard";
import { lineCase } from "../shared/casing";
import { effectiveKind } from "../categories/kinds";
import { peopleForDerivation } from "../brain/peopleFacts";
import { loadWaitingCache, waitingDaysOf } from "../messages/waiting";
import type { TaskData } from "../notes/types";
import type { EventItem } from "../schedule/types";
import { TargetGlyph, LockGlyph } from "../shared/glyphs";
import PageHeader from "../shared/PageHeader";
import { pressable } from "../shared/pressable";
import RowShell from "../brain/RowShell";
import RowSheet from "../brain/RowSheet";

// THE MONTHLY REPORT (2026-08-25, built from the approved v3 preview).
// Reassurance leads, numbers and color carry it, sentences live behind the
// taps. Exactly one proposed change, and it ends in a setting, not a
// feeling. Every section renders only what its month can prove.
//
// AMENDED 2026-09-26 (pass-off): a line under a title is a .facts line
// (one grey, one key colour, the dot drawn by CSS), never a caps sentence
// (§AK, §AM F2-F5; "caps is for a label, never a sentence"); a sentence
// goes under its card as a field note. The report carries Money, Mail,
// People, Health and Decisions from the seal, each with an exit and never
// a rule: One Change stays the only proposed change.

const SEEN_KEY = "jarvis.report.seen.v1";

export function markReportSeen(month: string): void {
  try { localStorage.setItem(SEEN_KEY, month); } catch { /* convenience only */ }
}
export function reportSeen(): string | null {
  try { return localStorage.getItem(SEEN_KEY); } catch { return null; }
}

const TARGET = <TargetGlyph />;

/** The longest reply still waited on, in days, off the Waiting On cache the
 *  mail tab already keeps. Read only; nothing is fetched. */
export function oldestWaitDays(now: number): number {
  let worst = 0;
  try {
    for (const r of Object.values(loadWaitingCache())) worst = Math.max(worst, waitingDaysOf(r.dateMs, now));
  } catch { /* no storage: nothing is waiting that this can see */ }
  return worst;
}

/** One facts line: the words grey, a count white, at most one key colour. */
function Facts({ facts }: { facts: ReportFact[] }) {
  return (
    // .rep-facts: a report row is a page of what happened, so its facts wrap onto a second line rather than ending in an
    // ellipsis (Dave 2026-10-05, the review: "14 of 18 Drafts Sent Une..." was the point of the row).
    <div className="facts rep-facts">
      {facts.map((f, i) => (
        <span className={"fact" + (f.tone ? " " + f.tone : "")} key={i}>
          {f.parts ? f.parts.map((p, j) => (typeof p === "string" ? p : <b key={j}>{p.b}</b>)) : f.text}
        </span>
      ))}
    </div>
  );
}

// WHAT A REPORT ROW OPENS (Dave 2026-10-05, locked: a row is a door, and its sheet holds every action, the primary
// prominent). The receipts behind the card are the sheet's words; the verb the row used to carry as a capsule under it
// (Do One, Drop One, Open Money) is the sheet's first answer, filled, with the quieter one beneath it.
interface ReportAnswer { label: string; onPick: () => void; destructive?: boolean }
interface OpenReceipts { title: string; lines: string[]; answers?: ReportAnswer[] }

function ReceiptsSheet({ title, lines, answers = [], onDone }: { title: string; lines: string[]; answers?: ReportAnswer[]; onDone: () => void }) {
  return (
    <RowSheet portal eyebrow="Receipts" text={title} answers={answers} cancelLabel="Done" onClose={onDone}>
      {/* The evidence, as lines in the regular weight with a hairline between them: the strand sheet's receipts (Dave
          2026-10-05, the review: one loud bold sentence in a filled box is not evidence). */}
      <div className="rep-receipts">
        {lines.map((l, i) => (
          <div className="strand-receipt" key={i}><div className="r-what conn-meta">{l}</div></div>
        ))}
      </div>
    </RowSheet>
  );
}

const hourName = (h: number) => `${h % 12 || 12} ${h % 24 < 12 ? "AM" : "PM"}`;
/** The three busiest hours of the day, as the receipts behind "Your Hours": what the bars are made of. */
function busiestHours(byHour: number[]): string[] {
  return byHour
    .map((n, h) => ({ n, h }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || a.h - b.h)
    .slice(0, 3)
    .map((x) => lineCase(`${hourName(x.h)}: ${x.n} ${x.n === 1 ? "finish" : "finishes"}`));
}

export function ReportScreen({ report, capped, onCap, onOpenTask, onDropTask, onBack, stillOpen, canExit, onExit }: {
  report: MonthReport;
  capped: boolean;
  onCap: () => void;
  onOpenTask?: (id: string) => void;
  onDropTask?: (t: CarriedTask) => void;
  onBack: () => void;
  /** The live current month: labeled, and never marked as a seen arrival. */
  stillOpen?: boolean;
  /** A life card's exit: whether its door is wired (a card whose door is
   *  not shows no button rather than one that does nothing), and the tap. */
  canExit?: (exit: LifeCard["exit"]) => boolean;
  onExit?: (exit: LifeCard["exit"]) => void;
}) {
  const [receipts, setReceipts] = useState<OpenReceipts | null>(null);
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
  const exitable = (exit: LifeCard["exit"]) => !!onExit && (!canExit || canExit(exit));
  const worthFeet = report.worth.map((w) => w.foot).filter((f): f is string => !!f);

  return (
    <div className="screen ruled">
      {/* ONE WAY OUT, NAMED (Dave 2026-10-05, the review: "an unlabelled red chevron on the left and a red Done on the
          right, two ways to leave"). The same large-title header every Brain page wears, with the page it returns to. */}
      <PageHeader title={report.monthName} back="Insights" onBack={onBack} />

      {/* HERO: the month's one number, then its named wins. */}
      <div className="pad-x rep-hero">
        <div className="rep-eyebrow">{stillOpen ? "Your Month So Far" : "Your Month"}</div>
        <div className="rep-big"><RollingNumber value={Number(report.hero.big)} /></div>
        <div className="rep-big-label">{report.hero.label}</div>
        {/* Last month's number, plainly: a fact with its count white, never a pill with a typed colon (Dave 2026-10-05). */}
        {report.hero.anchor && <Facts facts={[{ text: report.hero.anchor, parts: boldCounts(report.hero.anchor) }]} />}
        {report.hero.wins.length > 0 && (
          <div className="rep-wins">
            {/* Every win is done, achieved or paid, so every win is green
                (§AM). The colour used to follow the slot a win landed in. */}
            {report.hero.wins.map((w) => (
              <div className="rep-win rep-win-good" key={w.name}>
                <div className="rep-win-name">{w.name}</div>
                <div className="rep-win-val">{w.value}</div>
              </div>
            ))}
          </div>
        )}
        {/* A sentence, so a field note at 14 and never a caps line. */}
        <div className="input-hint rep-hint">Tap Any Card to See Why</div>
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
                {/* The label names the number, so it sits under the number; the comparison is the quiet line after it. */}
                <div className="stat-label">{t.label}</div>
                {t.delta && <div className={"rep-delta " + (t.delta.up ? "rep-delta-up" : "")}>{t.delta.text}</div>}
              </div>
            ))}
          </div>
        )}

        {report.hours && (
          <div {...pressable(() => setReceipts({ title: `Your Hours: ${report.hours!.label}`, lines: busiestHours(report.hours!.byHour) }))} className="card pad rep-gap">
            <div className="rep-split"><span className="rep-eyebrow rep-quiet">Your Hours</span><b>{report.hours.label}</b></div>
            {/* THE BARS ARE A TIME AXIS (Dave 2026-10-05, the review: "no hour labels, and the brand red says peak to
                nobody"). Four labels under the strip, and the three-hour band in bright ink, never the action red: red is
                for what can be tapped, and a bar is not a button. */}
            <div className="rep-hours">
              {report.hours.byHour.map((n, h) => (
                <i
                  key={h}
                  className={h >= report.hours!.bandStart && h < report.hours!.bandStart + 3 ? "hot" : undefined}
                  style={{ height: grown ? `${Math.max(6, Math.round((n / maxHour) * 100))}%` : "6%" }}
                />
              ))}
            </div>
            <div className="rep-hours-axis" aria-hidden="true"><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span></div>
          </div>
        )}

        {/* WHERE THE HOURS WENT (handoff item 13, Dave's option A). The same
            stack and legend "Where It Went" already uses, because it is the
            same shape of fact about a different unit: that one counts things
            finished, this one counts time scheduled. No target line and no
            ideal split is drawn, so there is nothing here to fall short of.
            The quiet line names live-goal areas with nothing on the calendar
            and stops there; whether that is a problem is the reader's call.
            The total is a length that cannot be tapped, so a white <b> on
            its own split line; the quiet line is the card's field note. */}
        {report.time && (
          <>
            <div className="card pad rep-gap">
              <div className="rep-eyebrow rep-quiet">Where the Hours Went</div>
              <div className="rep-stack">
                {report.time.rows.map((r) => (
                  <i key={r.id || "rest"} className={"cat-bg-" + r.color} style={{ width: grown ? `${Math.max(4, r.pct)}%` : "25%" }} />
                ))}
              </div>
              <div className="rep-leg">
                {report.time.rows.map((r) => (
                  <span key={r.id || "rest"}><i className={"cat-bg-" + r.color} />{r.name} <b>{r.label}</b>{r.vs && <span className="fact warn rep-vs">{r.vs}</span>}</span>
                ))}
              </div>
              <div className="rep-split rep-gap"><span className="rep-eyebrow rep-quiet">On the Calendar</span><b>{report.time.total}</b></div>
            </div>
            {report.time.quiet.length > 0 && (
              <div className="input-hint">
                {lineCase(`Nothing scheduled for ${report.time.quiet.map((q) => q.name).join(", ")}`)}
              </div>
            )}
          </>
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
                <span key={s.id}><i className={"cat-bg-" + s.color} />{s.name} <b>{s.n}</b></span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* WORTH A LOOK: each gap keeps its exit. */}
      {report.worth.length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Worth a Look</span></div>
          <div className="pad-x">
            <div className="card list-card-ruled shell-rows">
              {report.worth.map((w) => {
                // The carried card's two verbs: Do One opens the first task, Drop One drops it. Neither is drawn on the row.
                const first = w.id === "carried" && w.carried && w.carried.length > 0 ? w.carried[0]! : null;
                const answers: ReportAnswer[] = [
                  ...(first && onOpenTask ? [{ label: "Do One", onPick: () => onOpenTask(first.id) }] : []),
                  ...(first && onDropTask ? [{ label: "Drop One", destructive: true, onPick: () => onDropTask(first) }] : []),
                ];
                return (
                  <RowShell key={w.id} verb={answers[0] ? { label: answers[0].label, run: answers[0].onPick } : undefined}>
                    <div {...pressable(() => setReceipts({ title: w.title, lines: w.receipts, answers }))} className="row">
                      <div className="row-grow">
                        <div className="rep-title">{w.title}</div>
                        {w.sub && <Facts facts={w.sub} />}
                      </div>
                      <div className="chev" />
                    </div>
                  </RowShell>
                );
              })}
            </div>
            {/* A sentence under a card is its field note, never a caps line. */}
            {worthFeet.map((f) => <div className="input-hint" key={f}>{f}</div>)}
          </div>
        </>
      )}

      {/* PATTERNS: one line, one number, receipts behind the tap. */}
      {report.patterns.length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Patterns</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {report.patterns.map((p) => (
              <div {...pressable(() => setReceipts({ title: p.title, lines: p.receipts }))} className="row" key={p.id}>
                <div className="row-grow">
                  <div className="rep-title">{p.title}</div>
                  {p.sub && <Facts facts={p.sub} />}
                </div>
                <div className="chev" />
              </div>
            ))}
          </div></div>
        </>
      )}

      {/* ALSO IN THE MONTH (2026-09-26): Money, Mail, People, Health and
          Decisions from what the app already keeps. Each card is a fact
          with receipts and a door out (Open Money, Check In, Open Email,
          Open Health Insights, Open Decisions). Nothing here proposes a
          rule; One Change below is the report's one proposal. */}
      {report.life.length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Also in {report.monthName}</span></div>
          <div className="pad-x"><div className="card list-card-ruled shell-rows">
            {report.life.map((c) => {
              // The card's door out (Open Money, Check In, Open Email) is the sheet's primary and the row's swipe-left, not a
              // capsule under it. A door that is not wired gives the card no verb rather than one that does nothing.
              const answers: ReportAnswer[] = exitable(c.exit) ? [{ label: c.exit.label, onPick: () => onExit!(c.exit) }] : [];
              return (
                <RowShell key={c.id} verb={answers[0] ? { label: answers[0].label, run: answers[0].onPick } : undefined}>
                  <div {...pressable(() => setReceipts({ title: c.title, lines: c.receipts, answers }))} className="row">
                    <div className="row-grow">
                      <div className="rep-title">{c.title}</div>
                      {c.facts.length > 0 && <Facts facts={c.facts} />}
                    </div>
                    <div className="chev" />
                  </div>
                </RowShell>
              );
            })}
          </div></div>
        </>
      )}

      {/* JARVIS: what it learned and did, the one change, the seal. */}
      {(report.learned || report.did || report.closer) && (
        <div className="sh2 sh2-quiet"><span className="t">JARVIS</span></div>
      )}
      <div className="pad-x">
        {(report.learned || report.did) && (
          <div className="card list-card-ruled">
            {[report.learned, report.did].map((b, i) => b && (
              <div {...pressable(() => setReceipts({ title: b.title, lines: b.receipts }))} className="row" key={i}>
                <div className="row-grow">
                  <div className="rep-title">{b.title}</div>
                  {b.sub && <Facts facts={b.sub} />}
                </div>
                <div className="chev" />
              </div>
            ))}
          </div>
        )}

        {report.closer && (
          <div className="card pad rep-one rep-gap">
            <div className="rep-eyebrow">One Change</div>
            <div className="rep-question">{report.closer.question}</div>
            {/* The reason under the question is its quiet sub (§AM F4), not
                a second title at 17px semibold. */}
            <div className="conn-meta rep-quiet2">{report.closer.sub}</div>
            <div className="rep-one-acts promo-actions">
              {capped
                ? <button className="btn btn-block" disabled>Capped</button>
                : (
                  <>
                    <button className="btn btn-primary" onClick={onCap}>Turn It On</button>
                    <button className="btn" onClick={onBack}>No Thanks</button>
                  </>
                )}
            </div>
            {/* A sentence under the pair: the card's field note, not caps. */}
            <div className="input-hint rep-one-foot">{report.closer.foot}</div>
          </div>
        )}

        {/* A month still open is NOT sealed, and the lock card would be a
            lie on it; the eyebrow already says So Far (2026-08-25). */}
        {!stillOpen && (
          <div className="card rep-gap">
            <div className="row">
              <div className="row-glyph lib-ico-neutral"><LockGlyph /></div>
              <div className="row-grow">
                <div className="rep-title">{report.sealed.title}</div>
                <div className="facts"><span className="fact">{report.sealed.sub}</span></div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="screen-foot" />
      {receipts && <ReceiptsSheet title={receipts.title} lines={receipts.lines} answers={receipts.answers} onDone={() => setReceipts(null)} />}
    </div>
  );
}

/** Loads a month's report, assembles the model, wires the actions. With no
 *  props beyond navigation it opens the latest sealed month (the arrival
 *  path). `month` opens that sealed month from the shelf. `live` builds the
 *  CURRENT month from the live window through the same computeSeal, so the
 *  page is one engine wearing one honest extra label: So Far. */
export default function ReportFlow({ onBack, onOpenTask, month, live, onOpenEntity, onOpenMoney, onOpenEmail }: {
  onBack: () => void;
  onOpenTask?: (id: string) => void;
  month?: string;
  live?: boolean;
  /** The life cards' exits (2026-09-26): the shell's own entity door for a
   *  person ("person", id), the health area ("category", id), Contacts and
   *  Decisions ("category", "contacts" | "decisions"); the Money tab; the
   *  Email tab. Each optional: a card whose door is not wired shows no
   *  button. */
  onOpenEntity?: (kind: string, id: string) => void;
  onOpenMoney?: () => void;
  onOpenEmail?: () => void;
}) {
  const sealSvc = useOptionalSeal();
  const cats = useCategories();
  const goalsSvc = useGoals();
  const projectsSvc = useProjects();
  const gym = useGym();
  const tasksSvc = useTasks();
  const rules = useRules();
  const schedule = useSchedule();
  const peopleSvc = useOptionalPeople();
  const decisionsSvc = useOptionalDecisions();
  const [report, setReport] = useState<MonthReport | null>(null);
  const [none, setNone] = useState(false);
  const [capped, setCapped] = useState(false);
  const [taskById, setTaskById] = useState<Map<string, TaskData>>(new Map());

  const load = useCallback(async () => {
    if (!sealSvc) { setNone(true); return; }
    const [seals, cs, gl, pj, ws, tk, capRule, dec, ppl] = await Promise.all([
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
      // The life cards' sources (2026-09-26), best effort: a read that
      // fails costs the report a card, never the report.
      decisionsSvc ? decisionsSvc.listAll().catch(() => []) : Promise.resolve([]),
      peopleSvc ? peopleSvc.list().catch(() => []) : Promise.resolve([]),
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
      // BRAIN-F-16 (2026-09-05): the boundary seal has been handed events
      // since item 13 (AppShell passes the schedule), and this path never
      // was, so "September, So Far" had no Where the Hours Went whatever was
      // on the calendar. Best effort, exactly as the boundary treats it: a
      // failed calendar read costs the section, never the report.
      let events: EventItem[] | undefined;
      try { events = await schedule.listEvents(); } catch { events = undefined; }
      const people = await peopleForDerivation(peopleSvc, cs.map((c) => ({ id: c.id, name: c.data.name }))).catch(() => []);
      sealData = computeSeal(todayISO().slice(0, 7), {
        rows, workouts: ws, goals: gl, sealedAt: now, ...(events ? { events } : {}),
        tasks: tk, decisions: dec.map((d) => d.data), people, waitDays: oldestWaitDays(now),
      });
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
      people: ppl.map((p) => ({ id: p.id, name: p.data.name })),
      healthCategoryId: cs.find((c) => effectiveKind(c.data) === "health")?.id ?? null,
      ...(live ? { stillOpen: true } : {}),
    }));
  }, [sealSvc, cats, goalsSvc, projectsSvc, gym, tasksSvc, rules, schedule, peopleSvc, decisionsSvc, month, live]);
  useEffect(() => { void load(); }, [load]);

  // S4-Q26 (2026-09-04): one tap, one step. create() is idempotent and
  // announces nothing (the toast right here is the announcement), so this
  // is a real row in What JARVIS Learned the instant it fires, not a
  // pending observation waiting on a second one that will never come.
  // BRAIN-F-12 (2026-09-05): both of these wrote without a guard, so a failed
  // one either did nothing and said nothing (the cap) or threw before its own
  // toast (the drop). The receipt now follows the write instead of leading it.
  const onCap = async () => {
    const ok = await attemptWrite(() => rules.create("tuning", "plan.cap", "day", "3", "Chosen from the monthly report: first picks finish, later picks mostly do not"));
    if (!ok) return;
    setCapped(true);
    showToast({ message: "Capped at 3 · Starting Tomorrow" });
  };

  const onDropTask = async (c: CarriedTask) => {
    const data = taskById.get(c.id);
    const ok = await attemptWrite(() => tasksSvc.deleteTask(c.id));
    if (!ok) return;
    await load();
    showToast({
      message: "Task Dropped",
      actionLabel: "Undo",
      onAction: async () => {
        if (data) await attemptWrite(() => tasksSvc.recreateFrom(data));
        await load();
      },
    });
  };

  // THE EXITS (2026-09-26). Each life card opens the place its numbers came
  // from, through the shell's existing doors; a door that is not wired
  // shows no button.
  const canExit = (exit: LifeCard["exit"]): boolean => {
    if (exit.kind === "money") return !!onOpenMoney;
    if (exit.kind === "email") return !!onOpenEmail;
    if (exit.kind === "health") return !!onOpenEntity && !!exit.id;
    return !!onOpenEntity;
  };
  const onExit = (exit: LifeCard["exit"]): void => {
    if (!canExit(exit)) return;
    if (exit.kind === "money") onOpenMoney!();
    else if (exit.kind === "email") onOpenEmail!();
    else if (exit.kind === "person") onOpenEntity!(exit.id ? "person" : "category", exit.id ?? "contacts");
    else if (exit.kind === "health") onOpenEntity!("category", exit.id!);
    else onOpenEntity!("category", "decisions");
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
          <div className="empty-sub">Your First Report Arrives on the 1st, Unannounced</div>
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
      canExit={canExit}
      onExit={onExit}
    />
  );
}
