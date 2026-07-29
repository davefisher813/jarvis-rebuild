// Fades out the index.html boot splash once real UI is on screen. Idempotent
// and safe to call from anywhere; the splash also self-dismisses after 10s as
// a safety net (inline script in index.html).
export function dismissSplash(): void {
  const el = document.getElementById("splash");
  if (!el) return;
  el.style.opacity = "0";
  window.setTimeout(() => el.remove(), 250);
}
