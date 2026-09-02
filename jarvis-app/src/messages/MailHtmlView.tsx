import { useEffect, useMemo, useRef } from "react";
import { sanitizeMailHtml } from "./mailHtml";

// The mail as the sender laid it out, in a frame that cannot run anything.
// No scripts (the sandbox has none), links open outside, and the frame
// grows to its content so the page scrolls, never the frame.
export default function MailHtmlView({ html, dark = true }: { html: string; dark?: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const doc = useMemo(() => sanitizeMailHtml(html, { dark }), [html, dark]);
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
