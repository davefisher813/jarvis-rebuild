# Pass Off: Ship The Jarvis Update

For the next Claude chat. Dave wants this live. He has said so in plain words. He is frustrated and does not want jargon, options or long explanations. Short answers. Do the work. Ask only what you truly must.

## Where Everything Is

- Repo: davefisher813/jarvis-rebuild
- Branch with all the work: `handoff-2026-09-29` (already pushed to GitHub)
- Main is untouched at `80fbbf7`. The branch sits directly on top of it, so the merge is clean.
- Main auto-deploys to Vercel. Merging to main is what makes it live.
- Full technical notes: `docs/HANDOFF_2026_09_29.md` and `docs/WORKFLOW_AND_GATE.md`.

## What Was Built (12 steps, all done and tested locally)

1. Contracts tests
2. AI spending cap (hard dollar limit, stops AI when reached)
3. Google sign-in that repairs itself
4. Faster inbox refresh (only fetches what changed)
5. Custom email sections
6. Clean Out (batch move to Trash, with Undo, plus Select on the main list)
7. New morning brief (appointment card, Reply Coverage)
8. Today notification actions
9. Brain: Log It and File It
10. Full test run
11. Phone previews
12. Final report

Test results on the branch: 8100 app tests pass, typecheck clean, build passes, 95 core tests pass, 48 database concurrency checks pass.

## Not Tested For Real

Only fakes were used for these. Tell Dave to try them on his phone after it is live:

- Real Gmail and Google
- Real Supabase
- Real AI model calls
- A real phone
- Calendar events created from two devices at once

## Steps To Go Live, In This Order

Do not skip or reorder. The database change must come BEFORE the merge.

1. **Check server settings in Vercel.** Both `AI_MODEL` and `AI_MODEL_WRITE` must be models listed in the price table in `jarvis-app/src/ai/aiBudget.ts`. The Supabase service key must be set. If any of these is missing, AI features will refuse to run. This is on purpose (fails closed). Optional: set `AI_PRICE_MULTIPLIER_PERMILLE=1000`.
2. **Run migration 0043.** File: `jarvis-core/supabase/migrations/0043_ai_spend_budget.sql`. It adds new tables and functions for the spending cap. It does not change existing data. First confirm which Supabase project is Jarvis's live one, then apply it.
3. **Merge the branch to main.** This deploys.
4. **Set the spending limit very high.** Dave does not want a limit. He is the only user. The cap cannot be turned off (it always exists, default $5), so set it to $1000 in Settings, AI Control, spending limit. That is effectively no limit. Do not build an off switch unless Dave asks.
5. **Phone check with Dave** (below).

## Phone Check For Dave

1. Open Jarvis. Inbox loads, and reopening it is fast.
2. Tap Select in the inbox. Pick a few emails. Move to Trash. Tap Undo. They come back.
3. Open Settings, AI Control. The spending limit shows and can be changed.
4. Open Today. The brief shows.

If any step fails, say which one.

## Decisions Dave Still Owes (do not block the ship on these, mention once)

- The spending budget starts counting from when it is turned on. It does not count the $5 already spent.
- The cap holds back a safe maximum before each AI call, so a call can be refused when a few cents are left.
- Accepting a calendar invitation in the app does not send the RSVP.
- Reply Coverage on very long emails checks only part of the thread and may say "found" when it is incomplete.

## Rules To Follow

- Plain words. No em dashes. Short paragraphs.
- Dave's ALL CAPS means frustration. Skip the explanation and fix it.
- Do not use multiple choice with jargon. If you must ask, ask one yes or no question.
- Manual upkeep: run `ai_budget_reconcile_stale` in Supabase now and then to clear stuck holds.
