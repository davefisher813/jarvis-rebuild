# Chat tools: the model's hands

Dave's chat box order (2026-10-24). The model proposes; only the dispatcher acts.

This document is the map of what exists, so a later session does not rebuild it or loosen it. The code is in `jarvis-app/src/chat/tools/`.

## Status

Reads only (tier 0), behind `chat_tools_v1`, dark by default. Off, the chat's AI lane is one plain `ai.complete` call, exactly as before.

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
5. the tier: only tier 0 runs on this path.

A result is bounded before the model sees it (4 KB a call): items are dropped from the longest list, then long text is cut, and `truncated` is set. A failure comes back as words the implementation chose (`ToolFailure`) or a plain "that lookup failed"; a raw error is never passed on.

## The tools (all tier 0)

| tool | what it returns |
| --- | --- |
| `search_items` | hits across tasks, events, notes, people, projects, goals, decisions, files and facts, each with a ref. Wraps `search/search.ts`. Open tasks only unless `include_done`. |
| `read_document` | one note's text by a ref a search returned, cut at 3,000 characters, fenced and marked untrusted. |
| `get_schedule` | events (recurrence expanded) and open tasks in a window of at most 31 days, plus what is late when the window reaches today. |
| `search_email` | thread headers from the connected mail, marked untrusted. Search only. |
| `recall_facts` | what the person told JARVIS to remember, labelled STATED, with the date filed. Reversed and superseded rows are left out. |
| `get_activity` | what JARVIS did lately, from the thread's own action receipts. |

Outside text (mail, notes, pasted pages) is cleaned of invisible characters and forged delimiters (`messages/untrusted.ts`) and fenced. None of that is a guarantee, which is why the wall that matters is the dispatcher: a read can only return text.

## What the thread shows

- While a lookup runs: one line in the thread ("Searching your records..."), not stored.
- The answer: an AI bubble with its provenance line. The chips are the records the answer names by title (`citedRefs`), not every record the tools came across.
- A turn that ran out of steps, or came back empty, says so. A provider failure is told in its own words (`chat/failureWords.ts`).
- Receipts and claims about actions come from dispatcher states only. This phase has no writes, so the rule is held by the system prompt (`toolPrompt.ts`) and by there being nothing to claim.

## Laws

`laws/chatTools.test.ts` holds: the roster of tools is exactly the one in that file (a new tool is a decision made there); no tool name is an escape hatch (`run_query`, `call_api`, `execute`, `fetch`, `eval`, `shell`); every input schema is closed and bounded; the proxy attaches tools from the registry and never from the body; the read implementations are built in one place and dispatched in one place; nothing in the tool layer can call the model; the read tools and their wiring hook can reach no write.

## Not built, on purpose

- **Writes (tiers 1 to 3), drafts and the approval card.** The substrate's server-side approvals (hash bound, 5 minutes, single use) cover two shapes today: email candidates and email-draft sends. There is no generic entry for a tool, write grants do not exist, and nothing in `src/chat` reaches it. The write phase builds the same rules in the dispatcher (exact content shown, 5 minute expiry, single use, any edit voids it) and sends keep going through the composer and the existing send review.
- **Streaming, Stop, Retry, Regenerate**, rolling summaries, the byte-budgeted five-tier context, voice: later phases.
- **PDFs in chat:** wait on Doc AI landing on main.
