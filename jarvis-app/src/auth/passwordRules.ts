// THE RULES FOR CHANGING A PASSWORD, IN ONE PLACE (2026-10-04, Account >
// Change Password). The sheet checks the three fields before it asks Supabase
// anything, and says what is wrong in the words a person would use; whatever
// Supabase refuses after that is turned into a sentence here as well, so a
// code like `same_password` never reaches the screen.
//
// Six characters is the floor everywhere else a password is made (Sign In's
// Create Account, the Set a New Password screen), so it is the floor here: a
// password the app accepts when you make it is one it accepts when you change
// it.
export const MIN_PASSWORD_LENGTH = 6;

export type PasswordField = "current" | "next" | "confirm";
export interface PasswordDraft { current: string; next: string; confirm: string }
export interface PasswordProblem { field: PasswordField | null; message: string }

export const PASSWORD_WORDS = {
  needCurrent: "Enter your current password",
  tooShort: `Use at least ${MIN_PASSWORD_LENGTH} characters`,
  sameAsCurrent: "Your new password has to be different from your current one",
  mismatch: "The two new passwords don't match",
  wrongCurrent: "That isn't your current password. If you signed in with an email link and never set one, use Forgot Password on the sign-in screen.",
  tooWeak: "That password is too easy to guess · Try a longer one, with numbers or symbols",
  tooManyTries: "Too many tries · Wait a minute and try again",
  offline: "Couldn't reach JARVIS · Check your connection and try again",
  signedOut: "Your session ended · Sign in again, then change your password",
  noEmail: "This account has no email to check a password against",
  generic: "Couldn't change your password · Try again",
} as const;

/** What is wrong with the three fields, if anything, before any request is made. */
export function passwordProblem(d: PasswordDraft): PasswordProblem | null {
  if (!d.current) return { field: "current", message: PASSWORD_WORDS.needCurrent };
  if (d.next.length < MIN_PASSWORD_LENGTH) return { field: "next", message: PASSWORD_WORDS.tooShort };
  if (d.next === d.current) return { field: "next", message: PASSWORD_WORDS.sameAsCurrent };
  if (d.confirm !== d.next) return { field: "confirm", message: PASSWORD_WORDS.mismatch };
  return null;
}

// The few facts about a Supabase error this needs. `code` is GoTrue's own
// (invalid_credentials, same_password, weak_password, over_request_rate_limit);
// the message is the fallback for an older server that sends only words.
interface AuthLike { code?: string; status?: number; message?: string; name?: string }

/** A refusal from Supabase, or a failed request, as a sentence and the field it belongs to. */
export function passwordErrorOf(e: unknown): PasswordProblem {
  if (e instanceof Error && e.message === PASSWORD_WORDS.noEmail) return { field: null, message: PASSWORD_WORDS.noEmail };
  const a = (e ?? {}) as AuthLike;
  const code = a.code ?? "";
  const text = a.message ?? "";
  if (code === "invalid_credentials" || /invalid login credentials/i.test(text)) return { field: "current", message: PASSWORD_WORDS.wrongCurrent };
  if (code === "same_password" || /different from the old password/i.test(text)) return { field: "next", message: PASSWORD_WORDS.sameAsCurrent };
  if (code === "weak_password" || /password.*(weak|easy|short|characters)/i.test(text)) return { field: "next", message: PASSWORD_WORDS.tooWeak };
  if (code === "over_request_rate_limit" || a.status === 429 || /rate limit|too many/i.test(text)) return { field: null, message: PASSWORD_WORDS.tooManyTries };
  if (code === "session_not_found" || code === "refresh_token_not_found" || /session (missing|not found)/i.test(text)) return { field: null, message: PASSWORD_WORDS.signedOut };
  if (a.name === "AuthRetryableFetchError" || /failed to fetch|network|load failed/i.test(text) || e instanceof TypeError) return { field: null, message: PASSWORD_WORDS.offline };
  return { field: null, message: PASSWORD_WORDS.generic };
}
