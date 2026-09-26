import { useState } from "react";
import type { Person } from "../types";
import { personInitials, avatarClass } from "../types";
import { phonesOf, emailsOf, phoneText } from "../contactMethods";
import InlineEdit from "../../shared/InlineEdit";
import { catColor } from "../../shared/categories";
import { RowGlyph } from "../../shared/anatomy";
import { pressable } from "../../shared/pressable";
import { shortDate } from "../../shared/dateFormat";

const BACK = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
);
const EDIT = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z" /></svg>
);

// TAP A FACT TO CHANGE IT (Dave 2026-09-16: "Why can't I edit anything?").
//
// These rows stated what the app knew and answered no tap, so the only way
// to change a single wrong word was to find the pencil in the bar. The row
// is the door now, to the same sheet the pencil opens -- the app's own
// row-tap rule applied to the one section that is entirely facts.
//
// Not an inline field: a person's facts save as a set (the sheet's Save is
// what commits them), and a row that edited one value in place would be a
// second write path to the same record for no gain.
function KV({ label, value, onEdit }: { label: string; value?: string; onEdit?: () => void }) {
  if (!value) return null;
  return (
    <div className="row" {...(onEdit ? pressable(onEdit) : {})}>
      <div className="row-grow"><div className="conn-name">{label}</div></div>
      <span className="kv-val">{value}</span>
      {onEdit && <div className="chev" />}
      <div className="screen-foot" />
    </div>
  );
}

