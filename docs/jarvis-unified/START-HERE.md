# JARVIS unified handoff

**One foundation, with Email as its first consumer.**

## Open first
1. Open **PROTOTYPE.html** in a browser to click through the visual design. No installation or server is needed. The outer scenario selector lets you inspect failure states.
2. Read **IMPLEMENTATION-SPEC.md** for the resolved product rules, shared substrate and Email implementation.
3. Attach the full package to Claude Code and paste **Prompt 01** from **CLAUDE-CODE-PROMPTS.md**. Continue in order through Prompt 09 after each slice's checks pass.

## Files
| File | Purpose |
|---|---|
| PROTOTYPE.html | Interactive phone-style preview of Agents, Review, Activity, Email, Waiting, Today and linked details |
| IMPLEMENTATION-SPEC.md | Main implementation contract, sections 00–18 |
| API-AND-VALIDATION.md | Endpoint inputs, canonical approval hashes, validation, error copy and race behavior |
| CONTRACTS.ts | Typed logical contracts for the shared substrate and Email |
| CLAUDE-CODE-PROMPTS.md | All nine self-contained build prompts in sequence |
| prompts/ | The same nine prompts as separate files |
| ACCEPTANCE-MATRIX.md | 54 production acceptance requirements with evidence/status fields |
| SCREEN-STATE-MAP.md | Screen IDs, routes, scenarios and preview limitations |
| PREVIEW-QA.md | Checks actually performed on this package |
| preview-mobile.png | Phone preview image |
| preview-desktop.png | Desktop preview image |

## Build order
1. Repository contract and additive shared schema
2. Permissions, scoped context and agent gateway
3. Commands, approvals and receipts
4. AI Hub and durable decision review
5. Email inbox, search, accounts and source evidence
6. Deterministic capture and destination adapters
7. Compose, reply and exact approved sending
8. Waiting and Today integration
9. Security, full integration, release and live verification

## Fixed rules
- Fully useful with AI off.
- Project scope is normal; whole-database context is not an option.
- Modes never override Email's approval ceiling.
- Candidates remain inside Email until approved.
- Bills and receipts go to Money only. Bills never become tasks.
- Exact-message approval for every send; no blind resend after uncertainty.
- No scheduled background AI scanning in v1.
- Permissions can be suggested from taps but never silently granted.
- JARVIS controls its own mediated actions, not an outside assistant's independent accounts.

## What this package is
A design and implementation handoff, with a tested local prototype. It does not modify or deploy the production app. Provider connection/send behavior in the preview is clearly simulated. Actual repository mapping, RLS tests, Money integration, real Gmail verification and deployment are required work in the sequenced prompts. No claims of production testing are implied by preview QA.

The supplied source drafts were reconciled rather than copied wholesale. Latest user constraints govern; IMPLEMENTATION-SPEC.md section 00.1 records the choices that resolve conflicts. The API supplement and types expand that specification. If physical repository names differ, adapt via the explicit repository mapping while preserving the behavior.
