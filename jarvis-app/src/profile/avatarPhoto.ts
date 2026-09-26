import { useEffect, useState } from "react";
import { useOptionalProfile } from "../data/NotesProvider";

// YOUR PHOTO ON THE RED DISC (Dave's pick, 2026-09-26: the avatar keeps its
// brand-red disc, and it is a tap that changes the picture).
//
// A chosen photo is cut to a centred square and drawn at 256px as a JPEG
// data URL, on the phone, before it is saved. It rides the profile record
// (ProfileData.avatar) so it syncs like the name beside it, and at 256px a
// photo costs tens of kilobytes rather than the megabytes a camera writes.
// 256 is 72pt at 3x with room to spare, the biggest disc it is drawn in.
//
// The AI context reads named profile fields only (useAIContext), so the
// photo never rides along into a prompt.

export const AVATAR_PX = 256;
export const AVATAR_QUALITY = 0.85;

/** The largest centred square inside a w x h image: the crop a round avatar
 *  shows. A portrait loses its top and bottom equally, a landscape its sides. */
export function centerSquare(w: number, h: number): { sx: number; sy: number; side: number } {
  const side = Math.max(0, Math.min(w, h));
  return { sx: Math.round((w - side) / 2), sy: Math.round((h - side) / 2), side };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("unreadable image")); };
    img.src = url;
  });
}

/** A picked file, centre-cropped and resized to the avatar square. Throws
 *  when the file is not an image the browser can decode. */
export async function avatarFromFile(file: File): Promise<string> {
  const img = await loadImage(file);
  const { sx, sy, side } = centerSquare(img.naturalWidth, img.naturalHeight);
  if (side === 0) throw new Error("empty image");
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_PX;
  canvas.height = AVATAR_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_PX, AVATAR_PX);
  return canvas.toDataURL("image/jpeg", AVATAR_QUALITY);
}

// Account saves the photo; Today's disc is on another screen that may still
// be mounted. One window event says the photo changed, so every disc that
// shows it follows without a reload.
const AVATAR_EVENT = "jarvis:avatar";

export function announceAvatar(photo: string): void {
  window.dispatchEvent(new CustomEvent<string>(AVATAR_EVENT, { detail: photo }));
}

/** The saved photo, or "" when there is none (or no profile to read). */
export function useAvatarPhoto(): string {
  const svc = useOptionalProfile();
  const [photo, setPhoto] = useState("");
  useEffect(() => {
    let live = true;
    if (svc) void svc.get().then((p) => { if (live) setPhoto(p?.avatar ?? ""); }).catch(() => {});
    const on = (e: Event) => setPhoto((e as CustomEvent<string>).detail ?? "");
    window.addEventListener(AVATAR_EVENT, on);
    return () => { live = false; window.removeEventListener(AVATAR_EVENT, on); };
  }, [svc]);
  return photo;
}
