# Manual check: the unified substrate, slice 04 (the AI Hub and durable decision review)

Commit: 209df32 (HEAD before the slice 04 commit, which lands on top of it)
Date: 2026-10-03
Checked by: Claude Code, in the repo
QA report: `QA_PUBLISH=0 node qa/check.js`, not published
Preview: `qa/previews/unified-substrate-04/` (the eight Hub screens, light and dark, 390 wide, from the bench through the real stylesheets)

**What Dave asked for, in his words:** "work through the 9 sequenced prompts in JARVIS-Unified/prompts/ in order (01 through 09) - each is self-contained."

## Steps

| # | Do this | Expect this | Actual | Pass |
|---|---|---|---|---|
| 1 | With `VITE_JARVIS_FLAGS` empty: open Brain | No AI Hub row. Nothing changed anywhere. | The row is behind `flagOn("substrate_v1")`; the suite and build are green with the flag off | device |
| 2 | With `VITE_JARVIS_FLAGS=substrate_v1` and 0044 to 0047 applied: Brain > AI Hub | Agents, Review, Activity; the AI switch mirrors AI Control; no assistant yet, so "No Assistant Connected · JARVIS Still Works" with Add Assistant | Proven in jsdom and in the bench; not on a device | device |
| 3 | Add Assistant "ChatGPT" > pick a project > Preview Shared Context > Export | The preview names the records and fields, Health, Money and Mail excluded; Export opens the share sheet (or copies); Activity shows "Exported N records in <project>" | Proven in jsdom (the calls) and locally in SQL (the receipt); the phone's share sheet is the device check | device |
| 4 | Paste What Came Back with a JSON context response | Items land in Mentioned, "Not Saved Yet" nowhere; Keep as Note makes a note; Move to Decided then Save Decision asks for title, statement and reason | Proven in jsdom and SQL | device |
| 5 | Save a decision whose constraint collides with a saved one | "Conflicts With <title>" with both values side by side; Edit or Replace; Replace supersedes and history shows both versions | Proven in jsdom and SQL | device |
| 6 | Turn the admin switch off for the account | The Hub's AI switch says "Turned Off by Admin" and a tap only says so | Proven in jsdom | device |
| 7 | Airplane mode, then open the Hub | "Offline · Showing Saved Data"; every save answers "Connect to Save · Your Details Are Still Here" | Proven in jsdom | device |
| 8 | At 200% text, every screen | No clipped money, date or recipient; controls stack | Not checked on a device | device |

## The standing rules

- [x] No secret printed, logged, committed, or visible in any screenshot. The bench's session is a fixture; no token exists.
- [x] Anything visual was mocked first: the eight screens were rendered through the real components and stylesheets before anything was committed (the previews folder).
- [x] The laws pass: inside the tests stage, with `agentClient.ts` taken off the unwired list (it is wired now) and one toast rostered under the Undo law with its reason (an erasure is permanent by design).
- [x] No em dashes.
- [x] No demo data reaches a build: the bench is deleted before the commit; its only input is a dev HTML page the production build never includes.
- [x] Nothing pushed to GitHub except by Claude Code on Dave's word: pushed to the working branch only, as he asked; no merge.
- [x] Phone width: the previews are 390 wide; the compare grid stacks under 360.

## What I would tell Dave in one line

Brain has an AI Hub: who is allowed to read what, exactly what they read, what they suggested (saved only when you tap), and a receipt for every one of those, in the package's cream palette inside the Hub only, so you can say yes or no to the colour by looking.

## Notes

The device rows stay open on purpose: no device and no deployment in this
session. Row 1 is the one that matters for the deploy with the flag off.

**Result: open**
