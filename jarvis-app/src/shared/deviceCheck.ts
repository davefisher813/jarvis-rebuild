// THE SCREEN AND VERSION READOUT (Dave 2026-10-17 and 2026-10-18, issue 110).
//
// The tab bar and the Life header were fixed five times from renders of a
// build that Chromium could draw, and each fix passed there and was still
// wrong on his phone. Every one of those rounds guessed at a number the phone
// never reported. This is the phone reporting it: what build this copy is, where
// it was opened from, what the newest build is, and what the screen and the
// safe areas actually measure, in one place Dave can screenshot.
//
// Read-only. It writes nothing, changes no layout and costs one small request.

/** Where the newest build lives. The question "is this copy the latest?" has to
 *  be asked of ONE place: asked of the host the app is running from, a copy
 *  opened from a frozen deployment URL always answers "yes, current". The
 *  response carries Access-Control-Allow-Origin: *, so any host can ask. */
export const PRODUCTION_ORIGIN = "https://jarvis-rebuild.vercel.app";

export interface LatestBuild { id: string; date: string }
export type VersionVerdict = "current" | "behind" | "unknown";

/** Ask the production origin which build it serves. Null for anything that is
 *  not a clean answer (offline, blocked, a body of another shape): a wrong
 *  answer here would send somebody chasing the wrong cause. */
