// ONE STEP FROM ANYWHERE (the speech box, 2026-10-31; approved by Dave 2026-10-28: "Perfect.").
//
// A web app cannot listen from the lock screen, and an installed iPhone web app gets no widgets and no icon shortcuts. The
// approved trick is a link that opens JARVIS straight into the speech box, already recording, which he ties to a Siri phrase or
// a tap on the back of the phone. These are the links it answers to:
//
//   /capture?mode=voice        the speech box, recording
//   /capture                   the speech box, typing
//   /?capture=voice            the same, for a shortcut that can only open the app's home address
//
// Reading a link never saves anything: it only opens the box. Recording still needs the microphone, which iOS may ask for
// again; if it refuses, the box stays open for typing and says so.

export type CaptureMode = "voice" | "type";

export function readCaptureLink(url: URL): CaptureMode | null {
  const param = url.searchParams.get("capture");
  if (param === "voice" || param === "type") return param;
  if (/^\/capture\/?$/.test(url.pathname)) return url.searchParams.get("mode") === "voice" ? "voice" : "type";
  return null;
}

/** The address with the capture words taken out, so a reload does not open the box a second time. */
export function withoutCaptureLink(url: URL): string {
  const next = new URL(url.toString());
  next.searchParams.delete("capture");
  next.searchParams.delete("mode");
  next.searchParams.delete("autostart");
  if (/^\/capture\/?$/.test(next.pathname)) next.pathname = "/";
  return next.pathname + (next.search === "?" ? "" : next.search) + next.hash;
}
