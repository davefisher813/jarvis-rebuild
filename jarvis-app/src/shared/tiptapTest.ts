// The shims a jsdom test needs before it mounts the shared document editor.
// ProseMirror measures the page to place the caret and to scroll it into
// view; jsdom has no layout, so a Range has no rectangles and there is no
// element under a point. Every value here is the honest zero. Import this
// file at the top of any jsdom test that renders DocEditor.

const ZERO_RECT = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) } as DOMRect;

function rectList(): DOMRectList {
  const list = [] as unknown as DOMRectList;
  return list;
}

if (typeof window !== "undefined") {
  const R = window.Range?.prototype as (Range & { getClientRects?: () => DOMRectList; getBoundingClientRect?: () => DOMRect }) | undefined;
  if (R) {
    if (typeof R.getClientRects !== "function") R.getClientRects = rectList;
    if (typeof R.getBoundingClientRect !== "function") R.getBoundingClientRect = () => ZERO_RECT;
  }
  const D = document as Document & { elementFromPoint?: (x: number, y: number) => Element | null };
  if (typeof D.elementFromPoint !== "function") D.elementFromPoint = () => null;
  const W = window as Window & { scrollTo?: (...a: unknown[]) => void };
  // jsdom has a scrollTo that only reports it is not implemented; a quiet one
  // replaces it, since ProseMirror scrolls the caret into view on focus.
  W.scrollTo = () => {};
  const E = window.Element?.prototype as (Element & { scrollIntoView?: () => void }) | undefined;
  if (E && typeof E.scrollIntoView !== "function") E.scrollIntoView = () => {};
}
