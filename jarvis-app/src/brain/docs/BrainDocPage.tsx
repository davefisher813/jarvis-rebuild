import { useEffect, useRef, useState, type ReactNode } from "react";
import { Compass, PenNib, Flag } from "@phosphor-icons/react";
import { useBrainDocs, useOptionalStrands, useOptionalRules } from "../../data/NotesProvider";
import { todayISO } from "../../ai/useAIContext";
import { WRITING_CHANNEL_LABEL, type Strand, type WritingChannel } from "../strands/types";
import { stateForStrand, toneForStrandState, STRAND_STATE_LABEL } from "../strands/state";
import { writingProposals, type WritingProposal } from "../writingProposals";
import type { LearnedRule } from "../../rules/LearnedRulesService";
import { attemptWrite } from "../../shared/guard";
import RowStar from "../../shared/RowStar";
import { lineCase } from "../../shared/casing";
import { docMeta } from "./types";
import { useAI } from "../../ai/useAI";
import { buildVisionMessage } from "../../ai/AIService";
import { JARVIS_VOICE } from "../../ai/voice";
import { encodeImageForVision } from "../../shared/imageEncode";
import { showToast } from "../../shared/toast";
import PageHeader from "../../shared/PageHeader";
import MarkdownField from "../../shared/MarkdownField";
import { pressable, onPressKey } from "../../shared/pressable";
import FiledRows from "../manual/FiledRows";
import type { BrainMemoryCategory } from "../../ai/brainMemory";
import RowShell from "../RowShell";
import RowCtxAction from "../../shared/RowCtxAction";
import RowSheet from "../RowSheet";
import { cleanHardLines, HARD_LINE_LABEL, HARD_LINE_PROMISE, MAX_HARD_LINES, type HardLine, type HardLineKind } from "../hardLines";

// The empty page's glyph: the topic's own, in the outline weight, the same marks the Brain's Explore rows wear.
const DOC_GLYPH: Record<string, ReactNode> = {
  philosophy: <Compass className="ic" weight="regular" />,
  writing: <PenNib className="ic" weight="regular" />,
  values: <Flag className="ic" weight="regular" />,
};

const PHOTO = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
);

// What JARVIS should pull from a photo, per doc. Falls back to a generic read.
const PHOTO_TASK: Record<string, string> = {
  writing: "The image is something the user wrote (texts, an email, a post). Study HOW they write: tone, sentence length, greetings or the lack of them, punctuation habits, words they favor. Reply with 3 to 6 short plain lines describing their style, each on its own line, no bullets or numbering, no preamble. These lines go straight into the user's own style notes.",
  values: "The image relates to what matters to this user. Reply with 2 to 4 short plain lines capturing the values it reveals, each on its own line, no preamble.",
  philosophy: "The image relates to how this user thinks about life or work. Reply with 2 to 4 short plain lines capturing the outlook it shows, each on its own line, no preamble.",
};

// Which filed category lands on which doc page.
const FILED_FOR: Record<string, BrainMemoryCategory | undefined> = {
  philosophy: "philosophy",
  values: "value",
  writing: "voice",
};

