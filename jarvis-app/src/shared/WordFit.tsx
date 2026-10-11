import { useLayoutEffect, useRef, useState } from "react";

// A ONE-LINE TEXT THAT GIVES UP WHOLE WORDS (Dave 2026-10-11: "Preview text truncates mid-word ('pag...',
// 'progressiv...'). Truncate at word boundaries with an ellipsis."). CSS can only cut a line at a character, so the
// line measures itself: when the words do not fit, it drops whole words from the end until they do and closes with an
// ellipsis. The box must take its width from its parent, not from its own words (flex-basis 0 on a row line), or the
// measure would chase itself. Where nothing can be measured (a test, a print) the whole line is drawn; the stylesheet's
// own clip and ellipsis stay as the last resort for a single word wider than the box.
export default function WordFit({ text, className, ...rest }: { text: string; className?: string } & Record<`data-${string}`, string>) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(text);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const node = () => el.firstChild as Text | null;
    const fits = (t: string) => { const n = node(); if (n) n.nodeValue = t; return el.scrollWidth <= el.clientWidth + 1; };
    const fit = () => {
      if (!el.clientWidth) { setShown(text); return; }
      if (fits(text)) { setShown(text); return; }
      const words = text.split(" ");
      let lo = 1, hi = words.length - 1, best = 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (fits(words.slice(0, mid).join(" ").replace(/[\s,;:\u00b7-]+$/, "") + "…")) { best = mid; lo = mid + 1; } else hi = mid - 1;
      }
      const t = words.slice(0, best).join(" ").replace(/[\s,;:\u00b7-]+$/, "") + "…";
      fits(t);
      setShown(t);
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    let w = el.clientWidth;
    const ro = new ResizeObserver(() => { if (el.clientWidth !== w) { w = el.clientWidth; fit(); } });
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);
  return <span ref={ref} className={className} title={shown !== text ? text : undefined} {...rest}>{shown}</span>;
}
