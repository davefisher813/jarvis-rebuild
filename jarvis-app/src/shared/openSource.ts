import type { Source, SourceType } from "./provenance";

// UP-CORE-05 (2026-09-05): ONE MAP FROM A SOURCE STAMP TO A ROUTE.
//
// ProvenanceLine.tsx has rendered a button since it was written, for any caller
// that could supply the navigation, and until SHARED-F-17 no caller did. That
// fix wired the two Tasks surfaces by hand; every other surface that shows a
// provenance line (an event row, an event sheet, a note editor) would have
// needed the same hand-written map, which is how three surfaces end up
// disagreeing about where "From an email" goes.
//
// Only the types that resolve to something the app can actually show appear
// here. Everything else returns undefined and Provenance renders a plain
// fact, which is the honest answer: a button that does nothing is the bug in
// a different costume.
const ROUTE: Partial<Record<SourceType, string>> = {
  note: "note",
  event: "event",
  email: "email",
  gmail: "email",
  file: "file",
};

export function sourceOpener(nav: (kind: string, id: string) => void): (source: Source) => (() => void) | undefined {
  return (source: Source) => {
    const ref = source.ref;
    const kind = ROUTE[source.type];
    if (!ref || !kind) return undefined;
    return () => nav(kind, ref);
  };
}
