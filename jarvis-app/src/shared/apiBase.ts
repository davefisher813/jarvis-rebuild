// Where the serverless APIs live. On the website this is empty (same-origin
// relative paths, exactly the current behavior). Inside the native app the
// bundle is served from capacitor://localhost, so relative /api paths have
// nowhere to go: the native build sets VITE_API_BASE to the deployed origin
// (e.g. https://jarvis-rebuild.vercel.app) and every API call routes there.
export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

// SHELL-F-04 (2026-09-05): where a Supabase email link has to land. A password
// recovery link opens in the person's BROWSER, so it must point at a real http
// origin running this app: on the web that is where the app already is, and in
// the native build the bundle is served from capacitor://localhost, which no
// email client can open, so the deployed origin the API calls already go to is
// the one place the link can work. Empty means "say nothing and let Supabase
// use the project's Site URL", which is the old behaviour.
export function webOrigin(): string {
  if (API_BASE) return API_BASE;
  const here = typeof window !== "undefined" ? window.location.origin : "";
  return /^https?:/.test(here) ? here : "";
}
