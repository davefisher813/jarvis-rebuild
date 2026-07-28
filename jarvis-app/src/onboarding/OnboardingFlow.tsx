import { useEffect, useState } from "react";
import { useProfile, useCategories, usePeople, useRoutine, useTasks } from "../data/NotesProvider";
import { wakeFromBrief, DEFAULT_ROUTINE } from "../routine/types";
import { localParse } from "../ai/capture";
import { planDay } from "../schedule/planDay";
import { todayISO, fmtTime } from "../schedule/calendar";
import { haptics } from "../shared/haptics";
import { DEFAULT_CATEGORIES, type CategorySeed, type TemplateKey } from "../categories/defaults";
import { COLOR_SLOTS } from "../categories/types";
import { STEPS } from "./steps";

const ic = (d: string) => (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: d }} />
);
const SEND = ic('<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>');
const LOCK = '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>';
const MAIL = ic('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/>');
const CAL = ic('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>');
const X = ic('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>');

const TEMPLATE_LABEL: Record<TemplateKey, string> = { personal: "Personal", business: "Business", student: "Student" };

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

  const [idx, setIdx] = useState(0);
  const [name, setName] = useState("");
  const [priority, setPriority] = useState("");
  const [workStyle, setWorkStyle] = useState("");
  const [textDraft, setTextDraft] = useState("");
  const [template, setTemplate] = useState<TemplateKey>("personal");
  const [seeds, setSeeds] = useState<CategorySeed[]>([]);
  const [people, setPeople] = useState<string[]>([]);
  const [personDraft, setPersonDraft] = useState("");
  const [gmail, setGmail] = useState(false);
  const [calendar, setCalendar] = useState(false);
  const [briefTime, setBriefTime] = useState("");
  const [saving, setSaving] = useState(false);

  const step = STEPS[idx];
  if (!step) return null;

  const finish = async (complete: boolean) => {
    if (saving) return;
    setSaving(true);
    await profile.save({
      name: name.trim(),
      template,
      people,
      priority: priority || undefined,
      briefTime: briefTime || undefined,
      gmail,
      calendar,
      onboarded: true,
    });
    if (complete) {
      const existing = await categories.list();
      if (existing.length === 0) {
        for (const s of seeds) await categories.create(s.name, s.color, s.icon);
      }
      if (people.length > 0 && (await peopleSvc.list("inner_circle")).length === 0) {
        for (const name of people) await peopleSvc.create({ name, group: "inner_circle" });
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
        const due = parsed.date ?? (dayWord === "today" ? today : todayISO(new Date(Date.now() + 86400000)));
        await tasksSvc.createTask(parsed.title || priority, { category: catHit?.id, due });
      }
    }
    onFinish();
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
      return `Got it \u2014 for ${TEMPLATE_LABEL[template]}, I\u2019ve set up ${list}. Remove any that don\u2019t fit, or add your own.`;
    }
    return s.prompt!;
  };

  // ---- intro ----
  if (step.kind === "intro") {
    return (
      <div className="ob-screen">
        <div className="ob-body">
          <div className="ob-brand ob-brand-lg"><span className="jr">J</span>ARVIS</div>
          <div className="ob-card-title ob-tagline-1">Your personal operating system</div>
          <div className="ob-sub">Build your Brain. Let JARVIS run the rest.</div>
          <div className="grp"><div className="eyebrow">Three steps</div></div>
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
    <div className="convo">
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
  } else if (step.kind === "choice") {
    control = (
      <div className="convo-foot">
        <div className="convo-chips">
          {step.options!.map((o) => (
            <div key={o.value} className="chip" role="button" tabIndex={0} onClick={() => {
              if (step.key === "workStyle") { setWorkStyle(o.value); setIdx(idx + 1); }
              else pickTemplate(o.value as TemplateKey);
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
              <div className="row-grow"><input className="input ob-rename" value={s.name} onChange={(e) => updateSeed(i, e.target.value)} aria-label={"Category " + (i + 1) + " name"} /></div>
              <button className="ob-x" aria-label={"Remove " + s.name} onClick={() => removeSeed(i)}>{X}</button>
            </div>
          ))}
          <div className="row ob-addrow" role="button" tabIndex={0} onClick={addSeed}>
            <span className="sec-ico ico-accent"><svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg></span>
            <div className="row-grow"><div className="conn-name">Add Category</div></div>
          </div>
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
        <button className="btn btn-secondary btn-block" onClick={() => setIdx(idx + 1)}>{people.length ? "Continue" : "Later \u2014 I\u2019ll add people as I go"}</button>
      </div>
    );
  } else if (step.kind === "connect") {
    control = (
      <>
        <div className="pad-x"><div className="card">
          <div className="row connect-row">
            <div className="sec-ico ico-accent">{MAIL}</div>
            <div className="row-grow"><div className="conn-name">Gmail</div><div className="eyebrow">Read and reply from the Email tab</div></div>
          </div>
          <div className="row connect-row">
            <div className="sec-ico ico-blue">{CAL}</div>
            <div className="row-grow"><div className="conn-name">Google Calendar</div><div className="eyebrow">Events show up on Today</div></div>
          </div>
        </div></div>
        <div className="convo-foot"><button className="btn btn-primary btn-block" onClick={() => setIdx(idx + 1)}>Continue</button><div className="ob-skip" role="button" tabIndex={0} onClick={() => setIdx(idx + 1)}>Later \u2014 JARVIS works fine without it</div></div>
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
    <div className="ob-screen">
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
    <div className="ob-screen">
      <div className="ob-body">
        <div className="ob-card-title">{name ? `You\u2019re set, ${name}.` : "You\u2019re set."}</div>
        <div className="ob-sub">Here\u2019s your day, already moving.</div>
        <div className="grp"><div className="eyebrow">Today</div></div>
        <div className="pad-x"><div className="card">
          {briefLabel && (
            <div className="row"><div className="row-grow"><div className="conn-name">Morning brief</div></div><span className="row-status">{briefLabel}</span></div>
          )}
          <div className="row">
            <div className="row-grow"><div className="conn-name">Your areas</div></div>
            {seeds.slice(0, 6).map((s, i) => <span key={i} className={"cat-dot cat-bg-" + s.color} />)}
          </div>
          {taskTitle && (
            <div className="row">
              <span className="task-check" aria-hidden="true" />
              <div className="row-grow"><div className="conn-name">{taskTitle}</div><div className="eyebrow">Your top priority</div></div>
            </div>
          )}
        </div></div>
        {slotLine && <div className="ob-privacy"><div className="ob-privacy-txt">{slotLine} Tap it when it\u2019s done \u2014 I love that part.</div></div>}
      </div>
      <div className="ob-foot">
        <button className="btn btn-primary btn-block btn-lg" onClick={onEnter} disabled={saving}>Enter JARVIS</button>
      </div>
    </div>
  );
}
