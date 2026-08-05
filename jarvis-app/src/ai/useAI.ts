import { useMemo } from "react";
import { useOptionalSession } from "../auth/AuthProvider";
import { AIService } from "./AIService";

// An AIService bound to the current session token (sent to the /api/ai proxy).
// Outside an AuthProvider (component tests, the bench) this yields a service
// with no token rather than throwing: every screen that happens to touch AI
// must still render without an auth stack.
export function useAI(): AIService {
  const session = useOptionalSession();
  return useMemo(() => new AIService({ getToken: () => session?.access_token }), [session]);
}