export default function PersonDetail({
  person,
  onEdit,
  onAddPoint,
  onTogglePoint,
  onBack,
  linkedNotes = [],
  goals = [],
  onOpenGoal,
  onOpenNote,
  onCallPrep,
  onMessage,
  categoryNames = [],
  lastTalked,
  quiet = false,
  onCheckIn,
  checkingIn = false,
  openWith = [],
  onOpenItem,
  onMessageAbout,
  trustedAdult = false,
  categoryColors = [],
  projects = [],
  onOpenProject,
  decided = [],
  onOpenDecision,
  promises = [],
  onAddTask,
}: {
  person: Person;
  onEdit: () => void;
  /** Next time we talk. Absent means the surface cannot write, and the whole
   *  section stays off rather than rendering a list that cannot be added to. */
  onAddPoint?: (text: string) => void;
  onTogglePoint?: (id: string) => void;
  onBack: () => void;
  linkedNotes?: { id: string; title: string; category: string }[];
  /** Goals reached through the projects this person is on, each saying which
   *  project carried them here. Resolved by the caller like everything else
   *  on this screen, which has no service access on purpose. */
  goals?: { id: string; title: string; via: string }[];
  onOpenGoal?: (id: string) => void;
  onOpenNote?: (id: string) => void;
  // Opens the Call Prep card (addendum item 2). Without it the row falls
  // back to a bare tel: link (surfaces with no service access).
  onCallPrep?: () => void;
  // Opens the Messages drafting sheet (addendum item 3). Without it the row
  // falls back to a bare sms: link.
  onMessage?: () => void;
  // Names of the categories this person belongs to (resolved by the caller,
  // since this screen has no service access on purpose).
  categoryNames?: string[];
  // UP-ATH-07 (2026-09-06): this person is the one Say It to Someone reaches.
  // A fact, resolved by the caller like everything else on this screen (the
  // health module has no business being imported here, and this screen has no
  // service access on purpose). Absent on everyone else, which is most people.
  trustedAdult?: boolean;
  // LAST TALKED (S6-Q40, 2026-08-10's lastContact.ts brought to the card
  // itself): a ready sentence ("3 Weeks ago", "Gone quiet · 2 Months ago"),
  // resolved by the caller same as everything else here (a Gmail lookup
  // needs a session this screen has no access to). Undefined hides the row:
  // no email, no session, or never talked.
  lastTalked?: string;
  // Gates the Check In action; does not affect what lastTalked itself says.
  quiet?: boolean;
  // Drafts the gone-quiet check-in (checkinPrompt, already written for the
  // same job on the Family/area pages) and opens it in the mail app --
  // mailto, never auto-sent. Absent when there is no email to check in on.
  onCheckIn?: () => void;
  checkingIn?: boolean;
  // B1 (audit 2026-08-21): the card was a business card. Everything the app
  // knew that involved this person -- the task with their name in it, the
  // meeting on Thursday -- lived one tab away with nothing connecting them.
  // Resolved by the caller, same as the notes and the categories.
  openWith?: import("../mentions").MentionItem[];
  onOpenItem?: (kind: "task" | "event", id: string) => void;
  // BRAIN-F-24 (2026-09-05): the drafting sheet has taken an `about` since
  // addendum item 3 built it, and no surface ever passed one, so every draft
  // was a generic check-in. These rows are the surface that knows: a message
  // about THIS task or THIS meeting, drafted from what it says. Absent when
  // there is no number to text.
  onMessageAbout?: (m: import("../mentions").MentionItem) => void;
  // C-59 / C-60 / C-61 (Astra, 2026-09-12). Label facts on the hero (the
  // relationship, the areas as dots), a Projects head with its count, a
  // Decided with Them head with no count (decisions are never counted), and
  // the promises he made this person in his own mail, in Still Open.
  categoryColors?: { name: string; color: string; role?: string }[];
  projects?: { id: string; title: string; next?: string | null }[];
  onOpenProject?: (id: string) => void;
  decided?: { id: string; decision: string; createdAt: string }[];
  onOpenDecision?: (id: string) => void;
  promises?: { threadId: string; text: string; due?: string }[];
  onAddTask?: (p: { threadId: string; text: string; due?: string }) => void;
}) {
  const { name, relationship, birthday, notes, color, register, flagged } = person.data;
  // EVERY WAY TO REACH THEM, NOT JUST THE FIRST (People handoff, 2026-09-16).
  // This card read person.data.email and person.data.phone, which are the
  // PRIMARY of each kind, so a contact with a mobile and a work line showed
  // one and the other was invisible -- and before the parser was fixed, the
  // second one was sitting in the notes blob under this very card.
  // contactMethods reads either storage shape, so a person saved before the
  // lists existed renders exactly as they did.
  const points = person.data.talkingPoints ?? [];
  const openPoints = points.filter((pt) => !pt.discussed);
  const [adding, setAdding] = useState(false);
  // True when the relationship is just an area's name said again.
  const areaEchoes = !!relationship
    && categoryColors.some((c) => c.name.trim().toLowerCase() === relationship.trim().toLowerCase());
  const phones = phonesOf(person.data);
  const emails = emailsOf(person.data);
  const phone = phones[0]?.value;
  const email = emails[0]?.value;
  const hasAttrs = relationship || birthday || flagged || register || categoryNames.length > 0 || !!lastTalked;
  // How JARVIS writes to them, stated in the card because it drives every
  // draft. Flagged wins over register, same precedence the drafting stack uses.
  const writeStyle = flagged
    ? "With care, always professional"
    : register === "friend" ? "Like a close friend"
    : register === "casual" ? "Casual"
    : register === "professional" ? "Professional"
    : undefined;
  return (
    <div className="screen ruled proj-ruled person-ruled">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <button className="nav-action" aria-label="Edit" onClick={onEdit}>{EDIT}</button>
      </div>
      <div className="person-hero">
        <div className={"av av-72 " + avatarClass(color)}>{personInitials(name)}</div>
        <div className="person-name">{name}</div>
        {/* C-59: the label facts. The relationship WAS the one coloured
            fact, in sky, until that class went with the blue subtext; it had
            been drawing plain grey ever since. It keeps the plain grey on
            purpose now: every area beside it carries a dot, which is a mark
            under §AK, so the relationship is the line's one grey. */}
        {(relationship || categoryColors.length > 0) && (
          <div className="facts person-facts">
            {/* NOT THE SAME WORD TWICE (Dave 2026-09-16, photographed:
                "Family · Family"). The handoff bans duplicated relationship
                labels, and this is how one appears: "Family" typed as the
                relationship next to the Family area chip. The area already
                says it, in colour, so the relationship chip stands down
                rather than repeating it. */}
            {relationship && !areaEchoes && <span className="fact">{relationship}</span>}
            {/* A ROLE PER AREA (People handoff, 2026-09-16). Where a role
                is set, the area says what they are IN it: "Family · Mother",
                "Bridge · Board secretary". Both facts on one chip, because
                they are one fact. An area with no role reads as it always
                did. Text, never colour alone: the area's dot is the colour
                and the words carry the meaning. */}
            {categoryColors.map((c) => (
              <span className="fact cat" key={c.name}>
                <span className={"cd cat-bg-" + catColor(c.color)} />
                {c.role ? c.name + " · " + c.role : c.name}
              </span>
            ))}
          </div>
        )}
        {trustedAdult && <div className="bp-sub">Trusted adult</div>}
      </div>
      {/* Reach them (2026-08-10): the email and phone this card has stored
          since the person pass, finally shown, and tappable so the card is a
          launchpad, not a filing cabinet. */}
      {(email || phone) && (
        <div className="sh2 sh2-quiet"><span className="t">Reach Them</span></div>
      )}
      {(email || phone) && (
        <div className="pad-x"><div className="card list-card-ruled">
          {phone && onCallPrep && (
            // Call Prep (addendum item 2): the call action opens the prep
            // card, which carries the dial. Context first, then the phone.
            <div {...pressable(onCallPrep)} className="row person-reach">
              <div className="row-grow"><div className="conn-name">Call</div></div>
              <span className="kv-val">{phoneText(phone)}</span>
            </div>
          )}
          {phone && !onCallPrep && (
            <a className="row person-reach" href={"tel:" + phone.replace(/[^+\d]/g, "")}>
              <div className="row-grow"><div className="conn-name">Call</div></div>
              <span className="kv-val">{phoneText(phone)}</span>
            </a>
          )}
          {phone && onMessage && (
            // Messages Drafting (addendum item 3): the text action opens the
            // drafting sheet; the draft exists when it opens.
            <div {...pressable(onMessage)} className="row person-reach">
              <div className="row-grow"><div className="conn-name">Text</div></div>
              <span className="kv-val">{phoneText(phone)}</span>
            </div>
          )}
          {phone && !onMessage && (
            <a className="row person-reach" href={"sms:" + phone.replace(/[^+\d]/g, "")}>
              <div className="row-grow"><div className="conn-name">Text</div></div>
              <span className="kv-val">{phoneText(phone)}</span>
            </a>
          )}
          {email && (
            <a className="row person-reach" href={"mailto:" + email}>
              <div className="row-grow"><div className="conn-name">Email</div></div>
              <span className="kv-val">{email}</span>
            </a>
          )}
          {/* THE REST OF THEM (People handoff, 2026-09-16: "let the user
              choose when multiple exist"). The primary keeps the three verbs
              above, because that is the one a tap should reach without
              thinking. Everything else is its own row, wearing the label the
              contact file gave it and nothing the app made up: a number with
              no label is drawn as a number.
              Call and Text are one row per number rather than two, because a
              second mobile does not need its own pair of verbs -- it needs to
              be reachable at all, which it was not. */}
          {phones.slice(1).map((m) => (
            <a className="row person-reach" key={"p" + m.value} href={"tel:" + m.value.replace(/[^+\d]/g, "")}>
              <div className="row-grow"><div className="conn-name">{m.label ? "Call " + m.label : "Call"}</div></div>
              <span className="kv-val">{phoneText(m.value)}</span>
            </a>
          ))}
          {emails.slice(1).map((m) => (
            <a className="row person-reach" key={"e" + m.value} href={"mailto:" + m.value}>
              <div className="row-grow"><div className="conn-name">{m.label ? "Email " + m.label : "Email"}</div></div>
              <span className="kv-val">{m.value}</span>
            </a>
          ))}
        </div></div>
      )}
      {/* NEXT TIME WE TALK (People handoff, 2026-09-16). Undated points, and
          undated is the point: these raise no notification and set no date.
          A talking point that nags is a task, and the app already has tasks.
          Discussed ones are kept rather than deleted, so the answer to "did I
          bring that up?" is on the card and the tick can be undone. */}
      {onAddPoint && (
        <div className="sh2 sh2-quiet">
          <span className="t">Next Time We Talk</span>
          {openPoints.length > 0 && <span className="n">{openPoints.length}</span>}
        </div>
      )}
      {onAddPoint && (
        <div className="pad-x"><div className="card list-card-ruled">
          {points.map((pt) => (
            // The row IS the door: a talking point has no detail to open, so
            // the only thing a tap can mean here is "raised it" -- which is
            // exactly what the ring does. Same gesture, whole row.
            <div className={"row" + (pt.discussed ? " past" : "")} key={pt.id}
              {...pressable(() => onTogglePoint?.(pt.id))}>
              <div className="task-check-tap" role="checkbox" aria-checked={!!pt.discussed}
                aria-label={(pt.discussed ? "Not discussed yet: " : "Mark discussed: ") + pt.text}
                onClick={(ev) => { ev.stopPropagation(); onTogglePoint?.(pt.id); }}>
                <div className={"task-check" + (pt.discussed ? " on" : "")} />
              </div>
              <div className="row-grow"><div className="conn-name">{pt.text}</div></div>
            </div>
          ))}
          {adding ? (
            <div className="row">
              <div className="row-grow">
                <InlineEdit className="conn-name" value="" focused placeholder="Bring This Up"
                  onSave={(v) => { setAdding(false); const t = v.trim(); if (t) onAddPoint(t); }} />
              </div>
            </div>
          ) : (
            <button className="row-create" onClick={() => setAdding(true)}>Add Something</button>
          )}
        </div></div>
      )}
      {hasAttrs && <div className="sh2 sh2-quiet"><span className="t">About</span></div>}
      {hasAttrs && (
        <div className="pad-x"><div className="card list-card-ruled">
          <KV label="Relationship" value={relationship} onEdit={onEdit} />
          <KV label="Birthday" value={birthday} onEdit={onEdit} />
          <KV label="JARVIS writes" value={writeStyle} onEdit={onEdit} />
          <KV label="Areas" value={categoryNames.length > 0 ? categoryNames.join(", ") : undefined} onEdit={onEdit} />
          {lastTalked && (
            // Row tap (Dave 2026-09-15, "I want all rows clickable"): a quiet
            // contact's row drafts the check in, as its pill does. It opens a
            // draft in the mail app and never sends.
            <div className="row" {...(quiet && onCheckIn && !checkingIn ? pressable(onCheckIn) : {})}>
              <div className="row-grow"><div className="conn-name">Last Talked</div></div>
              <span className="kv-val">{lastTalked}</span>
              {quiet && onCheckIn && (
                <button className="pill-act" disabled={checkingIn} onClick={(ev) => { ev.stopPropagation(); onCheckIn(); }}>
                  {checkingIn ? "Drafting" : "Check In"}
                </button>
              )}
            </div>
          )}
        </div></div>
      )}
      {notes && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Notes</span></div>
          <div className="pad-x"><div className="card list-card-ruled person-notes"><div className="note-body">{notes}</div></div></div>
        </>
      )}
      {/* What is STILL between you, not a history: open tasks with their name
          in them and time still ahead. Done work and past meetings are left
          out on purpose; a list of everything you ever did together is a
          scrapbook, and he opened this card to know what he owes. */}
      {(openWith.length > 0 || promises.length > 0) && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Still Open</span><span className="n">{openWith.length + promises.length}</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {/* C-61: what he said he would do, in his own mail to them.
                The amber fact is the promise (it needs him); the deadline
                beside it in small caps; Add Task writes the task and the row
                leaves. Purple is not in the Colour Key (§AM). */}
            {promises.map((p) => (
              // Row tap (Dave 2026-09-15): a promise has no task yet, so the row
              // does its pill's verb, Add Task.
              <div className="row" key={"promise:" + p.threadId} {...(onAddTask ? pressable(() => onAddTask(p)) : {})}>
                <div className="row-grow">
                  <div className="conn-name">{p.text}</div>
                  <div className="facts"><span className="fact warn">You promised</span>{p.due && <span className="fact date">{shortDate(p.due)}</span>}</div>
                </div>
                {onAddTask && <button type="button" className="pill-act" onClick={(ev) => { ev.stopPropagation(); onAddTask(p); }}>Add Task</button>}
              </div>
            ))}
            {openWith.map((m) => (
              <div className="task-row p2 notif-row" key={m.kind + m.id}
                role={onOpenItem ? "button" : undefined} tabIndex={onOpenItem ? 0 : undefined}
                onClick={onOpenItem ? () => onOpenItem(m.kind, m.id) : undefined}>
                <div className="task-check-tap"><RowGlyph kind={m.kind} /></div>
                <div className="task-title">
                  <span className="task-name">{m.title}</span>
                  {m.sub && <div className="r-k"><span className="r-goal r-cat">{m.sub}</span></div>}
                </div>
                {onMessageAbout && (
                  <button className="pill-act" onClick={(e) => { e.stopPropagation(); onMessageAbout(m); }}>Message</button>
                )}
                {onOpenItem && !onMessageAbout && <div className="chev"></div>}
              </div>
            ))}
          </div></div>
        </>
      )}
      {/* C-60: the projects this person is on, with the count. */}
      {projects.length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Projects</span><span className="n">{projects.length}</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {projects.map((p) => (
              <div className="row" key={p.id} {...(onOpenProject ? pressable(() => onOpenProject(p.id)) : {})}>
                <div className="row-grow">
                  <div className="conn-name">{p.title}</div>
                  {p.next && <div className="facts"><span className="fact">Next: {p.next}</span></div>}
                </div>
                {onOpenProject && <div className="chev" />}
              </div>
            ))}
          </div></div>
        </>
      )}
      {/* C-60: decided with them. No count, by law: a count of decisions is
          a guilt metric. */}
      {decided.length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Decided with Them</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {decided.map((d) => (
              <div className="row" key={d.id} {...(onOpenDecision ? pressable(() => onOpenDecision(d.id)) : {})}>
                <div className="row-grow">
                  <div className="conn-name">{d.decision}</div>
                  <div className="facts"><span className="fact">{shortDate(d.createdAt)}</span></div>
                </div>
                {onOpenDecision && <div className="chev" />}
              </div>
            ))}
          </div></div>
        </>
      )}
      {/* THE GOALS THEIR WORK IS UNDER (People handoff, 2026-09-16). Reached
          through the projects they are on, which is the only honest link the
          app has: a person is not attached to a goal, their work is. The row
          says which project carried them here, so the connection is visible
          rather than asserted. No progress figures: the handoff says not to
          invent them, and a goal's progress is a fact about the goal, not
          about this person's part in it. */}
      {goals.length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Goals</span><span className="n">{goals.length}</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {goals.map((g) => (
              <div className="row" key={g.id} {...(onOpenGoal ? pressable(() => onOpenGoal(g.id)) : {})}>
                <div className="row-grow">
                  <div className="conn-name">{g.title}</div>
                  <div className="conn-meta">Through {g.via}</div>
                </div>
                {onOpenGoal && <div className="chev" />}
              </div>
            ))}
          </div></div>
        </>
      )}
      {linkedNotes.length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Linked Notes</span><span className="n">{linkedNotes.length}</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {linkedNotes.map((n) => (
              <div className="task-row p2 note-row" role={onOpenNote ? "button" : undefined} tabIndex={onOpenNote ? 0 : undefined} key={n.id} onClick={onOpenNote ? () => onOpenNote(n.id) : undefined}>
                <div className="task-check-tap gm-slot"><span className={"cat-dot cat-bg-" + (n.category ? catColor(n.category) : "graphite")} /></div>
                <div className="task-title"><span className="task-name">{n.title}</span></div>
                {onOpenNote && <div className="chev"></div>}
              </div>
            ))}
          </div></div>
        </>
      )}
      <div className="screen-foot" />
    </div>
  );
}
