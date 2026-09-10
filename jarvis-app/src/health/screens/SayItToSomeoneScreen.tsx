import { useEffect, useState } from "react";
import { telHref, smsHref, hasTrustedAdult, crisisLineFor, regionOf, type CrisisLine } from "../trustedAdult";
import { pressable } from "../../shared/pressable";

// SAY IT TO SOMEONE (Part 5). Always present, one tap, no preamble: the
// athlete's own chosen trusted adult, plus the crisis line for where they
// are. Never gated behind a mood question or any screener -- this screen
// asks nothing before it offers both numbers.
export default function SayItToSomeoneScreen({
  name, phone, onSetTrustedAdult, onBack, handOff, onShare, people = [],
  // BRAIN-F-26 (2026-09-05, option a), reaching this screen too: 988 connects
  // in two countries, and this screen dialled it from anywhere on earth. The
  // line is read from the browser's own locale, and a region with none gets
  // no row, because a number that does not connect is worse than no number.
  // A default parameter rather than a required prop so the bench and the
  // module's own tests keep working, and so every caller is region-aware
  // without having to remember to be.
  crisisLine = crisisLineFor(regionOf(typeof navigator === "undefined" ? null : navigator.language)),
}: {
  name: string;
  phone: string;
  onSetTrustedAdult: (name: string, phone: string, personId?: string) => void;
  onBack: () => void;
  // UP-ATH-05 (2026-09-06): the dated Still There? summary, when the athlete
  // arrived here from Point at It. Absent on a normal visit, and then this
  // screen is exactly what it was: two numbers and no preamble.
  handOff?: string;
  // The way out when there is no trusted adult saved: the OS share sheet, so
  // the summary can still reach a person the app has never heard of.
  onShare?: (text: string) => void;
  crisisLine?: CrisisLine | null;
  // UP-ATH-07 (2026-09-06): the people the athlete already has, with a number
  // on them, handed in from outside like every other external fact this
  // module reads (src/health never imports src/people). Typing a name and a
  // number into a separate box meant the one number that has to work in a
  // crisis was a second copy of a number Contacts enrichment already keeps
  // fresh. Empty means the free-text form, exactly as it was.
  people?: { id: string; name: string; phone: string }[];
}) {
  const [editing, setEditing] = useState(!hasTrustedAdult(name, phone));
  const [draftName, setDraftName] = useState(name);
  const [draftPhone, setDraftPhone] = useState(phone);

  // A trusted adult saved on a PRIOR visit arrives async: the parent
  // (HealthFlow) starts this screen with empty name/phone and reloads from
  // the store after first paint. useState's initializer only runs once, so
  // without this the edit form stayed put forever on a fresh mount landing
  // straight on this screen (a deep link, a crisis-button tap) even though
  // a person was already saved -- the one screen where that has to work on
  // the very first paint. Only ever clears editing; never sets it, so an
  // athlete who taps Change Who You Call to replace someone is untouched.
  //
  // HMN-F-22 (2026-09-05): the drafts had the same problem and no fix. On a
  // fresh mount the form fields initialised empty and stayed empty, so
  // Change Who You Call opened a blank form and the athlete had to retype a
  // person the app already had. The drafts follow the loaded person while
  // they are still untouched; once anything is typed, typing wins.
  useEffect(() => { if (hasTrustedAdult(name, phone)) setEditing(false); }, [name, phone]);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (touched) return;
    if (name) setDraftName(name);
    if (phone) setDraftPhone(phone);
  }, [name, phone, touched]);

  return (
    <div className="screen ruled health-ruled">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">Say It to Someone</div>
      </div>

      <div className="pad-x"><div className="card pad">
        <div className="p3-q">Reach a Human Now</div>
        <div className="bp-sub">One tap, no questions first.</div>
      </div></div>

      {/* UP-ATH-05: what is about to be sent, in full, before anything is
          sent. The athlete reads their own message and can decide not to. */}
      {handOff && (
        <div className="pad-x"><div className="card pad">
          <div className="input-label">What Gets Sent</div>
          {/* One div per line rather than a white-space rule: the message is
              built as lines, and the app has no inline styles. */}
          {handOff.split("\n").map((line, i) => <div className="bp-sub" key={i}>{line}</div>)}
        </div></div>
      )}

      <div className="pad-x"><div className="card list-card-ruled">
        {hasTrustedAdult(name, phone) && !editing ? (
          <a className="row" href={handOff ? smsHref(phone, handOff) : telHref(phone)}>
            <div className="row-grow">
              <div className="conn-name">{handOff ? "Send This to " + name : name}</div>
              <div className="bp-sub">Your chosen person</div>
            </div>
          </a>
        ) : (
          <div className="row"><div className="row-grow"><div className="conn-name">Choose Someone</div></div></div>
        )}
        {crisisLine && (
          <a className="row" href={telHref(crisisLine.number)}>
            <div className="row-grow"><div className="conn-name">{crisisLine.label}</div><div className="bp-sub">Always here, day or night</div></div>
          </a>
        )}
      </div></div>

      {/* No saved person, or somebody else this time: the share sheet reaches
          anyone the phone can reach, and the summary goes with it. */}
      {handOff && onShare && (
        <div className="pad-x"><button className="btn btn-secondary btn-block" onClick={() => onShare(handOff)}>Hand It to Someone Else</button></div>
      )}

      {editing ? (
        <>
        {people.length > 0 && (
          <>
            <div className="sh2 sh2-quiet"><span className="t">From Your People</span></div>
            <div className="pad-x"><div className="card list-card-ruled">
              {people.map((p) => (
                <div className="row" key={p.id} {...pressable(() => { onSetTrustedAdult(p.name, p.phone, p.id); setEditing(false); })}>
                  <div className="row-grow"><div className="conn-name">{p.name}</div><div className="bp-sub">{p.phone}</div></div>
                </div>
              ))}
            </div></div>
            <div className="pad-x"><div className="bp-sub">That's everyone you have a number for.</div></div>
            <div className="sh2 sh2-quiet"><span className="t">Or Somebody Else</span></div>
          </>
        )}
        <div className="pad-x"><div className="card pad">
          <div className="field">
            <div className="input-label">Their Name</div>
            <input className="input" value={draftName} onChange={(e) => { setTouched(true); setDraftName(e.target.value); }} placeholder="A Name You Trust" />
          </div>
          <div className="field">
            <div className="input-label">Their Number</div>
            <input className="input" type="tel" value={draftPhone} onChange={(e) => { setTouched(true); setDraftPhone(e.target.value); }} placeholder="A Number That Reaches Them" />
          </div>
          <button
            className="btn btn-primary btn-block"
            disabled={!draftName.trim() || !draftPhone.trim()}
            onClick={() => { onSetTrustedAdult(draftName, draftPhone); setEditing(false); }}
          >
            Save This Person
          </button>
        </div></div>
        </>
      ) : (
        <div className="pad-x"><button className="btn btn-secondary btn-block" onClick={() => setEditing(true)}>Change Who You Call</button></div>
      )}
      <div className="screen-foot" />
    </div>
  );
}
