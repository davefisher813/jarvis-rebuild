import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

// Appearance is multi-axis so skins and a gaming mode can be added later as
// pure config plus CSS, with no provider rewrite and no screen changes. Each
// axis is an independent data-attribute on the document root. The locked CSS
// (and any future skin or mode CSS) override the SAME design tokens through
// attribute selectors, so every token-pure screen restyles automatically.
//
// Today only `theme` (dark/light) has CSS behind it. `skin` and `mode` each
// carry a single value for now ("default" / "standard"); their option lists and
// CSS token blocks get added when those features are built. Adding one is:
//   1. add the value to APPEARANCE_OPTIONS below, and
//   2. add a [data-skin="x"] or [data-mode="x"] token block to the CSS.
// Nothing else changes.

export type Theme = "dark" | "light";
export type Skin = string; // widens when skins ship
export type Mode = string; // widens when gaming mode and friends ship

export interface Appearance {
  theme: Theme;
  skin: Skin;
  mode: Mode;
}

// Single source of truth for what the Settings UI may offer.
export const APPEARANCE_OPTIONS = {
  themes: ["dark", "light"] as Theme[],
  skins: ["default"] as Skin[],
  modes: ["standard"] as Mode[],
};

const DEFAULT_APPEARANCE: Appearance = {
  theme: "dark", // JARVIS DNA
  skin: "default",
  mode: "standard",
};

const STORAGE_KEY = "jarvis.appearance";

interface AppearanceContextValue {
  appearance: Appearance;
  setTheme: (t: Theme) => void;
  setSkin: (s: Skin) => void;
  setMode: (m: Mode) => void;
  toggleTheme: () => void;
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
        skin: typeof parsed.skin === "string" ? parsed.skin : DEFAULT_APPEARANCE.skin,
        mode: typeof parsed.mode === "string" ? parsed.mode : DEFAULT_APPEARANCE.mode,
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
    root.dataset.skin = appearance.skin;
    root.dataset.mode = appearance.mode;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance));
    } catch {
      // ignore persistence failure
    }
  }, [appearance]);

  const value: AppearanceContextValue = {
    appearance,
    setTheme: (theme) => setAppearance((a) => ({ ...a, theme })),
    setSkin: (skin) => setAppearance((a) => ({ ...a, skin })),
    setMode: (mode) => setAppearance((a) => ({ ...a, mode })),
    toggleTheme: () =>
      setAppearance((a) => ({ ...a, theme: a.theme === "dark" ? "light" : "dark" })),
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
