import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

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

export interface Appearance {
  theme: Theme;
}

const DEFAULT_APPEARANCE: Appearance = {
  theme: "dark", // JARVIS DNA
};

const STORAGE_KEY = "jarvis.appearance";

interface AppearanceContextValue {
  appearance: Appearance;
  setTheme: (t: Theme) => void;
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
      };
    }
  } catch {
    // ignore malformed / unavailable storage
  }
  return DEFAULT_APPEARANCE;
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<Appearance>(readInitial);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = appearance.theme;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance));
    } catch {
      // ignore persistence failure
    }
  }, [appearance]);

  const value: AppearanceContextValue = {
    appearance,
    setTheme: (theme) => setAppearance((a) => ({ ...a, theme })),
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
