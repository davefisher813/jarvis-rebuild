import { useEffect, useMemo, useRef, useState } from "react";
import { sanitizeMailHtml } from "./mailHtml";

type RootTheme = "dark" | "light";

const readRootTheme = (): RootTheme =>
  typeof document !== "undefined" && document.documentElement.dataset.theme === "light" ? "light" : "dark";

// THE FRAME FOLLOWS THE APP (Dave 2026-09-04). This view defaulted to dark
// and nothing ever told it otherwise, so with the app in Light the mail sat
// in a black slab (see mailHtml.ts for the why). AppearanceProvider stamps
// data-theme on the document root; reading that, rather than the context,
// means the view works anywhere the root is stamped, tests included, and
// re-fits itself if the theme changes while a mail is open.
function useRootTheme(): RootTheme {
  const [theme, setTheme] = useState<RootTheme>(readRootTheme);
  useEffect(() => {
    if (typeof MutationObserver === "undefined" || typeof document === "undefined") return;
    setTheme(readRootTheme());
    const mo = new MutationObserver(() => setTheme(readRootTheme()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  return theme;
}

// The mail as the sender laid it out, in a frame that cannot run anything.
// No scripts (the sandbox has none), links open outside, and the frame
// grows to its content so the page scrolls, never the frame.
export default function MailHtmlView({ html, dark }: { html: string; dark?: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const rootTheme = useRootTheme();
  // An explicit prop still wins; absent one, the app's theme decides.
  const isDark = dark ?? rootTheme === "dark";
  const doc = useMemo(() => sanitizeMailHtml(html, { dark: isDark }), [html, isDark]);
  useEffect(() => {
    const f = ref.current;
    if (!f) return;
    let ro: ResizeObserver | null = null;
    const fit = () => {
      const b = f.contentDocument?.body;
      if (b) f.style.height = Math.max(40, b.scrollHeight + 8) + "px";
    };
    const onLoad = () => {
      fit();
      const b = f.contentDocument?.body;
      if (b && typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(fit); ro.observe(b); }
      f.contentDocument?.querySelectorAll("img").forEach((img) => img.addEventListener("load", fit));
    };
    f.addEventListener("load", onLoad);
    return () => { f.removeEventListener("load", onLoad); ro?.disconnect(); };
  }, [doc]);
  return (
    <iframe
      ref={ref}
      className="mail-html"
      title="The email as sent"
      srcDoc={doc}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
    />
  );
}
