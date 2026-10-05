import { Capacitor, registerPlugin } from "@capacitor/core";

// THE KEYBOARD'S OWN ACCESSORY BAR, HIDDEN (2026-10-05, CLAUDE.md "two bars
// above the keys": "When the work moves to iOS: take option 3").
//
// With the keyboard up in a document, iOS draws its own accessory pill (the
// field chevrons and a tick) between our writing bar and the keys, and its
// tick duplicates our Done. On the web that pill belongs to WKWebView and
// cannot be touched, so the app kept both and reserved room for the pair
// (--doc-kbar-clear). In the native shell @capacitor/keyboard can hide it, and
// then our bar sits straight on the keys: this module hides it and, only once
// that has really happened, marks the page `data-kbar="compact"` so the
// writing bar takes the compact row (editor.css: 44px row, 36px buttons, 14px
// type, 18px icons; measured 45px against 57px). If the plugin is missing or
// refuses, nothing is marked and the bar keeps its full size beside the pill,
// which is the web behaviour and a complete one.
//
// Bound BY NAME like every other native seam (registerPlugin), so this
// compiles and tests on a checkout with no native layer.

interface KeyboardPlugin {
  setAccessoryBarVisible(options: { isVisible: boolean }): Promise<void>;
}

export async function hideKeyboardAccessoryBar(
  deps: { setVisible?: (isVisible: boolean) => Promise<void>; isIos?: () => boolean; root?: HTMLElement } = {},
): Promise<boolean> {
  const isIos = deps.isIos ?? (() => Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios");
  if (!isIos()) return false;
  try {
    const setVisible = deps.setVisible
      ?? ((isVisible: boolean) => registerPlugin<KeyboardPlugin>("Keyboard").setAccessoryBarVisible({ isVisible }));
    await setVisible(false);
  } catch {
    return false;
  }
  (deps.root ?? document.documentElement).setAttribute("data-kbar", "compact");
  return true;
}
