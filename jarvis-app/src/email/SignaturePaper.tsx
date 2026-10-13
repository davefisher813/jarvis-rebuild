// THE SIGNATURE ON WHITE (issue 113). The builder's preview is the very HTML the email carries (signature.ts, one function for the
// preview and the message), drawn the way a recipient's mail app draws it: white, the sender's own type, nothing of this app's
// styling reaching in. It is a frame because the app's stylesheets would otherwise restyle the table, and the preview would
// stop being what lands. The frame runs nothing (no scripts), takes no taps, and grows to its content.

import { useEffect, useMemo, useRef } from "react";

const documentFor = (html: string): string =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
  `<style>html,body{margin:0;background:#ffffff;-webkit-text-size-adjust:100%;text-size-adjust:100%}body{padding:14px 16px}img{max-width:100%}</style></head><body>${html}</body></html>`;

export default function SignaturePaper({ html, title }: { html: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const doc = useMemo(() => documentFor(html), [html]);
  useEffect(() => {
    const f = ref.current;
    if (!f) return;
    let ro: ResizeObserver | null = null;
    const fit = () => {
      const b = f.contentDocument?.body;
      if (b) f.style.height = Math.max(48, b.scrollHeight) + "px";
    };
    const onLoad = () => {
      fit();
      const b = f.contentDocument?.body;
      if (b && typeof ResizeObserver !== "undefined") { ro?.disconnect(); ro = new ResizeObserver(fit); ro.observe(b); }
      f.contentDocument?.querySelectorAll("img").forEach((img) => img.addEventListener("load", fit));
    };
    f.addEventListener("load", onLoad);
    return () => { f.removeEventListener("load", onLoad); ro?.disconnect(); };
  }, [doc]);
  return <iframe ref={ref} className="sig-paper" title={title} srcDoc={doc} sandbox="allow-same-origin" referrerPolicy="no-referrer" tabIndex={-1} />;
}
