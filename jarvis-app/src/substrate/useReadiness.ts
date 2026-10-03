import { useEffect, useState } from "react";
import { supabase } from "../auth/supabaseClient";
import { fetchReadiness, readinessFrom, type Readiness } from "./destinations/registry";

// The one question the Advanced screen asks of the substrate: is the database
// ready for it, and which doors are open. Asked once per mount; a build with
// no backend answers unknown for everything, which is the honest answer.
export function useSubstrateReadiness(): Readiness | null {
  const [state, setState] = useState<Readiness | null>(null);
  useEffect(() => {
    let on = true;
    if (!supabase) { setState(readinessFrom(null, "unknown")); return; }
    const client = supabase;
    void fetchReadiness((fn) => client.rpc(fn)).then((r) => { if (on) setState(r); });
    return () => { on = false; };
  }, []);
  return state;
}
