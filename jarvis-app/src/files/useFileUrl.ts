import { useEffect, useState } from "react";
import type { FileStore } from "./FileStore";

// The URL for a stored path, resolved once the store answers. Null until
// then, and null when the file cannot be read, which the caller shows as
// the file's name rather than a broken picture.
export function useFileUrl(store: FileStore | null, path: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (!store || !path) return;
    void store.url(path).then((u) => { if (live) setUrl(u); });
    return () => { live = false; };
  }, [store, path]);
  return url;
}
