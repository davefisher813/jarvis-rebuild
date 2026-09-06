import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { readSystemTextScale, clampScale } from "./textZoom";

// Appearance is one axis today: theme (dark/light), written to the document
// root as data-theme, which the locked CSS overrides design tokens through.
// Every token-pure screen restyles automatically.
//
// SHELL-F-25 (2026-09-05): it used to be three axes. `skin` and `mode` were
// scaffolding for features that have not been built: each carried exactly one
// value ("default" / "standard"), no screen offered either, no [data-skin] or
// [data-mode] block exists in any sheet, and setSkin / setMode /
// APPEARANCE_OPTIONS / toggleTheme had no callers at all. Scaffolding that
// does nothing still has to be read and kept correct by everyone after you,
// and it says a feature exists when it does not.
//
// The design is not lost, it is just written down instead of half-built.
// Adding a second axis is: widen Appearance with the field, write it to the
// root as its own data-attribute in the effect below, and add the matching
// [data-skin="x"] token block to the CSS. Nothing else changes, which was the
// point of the multi-axis shape and is still true from here.

export type Theme = "dark" | "light";

// UP-PLAT-09 (2026-09-06): the second axis, and the one this file's own note
// above said would be easy to add. Three named steps rather than a slider,
// because a slider invites a size nothing was designed at; these three are
// the sizes every screen was checked at.
export type TextSize = "default" | "larger" | "largest";

export const TEXT_SCALE: Record<TextSize, number> = {
  default: 1,
  larger: 1.15,
  largest: 1.3,
};

export interface Appearance {
  theme: Theme;
  textSize: TextSize;
}

const DEFAULT_APPEARANCE: Appearance = {
  theme: "dark", // JARVIS DNA
  textSize: "default",
};

function readSize(raw: unknown): TextSize {
  return raw === "larger" || raw === "largest" || raw === "default" ? raw : DEFAULT_APPEARANCE.textSize;
}

// UP-PLAT-10 (2026-09-06): still written, and still read first. This is the
// MIRROR now, not the only copy: data/SettingsService.ts holds the account's
// version under the "appearance" key and AppShell reconciles the two at boot.
// The mirror is what makes the first paint synchronous and what makes an
// offline or signed-out launch behave exactly as it always has, so it stays.
const STORAGE_KEY = "jarvis.appearance";

interface AppearanceContextValue {
  appearance: Appearance;
  setTheme: (t: Theme) => void;
  setTextSize: (t: TextSize) => void;
  // UP-PLAT-10 (2026-09-06): the whole object at once, for the one caller
  // that has the account's copy in hand and must not apply it in two steps
  // (two renders, two writes to the root, a visible flicker between them).
  applyAppearance: (a: Partial<Appearance>) => void;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

function readInitial(): Appearance {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Appearance>;
      return {
        theme:
          parsed.theme === "light" || parsed.theme === "dark"
            ? parsed.theme
            : DEFAULT_APPEARANCE.theme,
        textSize: readSize(parsed.textSize),
      };
    }
  } catch {
    // ignore malformed / unavailable storage
  }
  return DEFAULT_APPEARANCE;
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<Appearance>(readInitial);

  // UP-PLAT-09: the phone's own Larger Text setting, read once at boot. Null
  // until the native seam is live (appearance/textZoom.ts says exactly why),
  // and a manual choice always wins over it: someone who set Largest here
  // meant it here.
  const [systemScale, setSystemScale] = useState<number | null>(null);
  useEffect(() => {
    let on = true;
    void readSystemTextScale().then((n) => { if (on && n !== null) setSystemScale(clampScale(n)); });
    return () => { on = false; };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = appearance.theme;
    // Both, on purpose: the custom property is what every font-size in the
    // stylesheets multiplies by (styles/jarvis-design-system.css), and the
    // data attribute is what a future [data-textsize] block would target,
    // the same shape the theme axis already uses.
    root.dataset.textsize = appearance.textSize;
    const scale = appearance.textSize === "default" && systemScale !== null
      ? systemScale
      : TEXT_SCALE[appearance.textSize];
    root.style.setProperty("--type-scale", String(clampScale(scale)));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance));
    } catch {
      // ignore persistence failure
    }
  }, [appearance, systemScale]);

  const value: AppearanceContextValue = {
    appearance,
    setTheme: (theme) => setAppearance((a) => ({ ...a, theme })),
    setTextSize: (textSize) => setAppearance((a) => ({ ...a, textSize })),
    applyAppearance: (patch) => setAppearance((a) => ({
      theme: patch.theme ?? a.theme,
      textSize: patch.textSize ?? a.textSize,
    })),
  };

  return (
    <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>
  );
}

export function useAppearance(): AppearanceContextValue {
  const v = useContext(AppearanceContext);
  if (!v) throw new Error("useAppearance must be used inside AppearanceProvider");
  return v;
}
