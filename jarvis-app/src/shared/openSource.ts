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
//
// ONLY MAIL GOES TO EMAIL (audit 2026-09-29). "email" and "gmail" are the two
// stamps that name a thread, so they are the only two rows that may land on the
// Email tab, and there they land on a thread. A source that names a task (a
// block or a step made out of one) opens that task, not the inbox: it was a
// plain line before, which left "From a task" as the one origin with a record
// behind it and no way to it.
//
// Phase 0 D3 (2026-10-10): "app" and "import" have no route BY DESIGN. An app
// stamp's ref names a record in another app's store and an import names a
// file that is gone; neither is something this app can show, so both render a
// plain fact. openSource.test.ts pins the absence.
const ROUTE: Partial<Record<SourceType, string>> = {
  note: "note",
  event: "event",
  task: "task",
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
