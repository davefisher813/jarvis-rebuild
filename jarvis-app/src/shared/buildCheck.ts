// IS THE APP STILL RUNNING THE BUILD THAT IS DEPLOYED?
//
// (2026-09-16, Dave, after a day of shipped work he could not see: "I don't
// see any difference... it's been the same push forever.")
//
// THE BUG, in two halves, both of which have to be fixed or neither matters.
//
// 1. A HOME-SCREEN APP ON iOS IS SUSPENDED AND RESUMED, NOT CLOSED AND
//    LOADED. Tapping its icon restores the process: no `load` event, and no
//    navigation. The service worker's HTML handler is network-first, which
//    would have caught a new deploy -- but it only runs on a NAVIGATION, and
//    resuming is not one. So the running page can be days old and nothing in
//    the app ever asks.
//
// 2. reg.update() DOES NOT HELP, which is the part that makes this subtle.
//    The browser installs a new service worker only when /sw.js differs byte
//    for byte, and sw.js is a static file: it is identical across every
//    deploy that does not edit it. The bundles change names every deploy; the
//    worker that caches them does not. So the update check finds nothing, no
//    new worker installs, controllerchange never fires, and the reload that
//    was supposed to follow never happens.
//
// So the check has to look at the thing that actually changes: the hashed
// bundle filename in the deployed HTML. If the document being served names a
// different entry bundle than the one this code is running from, this tab is
// out of date and a reload is the whole fix -- the reload is a navigation, so
// the worker fetches fresh HTML, and the new bundle is not in the asset cache
// so it is fetched too.
//
// Nothing here caches, guesses or version-stamps. It compares the bundle it
// is running from with the bundle the server is handing out.

/** The entry bundle this code was loaded from, e.g. "/assets/index-a1b2c3.js".
 *  Null in a test or any context with no module URL. */
export function runningBundle(moduleUrl: string | undefined): string | null {
  if (!moduleUrl) return null;
  try {
    return new URL(moduleUrl, "http://x").pathname;
  } catch {
    return null;
  }
}

/** The entry bundle the deployed HTML points at. Null when the document does
 *  not name one, which is every case where guessing would be worse than
 *  doing nothing. */
export function deployedBundle(html: string): string | null {
  // Vite writes <script type="module" crossorigin src="/assets/index-HASH.js">.
  const m = /<script[^>]+src="(\/assets\/[^"]+\.js)"/.exec(html);
  return m ? m[1]! : null;
}

/** True when the two disagree AND both are known. Unknown is never stale:
 *  a reload on a bad read is a reload loop, and a loop is worse than a stale
 *  tab by a wide margin. */
export function isStale(running: string | null, deployed: string | null): boolean {
  if (!running || !deployed) return false;
  return running !== deployed;
}

export interface BuildCheckDeps {
  fetchImpl: typeof fetch;
  reload: () => void;
  moduleUrl?: string;
}

/** Ask the server which build it is serving, and reload if this is not it.
 *  Returns true when it reloaded. Every failure path is silent and returns
 *  false: offline, a proxy, a 404, a body that names no bundle. */
export async function checkBuild(d: BuildCheckDeps): Promise<boolean> {
  const running = runningBundle(d.moduleUrl);
  if (!running) return false;
  try {
    const res = await d.fetchImpl("/index.html", { cache: "no-store" });
    if (!res.ok) return false;
    const html = await res.text();
    if (!isStale(running, deployedBundle(html))) return false;
    d.reload();
    return true;
  } catch {
    return false;
  }
}
