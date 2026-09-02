import { useRef, type ReactNode } from "react";

// ONE PICKER FOR PICTURES AND FILES. A hidden file input the caller mounts
// once and opens from any button; on the phone the system sheet offers
// Take Photo, the library, and Files, so one button covers "pic or file".
// The input's value is cleared after every pick so the same file can be
// picked twice in a row.
export const PICK_ANY = "image/*,application/pdf";
export const PICK_IMAGE = "image/*";

export function usePickFile(onFile: (f: File) => void): { input: ReactNode; open: (accept?: string) => void } {
  const ref = useRef<HTMLInputElement>(null);
  const open = (accept: string = PICK_ANY) => {
    const el = ref.current;
    if (!el) return;
    el.accept = accept;
    el.click();
  };
  const input = (
    <input
      ref={ref}
      className="visually-hidden-input"
      type="file"
      accept={PICK_ANY}
      onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }}
    />
  );
  return { input, open };
}
