# Prototype screen and state map

Open PROTOTYPE.html in a browser. It is self-contained, requires no server and makes no network calls. It uses synthetic fixtures. Reset demo restores the baseline; refresh also resets this disposable preview. Product data durability is specified in the implementation contract, not simulated by this file.

## Screen entry points
| ID | Where to click | Working flow |
|---|---|---|
| H1 | AI Hub | Agents, AI toggle, agent detail, Add assistant |
| H2 | AI Hub → Review | Decided/Mentioned, Save decision, edit statement/reason, keep note, paste discussion |
| H3 | AI Hub → Activity | filter actions/reads/drafts, open receipt, constraint suggestion |
| H4 | Agents → Claude or ChatGPT | mode review/confirmation, revoke, scope preview |
| H5 | Agent → Preview shared context | choose records/expiry, share simulated context, export actual fixture JSON |
| H6 | Review → saved decision → history | reason/dependencies, replace, superseded version, withdraw with reason |
| H7 | Saved Email card → View or Activity receipt | exact effect, source/destination, revision-guard contract, Undo demonstration |
| M1 | Email | chronological rows, categories, search, cards, refresh, dismiss/restore |
| M2 | Any mail row | message body, source, reply/reply-all, manual capture, Gmail fallback explanation |
| M3 | Card → Details or message → Capture | edit fields and approve one change |
| M4 | Email → Waiting | track first from Coach Miller card; resolve/reopen, follow-up date, draft follow-up |
| M5 | Email → plus or Reply | editable account/recipient/subject/body, Cc/Bcc, saved preview draft |
| M6 | Compose → Review send | exact content/account/recipient review; Edit invalidates prior approval |
| M7 | Send this message | simulated accepted or unknown outcome; never real sending |
| M8 | Email search field | literal search across fixtures; categories intersect query |
| M9 | Email account label | demo reconnect/disconnect state and retention explanation |
| T1 | Today | generic review count, existing confirmed task, tomorrow callback only after approval |
| Destination reference | Life / Schedule | committed bill/receipt and event records from save flows; not a redesign of those modules |

## Scenarios
The outer Preview scenario picker is review tooling and must not ship in JARVIS.

| Scenario | What to inspect |
|---|---|
| Everyday use | full click-through flows |
| Empty | per-surface empty state; no fabricated items |
| Loading | initial skeleton; Finish loading preview returns normal |
| Connection error | Retry recovers saved content |
| Offline | cached content, capture/send blocked, inert draft editing |
| Gmail needs reconnecting | mail remains visible; reauth banner |
| Source changed | tap a capture, review latest difference before saving |
| Send outcome unknown | compose prefilled; review/send shows uncertainty and disabled resend |
| Money not ready | Save bill/receipt retains candidate and explains missing destination |
| AI disabled by admin | locked AI toggle, manual Email continues |

## Scope of this executable preview
Navigation, search, category filtering, core card-to-receipt flows, waiting resolve/reopen, Today gating, mode confirmation/revoke, context selection/export, decision edit/history/withdrawal, discussion import, drafts and exact send-review transitions run locally. Buttons for provider connection, attachment transport and Gmail link display are explicitly simulated/explained. There is no real OAuth, provider mail, backend, production RLS, external execution, full destination module or multi-device concurrency here. The spec defines those implementation contracts and tests. The preview intentionally does not pretend to validate them.

Some production interactions are specified rather than fully simulated: provider archive/read sync, actual attachment transfer, typed per-card validation for every timezone/currency edge, complete draft persistence after reload, precise device races and every database conflict. Treat IMPLEMENTATION-SPEC.md as authoritative for these states. Screen templates and the scenario picker demonstrate the visual treatment; the builder must implement the full matrix, not limit production to fixture behavior.

## Review walkthroughs
1. Save Con Edison → View receipt → Open Money → Email → Undo from receipt.
2. Track transcript → Waiting → set follow-up → Resolve → Reopen → Draft follow-up → Review send → edit or simulated send.
3. Add deposit call → Today shows Tomorrow, not Today → Schedule shows exact time.
4. Agents → Claude → preview context → deselect roster → share → Activity read receipt.
5. Review → Mentioned → keep note → Life reference; Decided → edit/save → history → replace → withdraw.
6. Scenario Offline → Save receipt is blocked; scenario Unknown → review/send displays no retry.
7. AI off → Email still captures; agent sharing unavailable; Review manual work remains.
