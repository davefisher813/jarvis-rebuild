import { useState } from "react";
import { useProfile, useCategories, usePeople } from "../data/NotesProvider";
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

export default function OnboardingFlow({ onFinish }: { onFinish: () => void }) {
  const profile = useProfile();
  const categories = useCategories();
  const peopleSvc = usePeople();

  const [idx, setIdx] = useState(0);
  const [name, setName] = useState("");
  const [nameDraft, setNameDraft] = useState("");
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
      case "connect": return "Coming soon";
      case "time": return s.options?.find((o) => o.value === briefTime)?.label ?? "Skip";
      default: return "";
    }
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

  // ---- done ----
  if (step.kind === "done") {
    return (
      <div className="ob-screen">
        <div className="convo">
          <div className="convo-sender">JARVIS</div>
          {STEPS.slice(1, idx).map((s) => (
            <Turn key={s.id} prompt={s.prompt!} answer={answerOf(STEPS.indexOf(s))} />
          ))}
          <div className="bubble bubble-ai">{name ? `You\u2019re all set, ${name}. I\u2019ll take it from here.` : step.prompt}</div>
        </div>
        <div className="ob-foot">
          <button className="btn btn-primary btn-block btn-lg" onClick={() => finish(true)} disabled={saving}>Enter JARVIS</button>
        </div>
      </div>
    );
  }

  // ---- conversation steps ----
  const transcript = (
    <div className="convo">
      <div className="convo-sender">JARVIS</div>
      {STEPS.slice(1, idx).map((s) => (
        <Turn key={s.id} prompt={s.prompt!} answer={answerOf(STEPS.indexOf(s))} />
      ))}
      <div className="bubble bubble-ai">{step.prompt}</div>
    </div>
  );

  let control = null;
  if (step.kind === "text") {
    control = (
      <div className="convo-foot">
        <div className="convo-inputbar">
          <input
            className="input"
            placeholder={step.placeholder}
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            autoFocus
          />
          <button className="convo-send" aria-label="Send" onClick={() => { if (nameDraft.trim()) { setName(nameDraft.trim()); setIdx(idx + 1); } }}>{SEND}</button>
        </div>
      </div>
    );
  } else if (step.kind === "choice") {
    control = (
      <div className="convo-foot">
        <div className="convo-chips">
          {step.options!.map((o) => (
            <div key={o.value} className="chip" role="button" tabIndex={0} onClick={() => pickTemplate(o.value as TemplateKey)}>{o.label}</div>
          ))}
        </div>
      </div>
    );
  } else if (step.kind === "categories") {
    control = (
      <>
        <div className="pad-x"><div className="card">
          {seeds.map((s, i) => (
            <div className="row" key={s.name + i}>
              <span className={"ob-swatch cat-bg-" + s.color} />
              <div className="row-grow"><div className="conn-name">{s.name}</div></div>
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
        <button className="btn btn-secondary btn-block" onClick={() => setIdx(idx + 1)}>{people.length ? "Continue" : "Skip for now"}</button>
      </div>
    );
  } else if (step.kind === "connect") {
    control = (
      <>
        <div className="pad-x"><div className="card">
          <div className="row connect-row">
            <div className="sec-ico ico-accent">{MAIL}</div>
            <div className="row-grow"><div className="conn-name">Gmail</div></div>
            <button className="chip" disabled>Coming soon</button>
          </div>
          <div className="row connect-row">
            <div className="sec-ico ico-blue">{CAL}</div>
            <div className="row-grow"><div className="conn-name">Google Calendar</div></div>
            <button className="chip" disabled>Coming soon</button>
          </div>
        </div></div>
        <div className="convo-foot"><div className="input-hint">Email and calendar connect in a later update.</div><button className="btn btn-primary btn-block" onClick={() => setIdx(idx + 1)}>Continue</button></div>
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
