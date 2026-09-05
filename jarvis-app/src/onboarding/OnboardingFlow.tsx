import { useEffect, useRef, useState } from "react";
import { useProfile, useCategories, usePeople, useRoutine, useTasks, useOptionalStrands } from "../data/NotesProvider";
import { wakeFromBrief, DEFAULT_ROUTINE } from "../routine/types";
import { localParse } from "../ai/capture";
import { useOptionalGoogle } from "../connections/google/GoogleSession";
import { googleConfigured } from "../connections/google/config";
import { planDay } from "../schedule/planDay";
import { todayISO, fmtTime, addDays } from "../schedule/calendar";
import { haptics } from "../shared/haptics";
import { DEFAULT_CATEGORIES, type CategorySeed, type TemplateKey } from "../categories/defaults";
import { COLOR_SLOTS } from "../categories/types";
import { STEPS } from "./steps";
import { seedQuestions, factsFrom } from "./seeds";
import { NEW_USER_TABS } from "../shell/destinations";
import { dismissSplash } from "../shared/splash";
import { attemptWrite } from "../shared/guard";

const ic = (d: string) => (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: d }} />
);
const SEND = ic('<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>');
const LOCK = '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>';
const MAIL = ic('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/>');
const CAL = ic('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>');
const X = ic('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>');

const TEMPLATE_LABEL: Record<TemplateKey, string> = { personal: "Personal", business: "Business", student: "Student" };
// Who each template is for, one line (the catalog picked "three cards" for
// this step; a card earns a line the chip never had room for). Straight from
// the three-template architecture: Personal is the multi-workstream juggler,
// Business the small owner, Student the athlete-or-parent wedge.
const TEMPLATE_WHO: Record<TemplateKey, string> = {
  personal: "Juggling a few workstreams at once",
  business: "Running a small business",
  student: "A student athlete, or a parent of one",
};

const CHEV = <div className="chev" />;

// Work-hour presets seeded by the one-tap workstyle question. "varies" keeps
// the defaults; everything is refinable later in Brain.
const WORK_PRESET: Record<string, { workStartMin: number; workEndMin: number } | null> = {
  "9-5": { workStartMin: 9 * 60, workEndMin: 17 * 60 },
  early: { workStartMin: 7 * 60, workEndMin: 15 * 60 },
  late: { workStartMin: 11 * 60, workEndMin: 19 * 60 },
  varies: null,
};

// Where the priority task lands: first open slot in the (chosen) work hours,
// via the same deterministic engine Plan My Day uses. A fresh account has no
// events, so this is exact, not a guess.
function slotForPriority(text: string, workStartMin: number, workEndMin: number, now = new Date()) {
  const plan = planDay([{ id: "p", text, category: "", durationMin: 60 }], [], workStartMin + 30, workEndMin);
  const start = plan.blocks[0]?.start ?? null;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const dayWord = nowMin < workEndMin - 60 ? "today" : "tomorrow";
  return { start, dayWord };
}

