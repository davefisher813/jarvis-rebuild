// WHAT A NAME FIELD DOES ON A PHONE (Dave 2026-09-17: "Title case it titles
// isn't default when I'm typing").
//
// Every title in this app is Title Case, and since 2026-09-17 the app cases a
// workout's and a lift's name on the way in and on the way out. That fixed
// what was already stored and did nothing for the moment that actually
// matters: standing in a gym typing "zercher squat" into a lowercase field and
// watching it stay lowercase until Save.
//
// `autoCapitalize="words"` is the keyboard's own answer -- iOS shifts each
// word as you start it -- so what is typed already looks like what will be
// saved, and liftTitle becomes a safety net instead of a surprise.
//
// Autocorrect is OFF here, which is the other half of the same problem: these
// are proper nouns and gym shorthand, not prose. A dictionary that has never
// heard of Zercher, RDL, TRX or Pallof will confidently replace them, and the
// athlete finds out after Save. Spellcheck's red underline is switched off for
// the same reason -- there is nothing to correct.
//
// Spread onto a text input that holds a NAME. Never onto a search field (you
// search in whatever case you like), a number, an ID, or free prose.
export const NAME_FIELD = {
  autoCapitalize: "words",
  autoCorrect: "off",
  spellCheck: false,
} as const;
