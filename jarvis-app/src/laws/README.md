# The laws, as tests

`laws.test.ts` enforces the app-wide rules that used to live only in a document. Each one is here because it was broken in real life and Dave found it on his phone.

Currently enforced:

1. **No em dashes.** Literal ones in source, escaped `—` ones in strings, and every AI parse function must scrub its output before a human reads or sends it.
2. **Every class has CSS behind it.** A className with no stylesheet rule fails silently forever; `nav-act` sat on four buttons for a whole session.
3. **No inline styles.** Tokens only, except live drag geometry.
4. **Apple HIG casing.** Nav and section titles are Title Case; ALL CAPS only ever comes from CSS.
5. **The app never scolds.** No shame or diagnosis vocabulary in any rendered string, quoted or bare JSX text.
6. **Icon-only buttons carry an aria-label.**
7. **Stored shapes are versioned.** A localStorage key without `.vN` fails, because a cached shape that gains a field and keeps its key is invisible forever (this is exactly how the email deadlines went missing).

## How to add a law

Write the check here in the same session the rule is agreed, never "later". Then **prove it bites**: plant a deliberate violation, watch the test fail, revert. A law that has never failed on purpose is not known to work. Four of the seven above were verified that way, and doing it caught a real hole in the shame check, which was only reading quoted strings and would have missed most UI copy.

## What this cannot catch

These are static checks. They cannot see dead ends, a receipt that never renders, a button offering a meaningless zero, or a screen that traps you. That is what the live walk is for, and the walk is still the gap.
