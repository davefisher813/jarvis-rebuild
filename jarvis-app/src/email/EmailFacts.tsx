// THE ONE WAY THE EMAIL TAB DRAWS A LINE OF FACTS (2026-10-05, Dave's visual
// catalog gate: "Open Email to Review" and "Task · Due Today" came back as two
// thin grey lines on the Email card). The catalog's answer is the same on every
// screen: separate .fact spans, the separator drawn by the stylesheet (never a
// middle dot inside a string), a fact with a meaning wearing its key colour, at
// most one untoned (grey) fact on the line, and nothing drawn at all when there
// is nothing to say. This component is that answer for this tab. Pass `wrap`
// for a line whose job is to show every fact (a message head, a search
// coverage line): it draws the wrapping .conn-meta instead of the one-line
// .facts, which ellipsizes its last fact.

import type { EmailFact } from "./format";

export default function EmailFacts({ facts, wrap = false }: { facts: readonly EmailFact[]; wrap?: boolean }) {
  const list = facts.filter((f) => f.text.trim());
  if (list.length === 0) return null;
  const spans = list.map((f, i) => (
    <span key={i + ":" + f.text} className={"fact" + (f.cat ? " cat" : "") + (f.tone ? " " + f.tone : "")}>
      {f.cat && <span className={"cd cat-bg-" + f.cat} />}
      {f.cat ? <span className="cat-t">{f.text}</span> : f.strong ? <b>{f.text}</b> : f.text}
    </span>
  ));
  return wrap ? <div className="conn-meta">{spans}</div> : <div className="facts">{spans}</div>;
}
