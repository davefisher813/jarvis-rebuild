import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { bus } from "../events";
import { todayISO } from "../tasks/grouping";
import { playCompletion } from "./effects";
import {
  DEFAULT_FEEDBACK, effectiveFeedback, isQuietToday, readFeedback, sanitizeFeedback, setLiveFeedback,
  setQuietToday, systemPrefersReducedMotion, type Effective, type FeedbackPrefs,
} from "./prefs";

// The one place the feedback settings are held and applied to the page.
// Modelled on AppearanceProvider: state is read synchronously from the
// account's mirror so the first paint is already right, the document root
// carries the result as attributes so stylesheets key off them the way they
// key off data-theme, and the account copy is adopted once at boot.

interface FeedbackValue {
  prefs: FeedbackPrefs;
  eff: Effective;
  quiet: boolean;
  /** A change the person made. The caller also saves it to the account. */
  apply: (patch: Partial<FeedbackPrefs>) => FeedbackPrefs;
  /** The account's copy at boot. State only: the mirror already has it. */
  adopt: (stored: unknown) => void;
  setQuiet: (on: boolean) => void;
}

const FALLBACK: FeedbackValue = {
  prefs: DEFAULT_FEEDBACK,
  eff: effectiveFeedback(DEFAULT_FEEDBACK, { systemReduced: false, quiet: false }),
  quiet: false,
  apply: (patch) => ({ ...DEFAULT_FEEDBACK, ...patch }),
  adopt: () => {},
  setQuiet: () => {},
};

const Ctx = createContext<FeedbackValue | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<FeedbackPrefs>(readFeedback);
  const [quiet, setQuietState] = useState<boolean>(() => isQuietToday(todayISO()));
  const [systemReduced, setSystemReduced] = useState<boolean>(systemPrefersReducedMotion);

  // The phone's own request is followed live: turning Reduce Motion on in the
  // phone's settings applies without relaunching.
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    let mq: MediaQueryList;
    try { mq = window.matchMedia("(prefers-reduced-motion: reduce)"); } catch { return; }
    const on = () => setSystemReduced(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);

  const eff = useMemo(() => effectiveFeedback(prefs, { systemReduced, quiet }), [prefs, systemReduced, quiet]);

  useEffect(() => {
    setLiveFeedback(prefs);
    const root = document.documentElement;
    root.dataset.celebrate = eff.celebrate;
    root.dataset.motion = eff.reduced ? "reduce" : "full";
    root.dataset.quiet = quiet ? "on" : "off";
  }, [prefs, eff, quiet]);

  // A completion anywhere in the app plays the tone once, if chosen. The
  // bus carries only real state changes (a task going from open to done), so
  // opening the app, syncing, or coming back from the background never
  // replays an old effect.
  useEffect(() => bus.subscribe((e) => { if (e.type === "task.completed") playCompletion(); }), []);

  const value: FeedbackValue = {
    prefs,
    eff,
    quiet,
    apply: (patch) => {
      const next = sanitizeFeedback({ ...prefs, ...patch });
      setPrefs(next);
      setLiveFeedback(next);
      return next;
    },
    adopt: (stored) => { if (stored !== undefined && stored !== null) setPrefs(sanitizeFeedback(stored)); },
    setQuiet: (on) => { setQuietToday(on, todayISO()); setQuietState(on); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Defaults outside a provider, so a screen under test, or one rendered
 *  before the provider mounts, behaves as the Gentle defaults. */
export function useFeedback(): FeedbackValue {
  return useContext(Ctx) ?? FALLBACK;
}
