# Session handoff, 12 Sep 2026

**Remote main is the Astra pass through Push J. Local equals remote. Tree clean apart from the untracked `Claude outputs/` folder. All gates green, CI green on every push.**

## What shipped this session

The Astra build (`Claude outputs/JARVIS_ASTRA_BUILD_MASTER_2026_09_12.md`, harness `JARVIS_ASTRA_PREVIEW_2026_09_12.html`), ten pushes, each one commit, one gate, one CI run:

| push | commit | what |
|---|---|---|
| A | `83aa717` | light tokens, `.facts`, `.row-star`, `.why`, `.dring`, laws 1 to 5 |
| B | `d302f8a`, `55d2b15` | Today: state vocabulary, Needs You, the headliner, the context packs |
| C | `67e8d44` | Schedule and Plan My Day: state words, nested proposals, the planner says why, event columns, laws 8 and 10 |
| D | `18428a4` | Brain: the two-band top, strand state words, one-word readiness, the Learning Lab, strand type |
| E | `000429f` | Decisions and Capture: chat auto-capture, source and outcome, Make It a Rule, the three prefixes, the star on every row, law 9 |
| F | `4ff71c3` | Life: projects moving it, milestones, the check-in, `goal.checkin` |
| G | `8785c73` | Contacts, Routine, Writing, Values: fuller labels, promises and projects on the card, Learned Rhythms, the writing channel, draft-edit learning, the values detector, doc autosave |
| H | `64b33d3` | Notes: the three blocks, pin, tags and archive, note-to-note links, JARVIS Found |
| I | `b5d7312` | Insights: This Week, one percent inside reports, law 6 |
| J | this commit | the catalog's §AA and this document |

Between C and D the other Code chat landed the Email pass (Pushes A through I of `JARVIS_EMAIL_BUILD_MASTER_2026_09_12.md`, catalog §AC); Push D was rebased over it cleanly.

## The gate, and where it runs

`docs/WORKFLOW_AND_GATE.md` is the contract. On this Windows machine the gate is: `npx tsc --noEmit`, `npx eslint src` (39 known `unused eslint-disable` warnings; a 40th or any error is new), `npx vitest run` with `TZ=UTC` and `NODE_OPTIONS=--no-experimental-webstorage` on this Node 25 box, `npm run build`, `npm run build:legal && git diff --exit-code public/`, the jarvis-core tsc and vitest, and the case-sensitivity scan (`git ls-files | sed -E 's/\.(tsx?|jsx?|mjs|cjs)$//' | sort -u | sort -f | uniq -di`, which must print nothing). CI on Node 22 is the authoritative gate; poll `actions/runs?head_sha=` after every push.

**Always `git fetch origin` and rebase before pushing.** Another Code chat may be shipping to main; the Email pass landed fourteen commits while Push D was being built. Rebase, rerun the gate on the merged tree, then push. Never force-push.

**One thing that cost an hour:** three vitest runs started on top of each other (a background run, a retry and a hung worker) and each took seven minutes to time out. Run one suite at a time, with a `timeout`, and kill orphaned `node` processes before starting the next.

## Every new law was planted first

Laws 3 to 10 of the build master live in `src/laws/astra.test.ts`; law 6 (percent) and law 7 (decisions never count) join laws 8 (COMPLETED derived), 9 (chat capture is user-only, never a rule) and 10 (closed event vocabulary). Each was planted (a violation written into a real component), watched fail, reverted, and the commit message says so. Two existing laws were amended rather than added: law 3 reads the `RowStar` and `EntityStar` tags as the star and knows the named row anatomies; law 11 exempts `brain/BrainTop.tsx` by C-38's own words.

## Departures from the doc, all stated in their commits

- The planner's "N project moving it" and the check-in head "How Is This Going?" follow the app's casing laws where the harness writes them lower-case.
- Make It a Rule links the strand to the decision through `StrandData.link` rather than a "decision" derivation key with the id in evidence: evidence is numbers and days by law.
- A WATCHING row on the Brain hub opens What JARVIS Knows rather than running an accept; a detector short of its gate has nothing to accept, and the one past it is already offered there.
- The values detector derives only the ruled-out half of C-63; the rule-strand half has no data yet because Make It a Rule writes a new strand each time.
- The draft-edit learning runs on the email deck path; the sms and chat draft surfaces have no send of their own.
- Month rows on Insights colour moved purple and done plain (one coloured fact per line, law 4) where the harness colours both.
- Month and week facts read "3 Moved", "2 Tasks pushed" under the leading-number casing law where the harness keeps them lower-case.

## Left out on purpose (section 11 stands)

Prototype palette, layouts and fonts from the Astra zip; the adaptive command bar; the text-link button tier; cyan for schedule; goals off purple; nested folders, version history, semantic search, link preview, note link blocks, Ask JARVIS in notes; the Recent Learning band, the learned-count headline and the Brain Coverage grid; silent learned memories and silent relationship labels; the app-written Values doc; a decision `standing` flag; `ai_draft_edited` with text; event-triggered decision re-evaluation; project status pill changes; the editor rewrite.

## Open items

- Thirteen strand categories with reworked caps before launch (six today; `StrandData.type` already carries the kind).
- Link preview and note link blocks, revisited later.
- "Frequent" on a contact's hero waits for a count the card does not have.
- The demo build has no AI and no milestone or dollar goal, so JARVIS Found, the milestone rows and the dollar ring are covered by tests only; look at them on the phone.

## Standing constraints

- No em dashes anywhere, comments and strings included.
- Title Case for anything that names or acts; ALL CAPS only from CSS.
- One filled primary per screen; every other action is a capsule.
- Anything visual is mocked first; the harness is the mock. Do not restyle beyond it.
- Do not touch bundle splitting until Dave says building is done. The main chunk is over the 500KB Vite warning, known and deferred.
- Do not fix the 39 pre-existing `unused eslint-disable` warnings.
