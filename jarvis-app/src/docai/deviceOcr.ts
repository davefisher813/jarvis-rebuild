import type { DocText } from "./types";

// DEVICE OCR (Lane 1 for a photo). Reading words off a picture on the phone is not an AI call (law 3), so it must work at AI level Off. The
// native recognizer (Apple Vision through a Capacitor plugin) is a native dependency: it needs a pod install and a real iOS build, the same
// reason @capacitor/keyboard waits (CLAUDE.md). Until that plugin is installed this reader answers null, the screens say photos cannot be
// read yet, and nothing pretends otherwise. The seam is here so wiring the plugin is one function, not a redesign.

export interface DeviceReader {
  /** Reads the picture and answers the words with a page map, or null when it cannot. */
  read(file: File): Promise<Pick<DocText, "text" | "pages" | "words"> | null>;
}

let reader: DeviceReader | null = null;

export const deviceReader = (): DeviceReader | null => reader;

/** The native shell registers the plugin-backed reader at startup. Tests register a fake. */
export function registerDeviceReader(r: DeviceReader | null): void {
  reader = r;
}