export default function OnboardingFlow({ onFinish }: { onFinish: () => void }) {
  const profile = useProfile();
  const categories = useCategories();
  const peopleSvc = usePeople();
  const routine = useRoutine();
  const tasksSvc = useTasks();
  // Optional on purpose, same seam as everywhere else the genome is touched:
  // no strands store means the seed questions simply do not render, and the
  // rest of intake is unchanged. A missing enhancement is never a broken step.
  const strandsSvc = useOptionalStrands();

  useEffect(() => { dismissSplash(); }, []);
  const [idx, setIdx] = useState(0);
  const [name, setName] = useState("");
  const [priority, setPriority] = useState("");
  const [workStyle, setWorkStyle] = useState("");
  const [aiChoice, setAiChoice] = useState(""); // item 22; empty = skipped = Draft Only
  const [textDraft, setTextDraft] = useState("");
  const [template, setTemplate] = useState<TemplateKey>("personal");
  const [seeds, setSeeds] = useState<CategorySeed[]>([]);
  const [people, setPeople] = useState<string[]>([]);
  const [personDraft, setPersonDraft] = useState("");
  const [gmail, setGmail] = useState(false);
  const [calendar, setCalendar] = useState(false);
  // Real connect from the connect step (2026-08-09): the rows now DO the
  // thing the step's copy promises. Optional so tests and providerless
  // renders keep the old static behavior.
  const google = useOptionalGoogle();
  const canConnect = !!google && googleConfigured();
  const [connecting, setConnecting] = useState(false);
  const connectGoogle = async () => {
    if (!google || connecting) return;
    setConnecting(true);
    try {
      await google.addAccount();
      setGmail(true);
      setCalendar(true);
    } catch { /* user closed the chooser: the Later path still works */ }
    finally { setConnecting(false); }
  };
  // Question id -> index of the chosen chip. Absent means unanswered, which
  // is a first-class outcome here: five optional questions, not a form.
  const [seedPicks, setSeedPicks] = useState<Record<string, number>>({});
  const [briefTime, setBriefTime] = useState("");
  const [saving, setSaving] = useState(false);

  // THE NEWEST TURN IS THE ONE YOU NEED TO READ (2026-09-04). .convo is a
  // scrolling region and nothing ever moved it, so from about the sixth step
  // on, JARVIS's current line sat above the fold while the control for it sat
  // below: the user saw the start of a conversation and a question they had
  // not been shown. Surfaced by the seeds step, whose control is tall enough
  // to squeeze the transcript to a few lines, but it was true of the two
  // steps before it as well.
  const convoRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = convoRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [idx]);

  const step = STEPS[idx];
  if (!step) return null;

  // B6-1 (2026-09-04): "A failed profile write locks a new user out
  // permanently." setSaving(true) above had no matching false on the way
  // out, and onFinish() only ran after every await succeeded, so a single
  // flaky write on a brand-new account (no data to lose retrying) latched
  // "Enter JARVIS" disabled forever with nothing on screen to explain why.
  // attemptWrite is the house-wide answer to exactly this shape of problem:
  // the whole sequence runs as one write, the standard toast fires on
  // failure, and the finally below always releases the button so the user
  // can just try again.
  const finish = async (complete: boolean) => {
    if (saving) return;
    setSaving(true);
    try {
      const ok = await attemptWrite(async () => {
        // (people and priority are deliberately NOT persisted on the profile:
        // the names become real person entities and the priority becomes a real
        // task below. Audit 2026-08-10 removed the write-only duplicates.)
        await profile.save({
          name: name.trim(),
          template,
          briefTime: briefTime || undefined,
          // Item 22: Skip lands on Draft Only, and the level applies instantly.
          ai: { level: aiChoice === "everything" ? "everything" as const : "draft" as const },
          gmail,
          calendar,
          onboarded: true,
          // New users start with the trimmed tab set (see destinations.tsx).
          // Persisted here so the default fallback never shifts under anyone who
          // onboarded before this existed.
          tabs: NEW_USER_TABS,
        });
        if (complete) {
          const existing = await categories.list();
          if (existing.length === 0) {
            for (const s of seeds) await categories.create(s.name, s.color, s.icon);
          }
          // Plain contacts, no register: onboarding asked who matters, not how
          // the user writes to them, and a guessed register is worse than none.
          if (people.length > 0 && (await peopleSvc.list()).length === 0) {
            for (const name of people) await peopleSvc.create({ name, group: "contacts" });
          }
          // Seed a smarter wake time from the morning-brief choice, and work hours
          // from the one-tap workstyle answer. Only when routine isn't already set.
          if ((briefTime || WORK_PRESET[workStyle]) && !(await routine.isConfigured())) {
            const work = WORK_PRESET[workStyle];
            await routine.save({
              ...(briefTime ? { wakeMin: wakeFromBrief(briefTime) } : {}),
              ...(work ?? {}),
            });
          }
          // The payoff made real: the priority answer becomes an actual task, its
          // text understood by the capture parser (catches "by Friday", "at 3pm"),
          // categorized when the parse names a seeded area, due where the plan
          // engine slotted it.
          if (priority.trim()) {
            const today = todayISO();
            const parsed = localParse(priority, today);
            const cats = await categories.list();
            const catHit = parsed.category
              ? cats.find((c) => c.data.name.toLowerCase() === parsed.category!.toLowerCase())
              : undefined;
            const work = WORK_PRESET[workStyle] ?? { workStartMin: DEFAULT_ROUTINE.workStartMin, workEndMin: DEFAULT_ROUTINE.workEndMin };
            const { dayWord } = slotForPriority(parsed.title || priority, work.workStartMin, work.workEndMin);
            // PLUMB-F-06 (2026-09-05): "tomorrow" steps a calendar day with
            // addDays, not now plus 86,400,000ms, which on the clocks-back
            // day (25 hours) is still today.
            const due = parsed.date ?? (dayWord === "today" ? today : addDays(today, 1));
            await tasksSvc.createTask(parsed.title || priority, { category: catHit?.id, due });
          }
          // The seeds become real facts, at source "asked" (see seeds.ts and
          // StrandsService.seed). Best-effort and last: a genome write must never
          // be the thing that stops a new account from opening.
          if (strandsSvc) {
            const today = todayISO();
            for (const f of factsFrom(template, seedPicks)) {
              try { await strandsSvc.seed(f.text, f.category, today); } catch { /* intake still succeeds */ }
            }
          }
        }
      });
      if (ok) onFinish();
    } finally {
      setSaving(false);
    }
  };

  const pickTemplate = (t: TemplateKey) => {
    setTemplate(t);
    setSeeds(DEFAULT_CATEGORIES[t].map((s) => ({ ...s })));
    setIdx(idx + 1);
  };
  const addPerson = () => {
    const p = personDraft.trim();
    if (!p) return;
    setPeople([...people, p]);
    setPersonDraft("");
  };
  const removeSeed = (i: number) => setSeeds(seeds.filter((_, k) => k !== i));
  const updateSeed = (i: number, name: string) => setSeeds(seeds.map((x, k) => (k === i ? { ...x, name } : x)));
  const addSeed = () => {
    const used = new Set(seeds.map((s) => s.color));
    const free = COLOR_SLOTS.find((c) => !used.has(c)) ?? "graphite";
    setSeeds([...seeds, { name: "New Area", color: free, icon: "folder" }]);
  };

  // answer summary shown as the user's bubble once a step is passed
  const answerOf = (stepIdx: number): string => {
    const s = STEPS[stepIdx];
    if (!s) return "";
    switch (s.id) {
      case "name": return name;
      case "template": return TEMPLATE_LABEL[template];
      case "categories": return seeds.map((x) => x.name).join(", ");
      case "people": return people.length ? people.join(", ") : "Maybe later";
      case "priority": return priority || "Skipped";
      case "workstyle": return s.options?.find((o) => o.value === workStyle)?.label ?? "Skipped";
      case "aichoice": return s.options?.find((o) => o.value === aiChoice)?.label ?? "Draft Only";
      case "seeds": {
        const n = seedQuestions(template).filter((q) => seedPicks[q.id] != null).length;
        return n === 0 ? "Skipped" : n + (n === 1 ? " answer" : " answers");
      }
      case "connect": return "Got it";
      case "time": return s.options?.find((o) => o.value === briefTime)?.label ?? "Skip";
      default: return "";
    }
  };

  // JARVIS's line for a step. The categories step visibly reacts to the
  // template choice: the app assembles itself around their answer.
  const promptOf = (s: (typeof STEPS)[number]): string => {
    if (s.id === "categories" && seeds.length > 0) {
      const names = seeds.map((x) => x.name);
      const list = names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names[names.length - 1] : names[0]!;
      return `Got it, for ${TEMPLATE_LABEL[template]} I\u2019ve set up ${list}. Remove any that don\u2019t fit, or add your own.`;
    }
    return s.prompt!;
  };

  // ---- intro ----
  if (step.kind === "intro") {
    return (
      <div className="ob-screen ruled">
        <div className="ob-body">
          <div className="ob-brand ob-brand-lg"><span className="jr">J</span>ARVIS</div>
          <div className="ob-card-title ob-tagline-1">Your personal operating system</div>
          <div className="ob-sub">Build your Brain. Let JARVIS run the rest.</div>
          <div className="grp"><div className="eyebrow">Three Steps</div></div>
          <div className="card">
            <div className="row"><div className="sec-ico ico-accent ob-num">1</div><div className="row-grow"><div className="conn-name">Tell JARVIS about you</div></div><span className="row-status">2 min</span></div>
            <div className="row"><div className="sec-ico cat-bg-yellow ob-num">2</div><div className="row-grow"><div className="conn-name">Connect Gmail and Calendar</div></div><span className="row-status">1 min</span></div>
            <div className="row"><div className="sec-ico ico-good ob-num">3</div><div className="row-grow"><div className="conn-name">Set your daily rhythm</div></div><span className="row-status">1 min</span></div>
          </div>
          <div className="ob-privacy">
            <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: LOCK }} />
            <div className="ob-privacy-txt"><b>Your data is yours.</b> Stored locally first. Cloud backup is optional.</div>
          </div>
        </div>
        <div className="ob-foot">
          <button className="btn btn-primary btn-block btn-lg" onClick={() => setIdx(idx + 1)}>Begin</button>
          <div className="ob-skip" role="button" tabIndex={0} onClick={() => finish(false)}>Skip for now</div>
        </div>
      </div>
    );
  }

  // ---- done: the payoff. A live preview of their Today, already moving. ----
  if (step.kind === "done") {
    const parsed = priority.trim() ? localParse(priority, todayISO()) : null;
    const work = WORK_PRESET[workStyle] ?? { workStartMin: DEFAULT_ROUTINE.workStartMin, workEndMin: DEFAULT_ROUTINE.workEndMin };
    const slot = parsed ? slotForPriority(parsed.title || priority, work.workStartMin, work.workEndMin) : null;
    const slotLine = slot?.start ? `I\u2019ve slotted it for ${slot.dayWord} at ${fmtTime(slot.start)}, right in your working hours.` : "";
    return <PayoffScreen name={name} briefLabel={STEPS.find((s) => s.id === "time")?.options?.find((o) => o.value === briefTime)?.label} seeds={seeds} taskTitle={parsed ? parsed.title || priority : ""} slotLine={slotLine} saving={saving} onEnter={() => finish(true)} />;
  }

  // ---- conversation steps ----
  const transcript = (
    <div className="convo" ref={convoRef}>
      <div className="convo-sender">JARVIS</div>
      {STEPS.slice(1, idx).map((s) => (
        <Turn key={s.id} prompt={promptOf(s)} answer={answerOf(STEPS.indexOf(s))} />
      ))}
      <div className="bubble bubble-ai">{promptOf(step)}</div>
    </div>
  );

  let control = null;
  if (step.kind === "text") {
    const commit = () => {
      const v = textDraft.trim();
      if (step.key === "name") {
        if (!v) return;
        setName(v);
      } else if (step.key === "priority") {
        setPriority(v);
      }
      setTextDraft("");
      setIdx(idx + 1);
    };
    const optional = step.key !== "name";
    control = (
      <div className="convo-foot">
        <div className="convo-inputbar">
          <input
            className="input"
            placeholder={step.placeholder}
            value={textDraft}
            onChange={(e) => setTextDraft(e.target.value)}
            autoFocus
          />
          <button className="convo-send" aria-label="Send" onClick={commit}>{SEND}</button>
        </div>
        {optional && (
          <div className="ob-skip" role="button" tabIndex={0} onClick={() => { setTextDraft(""); setIdx(idx + 1); }}>Skip for now</div>
        )}
      </div>
    );
  } else if (step.kind === "choice" && step.key === "template") {
    // THE TEMPLATE PICK IS THREE CARDS (catalog 2026-09-01: "Three cards:
    // Personal, Business, Student"). It is the one branching choice in the
    // flow -- the wedge for the whole product -- so it earns a card with a
    // line of who-it's-for, not a chip. Tapping a card picks and advances,
    // exactly as the chips did. The bubble above still asks the question, so
    // the conversation is unbroken.
    control = (
      <div className="pad-x ob-templates">
        {step.options!.map((o) => (
          <div key={o.value} className="card ob-tpl" role="button" tabIndex={0} onClick={() => pickTemplate(o.value as TemplateKey)}>
            <div className="row">
              <div className="row-grow">
                <div className="conn-name">{o.label}</div>
                <div className="conn-meta">{TEMPLATE_WHO[o.value as TemplateKey]}</div>
              </div>
              {CHEV}
            </div>
          </div>
        ))}
      </div>
    );
  } else if (step.kind === "choice") {
    control = (
      <div className="convo-foot">
        <div className="convo-chips">
          {step.options!.map((o) => (
            <div key={o.value} className="chip" role="button" tabIndex={0} onClick={() => {
              if (step.key === "workStyle") { setWorkStyle(o.value); setIdx(idx + 1); }
              else if (step.key === "aiChoice") { setAiChoice(o.value); setIdx(idx + 1); }
            }}>{o.label}</div>
          ))}
        </div>
      </div>
    );
  } else if (step.kind === "categories") {
    control = (
      <>
        <div className="pad-x"><div className="card">
          {seeds.map((s, i) => (
            <div className="row" key={i}>
              <span className={"ob-swatch cat-bg-" + s.color} />
              <div className="row-grow"><input className="input ob-rename" value={s.name} onChange={(e) => updateSeed(i, e.target.value)} aria-label={"Area " + (i + 1) + " name"} /></div>
              <button className="ob-x" aria-label={"Remove " + s.name} onClick={() => removeSeed(i)}>{X}</button>
            </div>
          ))}
          <button className="row row-act" onClick={addSeed}>Add Area</button>
        </div></div>
        <div className="convo-foot"><button className="btn btn-primary btn-block" onClick={() => setIdx(idx + 1)}>Continue</button></div>
      </>
    );
  } else if (step.kind === "people") {
    control = (
      <div className="convo-foot">
        {people.length > 0 && (
          <div className="convo-chips">{people.map((p, i) => <div key={p + i} className="chip cat-bg-blue">{p}</div>)}</div>
        )}
        <div className="convo-inputbar">
          <input className="input" placeholder={step.placeholder} value={personDraft} onChange={(e) => setPersonDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addPerson(); }} />
          <button className="convo-send" aria-label="Add person" onClick={addPerson}>{SEND}</button>
        </div>
        <button className="btn btn-secondary btn-block" onClick={() => setIdx(idx + 1)}>{people.length ? "Continue" : "Later, I\u2019ll add people as I go"}</button>
      </div>
    );
  } else if (step.kind === "seeds") {
    // All five on one screen rather than five turns. For the brain this app is
    // built for, one screen you can bail out of beats five sequential asks,
    // and the item's budget was sixty seconds. Tapping a chip twice clears it,
    // so no answer is a trap. Chips use the app's own chip-on state; nothing
    // new was styled for this.
    const qs = seedQuestions(template);
    const answered = qs.filter((q) => seedPicks[q.id] != null).length;
    control = (
      <>
        <div className="pad-x">
          {qs.map((q) => (
            <div className="ob-seed" key={q.id}>
              <div className="sh2 sh2-quiet"><span className="t">{q.prompt}</span></div>
              <div className="convo-chips">
                {q.options.map((o, i) => (
                  <div
                    key={o.label}
                    className={"chip" + (seedPicks[q.id] === i ? " chip-on" : "")}
                    role="button"
                    tabIndex={0}
                    aria-pressed={seedPicks[q.id] === i}
                    onClick={() => setSeedPicks((prev) => {
                      const next = { ...prev };
                      if (next[q.id] === i) delete next[q.id]; else next[q.id] = i;
                      return next;
                    })}
                  >{o.label}</div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="convo-foot">
          <button className="btn btn-primary btn-block" onClick={() => setIdx(idx + 1)}>
            {answered > 0 ? "Continue" : "Skip these"}
          </button>
        </div>
      </>
    );
  } else if (step.kind === "connect") {
    control = (
      <>
        <div className="pad-x"><div className="card">
          <div className="row connect-row" {...(canConnect ? { role: "button" as const, tabIndex: 0, onClick: () => void connectGoogle() } : {})}>
            <div className="sec-ico ico-accent">{MAIL}</div>
            <div className="row-grow"><div className="conn-name">Gmail</div><div className="conn-meta">Read and reply from the Email tab</div></div>
          </div>
          <div className="row connect-row" {...(canConnect ? { role: "button" as const, tabIndex: 0, onClick: () => void connectGoogle() } : {})}>
            <div className="sec-ico ico-blue">{CAL}</div>
            <div className="row-grow"><div className="conn-name">Google Calendar</div><div className="conn-meta">Events show up on Today</div></div>
          </div>
          {(google?.accounts.length ?? 0) > 0 && (
            <div className="row"><div className="row-grow"><div className="conn-name">Connected</div><div className="conn-meta">{google!.accounts.map((a) => a.email).join(", ")}</div></div></div>
          )}
        </div></div>
        <div className="convo-foot">
          {canConnect && (google?.accounts.length ?? 0) === 0 ? (
            <button className="btn btn-primary btn-block" disabled={connecting} onClick={() => void connectGoogle()}>{connecting ? "Connecting..." : "Connect Google"}</button>
          ) : (
            <button className="btn btn-primary btn-block" onClick={() => setIdx(idx + 1)}>Continue</button>
          )}
          <div className="ob-skip" role="button" tabIndex={0} onClick={() => setIdx(idx + 1)}>Later, JARVIS works fine without it</div>
        </div>
      </>
    );
  } else if (step.kind === "time") {
    control = (
      <div className="convo-foot">
        <div className="convo-chips">
          {step.options!.map((o) => (
            <div key={o.value} className="chip" role="button" tabIndex={0} onClick={() => { setBriefTime(o.value); setIdx(idx + 1); }}>{o.label}</div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="ob-screen ruled">
      {transcript}
      {control}
    </div>
  );
}

function Turn({ prompt, answer }: { prompt: string; answer: string }) {
  return (
    <>
      <div className="bubble bubble-ai">{prompt}</div>
      {answer && <div className="bubble bubble-user">{answer}</div>}
    </>
  );
}

// The last screen a new user sees: their Today, already assembled. Uses the
// same card/row atoms as the real Today so entering the app matches the
// preview, and the row-stagger entrance makes it assemble on screen.
function PayoffScreen({ name, briefLabel, seeds, taskTitle, slotLine, saving, onEnter }: {
  name: string;
  briefLabel?: string;
  seeds: CategorySeed[];
  taskTitle: string;
  slotLine: string;
  saving: boolean;
  onEnter: () => void;
}) {
  useEffect(() => { haptics.success(); }, []);
  return (
    <div className="ob-screen ruled">
      <div className="ob-body">
        <div className="ob-card-title">{name ? `You\u2019re set, ${name}.` : "You\u2019re set."}</div>
        <div className="ob-sub">Here\u2019s your day, already moving.</div>
        <div className="grp"><div className="eyebrow">Today</div></div>
        <div className="pad-x"><div className="card">
          {briefLabel && (
            <div className="row"><div className="row-grow"><div className="conn-name">Morning Brief</div></div><span className="row-status">{briefLabel}</span></div>
          )}
          <div className="row">
            <div className="row-grow"><div className="conn-name">Your areas</div></div>
            {seeds.slice(0, 6).map((s, i) => <span key={i} className={"cat-dot cat-bg-" + s.color} />)}
          </div>
          {taskTitle && (
            <div className="row">
              <span className="task-check" aria-hidden="true" />
              <div className="row-grow"><div className="conn-name">{taskTitle}</div><div className="conn-meta">Your top priority</div></div>
            </div>
          )}
        </div></div>
        {slotLine && <div className="ob-privacy"><div className="ob-privacy-txt">{slotLine} Tap it when it\u2019s done. I love that part.</div></div>}
      </div>
      <div className="ob-foot">
        <button className="btn btn-primary btn-block btn-lg" onClick={onEnter} disabled={saving}>Enter JARVIS</button>
      </div>
    </div>
  );
}
