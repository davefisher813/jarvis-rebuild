// OPEN A PAGE, INSIDE THE TAP (2026-09-29).
//
// iOS treats a window.open that is not made synchronously inside the user's
// gesture as a popup and drops it, silently: no error, no tab. Every caller
// therefore calls this FIRST in its tap handler, before any await. Rendering
// or hovering a link never reaches here; only a tap does.
//
// It returns whether a window actually opened. The "noopener" feature string
// is deliberately not used: it makes window.open return null in every browser,
// so "blocked" and "opened" become the same answer and a caller can never tell
// which one it got. The opener is cut after the fact instead, which is the
// same protection and keeps the return value meaningful.

type Opener = Pick<Window, "open">;

export function openExternal(url: string, win: Opener | undefined = typeof window === "undefined" ? undefined : window): boolean {
  if (!win) return false;
  let w: ReturnType<Opener["open"]>;
  try { w = win.open(url, "_blank"); } catch { return false; }
  if (!w) return false;
  try { w.opener = null; } catch { /* a cross-origin window may refuse; the tab is open either way */ }
  return true;
}