export default function BrainDocPage({ topic, onBack }: { topic: string; onBack: () => void }) {
  const docs = useBrainDocs();
  const ai = useAI();
  const meta = docMeta(topic);
  const [text, setText] = useState("");
  // THE SHARED EDITOR (the writing system, wave 3c): the document is built
  // from the stored words once per load and once more when a photo appends
  // lines, never on a keystroke.
  const [docKey, setDocKey] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [reading, setReading] = useState(false);
  // A page with nothing written is an empty state until the person starts: the editor is a canvas with no edge, so a blank one
  // was a blank page (Dave 2026-10-05: "he opens the app and finds nothing"). Start Writing opens the card and its caret.
  const [started, setStarted] = useState(false);
  // C-57 / C-56 (Astra, 2026-09-12): on How You Write, the writing facts
  // grouped by channel, and the draft-edit proposals waiting for a word.
  const isWriting = topic === "writing";
  const strandsSvc = useOptionalStrands();
  const rulesSvc = useOptionalRules();
  const [writingStrands, setWritingStrands] = useState<Strand[]>([]);
  const [proposals, setProposals] = useState<WritingProposal[]>([]);
  // A proposed rule's sheet, and a hard line's: a row is a door, so what it holds opens on a tap (Dave 2026-10-05).
  const [asking, setAsking] = useState<WritingProposal | null>(null);
  const [lineOpen, setLineOpen] = useState<number | null>(null);
  const loadWriting = async () => {
    if (!isWriting) return;
    try {
      if (strandsSvc) setWritingStrands((await strandsSvc.list()).filter((s) => s.data.category === "writing" && s.data.status === "active"));
      if (rulesSvc) setProposals(writingProposals(await rulesSvc.list()));
    } catch { /* the heads simply do not render */ }
  };
  useEffect(() => { void loadWriting(); }, [isWriting, strandsSvc, rulesSvc]);
  // That's Right: the proposal becomes a writing strand on the email
  // channel, and the rule is marked announced so it stops asking.
  const confirmProposal = async (p: WritingProposal) => {
    if (!strandsSvc || !rulesSvc) return;
    const today = todayISO();
    let id: string | null = null;
    const ok = await attemptWrite(async () => {
      id = await strandsSvc.add(p.text, "writing", today, "influence", "pattern");
      if (id) {
        const made = (await strandsSvc.list()).find((s) => s.id === id);
        if (made) await strandsSvc.setChannel(made, "email");
      }
      await rulesSvc.markAnnounced(p.rule as LearnedRule);
    });
    if (!ok) return;
    if (!id) { showToast({ message: "The Brain Is Full · Prune It in What JARVIS Knows" }); return; }
    showToast({ message: "Saved to Writing" });
    await loadWriting();
  };
  const fileRef = useRef<HTMLInputElement>(null);

  // BRAIN-F-12 (2026-09-05): with no catch, one failed read left `loaded`
  // false forever: the writing surface stayed greyed out with nothing said
  // and no way to ask again short of leaving the tab. It says so now, and
  // Try Again re-runs this effect.
  // UP-MIND-20 (2026-09-05): the Values doc's hard lines, edited as chips
  // beside the prose. Values only: the other two docs shape how JARVIS
  // writes, and neither of them stops the app doing anything.
  const isValues = topic === "values";
  const [lines, setLines] = useState<HardLine[]>([]);
  const [lineKind, setLineKind] = useState<HardLineKind>("never_file");
  const [lineText, setLineText] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let on = true;
    setLoadFailed(false);
    docs.get(topic)
      .then(async (t) => {
        const hl = isValues ? await docs.hardLines(topic).catch(() => []) : [];
        if (on) { setText(t); setLines(hl); setLoaded(true); setDocKey((k) => k + 1); }
      })
      .catch(() => { if (!on) return; setLoadFailed(true); showToast({ message: "Couldn't Load · Check Your Connection" }); });
    return () => { on = false; };
  }, [docs, topic, attempt]);

  // C-16 (Astra, 2026-09-12): AUTOSAVE, the notes blur-save shape. The bar
  // Save is gone; the doc writes when the canvas loses focus and when a
  // hard line changes, one write at a time through a queue so a save
  // started on blur and one started by a chip tap never race each other.
  // Failed saves surface instead of dying silently (audit 2026-07-30).
  const queueRef = useRef<Promise<void> | null>(null);
  const latestRef = useRef<{ text: string; lines: HardLine[]; dirty: boolean }>({ text: "", lines: [], dirty: false });
  latestRef.current = { text, lines, dirty };
  const save = async () => {
    const run = async () => {
      const cur = latestRef.current;
      try {
        await docs.save(topic, cur.text.trim(), isValues ? cur.lines : undefined);
        setDirty(false);
      } catch {
        showToast({ message: "Couldn't Save · Check Your Connection" });
      }
    };
    const prev = queueRef.current ?? new Promise<void>((done) => done());
    queueRef.current = prev.then(run, run);
    await queueRef.current;
  };
  // Hard lines save on the change itself; the canvas saves on blur.
  const linesDirtyRef = useRef(false);
  const addLine = () => {
    if (!lineText.trim()) return;
    linesDirtyRef.current = true;
    setLines((ls) => cleanHardLines([...ls, { kind: lineKind, match: lineText.trim() }]));
    setLineText("");
    setDirty(true);
  };
  const removeLine = (i: number) => { linesDirtyRef.current = true; setLines((ls) => ls.filter((_, j) => j !== i)); setDirty(true); };
  useEffect(() => {
    if (!loaded || !linesDirtyRef.current) return;
    linesDirtyRef.current = false;
    void save();
  }, [lines]);

  // Photo-to-doc (Dave 2026-07-30): pick a photo, JARVIS reads it and appends
  // what it learned as editable text. The user reviews, then taps Save; the AI
  // never writes to storage directly.
  const onPhoto = async (file: File) => {
    setReading(true);
    try {
      // SHARED-F-23 (2026-09-05): this used to call fileToAIImage, the older
      // single-guess encoder, whose header claimed the proxy allows ~340KB
      // when api/ai.ts:62 caps a vision request at 600,000 bytes. One guess
      // at 896px/q0.72 is not checked against any cap, which is the silent
      // 413 imageEncode.ts was written to end. One encoder now, and it
      // verifies its own output before handing it over.
      const img = await encodeImageForVision(file);
      const task = PHOTO_TASK[topic] ?? `The image is something the user added to their "${meta?.title ?? topic}" notes. Reply with 2 to 4 short plain lines capturing what it should add to those notes, each on its own line, no preamble.`;
      const out = await ai.complete([buildVisionMessage(task, img.data, img.mediaType)], JARVIS_VOICE);
      const clean = out.trim();
      if (!clean) throw new Error("empty");
      setText((t) => (t.trim() ? t.replace(/\s+$/, "") + "\n" + clean : clean));
      setDocKey((k) => k + 1);
      setDirty(true);
    } catch {
      showToast({ message: "Couldn't Read That · Try a Clearer Photo" });
    } finally {
      setReading(false);
    }
  };

  return (
    <div className="screen ruled">
      <PageHeader
        title={meta?.title ?? "Note"}
        back="Brain"
        onBack={onBack}
      />
      {/* Deep writing pass (2026-08-19): brain docs write on the notes
          canvas, not in a boxed form field. Same typography, same caret. */}
      <div>
        {/* A BUTTON NEVER STANDS ALONE IN A BOX (Dave 2026-10-05, rule 12). The retry sat by itself in a grey plate. The read
            failing is a thing to say, so the card keeps its own words, as Your Routine's load failure does. */}
        {loadFailed && !loaded && (
          <div className="pad-x"><div className="card list-card-ruled">
            <div className="empty-state">
              <div className="t-body">Couldn't Load This Page</div>
              <button className="btn btn-secondary" onClick={() => setAttempt((n) => n + 1)}>Try Again</button>
            </div>
          </div></div>
        )}
        {isValues && loaded && <div className="sh2 sh2-quiet"><span className="t">What Matters</span></div>}
        {loaded && text.trim() === "" && !started && (
          <div className="empty-state empty-compact">
            <div className={"empty-icon " + (meta?.tone ?? "")}>{DOC_GLYPH[topic]}</div>
            <div className="empty-title">Nothing Written Yet</div>
            <div className="empty-sub">{meta?.emptyLine}</div>
            <button type="button" className="btn btn-primary" onClick={() => setStarted(true)}>Start Writing</button>
          </div>
        )}
        {loaded && (text.trim() !== "" || started) && (
          // A REAL CARD TO WRITE IN, not a canvas with no edge (Dave 2026-10-05, the review: the page was blank to the dock).
          <div className="pad-x"><div className="card pad doc-card"><MarkdownField
            value={text}
            docKey={topic + ":" + docKey}
            level="document"
            placeholder={meta?.placeholder}
            ariaLabel={meta?.title ?? "Note"}
            autofocus={started && text.trim() === ""}
            onChange={(v) => { setText(v); setDirty(true); }}
            onBlur={() => { if (latestRef.current.dirty) void save(); }}
          /></div></div>
        )}
        {/* C-57: the writing facts by channel, each row the strand row's
            anatomy. C-56: a draft-edit rule waiting for a word sits under
            Email with That's Right. */}
        {isWriting && (writingStrands.length > 0 || proposals.length > 0) && (
          (["email", "text", "general"] as WritingChannel[]).map((ch) => {
            const rows = writingStrands.filter((s) => (s.data.channel ?? "general") === ch);
            const asks = ch === "email" ? proposals : [];
            if (rows.length === 0 && asks.length === 0) return null;
            return (
              <div key={ch}>
                <div className="sh2 sh2-quiet"><span className="t">{WRITING_CHANNEL_LABEL[ch]}</span><span className="n">{rows.length + asks.length}</span></div>
                <div className="pad-x"><div className="card list-card-ruled shell-rows">
                  {rows.map((s) => {
                    const st = stateForStrand(s, todayISO());
                    return (
                      <RowShell key={s.id}>
                        <div className="row strand-row">
                          <RowStar on={!!s.data.link} />
                          <div className="row-grow">
                            <div className="conn-name">{lineCase(s.data.text)}</div>
                            <div className="facts">
                              {st && <span className={"fact st " + toneForStrandState(st)}>{STRAND_STATE_LABEL[st]}</span>}
                              {s.data.strength === "rule" && <span className="fact st">Rule</span>}
                              {(s.data.evidence?.length ?? 0) > 0 && <span className="fact">{lineCase(`${s.data.evidence!.length} edits`)}</span>}
                            </div>
                          </div>
                        </div>
                      </RowShell>
                    );
                  })}
                  {asks.map((p) => (
                    // CLEAN ROWS (Dave 2026-10-05, locked): That's Right is the swipe-left, the one quiet word on a row that is
                    // asking right now, and the sheet's primary; each an explicit tap, which the Brain's identity-write agency
                    // law asks for.
                    <RowShell key={"ask:" + p.rule.id} verb={{ label: "That's Right", run: () => void confirmProposal(p) }}>
                      <div {...pressable(() => setAsking(p))} className="row strand-row">
                        <div className="row-grow">
                          <div className="conn-name">{lineCase(p.text)}</div>
                          <div className="facts"><span className="fact st warn">Needs Confirmation</span><span className="fact">{lineCase(`${p.edits} edits`)}</span></div>
                        </div>
                        <RowCtxAction when label="That's Right" ariaLabel={"That's Right, " + lineCase(p.text)} onAct={() => void confirmProposal(p)} />
                      </div>
                    </RowShell>
                  ))}
                </div></div>
              </div>
            );
          })
        )}
        {/* UP-MIND-20: the hard lines. Typed by the user, on their own
            page, and nowhere else: the app never writes a Value. Each chip
            says exactly what it will stop, because a rule that stops an
            automatic action has to be readable at a glance. */}
        {isValues && loaded && (<>
          <div className="sh2 sh2-quiet"><span className="t">Hard Lines</span>{lines.length > 0 && <span className="n">{lines.length}</span>}</div>
          <div className="pad-x"><div className="card list-card-ruled shell-rows">
            {lines.map((l, i) => (
              // CLEAN ROW (Dave 2026-10-05): the line is its words, the kind is its one grey fact (the dot, if any, is
              // CSS), Remove is the swipe-left, and what the line promises, and Remove again, are on the sheet a tap opens.
              <RowShell key={l.kind + l.match} verb={{ label: "Remove", run: () => removeLine(i) }}>
                <div {...pressable(() => setLineOpen(i))} className="row">
                  <div className="row-grow">
                    <div className="conn-name">{l.match}</div>
                    <div className="facts"><span className="fact">{HARD_LINE_LABEL[l.kind]}</span></div>
                  </div>
                  <div className="chev" />
                </div>
              </RowShell>
            ))}
            {lines.length < MAX_HARD_LINES && (
              <div className="pad-x sheet-form hard-add">
                {/* THREE KINDS FIT ONE ROW (Dave 2026-10-05, the review: the chips ran off the card and "Protect" was cut).
                    One choice of three is the app's segmented control. */}
                <div className="segmented seg-tri" role="radiogroup" aria-label="What this line does">
                  {(Object.keys(HARD_LINE_LABEL) as HardLineKind[]).map((k) => (
                    <button type="button" key={k} className={"seg" + (lineKind === k ? " active" : "")} role="radio" aria-checked={lineKind === k} onClick={() => setLineKind(k)}>{HARD_LINE_LABEL[k]}</button>
                  ))}
                </div>
                {/* The field, with its one verb at its trailing edge as text, there only while there is something to add: a
                    full-width disabled slab said nothing and read as an inert block. */}
                <div className="hard-add-field">
                  <input
                    className="input"
                    placeholder="Gym, Family, School.org"
                    value={lineText}
                    onChange={(e) => setLineText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLine(); } }}
                    aria-label="What this line is about"
                  />
                  <RowCtxAction when={!!lineText.trim()} label="Add" ariaLabel="Add a Line" onAct={addLine} />
                </div>
              </div>
            )}
          </div></div>
        </>)}
        {ai.available && (
          <>
            <input
              ref={fileRef}
              className="visually-hidden-input"
              type="file"
              accept="image/*"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPhoto(f); e.target.value = ""; }}
            />
            <div className="pad-x"><div className="card list-card-ruled">
              <div {...pressable(() => !reading && fileRef.current?.click())} className="row">
                <div className="sec-ico ico-blue">{PHOTO}</div>
                <div className="row-grow">
                  <div className="conn-name">{reading ? "Reading your photo..." : "Add a Photo"}</div>
                  {/* ONE FACT, NOT TWO (Dave 2026-09-03, pic 2). "JARVIS
                      reads it · Learns from it" was a two-token
                      concatenation under a title, which the subtext law
                      forbids outright, and the capital L mid-line was the
                      casing it made him look at. One sentence says both. */}
                  {reading && <div className="conn-meta">Reading</div>}
                </div>
              </div>
            </div></div>
          </>
        )}
      </div>
      {/* Brain Manual v1: what was filed to this page from a note, an
          email or the + menu. Nothing filed, nothing drawn. */}
      {FILED_FOR[topic] && <FiledRows categories={[FILED_FOR[topic]!]} />}
      {asking && (
        <RowSheet eyebrow="Needs Confirmation" text={lineCase(asking.text)} facts={<span className="fact">{lineCase(`${asking.edits} edits`)}</span>}
          answers={[{ label: "That's Right", onPick: () => void confirmProposal(asking) }]} onClose={() => setAsking(null)} />
      )}
      {lineOpen !== null && lines[lineOpen] && (
        <RowSheet eyebrow={HARD_LINE_LABEL[lines[lineOpen]!.kind]} text={lines[lineOpen]!.match}
          facts={<span className="fact">{HARD_LINE_PROMISE[lines[lineOpen]!.kind]}</span>}
          answers={[{ label: "Remove", destructive: true, onPick: () => removeLine(lineOpen) }]} onClose={() => setLineOpen(null)} />
      )}
    </div>
  );
}
