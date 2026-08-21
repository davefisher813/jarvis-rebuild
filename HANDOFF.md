# Session handoff — 21 Aug 2026

**Remote main: `5c22d31`. Local == remote. Tree clean. All gates green.**

## What shipped this session

| commit | what |
|---|---|
| `0755e81` | Apple Music palette (earlier in session) |
| `f6ba5e1` | Salmon → white-on-red-tint; screen crawler; ADHD behaviour audit |
| `5c22d31` | Contrast-auditor alpha bug fixed; design measurement tooling; visual design audit |

Gates at `5c22d31`: tsc clean · eslint 0 errors (19 warnings, pre-existing) · **1588 tests pass** · build ok.

## Read this before you push anything

**The remote diverged mid-session and a bundle silently never landed.** Two commits (`6ba6612`, `43189d0`) were pushed onto `main` from elsewhere while this session was building on `0755e81`. A "pushed" confirmation had been taken at face value for a commit that was actually still only local.

**Always `git fetch origin main` and compare before building a bundle**, and verify with `git ls-remote origin main` after. The resolution was a plain `git rebase origin/main` — clean, no conflicts — then re-running every gate against the merged code, which is what caught that the test count had moved 1569 → 1588.

Never force-push to resolve this.

## The colour change

`--accent-tx` in dark is now **white**; the red meaning on chip-shaped controls moved to `--accent-chip` (`rgba(255,69,58,0.18)` wash). Dave rejected the salmon `#FC828F` on sight — and any red clearing 4.5:1 on Apple's lighter dark surfaces is forced light enough to read pink, so a red text token was never going to work there. Light theme's chip text is `#B80417` (`#CC051B` measured 4.1:1 on the wash-over-pressed-chip).

Three rules that meant *error* rather than *accent* now say `--red`: `.test-bad`, `.test-err`, `.plan-overdue`.

## The auditor was lying, and this matters

`tools/visual-audit.mjs` reported **0 contrast findings** for weeks. Its `rel()` helper matched all digits in a colour string and used the first three, so `rgba(235,235,245,0.3)` was measured as opaque `#EBEBF5`. Every `--tx-*` grey in this app is `rgba` — the whole secondary/tertiary text layer had never been checked.

Fixed (composites over the real backdrop first). Same 7 passes now return **218 findings**, 192 of them light theme. Verified identical before and after the rebase, so the incoming commits added none of them.

**Open decision, deliberately not made:** light `--tx-3` needs `0.75` alpha (currently `0.60`, measuring 3.1–3.4:1). `--tx-4` at `0.30` measures 1.7–2.5:1 in *both* themes and carries the **inactive tab labels at 2.25:1** — the app's primary navigation. Taking `tx-4` to AA collapses it into `tx-3` and costs a tier of visual quiet. That is Dave's call, not a bug fix. Nothing was changed.

## Tooling now in `jarvis-app/tools/`

- **`screen-crawl.mjs`** — proves coverage. The app has no router, so screens are seeded **by name** from `shell/destinations.tsx`, and each seed's heading is compared against its parent's: a tap that lands but doesn't navigate is recorded as a failure, not a pass. That check caught five pages silently not opening while an earlier version reported "30/30 reached". Captures full scroll height; every untapped element goes in a named skip ledger. Last run: 33/33 seeds, 197 unique screens, 386 segments.
- **`adhd-metrics.mjs`** — per-screen truncation, sub-44px tap targets, density, repeated-action walls, shame copy, unstoppable motion.
- **`design-metrics.mjs`** — type/colour/spacing/radius/button/hierarchy, from **computed style**, not the stylesheet.
- **`design-overlay.mjs`** — draws text-ink rails and sub-44px targets onto a screenshot. Ink measured via `Range`, not element boxes (element boxes include padding and invent edges that aren't visible — this produced a false alignment finding before it was corrected).

## Findings not yet acted on

Both audits are project docs: `claude/ADHD_VISUAL_AUDIT_2026_08_21.md` and `claude/VISUAL_DESIGN_AUDIT_2026_08_21.md`. Visual version: https://claude.ai/code/artifact/1b215ef1-7c18-4be8-9d88-e2c98b7d5896

Highest-value unfixed items:

1. **`pickOne` opens the Edit Task form.** `TasksFlow.tsx:445` — "Just Pick One For Me" hands ~20 decisions to someone who just said they can't choose. Code comment says "straight to a task that is already open"; it calls `openEdit()`. The right destination already exists (the What-Now "Just Fifteen" sheet, or Focus/Up Next).
2. **Red badge fires when nothing is overdue** — `Tasks > Overdue · 0` with a red `5` on the tab.
3. **`.cb` is 22×22** with no hit-area expansion (`jarvis-design-system.css:311`), used by `RemindersStrip.tsx:56` and `NoteEditor.tsx:116`. The tap-target law only checks `.pill-act`.
4. **Two shame strings** — `TodayFlow.tsx:1007` ("has moved N days running"), `inboxBrief.ts:38` ("waiting N days on you").
5. **96 red rules against a four-use law** the CSS states in its own comment; `.sched-loc` paints location names in brand red.
6. **`.btn.btn-block` paints nothing** — no background, no border, so "I'm Overwhelmed" reads as a heading.

## Standing constraints

- **Bundle size / code-splitting: do not touch** until Dave says building is done. The main JS chunk is over the 500KB Vite warning; this is known and deliberately deferred.
- **Never ask for a PAT.** The sandbox cannot push (403). Flow is: `git bundle create` → `SendUserFile` → Dave runs the PowerShell clone-and-push → verify with `git ls-remote`.
