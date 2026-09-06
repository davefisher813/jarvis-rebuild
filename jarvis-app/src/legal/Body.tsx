import { Fragment, type ReactNode } from "react";
import type { LegalDoc, Inline, Block } from "./content";

// UP-LAUNCH-05 (2026-09-05): the in-app half of the one legal source. The
// three screens under src/settings render this; public/*.html is generated
// from the same document by tools/build-legal.mjs.
//
// Two deliberate differences from the web rendering, both of which preserve
// exactly what each surface did before they shared a source:
//
//   A list becomes one paragraph per item rather than a <ul>. That is what
//   PrivacyPage and SupportPage already looked like, and the legal card's
//   type scale was built for paragraphs.
//
//   A link renders as its own text, not an anchor. Nothing in the app's legal
//   screens has ever been tappable, and an <a href> inside the Capacitor
//   webview navigates the app away from itself with no way back. When these
//   pages get a real external-link affordance, it goes here and both
//   renderings gain it at once.

function inline(run: Inline, key: number): ReactNode {
  if (typeof run === "string") return <Fragment key={key}>{run}</Fragment>;
  if ("b" in run) return <b key={key}>{run.b}</b>;
  return <Fragment key={key}>{run.a}</Fragment>;
}

const runs = (rs: Inline[]): ReactNode => rs.map(inline);

function block(b: Block, key: number): ReactNode {
  if (b.kind === "ul") return <Fragment key={key}>{b.items.map((item, i) => <p key={i}>{runs(item)}</p>)}</Fragment>;
  return <p key={key}>{runs(b.runs)}</p>;
}

export default function LegalBody({ doc }: { doc: LegalDoc }) {
  return (
    <>
      {doc.intro.map(block)}
      {doc.sections.map((s, i) => (
        <Fragment key={i}>
          <h4 className="legal-h">{s.heading}</h4>
          {s.blocks.map(block)}
        </Fragment>
      ))}
    </>
  );
}
