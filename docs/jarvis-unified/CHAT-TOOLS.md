# Chat tools: the model's hands

Dave's chat box order (2026-10-24). The model proposes; only the dispatcher acts.

This document is the map of what exists, so a later session does not rebuild it or loosen it. The code is in `jarvis-app/src/chat/tools/`.

## Status

Six reads (tier 0) and three proposals (tier 1: `create_task`, `update_task`, `capture_decision`), behind `chat_tools_v1`, dark by default. Off, the chat's AI lane is one plain `ai.complete` call, exactly as before. Tiers 2 and 3 (drafts, sends, deletes) are not built.

To switch it on for a deploy: add `chat_tools_v1` to `VITE_JARVIS_FLAGS` in Vercel (comma separated) and redeploy. It is a build variable, so it is a per-deploy switch, not a per-user one.

## One turn

```
ChatFlow                       deterministic layers first: decision capture, the four commands, Q&A over records
  └ AI lane (flag on)          useChatTools.run(history, system)
      └ runToolTurn            a plain for loop, at most MAX_STEPS (5) model calls
          ├ AIService.completeTurn   POST /api/ai with tool NAMES, never definitions
          │    └ api/ai.ts           looks each name up in the registry, attaches the definition, returns { text, toolCalls, stop }
          └ dispatch(call)           the five checks, in order, then a read implementation
               └ tool_result        bounded JSON, back to the model on the next step
```

The proxy is stateless. The app carries the conversation: each step re-sends the messages so far, including the model's own `tool_use` blocks and the dispatcher's `tool_result` blocks. Each step is its own request with its own request id and its own budget reservation, so the dollar cap meters a tool turn like any other calls.

## The wire

- Request: `tools: ["search_items", ...]`. Names only. The proxy refuses (`400 Bad tools`) any name the registry does not hold, a repeat, an empty list, a list over 12, or a menu sent together with a forced `schema`.
- Messages may carry `tool_use` (assistant turns only) and `tool_result` (person turns only) blocks, and only for tools the request names. Ids, inputs (2,000 bytes) and results (6,000 bytes) are bounded in `wire.ts`.
- Response: `{ text, toolCalls: [{ id, name, input }], stop }`. A call to an unoffered tool, with a bad id or a non-object input, is dropped, and at most four are returned.
- Size: a tool turn gets `AI_MAX_TOOL_INPUT_BYTES` (default 65,536, counted in bytes) because it carries earlier results. A plain request keeps `AI_MAX_INPUT_BYTES` (32,768).

## The five checks (dispatcher.ts)

In this order, every no is a `tool_result` with `is_error`, so the model learns to ask a different way:

1. the name is on the menu;
2. the turn's budget is not spent (8 calls, 16 KB of results);
3. the input passes the tool's own schema (`validate.ts`);
4. every field shaped like a ref is a ref a search in this conversation returned (`seen`), so the model cannot invent a record or point at one it never found;
5. the tier: tier 0 runs; tier 1 is PROPOSED (the call becomes a card, nothing is written here, ever); tiers 2 and 3 are refused until they are built.

A result is bounded before the model sees it (4 KB a call): items are dropped from the longest list, then long text is cut, and `truncated` is set. A failure comes back as words the implementation chose (`ToolFailure`) or a plain "that lookup failed"; a raw error is never passed on.

## The tools

| tool | what it returns |
| --- | --- |
| `search_items` | hits across tasks, events, notes, people, projects, goals, decisions, files and facts, each with a ref. Wraps `search/search.ts`. Open tasks only unless `include_done`. |
| `read_document` | one note's text by a ref a search returned, cut at 3,000 characters, fenced and marked untrusted. |
| `get_schedule` | events (recurrence expanded) and open tasks in a window of at most 31 days, plus what is late when the window reaches today. |
| `search_email` | thread headers from the connected mail, marked untrusted. Search only. |
| `recall_facts` | what the person told JARVIS to remember, labelled STATED, with the date filed. Reversed and superseded rows are left out. |
| `get_activity` | what JARVIS did lately, from the thread's own action receipts. |
| `create_task` (tier 1) | a card: "Add this task?" with the exact words, and a date, a priority and a person only when asked for. |
| `update_task` (tier 1) | a card for a change to a task a search returned: done, a new date or no date, new words, a priority. A change that is already true is dropped; a request that would change nothing, a task that is gone or done, a bill or a reminder gets no card, only a reason. A repeating task is not finished by a tick, so its card says "Tick it off for today (repeats, next due ...)" with the date, the tick is asked for on its own, and one already ticked today gets no card. |
| `capture_decision` (tier 1) | a card: "Save this decision?" with the decision, the reason and what it was chosen over. |