export async function fetchLatestBuild(fetchImpl: typeof fetch = fetch, origin: string = PRODUCTION_ORIGIN): Promise<LatestBuild | null> {
  try {
    const res = await fetchImpl(`${origin}/version.json`, { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<LatestBuild> | null;
    if (!body || typeof body.id !== "string" || typeof body.date !== "string") return null;
    return { id: body.id, date: body.date };
  } catch {
    return null;
  }
}

/** This copy against the newest build. "dev" and an unreachable answer are
 *  unknown, never "current". */
export function versionVerdict(running: string, latest: LatestBuild | null): VersionVerdict {
  if (!latest || !running || running === "dev") return "unknown";
  return running === latest.id ? "current" : "behind";
}

const px = (n: number): number => Math.round(n * 10) / 10;

/** The pixel height of a CSS length, by drawing an invisible box of it. Null
 *  where the engine does not know the unit (a box that did not take it). */
function probeHeight(css: string): number | null {
  const el = document.createElement("div");
  el.style.cssText = `position:fixed;left:0;top:0;width:0;visibility:hidden;pointer-events:none;height:${css}`;
  document.body.appendChild(el);
  const h = el.getBoundingClientRect().height;
  el.remove();
  return h > 0 ? px(h) : null;
}

/** A safe-area inset in pixels, as the page is given it. */
function probeInset(side: "top" | "bottom"): number {
  const el = document.createElement("div");
  el.style.cssText = `position:fixed;left:0;top:0;width:0;visibility:hidden;pointer-events:none;padding-${side}:env(safe-area-inset-${side}, 0px)`;
  document.body.appendChild(el);
  const v = parseFloat(getComputedStyle(el).getPropertyValue(`padding-${side}`));
  el.remove();
  return Number.isFinite(v) ? px(v) : 0;
}

interface Box { top: number; bottom: number; height: number }
const boxOf = (sel: string): Box | null => {
  const e = document.querySelector(sel);
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return { top: px(r.top), bottom: px(r.bottom), height: px(r.height) };
};

export interface DeviceReading {
  origin: string;
  iosVersion: string | null;
  /** What iOS says about being installed: navigator.standalone, and the display-mode query. Kept apart from fullHeightMode on
   *  purpose: the two have disagreed, and which one the page believes is the question. */
  installedNavigator: boolean;
  installedDisplayMode: boolean;
  /** html.ios-standalone: the rule that sizes the shell from the large viewport (components.css --app-h). */
  fullHeightMode: boolean;
  nativeShell: boolean;
  workerControls: boolean;
  runningBundle: string | null;
  innerW: number; innerH: number;
  visualH: number | null; visualTop: number | null; visualScale: number | null;
  screenW: number; screenH: number; ratio: number;
  largeH: number | null; smallH: number | null; dynamicH: number | null;
  appH: number | null;
  insetTop: number; insetBottom: number;
  shell: Box | null; scroller: Box | null; tabBar: Box | null; pageBar: Box | null;
  /** The lowest edge of any tab label, which is what "how far above the
   *  bottom do the labels sit" means. */
  labelsBottom: number | null;
}

/** Measure this device now. Safe to call anywhere: every probe answers null or
 *  zero where the platform has nothing to say, never throws. */
export function readDevice(runningBundle: string | null = null): DeviceReading {
  const nav = navigator as Navigator & { standalone?: boolean };
  // window.Capacitor EXISTS ON THE WEB TOO (the bundle carries the core), so its presence says nothing; asking it does.
  const win = window as Window & { Capacitor?: { isNativePlatform?: () => boolean } };
  const vv = window.visualViewport;
  const ios = /OS (\d+)[_.](\d+)/.exec(navigator.userAgent);
  let standaloneMedia = false;
  try { standaloneMedia = typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches; } catch { /* an old webview */ }
  const labels = Array.from(document.querySelectorAll(".tab-bar .tab")).map((e) => e.getBoundingClientRect().bottom);
  return {
    origin: location.origin,
    iosVersion: ios ? `${ios[1]}.${ios[2]}` : null,
    installedNavigator: nav.standalone === true,
    installedDisplayMode: standaloneMedia,
    fullHeightMode: document.documentElement.classList.contains("ios-standalone"),
    nativeShell: win.Capacitor?.isNativePlatform?.() === true,
    workerControls: !!navigator.serviceWorker?.controller,
    runningBundle,
    innerW: window.innerWidth, innerH: window.innerHeight,
    visualH: vv ? px(vv.height) : null, visualTop: vv ? px(vv.offsetTop) : null, visualScale: vv ? px(vv.scale) : null,
    screenW: window.screen?.width ?? 0, screenH: window.screen?.height ?? 0, ratio: px(window.devicePixelRatio || 1),
    largeH: probeHeight("100lvh"), smallH: probeHeight("100svh"), dynamicH: probeHeight("100dvh"),
    appH: probeHeight("var(--app-h, 0px)"),
    insetTop: probeInset("top"), insetBottom: probeInset("bottom"),
    shell: boxOf(".app-shell"), scroller: boxOf(".app-scroll"), tabBar: boxOf(".tab-bar"), pageBar: boxOf(".pagebar"),
    labelsBottom: labels.length ? px(Math.max(...labels)) : null,
  };
}

export interface ReadoutLine { label: string; parts: string[] }

const dash = (n: number | null): string => (n === null ? "Not Reported" : String(n));
const span = (b: Box | null): string[] => (b ? [`Top ${b.top}`, `Bottom ${b.bottom}`, `Height ${b.height}`] : ["Not on This Screen"]);

/** The readout as lines of facts, in the order that answers the questions in
 *  the order they get asked: which build, from where, then the screen. */
export function readoutLines(d: DeviceReading, running: { id: string; date: string }, latest: LatestBuild | null | "checking"): ReadoutLine[] {
  const verdict = latest === "checking" ? "unknown" : versionVerdict(running.id, latest);
  const lines: ReadoutLine[] = [
    { label: "Running Build", parts: [running.id, running.date] },
    { label: "Latest Build", parts: latest === "checking" ? ["Checking"] : latest ? [latest.id, latest.date] : ["Couldn't Check"] },
    { label: "This Copy", parts: [verdict === "current" ? "Up to Date" : verdict === "behind" ? "Behind the Latest" : "Not Known"] },
    // The whole origin, scheme included: "https" against "capacitor" says which shell this is, and it is an address, which the
    // Title Case law reads as data and leaves alone.
    { label: "Opened From", parts: [d.origin] },
    { label: "Installed", parts: [`Navigator ${d.installedNavigator ? "Yes" : "No"}`, `Display ${d.installedDisplayMode ? "Yes" : "No"}`] },
    { label: "Full Height Rule", parts: [d.fullHeightMode ? "On" : "Off", d.nativeShell ? "Native Shell" : "Web"] },
    { label: "Update Worker", parts: [d.workerControls ? "Active" : "None"] },
    { label: "iOS", parts: [d.iosVersion ?? "Not iOS"] },
    { label: "Window", parts: [`${d.innerW} × ${d.innerH}`] },
    { label: "Visible Area", parts: [`Height ${dash(d.visualH)}`, `Top ${dash(d.visualTop)}`, `Zoom ${dash(d.visualScale)}`] },
    { label: "Screen", parts: [`${d.screenW} × ${d.screenH}`, `${d.ratio}x`] },
    { label: "Height Units", parts: [`Large ${dash(d.largeH)}`, `Small ${dash(d.smallH)}`, `Dynamic ${dash(d.dynamicH)}`] },
    { label: "App Height", parts: [dash(d.appH)] },
    { label: "Safe Areas", parts: [`Top ${d.insetTop}`, `Bottom ${d.insetBottom}`] },
    { label: "Shell", parts: span(d.shell) },
    { label: "Scroll Area", parts: span(d.scroller) },
    { label: "Page Bar", parts: span(d.pageBar) },
    { label: "Tab Bar", parts: span(d.tabBar) },
    {
      label: "Labels to Bottom",
      parts: d.labelsBottom === null ? ["Not on This Screen"] : [`Window ${px(d.innerH - d.labelsBottom)}`, `Screen ${px(d.screenH - d.labelsBottom)}`],
    },
  ];
  return lines;
}

/** The same readout as plain text, for the clipboard. */
export function readoutText(lines: ReadoutLine[]): string {
  return lines.map((l) => `${l.label}: ${l.parts.join(", ")}`).join("\n");
}
