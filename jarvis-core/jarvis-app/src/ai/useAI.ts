import { useMemo } from "react";
import { useAuth } from "../auth/AuthProvider";
import { AIService } from "./AIService";

// An AIService bound to the current session token (sent to the /api/ai proxy).
export function useAI(): AIService {
  const { session } = useAuth();
  return useMemo(() => new AIService({ getToken: () => session?.access_token }), [session]);
}