Outside text (mail, notes, pasted pages) is cleaned of invisible characters and forged delimiters (`messages/untrusted.ts`) and fenced. None of that is a guarantee, which is why the wall that matters is the dispatcher: a read can only return text.

## A write is a card (proposals.ts, propose.ts, approval.ts, execute.ts)

Dave's law: reads free, writes ask with the exact content, any edit voids the approval. The path, in order:

1. The model asks for a write. The dispatcher runs the five checks, then `propose.ts` reads the record as it is NOW (two read functions, nothing else), judges the request against it, and returns the content of a card. The model is told, in the card's own words, that it is waiting and that nothing changed.
2. `ProposalStore` (`proposals.ts`) holds it: a hash of exactly that content (`substrate/canonical.ts`, the one canonical form every approval in the app binds to), five minutes to live, one use. A newer card for the same thing (same task, same words) replaces the older one. At most three cards a turn.
3. `ProposalCards.tsx` draws it in the thread: a JARVIS bubble with the card's lines (the question, then the content, one fact to a line, nothing cut), and under it the capsules: the change named for what it does (Add Task, Move Task, Mark Done, Clear Date, Change Task, Save Decision) and Not Now. No dots are baked into the words and no pill sits inside the bubble.
4. The person taps. `useChatTools.approve` goes to `approveAndRun` (`approval.ts`), the only module that imports `execute.ts`: the store checks the proposal is open, inside its five minutes, and bound to the hash the card drew (and re-derives the hash from the content as it stands, so an edit made after the card was drawn is caught). A second tap, a double tap or a replaced card is refused. Only a yes goes on to `executeProposal`.
5. `execute.ts` looks at the task once more. If it changed since the card was drawn (words, date, priority), is gone, is done, or became a bill or a reminder, nothing is written and the thread says so. Otherwise it writes through `writeDeps.ts` (the only file in the tool layer that calls a service write), step by step with the compensations kept, so a failure part-way is undone and reported as nothing changed.
6. The thread's receipt is written from what was made ("Moved to Fri, Oct 30: Call the plumber", "Added: ...", "Done: ...", "Saved decision · ..."), stored as an `action` bubble with the record as a chip, with the toast's Undo built from the record as it was just before. The card stays on screen, resting, until the receipt is written.

