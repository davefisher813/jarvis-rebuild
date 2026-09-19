import { supabase } from "../auth/supabaseClient";
import type { BookingSettings } from "./settings";

// THE LINK, FROM THE APP'S SIDE (Track 3, 2026-09-19). One place that knows
// how to ask the server about the caller's booking link, so the settings
// screen holds state and not protocol.
//
// Every call carries the LIVE project's session token: the server proves who
// you are against that project and then writes Track 3 on your behalf, which
// is what lets booking work before Clerk is wired. See api/booking-link.ts.

export interface LinkFace { slug: string; visibility: string; days: number }

async function token(): Promise<string | null> {
  try {
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch { return null; }
}

async function call(method: string, body?: unknown): Promise<LinkFace | null> {
  const t = await token();
  // No session, no link. The screen reads this as "nothing yet" rather than
  // as an error, because on a device with no backend that is the truth.
  if (!t) return null;
  const r = await fetch("/api/booking-link", {
    method,
    headers: { Authorization: `Bearer ${t}`, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!r.ok) throw new Error(String(r.status));
  const out = (await r.json()) as { link: LinkFace | null };
  return out.link;
}

export function readLink(): Promise<LinkFace | null> {
  return call("GET");
}

/** Write Your Times into Track 3 and get the address back. The zone is the
 *  device's, because the hours on that screen are the hours where the person
 *  setting them is standing. */
export function saveLink(settings: BookingSettings, name = "Meeting"): Promise<LinkFace | null> {
  let timezone = "UTC";
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { /* keep UTC */ }
  return call("PUT", { settings, timezone, name });
}

export function removeLink(): Promise<LinkFace | null> {
  return call("DELETE");
}

/** The address a person gives out, built from the slug the server owns. */
export function linkUrl(slug: string, origin?: string): string {
  const base = origin ?? (typeof window === "undefined" ? "" : window.location.origin);
  return `${base}/book/${slug}`;
}