A date the model proposes must be a real day from two weeks back to five years on (a year it got wrong is told today's date and asked to try again, never turned into a card), and a card shows the year whenever it is not this one. New words are made plain (no invisible, bidirectional or control characters, one line) BEFORE they are hashed, so the card shows exactly what would be saved and a title from a stranger cannot forge a line of it; a joiner is kept where it is real (inside an emoji, inside a Persian word). A task made from a card is stamped as made in Chat, as the chat's other model-made tasks are.

A card that nobody taps is marked timed out at five minutes (a timer in the hook, and again at any tap); it still shows what it was, says nothing was changed, and can only be dismissed. Not Now closes it and the thread keeps "Left it alone: ...". The store outlives the screen for the five minutes. It is kept per signed-in USER, not per service: the provider rebuilds every service whenever the session's token refreshes (which happens on its own), and a card must not vanish then, nor a turn already in flight file its card where nobody is looking. So leaving Chat for another tab and coming back does not lose a card the thread says is waiting, and another account never sees it. A newer card for the same task replaces the older one, and the model is told which card replaced which (`replaced_earlier_card` in its tool result), so it does not describe both as waiting.

Honesty about what was done (execute.ts): a write the service answers false to, or one that wrote nothing (a repeating task already ticked today), is not a success and gets no receipt; a change that fails part-way is put back step by step, and if a step will not go back the person is told it was saved in part, never that nothing changed; an Undo that cannot put a step back throws, so the screen's standard failure toast speaks; a repeating task's receipt says "Done for today ... Next <the date it really moved to>", and a next date other than the one the card showed (the day turned over) is put back. Undo of a later move leaves the task's slip count and its logged push as they were: that is how every reschedule Undo in the app behaves (the deterministic "move to tomorrow" command too), and was not changed here.

### Claims

In the tool lane no tool changes anything, so a first-person "I've moved it" from the model is never true. `turnWords.ts` (`screenClaims`) takes the claiming SENTENCES out of the model's text and keeps the rest as it was written, then adds one line from what the dispatcher actually did, read from the live state of this turn's cards when the turn ends (`tools.tally`): "Waiting for your OK on the card below · Nothing has changed yet" while a card waits (without the second half if another was already made), "Nothing was changed · Ask again and I'll put it on a card for you to confirm" when no card was made, and nothing at all when the cards were made or set aside while the model was still talking (their own lines said so). A pointer to a card that is not there ("tap Move Task to confirm") goes the same way.

Two tiers, because a plain question must not lose a true answer: the model speaking of its own finished work ("I added", "I've moved", "I just marked", "I set it for Friday") and a bare receipt word opening a reply ("Done.", "Added!") are claims in any turn; the speaker-less report ("Moved the plumber task to Friday.", "It has been moved", "It's now on your calendar") is a claim in a turn that is about changing something (a write tool was tried, or the sentence asked for a change: an edit, a creation, a "yes, do it"). Nothing about which other tools ran switches it off; the one exemption is a turn that only read the activity log and asked for no change, which is reporting earlier work and is true. A sentence that denies ("Nothing has been changed yet", "I haven't added anything", "I added nothing") is not a claim; "no problem" after the claim is not a denial.

It is a backstop built to be hard to talk around, not a proof. What words cannot catch is held by structure: nothing the model writes makes a change, and the receipts in the thread are drawn by the app from what it made.

### Routing

With the tools on and the AI available, a sentence that opens with a verb that can only mean changing something that exists goes to the model, which finds the task and puts the change on a card: move, push, reschedule, postpone, delay, bump, rename, reword, retitle, unmark; and mark, clear and change only with what they change ("mark it as done", "clear the due date", "change the plumber task's priority"), however politely wrapped ("can you please", "would you", "I need you to"). A single short line only: a pasted paragraph that happens to open that way is a paste. "Clear the gutters before Friday", "Change the oil filter on the truck" and "Mark Sarah's birthday on the calendar" are new things and keep the capture lane. Before any of this, the commands the app reads itself still come first, exactly as they did: "move X to today or tomorrow", "complete X" and "delete task X" act on the spot with their own receipt and Undo (the Uncertainty Protocol, addendum item 23). Whether they should also ask first is Dave's call and is not made here. "Make", "set", "update" and "add" are not on the list: those are new things.

## What the thread shows

- While a lookup runs: one line in the thread ("Searching your records..."), not stored.
- The answer: an AI bubble with its provenance line. The chips are the records the answer names by title (`citedRefs`), not every record the tools came across.
- A turn that ran out of steps, or came back empty, says so. A provider failure is told in its own words (`chat/failureWords.ts`).
- Receipts and claims about actions come from what the app made, never from the model's words: the receipt is built from the executed change, and a claim of a change in the model's text is replaced (see Claims).

## Laws

`laws/chatTools.test.ts` holds: the roster of tools is exactly the one in that file (a new tool is a decision made there); no tool name is an escape hatch (`run_query`, `call_api`, `execute`, `fetch`, `eval`, `shell`); every input schema is closed and bounded; the proxy attaches tools from the registry and never from the body; the read implementations are built in one place and dispatched in one place; nothing in the tool layer can call the model. For the writes: the menu has nothing above tier 1; every write has a proposer; the read tools, the proposers, the dispatcher and the store import nothing that writes; `execute.ts` is reached from `approval.ts` alone, and `approval.ts` and `writeDeps.ts` from the hook alone; `executeProposal` is called in one place, after the store's yes; `approve` takes the hash, checks the clock, and is the only place a proposal becomes approved; the screen calls approve once, from the handler the card's button is wired to; the hook calls no service write itself.

## Not built, on purpose

- **Tiers 2 and 3: drafts, sends, deletes, share.** The substrate's server-side approvals (hash bound, 5 minutes, single use) cover two shapes today: email candidates and email-draft sends. The chat builds the same rules in its own store for the tier 1 writes; a send is never the agent's and keeps ending in the composer and the existing send review. `log_money` and `file_document` (tier 1) wait for their own proposers.
- **A grant**, so that a chosen kind of write needs no tap for a while: not built. Every tier 1 write asks.
- **Editing a card** before approving it: not built. The person says what to change and a new card replaces the old one.
- **Streaming, Stop, Retry, Regenerate**, rolling summaries, the byte-budgeted five-tier context, voice: later phases.
- **PDFs in chat:** wait on Doc AI landing on main.
