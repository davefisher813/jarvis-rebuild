# STATE.md - JARVIS Track 3 Rebuild

Continuity file (RULE 13). Re-read this first at the start of any session. STATE.md wins if it disagrees with chat memory.

## Phase
Visual Phase.

## Current step
Visual Phase. STEP 3 is BLOCKED until a COMPLETE FEATURE INVENTORY is produced and confirmed by Dave (new FULL FEATURE COVERAGE rule). Icon/scrim RULE 9 token proposal is PAUSED, resumes after inventory confirmation.

## Files maintained
- manifest.md - v1, 398 atomic rules (305 design-system / 85 convention / 8 HIG), 379 M / 19 V, band 300-700 PASS. Mutate only via RULE 9.
- step0-package.md - 0C sample rules, 0D coverage map, 0E reference notes, 0F screen inventory, 0G ambiguity list, 0H batch groupings, 0I deferred log.
- STATE.md - this file.
- uniformity.css - NOT yet created (STEP 2).

## Sources confirmed read
- jarvis-design-system.css - full (378 lines). Visual truth, used as-is.
- JARVIS_UI_Samples_v2.html - present, dark + light blocks. Locked visual reference.
- Catalog - 25 files; screen inventory extracted (0F). Content/structure only; styling + real org names + sentence-case titles superseded.
- v347-WORKING.html absent (not in project). v348-unified.html present (assembly ref, not deep-read). JARVIS_Today_Light_Realistic.html present (light Today ref). Handoff May16 file absent (Dave: proceed without it).

## Approved batches
None.

## Manifest version
v1.

## Locked demo dataset
Not yet locked (STEP 1).

## STEP 1 locked decisions
- Naming: "Schedule" everywhere (tab label + screen title). Overrides the catalog's "Calendar" tab label per Dave's explicit instruction (Dave's word > catalog).
- Tab bar (final): Today · Tasks · Schedule · Brain · More.
- More tab = hub for everything NOT on the bottom bar: Messages, Goals, Life Map, Themes, Settings, Account (exact list finalized from catalog when the More batch is built).
- Demo dataset: APPROVED as proposed. demo-data.md is now LOCKED. Every screen draws from it.

- RULE 4 reading (LOCKED by Dave): uniformity.css is production-only, real app rules only, no demo/catalog chrome. The zoo carries its catalog scaffolding locally and clearly separated (like v2). "Only design system + uniformity" governs the rendered components; each must trace strictly to those two files.
- uniformity.css bumped to v1.1: added G5 category-color utility classes (.cat-bg-*, .cat-fg-*) so avatars/dots/bars/icons/fills apply --cat-* without inline styles. Surfaced by the zoo build.

- STEP 2.5 Component Zoo: APPROVED by Dave. Machine gate clean, visual confirmed.
- Icon decision (LOCKED): STEP 3 screen mockups use real Lucide glyphs (inline SVG), not placeholder boxes. Production = Lucide React (CONV 11, stroke 1.5).

- RULE 18 (Testing mandatory, BFFSA bridge-app method) [LOCKED, effective now]: Every feature ships with an interactive test harness. The harness lists every path, state, and edge case as numbered steps ("tap each step in order"); each step states its expected result; tapping a step runs the REAL behavior (not a mock) and shows live captured console output; each step shows a visible PASS or FAIL. A feature is not done until every step passes. The harness lives behind a TEST_MODE flag, OFF at Milestone B (define Milestone B when milestones are finalized).
- FULL FEATURE COVERAGE [LOCKED, effective now]: The catalog is a design reference, not a complete feature list. A confirmed COMPLETE FEATURE INVENTORY governs scope. It is produced before STEP 3 and confirmed by Dave via widget (Dave names anything missing, e.g. Music). Every feature in the confirmed inventory MUST be built and MUST ship with a passing RULE 18 harness.

## Zoo build additions to uniformity (v1.2)
- G5 .pill-bffsa (inverting tier pill) and G6 .cat-bg-*/.cat-fg-* category utilities. Token-clean, existing tokens only. Surfaced during zoo build per RULE 4.
- Open RULE 9 suggestion: dark on-color for light-fill category surfaces (money yellow, friends mint) for contrast.

## Open items (for STEP 1)
- G1: exact tab order + what lives under More.
- G2: voice "Tap to speak" affordance placement (RULE 17, needs Dave).
- G3: onboarding screen sequence.
- G4: confirm Calendar tab label vs Schedule screen.
- Build + lock the neutral demo dataset (6 personas, times, projects, messages, tasks, events, life-map areas, brain entries).

## Last decision locked
Proceed through STEP 0 multi-part; proceed without the May16 handoff file (Dave taps).


## Persistence anomaly (logged this session)
- manifest.md on disk was found replaced by a foreign 148-row file at start of the 0C turn (different schema: Category column, M/V tags, codes COL/CAT/MSG/SUG/URG). STATE.md was intact and is mine.
- Per RULE 13 (STATE.md wins), rebuilt manifest.md to the recorded v1 (472 rules, 0 em dashes, 454 MACHINE / 18 VISUAL). Foreign file backed up as manifest_ondisk_148_backup.md.
- RISK: file persistence between turns appears unreliable. If a file is missing/changed at the next session start, re-verify against STATE.md before building on it.

## Next action
Component Zoo (STEP 2.5) built: zoo.html (preview, both themes), zoo-test-panel.html, zoo-audit.md. uniformity bumped to v1.2 (added .pill-bffsa G5, .cat-bg/.cat-fg G6 during zoo build per RULE 4). Machine gate clean (0 FAIL/0 UNVERIFIED). Awaiting Dave's VISUAL confirmation + zoo approval. Then STEP 3 batch 1.
## Visual review fixes (zoo, this session) + RULE 9 design-system amendment
Dave reviewed rendered zoo on device, flagged 3 issues. All resolved:
1. Schedule rows had no category color (SYS-001/004/005 not enforced). Added category color via .cat-dot leading each event (Apple Calendar list-view convention, matches Life Map dots; Dave confirmed dot over rail per RULE 17): Team Standup=cat-brain, Lunch With Maya=cat-tucci, Marathon=cat-health. Token-clean inline (mockup-allowed). Note: brain #5E9BFF and tucci #5AC8FA both read blue; accurate to data, not a bug. (.cat-bar chrome utility left defined but unused, available for future timeline/block views.)
2. Completion check glyph was top-left in its circle. .task-check now display:inline-flex + center + color:#fff + font-size var(--t-meta).
3. Filter chips read as ovals/balloons. ROOT CAUSE: canonical jarvis-design-system.css line 371 forced min-height:var(--tap-min)=44px onto .chip (touch target applied to visible pill). v2 reference (line 244) has no such rule; iOS HIG ~28-32px; design-system's own .hit44 comment says extend touch "without changing look".

RULE 9 AMENDMENT (Dave approved: "whatever is best and most like iOS"):
- jarvis-design-system.css: removed `.chip` from the line-371 min-height:44px selector group. Chip now renders at natural v2 height (~28px capsule).
- Markup: all chips now carry `.hit44` to preserve 44pt touch target via the pseudo-element (no visible inflation).
- Scope: chips ONLY. .segmented .seg / nav buttons / stepper / btn-sm still in the 44px group, unchanged.
- A working editable copy now lives at /mnt/user-data/outputs/jarvis-design-system.css (project /mnt/project copy is read-only). This working copy is the rebuild truth going forward; it diverges from the project source by exactly this one-line chip change. Future zoo/screen builds must embed THIS working copy, not /mnt/project.
- Applied identically in: jarvis-design-system.css (working), zoo.html embed, zoo-test-panel.html embed.

Machine gate after fixes: 0 em dashes (all files), chip removed from 44px group in all 3 files, all 5 chip instances carry hit44, prior fixes intact. Still 0 FAIL / 0 UNVERIFIED on machine checks.

## STEP 3 Batch 1 built (Shell + Nav + Global States)
- Zoo approved by Dave ("Zoo passes, start STEP 3"). STEP 3 unblocked.
- LOCKED DECISION (icons): mockup icons = provisional Lucide line glyphs, inlined (offline-safe), stand-in for SF Symbols. Final iOS app ships SF Symbols. Dave deferred to recommendation. Applies to ALL batches.
- Artifacts: step3-batch1.html (preview, both themes), step3-batch1-test-panel.html (toggles: theme/state/tab/large-title/toast), step3-batch1-audit.md.
- Rendered: shell device frame with each global state in context (loaded/loading/empty/error/offline), nav variants (large expanded, collapsed sticky inline, back+action, icon action), tab bar states (+badge), toasts x4, sync banners x4.
- Built from working jarvis-design-system.css (chip fix carried) + uniformity v1.2 + local chrome. Machine gate clean: 0 undefined classes, 0 raw inline, 0 em dashes, smart punctuation in copy, tab order locked.
- A prior stale zoo-batch1.* set existed (unfixed design-system, assumed uniformity v1.3, Lucide) from an abandoned attempt; NOT used. New files use step3-batch1.* names.
- STATUS: awaiting Dave's visual confirmation + batch approval. Next batch (2) = Today screen.

## Batch 1 fix: base text color in multi-theme mockup
- Dave caught black title text on dark cards. Cause: design-system sets base color via `html,body { color: var(--tx-1) }`, but --tx-1 only resolves under [data-theme], which the mockup sets on the per-theme PANE, not body. Default-color text (row titles, .nav-large, .nav-title carry no explicit color) inherited black.
- Fix: set `color: var(--tx-1)` on the themed container (.theme-pane in preview, #stage in test panel) so default text resolves per theme. Subtitles/meta already set --tx-3 explicitly and were fine.
- This is a mockup-structure fix (two themes in one document); the real app sets data-theme on the root so body color works directly. No design-system change.

## STEP 3 Batch 2 built (Today screen)
- Artifacts: step3-batch2.html (preview both themes), step3-batch2-test-panel.html (theme + loaded/loading/empty), step3-batch2-audit.md.
- Sections (order): Smart Start, Snapshot, Up Next, Your Day, Active Projects, Life Map, Recent Messages, From Your Brain, JARVIS Suggests, Voice bar. All content from LOCKED demo-data.md.
- uniformity bumped to v1.3: G7 snapshot tiles (.snapshot/.stat-tile/.stat-num/.stat-label), G8 voice bar (.voice-bar/.voice-mic/.voice-name/.voice-hint). Token-clean.
- Machine gate clean: 0 undefined classes, 0 raw inline, 0 em dashes, smart quotes, tab order locked, chip fix carried.
- OPEN FLAGS raised to Dave on this screen: (1) voice bar PLACEMENT provisional (G2/RULE 17); (2) money-yellow proj-icon "Q" low-contrast = the open RULE 9 contrast issue, now visible; (3) Active Projects has no per-project counts (none in demo-data, not invented); (4) Smart Start brief + Up Next countdown + snapshot counts are derived from demo-data, not literal fields.
- STATUS: awaiting Dave's visual confirmation + batch approval. Next batch (3) = Tasks + Schedule.

## Batch 2 universal-rule sweep + contrast resolution (Dave: "apply all rules to everything")
- Dave flagged that universal rules were applied unevenly. Did a full sweep on Today and fixed:
  - 44pt hit targets: .hit44 on "See all"/"View" links.
  - Truncation: .truncate on message name, life-map name, project tag (universal single-line rule).
  - Title Case minor word: "Time to Focus".
  - Alignment: large title gets .screen-pad so its left edge aligns with card group (was s-4 vs cards s-5).
  - Safe insets: voice bar uses .screen-pad.
- CONTRAST RESOLVED (was repeatedly deferred): added RULE 9 token --on-fill-dark: #000000 to design-system :root (theme-constant; --cat-bffsa-on was wrong because it inverts per theme). uniformity .cat-bg-money/.cat-bg-friends now use var(--on-fill-dark). Readable glyphs on yellow/mint in BOTH themes. Open zoo contrast item is now CLOSED.
- Voice bar placement committed (pill above tab bar, catalog-derived); stop flagging as provisional.
- design-system working copy now diverges from /mnt/project by TWO documented changes: (1) chip out of 44px group, (2) --on-fill-dark token. uniformity at v1.3.

## STANDING RULE (locked): systemic category color on EVERY category-bearing item
Dave flagged twice that items were left grey. From now, EVERY screen: any row/item/tile that belongs to a category MUST show its category color (cat-dot, proj-icon fill, avatar, etc.). Default ON. Do not ship a grey category list. Applied retroactively to Today: JARVIS Suggests rows now have cat-dots (family/money/brain). Check this on every future batch before presenting.

## Batch 2: color on non-row containers (Dave flagged Smart Start was pure grey)
- Smart Start card: eyebrow "SMART START" now accent red; each brief line has a leading category dot (money/money/brain) matching the items it references.
- Snapshot stat numbers now use --tint (theme accent), not grey.
- From Your Brain eyebrow now cat-brain blue.
- Color applied via dots/accent/blue only (theme-safe); avoided money-yellow/friends-mint as TEXT (light-theme contrast). Standing rule reinforced: NO grey containers; color every block.

## Batch 2: Smart Start readability rebuild (Dave: "it all blends, doesn't look iOS")
- Top of Today restructured (Dave): hero large title = "Good morning, Dave." (date as tight subtitle), "Today" title removed; the brief section header is now "Focus" (Dave picked over Today/Priorities). Brief rows = item primary + trailing grey time + sentence-case category subtitle + leading category dot + dividers.

## Batch 2 bugfix: message avatars were colorless
- Cause: token typo, msgs tuple stored "cat-tucci" then code prefixed "--cat-" -> var(--cat-cat-tucci) (undefined) -> no fill.
- Fix: tuple now bare ("tucci"/"brain"/"family") -> var(--cat-tucci) etc. Avatars colored. Swept whole file: no other undefined --cat- tokens.
- Note for Dave: urgency labels (EOD/2H/WAITING) are colored caps by the urgency rule (BDG-006, color=severity); neutral times stay grey by design. Distinct on purpose.

## Batch 2 fix: Life Map dot/bar color mismatch
- Was dot=category, bar=status -> two color systems in one row (pink dot + green bar). Dave flagged mismatch.
- Fix (Apple Activity-rings model): dot AND bar both = category color (fixed per area); status shown by the colored status WORD (Active/Drifting/Slipping) + the fill length. Dot and bar now match per row.

## Batch 2 bugfix: test panel light theme broken
- Cause: panel CSS was built by line-filtering CHROME, which truncated multi-line rules (e.g., .device lost its `background: var(--bg)` continuation line) -> device had no bg -> fell through to a dark layer -> dark-on-dark section headers in light theme.
- Fix: panel now embeds full CHROME intact + PANEL_CHROME overrides last. Preview file was never affected (uses full CHROME). Lesson: never line-filter multi-line CSS.

## STEP 3 Batch 3 built (Tasks + Schedule)
- Artifacts: step3-batch3.html (both screens, both themes), step3-batch3-test-panel.html (theme + screen toggle, tap-to-complete), step3-batch3-audit.md.
- TASKS: filter chips (capsule + hit44: All/Today/Upcoming/Done), grouped sections Today/Upcoming/Anytime, task rows = category-tinted check circle (iOS Reminders) + Title-Case title + optional project subtitle + trailing when (urgency caps text or grey date).
- SCHEDULE: segmented Day/Week/Month, date subheader, day timeline with category dots + Now 9:41 marker. Reuses sched-row.
- All Today-batch lessons applied up front: category color on every item, trailing-meta times, iOS grouped lists/dividers, hit44, truncation, no caps subjects, full chrome in panel (no line-filter), no double-prefix token bug, base text color on themed container.
- Task->category inferred where demo-data silent (flagged in audit). Book Flights = default accent (no project).
- Machine gate clean: 0 undefined classes, 0 raw inline, 0 em dashes, 0 undefined token refs, tab order locked, both themes.
- STATUS: awaiting Dave visual review + batch approval. Next: Batch 4 = Brain + Messages.

## Batch 3 fix: segmented + Week/Month (RULE 9 amendment #3)
- Dave flagged segmented Day/Week/Month: chunky look + couldn't click to see week/month.
- FIX a: de-chunked `.segmented .seg` out of the 44px min-height group in working design-system (3rd RULE 9 amendment; chip, --on-fill-dark token, segmented). iOS segmented ~30px; touch via wide segment.
- FIX b: built real Week (week selector strip + day events) and Month (May 2026 grid + day events) views. Sunday-start grid. Today 21 = accent circle + event dot. Single-day demo populates selected day in all views.
- Interactivity in TEST PANEL only (RULE 6): segmented tap switches Day/Week/Month; preview static Day. Panel embeds SCHED_DAY/WEEK/MONTH as JS, swaps on .seg click. Hint text added to panel.
- Re-gate clean (both files). build_batch3.py rewritten (old saved build_batch3.bak.py).
- STILL awaiting Batch 3 approval. Next after approve: Batch 4 = Brain + Messages.

## STEP 3 Batch 4 built (Brain + Messages)
- Artifacts: step3-batch4.html (both screens, both themes), step3-batch4-test-panel.html (theme + screen toggle, tap message to toggle unread), step3-batch4-audit.md. build_batch4.py.
- MESSAGES: iOS Messages list. nav-large "Messages" + search bar; card of msg-rows = leading unread-dot column + category avatar (av-40, cat bg) + msg-head (name + time) + preview. Maya(tucci)/Daniel(brain) unread, Sofia(family) read.
- BRAIN: nav-large "Brain" + "Updated 2 days ago"; lead insight card (brain-blue eyebrow + demo insight); iOS Settings-style grouped sections (Who You Know / How You Think / How You Write / Org Context / Setup), each row = colored proj-icon (glyph) + label + value/chevron. 12 rows.
- Icons: pulled exact Lucide SVGs via lucide-static (users, heart, shield, book-open, compass, pen-line, building-2, circle-check, cloud, search) into /home/claude/ic. No hand-authored paths.
- Readability applied up front: dark glyph/initial (on-fill-dark) on light fills (tucci/money/friends); bffsa-on glyph + NEW hairline ring (.proj-icon.ring, box-shadow 1px var(--divider)) so the inverting BFFSA fill stays visible on matching card bg in both themes.
- Inferred/design-choice (flagged in audit): Brain row icons+colors are a design choice (catalog gives labels only); Baseball=health inferred; Adversarial=accent red.
- Machine gate clean both files: 0 undefined classes, 0 raw inline, 0 em dashes, 0 undefined token refs, tab order locked.
- STATUS: awaiting Dave visual review + batch approval. Next: Batch 5 = More + Goals + Life Map + Themes + Settings.

## LOCKED DECISION: font weight scale
- Weight tokens run ~one step heavier than stock iOS BY DESIGN (brand look). normal 400 / regular 500 / medium 600 / semi 700 / bold 800. So "semi"=iOS Bold(700), "bold"=iOS Heavy(800). Dave confirmed: KEEP the heavier JARVIS scale. Do NOT flag or "fix" type weight again; row labels at 400 already match iOS.

## CORRECTION (Batch 4 Brain org names) + demo-data org rule
- Locked demo-data: BFFSA/Tucci/Elite are USER-CONFIGURED at signup, NOT demo names. Demo org PLACEHOLDERS = Northside Select (elite red), Metro Youth League (tucci teal), Coastal Alliance (bffsa inverts). Use these everywhere for combined-preview consistency.
- Fixed Brain Org Context: BFFSA/Tucci/Elite Squad/Baseball -> Northside Select / Metro Youth League / Coastal Alliance (3 orgs). Rebuilt batch4 files. (Data correction, not a re-gate.)

## STEP 3 Batch 5 built (More + Goals + Life Map + Themes + Settings)
- Artifacts: step3-batch5.html (5 screens, both themes), step3-batch5-test-panel.html (theme + 5-way screen toggle), step3-batch5-audit.md, build_batch5.py.
- MORE: nav-large "More" + profile row (av-56 accent "D" / Dave / dave@example.com placeholder email, iOS account line) + 2 grouped nav cards (Messages/Goals/Life Map/Projects ; Themes/Settings). Colored proj-icons + chevrons. Tab=More.
- GOALS: nav-large + "3 active". 3 goal rows DERIVED from locked projects (goals not in locked dataset, FLAGGED): Q3 Partnership/money 62%, Marathon Training/health Week 6, Spring Fundraiser/elite On track(good). lifemap-bar/fill reused; bar widths illustrative.
- LIFE MAP: locked 4 areas (Family active/Health drifting/Money active/Friends slipping). cat-dot + bar SAME category color (rule 5), status word colored (good/warn/red). Bar widths illustrative (flagged).
- THEMES: Appearance = two preview tiles (Dark selected ring+check / Light) + "Match Device" switch (off). Only Dark/Light defined in system; NO extra skins invented (flagged). New chrome: .switch, .theme-tile/.tile-preview.
- SETTINGS: iOS grouped sections General(Account/Notifications/Appearance=Dark) / Privacy & Data(Privacy/Sync & Backup=On) / Assistant(Voice) / About(v3.4.8) / Sign Out (row-danger red). 
- New icons fetched via lucide-static: message-circle,target,map,folder,palette,settings,users,bell,sun-moon,lock,info,log-out,moon,sun (+ earlier set).
- Machine gate clean both files: 0 undef classes, 0 raw inline, 0 em dashes, 0 undef token refs.
- STATUS: awaiting Dave review + approval. Next: Batch 6 = Onboarding (last screen batch), then STEP 4 combined preview.

## STEP 3 Batch 6 built (Onboarding) - LAST screen batch
- Artifacts: step3-batch6.html (5 steps, both themes), step3-batch6-test-panel.html (theme + step jump + Back/Next), step3-batch6-audit.md, build_batch6.py.
- Flow: Welcome -> Sign In -> Choose Template -> Notifications -> All Set. No tab bar (modal flow). Progress dots on steps 2-4.
- WELCOME: JARVIS wordmark + tagline + Get Started + "I already have an account".
- SIGN IN: brain badge + "Create your account"; Continue with Apple (btn-apple = tx-1/bg, INVERTS per theme; placeholder for Apple's official SIWA component, flagged) + Continue with Email (mail) + legal line. Auth=Clerk per plan.
- CHOOSE TEMPLATE: 3 cards Personal(brain/users)/Business(money/briefcase)/Student(accent/graduation-cap). Student SELECTED + "Popular" pill (the wedge). New chrome .tmpl/.tmpl-ic.
- NOTIFICATIONS: bell badge priming + Enable + Maybe later.
- ALL SET: check badge + Enter JARVIS.
- New icons: apple(dropped-fruit-not-logo), mail, arrow-right, check, briefcase, graduation-cap. Apple icon NOT used (Lucide apple = fruit, not Apple logo; SIWA button text-only).
- Composed (no source onboarding in catalog); copy + template descriptions from three-template plan; flagged in audit.
- Machine gate clean both files.
- STATUS: awaiting approval. ALL 6 screen batches then done -> STEP 4 combined preview (all screens as one app), STEP 5 Visual Lock.

## DECISION: three-template differentiation timing
- Three-template spec (Personal/Business/Student differences: categories, entity types, terminology, which sections show, seed content/copy) is PARKED as the FIRST task AFTER Visual Lock (post STEP 5), before/driving the Supabase schema.
- Visual system stays template-AGNOSTIC (same screens all 3; only data/categories/copy differ). Student is the wedge -> build Student fully first, Personal/Business as later configs.
- Dependency: Monetizing Jarvis strategic plan may already define the differences (not yet read); translate it into the spec, or define if absent.

## STEP 4 built: combined preview (one app)
- Artifact: step4-combined.html. Interactive prototype reusing approved Batch 1-6 screens (build_combined.py imports build_batch2-6, strips each screen's tab bar, supplies one consistent tab bar).
- App mode: tab nav (Today/Tasks/Schedule/Brain/More) + More pushes sub-screens (Messages/Goals/Life Map/Themes/Settings) with cx-navbar Back. Onboarding mode: 5-step flow, buttons advance, Enter JARVIS -> app. Theme toggle. Meta-controls OUTSIDE device; device has only real app chrome.
- 10 app screens + 5 onboarding embedded. Machine gate clean (0 em, 0 undef cls, 0 raw inline, 0 undef tok).
- Known gaps (flagged): Projects row no dedicated screen (no-op); Schedule=Day (week/month in batch3 panel); global transient states in batch1 artifacts; Apple SIWA placeholder.
- STATUS: awaiting Dave review of combined preview. Next: STEP 5 Visual Lock.

## STEP 5 Visual Lock PROPOSED (awaiting confirm)
- VISUAL-LOCK.md written: frozen file set (design-system working copy + uniformity v1.3 + step3-batch1-6 + step4-combined + demo-data + manifest + ic/ Lucide set), the 3 RULE 9 amendments, all locked decisions, deferred log (scrim token, Projects screen, global states wiring, schedule week/month, goals data model, themes skins, illustrative values, Apple SIWA, behavior-level items).
- Final sweep: all 7 rendered screen files CLEAN (0 em, 0 undef cls, 0 raw inline, 0 undef tok), both themes. 3 amendments confirmed in design-system.
- On confirm: visual phase COMPLETE. Next = three-template spec (parked first task), then code phases 6-14.

## VISUAL LOCK CONFIRMED 2026-05-21 - VISUAL PHASE COMPLETE
- Dave confirmed the Visual Lock. STEP 0-5 done. Visual system frozen per VISUAL-LOCK.md.
- Next (parked decision): three-template spec (Personal/Business/Student), then code phases 6-14.
- Dependency: Monetizing Jarvis strategic plan may already define the template differences; not yet read. Awaiting Dave's choice: draft spec now from what we know, or he brings the strategic plan in first.

## STRATEGIC PIVOT (Dave directive, 2026-05-21): WEDGE not platform
- DO NOT build the three-template spec. Strategy already decided: build the WEDGE, not the platform.
- BUILD PERSONAL ONLY for now. Multi-template / module platform is DEFERRED until Personal ships and the wedge validates.
- Do NOT build Personal/Business/Student variations or any module entities. Modules are NOT stubbed.
- Proceed to CODE PHASE architecture (STEP 6) for Personal.
- DATA LAYER: design an EXTENSIBLE typed-entity model (base item + type-specific schemas) so domain modules can plug in LATER without a rewrite, but IMPLEMENT ONLY Personal entities now: orgs, workstreams, projects, meetings, contacts. Extensibility required; building modules now is FORBIDDEN.
- Target module architecture to be documented SEPARATELY (not built).

## STEP 6 data-layer architecture drafted (Personal)
- Docs: step6-data-architecture.md (build-now Personal data layer), module-architecture.md (DEFERRED target, documented not built).
- Model = extensible typed-entity: entity_type registry (extensibility seam) + item (base, common cols + JSONB data validated vs type schema, server updated_at, NATIVE delete no tombstones) + item_link (generic typed edges = relationships) + scalar_setting (server-authoritative single-value sync e.g. theme).
- Personal types seeded: org, workstream, project, meeting, contact. RLS owner_id=Clerk sub; per-table realtime.
- OPEN SCOPE Q raised to Dave: Tasks tab needs a `task` entity, Messages needs `message` entity (core Personal, not modules). Did NOT add silently. Awaiting his call (in core now vs fold/defer). Goals/LifeMap/Brain treated as out-of-core unless told otherwise.
- Module arch (how modules plug in later: new entity_type rows + schemas + RLS/views + UI reg, core untouched) documented separately, NOT built.
- STATUS: awaiting Dave review of the data model + the task/message scope call. Next: auth wiring (Clerk->Supabase JWT), RLS SQL, updated_at trigger, seed types, map screens to queries.

## STEP 6 cont: task+message confirmed, schema migration written
- Dave confirmed: task and message ARE in Personal core. 7 types: org, workstream, project, meeting, contact, task, message.
- step6-data-architecture.md updated (task/message rows + relationships; open scope Q resolved).
- 0001_personal_core.sql written: entity_type, item, item_link, scalar_setting; indexes; server-authoritative updated_at triggers; RLS (owner_id = current_external_id() = Clerk JWT sub) on all 4 (entity_type read-only to authed users); native DELETE (no tombstones); per-table realtime publication; 7 seeded Personal entity_type rows with JSON Schemas + SF Symbol icons. All schemas valid JSON, 0 em dashes.
- Color is instance-driven (data.category); JSON-Schema validation app-side now, pg_jsonschema DB hardening deferred (noted in file).
- NEXT: Clerk->Supabase auth wiring + map each locked screen to its read/write queries (access patterns), then seed demo data / build out.

## RUN MODE (Dave, 2026-05-21): keep building, explain plain English
- Dave is the product owner, NOT reading code/SQL. Going forward: I make ALL technical decisions myself with sensible defaults; I do NOT hand him technical files to approve.
- I keep building the real artifacts (specs/SQL/code a dev or Claude Code implements; cannot deploy live here).
- I explain EACH step in plain English, no jargon.
- I only surface decisions that are genuinely his: what the app does, what's in/out of scope, anything that costs money. In plain English with a recommendation.

## DECISION: login = Apple + Email, ENFORCEMENT DEFERRED to App Store launch
- Sign-in methods: Sign in with Apple + Email (Clerk).
- Do NOT enforce login until the app is live on the App Store. Dave's personal/dev version must run with NO login wall.
- Technical (mine): auth behind a flag. Dev/personal build = no login, fixed local owner_id, RLS bypassed locally. Production/App Store build = Clerk login enforced. Build the capability now, switch it on only at launch.
- Payments (Stripe) similarly = launch-time, not now.

## STEP 6 cont: full Personal build architecture documented
- personal-build-architecture.md: covers every piece for the real build, plain English + technical. Sections: data (done), login (done/deferred), the assistant brain (Anthropic API server-side proxy, key-safe, per-user AI budget + rate limit), sync/offline, notifications, voice, App Store & payments, reliability/privacy/abuse (Sentry, rate limiting, Plausible/PostHog, no ads), deferred items.
- REAL DECISIONS surfaced to Dave (plain English): (1) AI budget per user (generous vs tight); (2) payments = Apple IAP for in-app subs (compliant default, verify Apple rules at launch; Stripe for web/non-Apple); deferred.
- KEY FLAG logged: Apple App Store generally REQUIRES Apple In-App Purchase for in-app digital subscriptions (15-30% cut); Stripe likely NOT allowed for in-app digital subs. Rules shifting (courts/EU); verify at launch. Project brief said "Payments: Stripe" - reconcile at launch.
- STATUS: Dave wants every detail covered before real build; keep going. Awaiting his 2 real decisions (AI budget, payments-ack) but can continue covering details.

## STEP 6 cont: screen-by-screen functional spec
- screen-functional-spec.md: every locked screen = what it shows (reads) / what you can do (writes) / states / AI behavior. Plain English.
- 6 OPEN PRODUCT questions surfaced (not money, all Dave's): (1) Messages = what? (in-app inbox / email-text integration / JARVIS nudges) BIGGEST; (2) Brain knowledge data sources; (3) Goals real fields vs derived; (4) Life Map status auto vs manual; (5) Projects screen GAP (never designed, needs list+detail); (6) Onboarding drop template-choice step for Personal-only.
- STATUS: keep covering details per Dave. Offered: keep going vs resolve the 6 open questions.

## MAJOR GAP CAUGHT (Dave, 2026-05-21): visual phase missed features
- Dave flagged: "Where is email? Where is the music option? Did you actually look through all features?" CORRECT catch.
- I speced only from the ~10 screens I rebuilt, NOT the full source app. Did a full pass over all 28 source files.
- EMAIL: real, missed. Messages (catalog 14) is a unified EMAIL + TEXTS inbox with Drafts + Scheduled sends + filters (All/Unread/Email/Texts/Drafts). I built a 3-row chat list. Big miss.
- MUSIC: NOT in any source file (searched all 28, zero hits). New scope if wanted; told Dave honestly.
- Also missed/under-built: Notes(18), Maps/locations(12), Notifications feed(17), Search(17), Money/finance card(17), Contacts list(17), Media/photos(13), Charts(11), full Voice screen(09), and detail screens (project/life-area/account/about/advanced/backup/notifications/themes/voice -detail).
- VISUAL LOCK was INCOMPLETE (core screens only). Missed features must be designed + re-locked OR cut from Personal scope before real build.
- feature-inventory.md written (complete, from source). Awaiting Dave's SCOPE call: which missed features are IN for Personal.

## INCIDENT: overwrote original feature-inventory.md (ship list) - rebuilt
- I overwrote the confirmed feature-inventory.md (had FEAT ids, P/B/S tags) without checking it existed. Full original body NOT recoverable from transcripts (created in an uncaptured/compacted session). Only header+legend survived (head -5).
- Recovered the governing rules: FULL FEATURE COVERAGE (inventory = ship list, confirmed pre-STEP 3) + RULE 18 (every feature ships with an interactive test harness, numbered steps, real behavior, PASS/FAIL, behind TEST_MODE flag).
- Rebuilt feature-inventory.md COMPLETE from source (FEAT-01..25). Personal-scoped. Marks built vs NOT-built vs under-built. Music = FEAT-25 [Missing], Dave's call.
- KEY FINDING: STEP 3 built only the core screens; many confirmed-inventory features were NOT built (Email/Texts full inbox, Notes, Maps, Notifications feed, Search, Money card, Contacts, Media, Charts, Projects screen, detail screens, full Voice). Visual Lock was therefore INCOMPLETE.
- LESSON: never overwrite a file without checking it exists first (create_file failed -> I should have read it fully before cat-overwriting, and backed it up).
- AWAITING: Dave confirms Personal feature scope (which NOT-built features are in) + Music decision.

## SCOPE CONFIRMED (Dave, 2026-05-21): build ALL missing features + Music
- Build all missing/under-built features into Personal, design + RE-LOCK everything (Visual Lock v2).
- Music (FEAT-25): Dave WANTS it, will describe it. Hold design until description received.
- Re-lock plan (missing-feature batches): R1 Messages(Email+Texts+Drafts+Scheduled)+Contacts; R2 Notes+Media/photos+Search; R3 Maps/locations+Notifications feed+Money card+Charts; R4 Projects(list+detail)+detail screens(life-area/account/about/advanced/backup/notifications/themes/voice); R5 full Voice; R6 Music. Then combined preview v2 + Visual Lock v2.
- Demo data will need extending for richer surfaces (e.g. full inbox) using LOCKED personas; flag each extension.
- NEXT: await Music direction, start R1 (full Messages).

## MUSIC (FEAT-25) SPEC (Dave): suggested music during tasks
- JARVIS suggests music matched to the current task / focus session; plays via connected streaming (Spotify / Apple Music). Brain-driven, task-aware. Includes playback control + now-playing strip. NOT a standalone player. Surfaces on Today/Tasks + a now-playing strip. Build in R6.

## FEAT-25 Music: spec'd (Dave brainstorm, 2026-05-21)
- Concept: JARVIS sets context-matched music during tasks via the user's Apple Music/Spotify. NO music engine on our side; lean on services' existing playlists.
- Pick: task -> mood (deep focus/light/creative/workout/wind-down) -> existing service playlist. BLEND: start with services' mood playlists, learn toward user's own/likes.
- UI: suggest+tap default (auto-start optional, off by default), now-playing strip, fades on complete, voice control.
- Streaming: Apple Music (native default) + Spotify; user connects either; their sub plays (no licensing cost); built-in focus sounds fallback.
- music-feature-spec.md written; feature-inventory FEAT-25 -> Confirmed/spec'd.
- Music is R6 in the re-lock plan. NEXT: start R1 (full Messages: Email+Texts+Drafts+Scheduled) + Contacts.

## FEAT-25 Music refinement: taste/artist personalization
- Dave: must pick up on the user's liked artists, type of music, history. Folded in: matching keys off the user's top/liked artists, genres, history (services track this) so sets sound like THEIR taste at the right energy, not generic. Spotify = seed by artists + tune energy/instrumentalness; Apple Music = personalized mixes/stations. Service engine does taste work; JARVIS supplies context. music-feature-spec.md updated.

## FEAT-25 Music: scope finalized (Dave directives, 2026-05-21)
IN: suggest+user-sign-off (default, no surprise playback); plan ahead = schedule + repeat for known tasks/events; assign/pin playlists to tasks/events/categories (manual override wins); preferences customizable in SETTINGS (service, suggest-vs-auto, genre guardrails e.g. no-lyrics-in-deep-work, focus-sounds prefs, per-category defaults); part of ONBOARDING (connect Apple Music/Spotify + prefs); woven into BRAIN (music+productivity insights); Focus Sounds (handful of non-music: rain/cafe/brown noise); learns over time (skips/repeats/what kept per task); Lock-in mode (focus set + timer + silence notifications); Start kick (energizing first-few-min opener); taste personalization (artists/genres/history); blend (services' playlists -> learn toward own).
CUT: session arc (ease-in/deep/wind-down) + auto-extend = far-fetched.
PARKED (not v1): completion payoff, calendar-aware prep, state-shift, "why this" line, reads-the-room quiet hours.
music-feature-spec.md rewritten to match. Music is R6 in re-lock plan.

## FEAT-25 Music: user control + auto (Dave, 2026-05-21)
- Every suggestion is adjustable: accept / swap playlist or song / pick own, one tap. Nothing forced.
- Three control levels: Auto (hands-off, JARVIS runs it), Suggest (default, offer+tap), Manual (user picks). Auto toggle OFF by default. Spec updated.
- BRAINSTORM PILE not yet folded into spec (await converge): batch1 = lock-in mode, session arc+flow protection, completion payoff, calendar-aware prep, "why this" line, focus sounds; batch2 = hard-start kick, state shift, skip=learning, "same as last time", no-more-picking, reads-the-room; further = genre guardrails, wind-down/sleep, feed the Brain. Capture all when Dave converges.

## FEAT-25 Music: spec reconciled to disk (authoritative) + control folded in
- music-feature-spec.md on disk is the current truth and is further along than the prior STATE summary. It already contains: concept; how it picks (mood + taste, blend); CONTROL (Auto/Suggest/Manual, Auto off by default, every suggestion one tap to swap/replace/pick own) <- Dave's latest folded here; plan-ahead (schedule+repeat); assign/pin playlists (manual override wins); Lock-in mode + Start kick; Focus Sounds; learns over time; Settings; Onboarding; Brain insights; streaming (Apple Music default + Spotify, their sub plays). CUT: session arc + auto-extend (far-fetched). PARKED (not v1): completion payoff, calendar-aware prep, state-shift, "why this" line, reads-the-room.
- Spec now comprehensive. Music is R6 in re-lock plan. Ready to start R1 (full Messages + Contacts) when Dave gives go.

## FEAT-25 Music LOCKED v1 (Dave, 2026-05-21). Build = R6. NOW BUILDING R1 (Messages: Email+Texts+Drafts+Scheduled + Contacts).

## R1 BUILT (Messages FEAT-05 + Contacts FEAT-18) - awaiting Dave VISUAL confirm
- Files: relock-R1-messages.html (preview both themes), relock-R1-test-panel.html (RULE 18, 9 steps), relock-R1-audit.md. Builder: /home/claude/build_relock_R1.py.
- Full inbox: filter chips (All/Unread/Email/Texts/Drafts), Email(5), Texts(4: 3 iMessage+1 SMS w/ channel badges), Drafts(2, warn accent), Scheduled(2, blue accent, Edit/Send now/Cancel). Contacts(6, role subtitles).
- uniformity bumped v1.4 (G9 messages, G10 contacts; token-clean). demo-data extended (flagged R1 inbox extension; locked previews preserved for Maya/Daniel/Sofia).
- MACHINE gate clean: 0 em, 0 undefined classes, token-only inline, both themes, counts verified.
- Compose/detail/thread screens deferred to R4 (detail screens).
- NEXT after R1 approval: R2 (Notes + Media/photos + Search).

## R1 v2 REBUILT to iOS-native (Dave: v1 didn't look iOS; wants email/text separated)
- Email|Texts segmented control splits them. Email = iOS Mail (no avatars, unread dot, sender/subject/2-line preview, chevron; Drafts+Scheduled grouped under Email). Texts = iOS Messages (avatars, preview). Dropped category pills + channel badges + inline buttons (un-iOS). Added compose FAB.
- uniformity v1.5 (G11) added; v1.4 inbox styling superseded/unused.
- Gate clean (0 em, 0 undefined, token inline, both themes; counts verified). Files regenerated: relock-R1-messages.html, relock-R1-test-panel.html (9 steps), relock-R1-audit.md.
- Awaiting Dave VISUAL verdict. Alt option offered: fully separate Email/Texts screens instead of segmented.

## R1 v2.1: reduced subtext (Dave). Email/drafts/scheduled = sender+subject only (no preview line). Texts = single-line preview. Gate clean.

## R1 v2.2 page-level visual pass (Dave). Fixed: time tx-4->tx-3 (light-mode legibility), texts preview tx-3->tx-2 (tier from time), removed floating red compose FAB -> iOS nav-bar top-right compose button (.nav-compose, accent tint); Contacts gets top-right "+". uniformity v1.6. Gate clean. Confirmed sender/subject, grp headers, drafts orange To:, blue Sends line, contacts all read clean both themes.

## R1 APPROVED (Dave, 2026-05-21). FEAT-05 Messages + FEAT-18 Contacts done (iOS-native). Starting R2: Notes(FEAT-06)+Media(FEAT-14)+Search(FEAT-16).

## R2 BUILT (Notes FEAT-06 + Media FEAT-14 + Search FEAT-16) - awaiting Dave verdict. Files: relock-R2-screens.html, relock-R2-test-panel.html (7 steps), relock-R2-audit.md. uniformity v1.7 (G12/13/14). iOS-native, no category pills on notes, minimal subtext. Gate clean. demo-data extended (flagged). Builder /home/claude/build_relock_R2.py. NEXT: R3 (Maps/locations + Notifications feed + Money card + Charts).

## R2 EXPANDED to all functional states (Dave: functionality renders more visuals, address them all). 14 states: Notes(list/open/new/empty), Media(grid/sheet/photo-picker/files-picker/attached/viewer/empty), Search(initial/results/no-results). Interactive tap-through prototype (relock-R2-test-panel.html, 11 steps). uniformity v1.8. Fixed latent bug: nav-large used undefined --t-title -> --t-h1 (fixed R1+R2, both rebuilt). Gate clean. Builder /home/claude/build_relock_R2.py (old v1 -> build_relock_R2_v1.bak.py).

## R1 GATE REBUILD (after Dave STOP). Re-anchored DS+v2 in full. R1 rebuilt from canonical components ONLY (msg-row/msg-head/msg-name/msg-subject/msg-preview/unread-dot/pill/nav-large/nav-action/segmented/conn-row/chev/eyebrow/av), zero inline styles (category color via .cat-bg-* classes; uniformity v1.9 adds tucci on-fill-dark + cat-bd-*). Restored: category-colored avatars, channel pills, 1-line preview. Removed improvised mail-row/imsg-row/nav-compose/send-meta. Machine gate clean. relock-R1-gate.md = traced tokens + v2 diff for Dave visual confirm (cannot self-PASS). Builder backed up build_relock_R1_preGate.bak.py. NEXT (only after R1 confirmed): re-audit+rebuild R2 to canonical; then R3. R2/R3 NOT started.

## R1 declutter (Dave): names+subjects truncate to one line (.truncate), time nowrap+no-shrink, channel pills (IMESSAGE/SMS) removed (channel shows in thread, not list). uniformity v2.0 (.msg-name flex/min-width, .msg-time nowrap). Gate clean: 0 inline, 0 undefined, 0 em, both themes.

## R1 subtext reduction (Dave: less subtext in general). One subtext line max per row: email/drafts/scheduled = subject only (preview dropped); texts = message line only; contacts = name only. Gate clean.

## R2 GATE REBUILD. uniformity PRUNED (295->148 lines): removed all improvised v1.4-v1.8 classes (note-row/ne-*/empty-*/as-*/srch-*/file-*/topbar-*/grp-head/upload-*/recent-*/nav-compose/ph/pv-*). R2 (14 states) rebuilt from canonical: .row+.cat-dot+.conn-name+.conn-meta+.chev (notes/files/search/recent), .empty-state, .action-sheet button(.cancel), .nav-bar/.nav-back(+ios chevron)/.nav-action/.nav-large, .search-bar, .eyebrow, .t-h2/.t-body. New --scrim token (DS, resolves deferred G4). New components in uniformity v2.1 (no canonical equiv): photo-grid/tile/check, photo-viewer/pv-stage, doc, sheet-scrim, row-x, lead-tint/muted, is-placeholder, empty-icon glyph, nav-back chevron. Notes list = title+date only (less subtext). Machine gate clean (0 inline, 0 undefined, 0 em, both themes). R1 rebuilt against pruned uniformity, still clean. relock-R2-gate.md = traced tokens + v2 diff for Dave confirm. Builder backup build_relock_R2_preGate.bak.py; uniformity backup uniformity_preGateR2.bak.css. NEXT after R2 confirm: R3 (Maps+Notifications+Money+Charts). R3 NOT started.

## R2 GATE color fix (Dave: color coding thin). Systemic color applied: notes + search results = filled category tiles (.proj-icon .cat-bg-*); files = type-color glyphs (.fg-good/red/blue, Files-app convention); note editor = category kicker (.cat-fg-tucci); add actions = accent (.lead-tint). Grey only on photo placeholders (real photos in app) + recents (no category) + dividers/secondary text. uniformity v2.2 (.proj-icon .ic size, .fg-*). 18 category tiles, file-type colors, gate clean.

## R3 GATE BUILD. Maps/Notifications/Money/Charts (5 states): map(stage SVG+location rows), notifs(canonical msg-row, grouped)+empty, money(hero card cat-fg-money + lifemap-row SVG spend bars + txn rows), insights(SVG vertical bars + stat tiles G7 + completion ring + sparkline). Charts = inline SVG, geometry in SVG attrs (zero inline), color via cat-fg-*/fg-tint (fill/stroke=currentColor). uniformity v2.3 (chart/map-stage/hero-num/ring/delta/day-axis). Re-anchored on catalogs 11/12/17 for intent (old catalogs are inline-styled; derived clean SVG versions). Machine gate clean (0 inline,0 undefined,0 em, both themes). relock-R3-gate.md = traced tokens + diff. Builder build_relock_R3.py. No interactive panel yet (low interactivity; add if needed). NEXT after R3 confirm: R4 (Projects + detail screens). R4 NOT started.

## R3 Money expanded (Dave: budgeting for everyone + upload from other apps/accounts). Money Overview now: budget hero (May Budget, $1160 left, overall bar), "Add to Budget" import rows (scan receipt/statement, add from screenshot of other budgeting app, connect account) PROMINENT, "Budget by Area" category bars (over-budget=red), Accounts (checking/savings/visa, neg=red), Recent txns. New money_import screen (scan/screenshot/connect/import file; imported items land in Recent). 6 states now. Gate clean. budget_cat/import_row/acct_row compose from canonical (.row/.lifemap-row/.msg-body/.conn-name + bar_h SVG); backbar() added.

## R4 GATE BUILD. 11 screens: Projects list (canonical proj-row) + Project detail (eyebrow kicker, progress ring, task-row w/ cat-bd border + urgency, team), Life Area detail (status, ring, suggestion-row, people, Call Mom CTA), Settings: More(profile + colored icon-tile nav rows + sign out), Account(profile + plan/login), Notifications(toggle rows + quiet hours), Themes(appearance segmented + color skins w/ swatches+check), Backup(sync-banner + toggles), Advanced(toggles + data rows), About(app-icon + version + legal), Voice(toggles + voice style choices + wake word). uniformity v2.4 (.profile/.app-icon/.swatch/.destructive-row/.detail-head/.btn-block/.fg-warn). All compose from canonical (.proj-row/.task-row/.suggestion-row/.row/.switch/.radio/.segmented/.sync-banner/.eyebrow). Machine gate clean (0 inline,0 undefined,0 em, both themes); R1-R3 reverified clean. relock-R4-gate.md. NEXT after R4: R5 (full Voice interaction UI), then R6 (Music), then combined preview + Visual Lock v2.

## R4 color-clarity fix (Dave). (1) Detail/section kickers now GREY (.eyebrow, no cat-fg) matching the grey proj-tag in lists; category color lives in tiles/dots/rings/borders, not in header text. (2) Project count pills all pill-subdued (grey) so the category tile is the only color per row (removed warn/good pills that clashed with the tile). (3) Life-area: dropped redundant pink kicker + floating orange DRIFTING header; status moved inside the ring card next to the orange ring. Gate clean.

## R4 PASSED (Dave). Final nit: "On Track" was a status in a count slot -> changed to "4 Tasks" so all project-list trailing items are consistent neutral counts (5 Tasks/3 Today/2 Tasks/4 Tasks). Logic locked: category=tile color (one per row); LIST trailing=neutral count pills (overview, calm); DETAIL=per-task urgency as colored TEXT (red/amber/grey) per gate rule 6 (urgency=text not pill). Kickers grey. R1-R4 all clean. NEXT: R5 full Voice interaction UI.

## R5 GATE BUILD. Voice interaction UI (4 states): idle (orb + Tap to Speak + command chips), listening (orb pulse + Listening + live transcript + Tap to stop), thinking (orb + spinner), response (user/ai conversation bubbles + canonical sched-row result card "Goldman -> 4:00 PM" + Undo/Done + G8 capture bar). uniformity v2.5 (.voice-screen/.voice-orb/.voice-prompt/.voice-transcript/.voice-hint2/.chip-wrap/.convo/.bubble/.convo-actions). Reuses canonical .chip/.spinner/.sched-row/.btn + G8 voice-bar. Full-screen mode w/ X dismiss. Machine gate clean (0 inline,0 undefined,0 em, both themes). relock-R5-gate.md. NEXT: R6 (Music), then combined preview + Visual Lock v2.

## R5 spacing fix (Dave). Result card: replaced spread sched-row (60px time rail gap) with a compact .row (cat-dot + title/loc + trailing time). .convo-actions top padding 0 -> s-4 so Undo/Done separate from the card. Consistent s-4 vertical rhythm convo/result/actions. Gate clean.

## NOTES UPGRADE Phase 1 (visual) BUILT - awaiting Dave verdict. Per JARVIS_Notes_Upgrade_Spec.md (Dave pasted it; not on disk/project knowledge). Chose VISUAL batch (Dave picked) honoring spec note that functional/code rework is parked to Notes code phase. 6 screens: List (R2 container reused), Editor-Blocks (text/heading/checklist/light-table/attachments + Add Block), Add Block inserter (8 Phase-1 types), Templates picker (6 starter), Connections (category/event/task + create-tasks action), Create Tasks (task-rows + Create CTA). Phase 2/3 OUT (charts/AI/program/domain templates/two-way sync/backlinks/goals/surface-on-Today). uniformity v2.6 (.inline-dot/.block-h/.note-list/.check-line/.ntable+.num+.sum/.add-block/.row-stack); all compose on canonical .cb/.row/.task-row/.proj-icon/.conn-name/.conn-meta/.chev/.urgency/.sheet-scrim/.action-sheet/.btn. CONSISTENCY FIX flagged: editor kicker now grey text + colored cat-dot (was R2 colored "Tucci" word) per R4 grey-kicker rule. Machine gate PASS (0 inline,0 undefined,0 em,both themes); R1-R5 reverified clean against v2.6. Test panel = 6 DOM-assertion steps. Files: relock-RNotes-screens.html, relock-RNotes-test-panel.html, relock-RNotes-gate.md. Builder /home/claude/build_relock_RNotes.py. Icons added: type/list/list-ordered/table/tag/text/list-todo/calendar-plus/link. NEXT after verdict: R6 (Music), then combined preview + Visual Lock v2.

## RECURRING DEFECT FIXED (Dave frustrated, sent binding gate). Root cause: preview frames never rendered iOS status bar or top/bottom safe-area zones; --safe-top/--safe-bottom = env()=0 in artifact preview so DS L368-370 safe padding did nothing; content jammed 12px from top edge on EVERY screen of EVERY batch. Refs DO render it (v348 .ios-status L597; Today_Light_Realistic .statusbar L48/132). FIX in shared frame chrome of ALL 6 builders: added .statusbar (9:41+cellular+wifi+battery, height 50) + .home-indicator (134x5 pill, height 34); frame 760->800; content clears both zones. Patched build_relock_R1..R5 + RNotes (CHROME+=_SBCSS; STATUSBAR/HOMEIND consts; device() wraps). App markup stays token-pure (0 inline); raw px only in device chrome (status-bar/home-indicator/frame metrics = iOS device values, flagged). All 6 rebuilt: 0 inline/0 undefined/0 em/statusbar+home/both themes. relock-FULL-reaudit.md written. AWAITING Dave visual confirm of the safe-area fix before continuing. Notes Upgrade verdict still pending under this fix. If recurring issue was something else, Dave points at one frame.

## NOTES color-coding fix (Dave: recurring color issue, R5 was fine, Notes regressed). Matched R4 systemic-color standard: connections rows grey glyphs -> colored category tiles (proj-icon cat-bg-tucci) like R4 nav_row; create-tasks rows -> task-check cat-bd-tucci + colored urgency text like R4 task_row (dropped cb-as-selection, subtitle "become Tucci Tasks"); editor kicker 10px dot -> colored category tile matching the list. Add Block/Templates keep accent glyphs (non-category, interactive=accent, flagged intentional). Panel conn assertion updated (proj-icon>=4). Gate PASS (0 inline/undef/em, both themes); safe-area/status-bar fix retained. AWAITING Dave verdict on Notes.

## NOTES "everything blue" fix (Dave). Cause: demo note was Tucci (brand color light blue) AND dark interactive tint is blue -> stacked monochrome; plus menu glyphs were lead-tint (accent=blue in dark). Fix: (1) demo note re-themed to HEALTH/green ("Marathon Plan V3": training checklist, paces table, attachments) across editor/connections/create-tasks so category color is distinct from the blue tint; (2) Templates+Add Block leading glyphs lead-tint -> lead-ink (neutral label color, var(--tx-2)) = iOS menu-icon treatment, not accent (uniformity v2.6b). Remaining blue-in-dark is only the add-block link + one done checkbox (legit interactive). Category variety preserved in list. cat-bd-health task markers; file-type colors kept. Gate PASS (0 inline/undef/em, both themes). Panel assertions updated (Long Run Sunday, Create 3 Tasks). AWAITING Dave verdict.

## NOTES UPGRADE PASSED (Dave, color fix accepted). Standing instruction GOING FORWARD: use VARIED category example data across a batch (not a single-category flow that reads as one color); e.g. mix tucci/health/family/elite/brain/money/friends so systemic color shows variety. Applies R6 onward (passed batches unchanged). NEXT: R6 Music (last re-lock batch), then combined preview + Visual Lock v2.

## R6 MUSIC BUILT (FEAT-25, visual) - awaiting Dave verdict. 7 states: Suggest(offer card + Play/Swap/Replace + For-Your-Day rows)/Now Playing(albumart-lg + transport + SVG progress + APPLE MUSIC pill + Swap)/Lock-In(hero-num timer + Notifications Silenced + Start Kick + End Session)/Focus Sounds(6 ambience rows, Rain playing)/Assign(scope segmented Task/Event/Category + playlist radio list, pinning to Family)/Settings(service rows + Suggest/Auto/Manual segmented + No-Lyrics/Start-Kick toggles + Focus Sounds + per-category defaults)/Connect(empty + Apple Music/Spotify/Focus Sounds btns). VARIED categories (elite/tucci/health/family/money/brain/friends) per new rule. uniformity v2.7 (.albumart/-lg, .np/-title/-artist, .xport/.play, .scrub-times, .lockin/.lockin-sub) all compose on canonical .card/.row/.segmented/.slider?->SVG progress/.btn/.pill/.switch/.radio/.empty-state/.proj-icon tiles/.convo-actions. Progress = inline SVG (geometry in attrs, fg-tint), zero inline. Status bar+safe areas present (global fix). Machine gate PASS (0 inline/undef/em, both themes); R1-R5+RNotes reverified clean. Files relock-R6-screens.html / -test-panel.html (7 steps) / -gate.md. Builder /home/claude/build_relock_R6.py. Icons added: music/list-music/play/pause/skip-back/skip-forward/headphones/cloud-rain/waves/coffee/flame/volume-2/pin/bell-off/zap/radio/disc-3/shuffle/repeat. NEXT after R6 verdict: combined preview (all batches) + Visual Lock v2 sign-off, then Code Phase.

## R6 MUSIC REWORKED to mirror Apple Music (Dave: mirror Apple Music with JARVIS theme, like we mirror iOS). Album art -> Apple-Music personalized-mix covers (category-hued gradient + sheen + scrim + mix-name overlay; real cover art loads from service in live app; thumbnails small w/ music glyph). Now Playing -> Apple Music player layout (grabber, big cover, track+artist + round more btn, thin scrubber elapsed/-remaining, large transport w/ accent play, volume slider w/ speaker icons, Lyrics/AirPlay/Queue tools row; JARVIS context kicker centered above). Suggest -> AM playlist-header (cover+title+desc+Play) + Swap/Replace. Assign/For-Your-Day -> AM library rows (cover thumb+title+sub). uniformity v2.7 rewritten (.albumart/-lg + ::after scrim + -title, .np-head/.np-track/.np-artist/.np-more, .scrub-times, .xport/.play accent, .volume/.vol-bar, .np-tools(+button), .np-context, .np-meta, .lockin). Cover gradient = neutral rgba sheen over cat hue (DS-card technique), not invented color. Icons added chevron-down/airplay/quote/volume-1. Old builder -> build_relock_R6_v1.bak.py. Gate PASS (0 inline/undef/em both themes); all batches reverified clean. AWAITING Dave verdict.

## R6 verdict tweaks (Dave). (1) Focus Sounds now colored icon tiles (proj-icon cat-bg: Rain=brain/Cafe=money/Ocean=tucci/Brown Noise=health/Fireplace=elite/White Noise=family), 6 distinct colors + PLAYING tag. (2) Big cover boxes: added .albumart-edit camera upload overlay on Suggest + Now Playing covers (custom user image; service art default). uniformity .albumart-edit added; camera icon added. Gate PASS (0 inline/undef/em, both themes); all batches clean. AWAITING Dave verdict (then combined preview + Visual Lock v2).

## COMBINED PREVIEW + VISUAL LOCK v2 BUILT (Dave approved R6, said build it). jarvis-combined-preview.html = interactive gallery, 7 batch tabs + Dark/Light toggle, 51 frames pulled live from each batch builder (R1 EMAIL_S/TEXTS_S/CONTACTS_S; R2-R6/RNotes STATES/GROUPS). build_combined.py. 0 em/0 undefined/0 inline in frames. jarvis-visual-lock-v2.md = sign-off summary (coverage, locked standards: status bar/safe areas, token purity, systemic color, caps, cards, Apple Music mirror). AWAITING Dave Visual Lock v2 sign-off. After sign-off -> Code Phase STEP 6 (architecture). NO code phase work until Dave signs.

## COMBINED-PREVIEW AUDIT FIXES (Dave, pre-sign-off). (1) R3 Money: yellow "May Budget" cat-fg-money kicker INSIDE hero card -> grey group("May Budget") eyebrow ABOVE card (matches Add to Budget/Budget by Area). Yellow now only on data bar. Money full audit: only that 1 violation; rest compliant (cat bars, money-tile accounts, cat-dot txns, red over-budget status, grey amounts/headers). (2) R2 note_open kicker: cat-fg-tucci "Tucci" colored TEXT -> grey eyebrow + proj-icon cat-bg-tucci tile (matches R4 sign-off + RNotes editor). (3) Light cards: added [data-theme="light"] .card{background:var(--surface-1)} = solid white (DS glass-bg 0.72 read grey; gate wants solid white in light). Remaining light greys = intentional placeholders (empty photos, map stage, bar tracks, modal scrim). Only colored-text kickers were R2+R3; all other cat-fg = data-viz (bars/rings/pins) kept. Rebuilt all + combined; 0 inline/undef/em all 8 files. AWAITING Dave re-review / sign-off.

## LOCKED RULE: iOS HIG SPACING (app-wide, uniformity v2.8). Fixed at the shared leverage classes so all 51 screens inherit it: layout margin 16pt (.pad-x/.grp/.sub-bar/.seg-card/.detail-head/.doc = var(--s-4)); list rows 44pt with 12pt vertical / 16pt leading (.row family = var(--s-3) var(--s-4) + min-height var(--tap-min)); section rhythm 8/12/16; player/voice/convo blocks on the 16pt margin. Overrides the old JARVIS 18pt edge / 14pt row padding. NEVER reintroduce 18pt edges or 14pt row padding. Any future spacing = these tokens only. Rebuilt all 7 builders + combined; gate clean.

## MONEY COLOR-SCHEME FIX (Dave: import icons all red, off). (1) import_row: was accent glyph ic(...,"lead-tint") = red in light/blue in dark = wall of red, inconsistent with Accounts on same page -> now colored category TILE (proj-icon cat-bg-X) matching acct_row. Varied iOS-Settings style: Scan=money, Screenshot=tucci, Connect=health, Import File=brain. Theme-stable (no longer flips red/blue). (2) Dining budget bar was elite=RED at 76% (NOT over) = misread as over-budget alert -> changed to friends=teal. Red on Money page now reserved for negatives/over-budget only (Travel over=fg-red, Visa balance, neg txns). Rebuilt R3+combined, gate clean.

## LOCKED RULE: ROW-LEADING ICONS = COLORED CATEGORY TILES (app-wide, Dave-approved). Every list/menu/action ROW that has a leading icon uses a colored tile (.proj-icon cat-bg-X), NOT a bare glyph (lead-ink / lead-tint / lead-muted). Applies to Settings, Money (import + accounts), Connections, Focus Sounds, Notes templates, Notes Add Block, and any new row type. Pick varied category colors (iOS-Settings style) unless the row belongs to one category. EXCEPTIONS (NOT row-leading icons, keep as-is): iOS action sheets (tinted text, no icon), toolbar/format buttons (e.g. player np-tools, voice controls), inline glyphs inside text, data-viz. Converted Notes Add Block (8 blocks) + template picker (6) from monochrome lead-ink to tiles. Rebuilt RNotes+combined.

## CROSS-REFERENCE (rules vs all 51 frames). Fixed: R2 Media ADD rows (Take Photo / Choose from Library / Attach a File) were accent glyphs -> colored tiles (tucci/family/health), same rule as Money import. FLAGGED EXCEPTION (kept, awaiting Dave): R2 Search RECENT rows use a grey clock glyph (ic clock lead-muted) not a colored tile = iOS recent-search pattern; recommend keeping grey clock as an explicit exception to the tile rule. All other rules PASS: 0 inline / 0 undefined class / 0 em dash (machine, all 7 files); both themes; status bar + home indicator on every frame; 0 colored-text kickers; rows 44pt min (v2.8); light cards solid white; urgency = colored text not pill; category color in tiles/dots/bars/rings. Note: canonical master prompt is read-only to me (/mnt/project + project knowledge); rule text provided to Dave to paste; logged here as the working rule.

## LOCKED: CODE-PHASE TEST PROCEDURE (Dave-approved, all 3 upgrades). Behavior-first clickable harness: ordered buttons run real in-memory logic, pass/fail + live state, steps unlock sequentially. Approve behavior BEFORE writing production code; then build Supabase code to match; same step defs run as automated tests against real code. UPGRADES: (1) single source of truth = approved step list drives harness now + generated automated tests later, no drift; (2) core + edge/failure steps (bad input rejected, double-action no crash, empty input, offline/reconnect); (3) coverage checklist per feature, each requirement ticks green only when a covering step passes. One harness app with feature picker. Gate: feature behavior locked only when all steps pass + all coverage green + Dave approves; real code accepted only when same steps pass against it; tombstone + sync get permanent dedicated steps. Files: TEST_PROCEDURE.md (contract), test-harness-v2.html (reference template, Notes fully built as the example).

## VISUAL LOCK v2 SIGNED (Dave). Visual phase complete: 51 frames, both themes, gate clean, all rules locked (R4 color logic, iOS spacing v2.8, row-leading tiles + search-recents grey-clock exception). CODE PHASE STARTED.
## CODE PHASE STEP 1: CORE DATA MODEL (the spine). Per locked test procedure: behavior approved before code, data model first. Added "Core Data Model" feature to test-harness-v2.html (now default tab; Notes kept as the example). Tests the universal invariants in memory: D1 create, D2 read, D3 update, D4 hard delete, D5 tombstone-proof reload, D6 per-user isolation, D7 server-time-wins (scalar sync fix), D8 offline-queue/reconnect, D9 safe no-op on missing id, D10 concurrent edits deterministic by server time. Core + edge steps, coverage checklist, single-source spec. AWAITING Dave to tap through + approve the core data behavior; then build Supabase schema + store (RLS = D6, hard delete = D4/D5, server timestamps = D7/D10) to match, and re-run these steps against the real code. No production code written yet.

## CODE STEP 1 FIX (harness caught a real sync flaw pre-code). Step 10 (offline edit then reconnect) failed: server clock was not monotonic, so an offline edit reconnecting after an artificially high explicit timestamp (step 7 ts=10 vs clock=4) got stamped 5, judged stale (5<10), and dropped. FIX in makeCore.applyUpdate: clock is now monotonic (on accepting an explicit ts, advance clock=max(clock,ts)), so a reconnecting offline edit always gets the latest time and wins over prior state. Keeps server-time-wins (D7) + concurrent resolution (D10) correct. Verified via Python mirror: all 11 steps PASS. This is the LWW-by-server-time model (chosen for scalar sync); deeper per-field/CRDT merge is out of scope. Awaiting Dave re-run + approval.

## CODE STEP 1 APPROVED (Dave): core data model behavior, all 10 steps pass. Next = build it for real (Supabase schema + RLS [D6], hard delete [D4/D5], server-time-wins monotonic [D7/D10], offline queue/reconnect [D8], typed store) + auto-generated tests from the 10 approved steps, runnable locally. NOTE: discussed build logistics. Recommended: fresh build chat in Track 3 project for context headroom; persistence = Dave commits each deliverable to the existing private GitHub repo; sandbox cannot reach live Supabase (build + unit-test here, wire to real Supabase + device on Dave machine).

## HANDOFF PACK PREPARED for fresh build chat: CODE_PHASE_HANDOFF.md (START HERE brief) + STATE.md + TEST_PROCEDURE.md + test-harness-v2.html + jarvis-design-system.css + uniformity.css + jarvis-visual-lock-v2.md + jarvis-combined-preview.html. Dave to start a new chat in Track 3 project, load the pack, build the approved Core Data Model first.

## CODE STEP 1 BUILT (Core Data Model, real code). Fresh build chat. Decisions locked via widget: (1) Supabase Auth now, swap to Clerk at Milestone B; (2) build the engine only (base item + scalar_setting + entity_type seam, NO Personal entity types seeded yet); (3) in-memory automated tests now + a device script for live Supabase/RLS. Project jarvis-core: Vite-less lib (React/Capacitor wire-up comes with the first feature), TS + Vitest. Files: src/core/{types,adapter,inMemoryAdapter,supabaseAdapter,store,spec}.ts, src/index.ts, tests/core.spec.ts, supabase/migrations/0001_core_data_model.sql, docs/DEVICE_TEST.md + verify-rls.mjs, README.md. ARCHITECTURE: DataAdapter interface (async) with two interchangeable backends - InMemoryAdapter (faithful 1:1 port of approved harness makeCore, used by tests, no network) and SupabaseAdapter (real, used on device). Store wraps an adapter and adds the offline queue (client concern). spec.ts is the SINGLE SOURCE: the 11 approved steps ported 1:1 from test-harness-v2.html, drives the Vitest suite; harness and spec must be kept in sync (future: regenerate harness from spec). SQL: item (uuid id, owner_id default auth.uid(), entity_type FK, data jsonb, created_at, updated_at) + scalar_setting + entity_type registry; monotonic updated_at trigger (greatest(now(), old+1us)) = D7/D10 ordering; item_apply_patch(p_id,p_patch) RPC = atomic JSONB merge inside RLS (security invoker) = D6+D9; RLS owner-only select/insert/update/delete on item + scalar_setting; entity_type readable by authenticated. Seeded placeholder type 'item' so the FK holds until real types arrive. TESTS: 23 pass (11 ordered steps D1-D10, 10 coverage assertions, 2 permanent guardians = tombstone D4/D5 + offline-sync D8). typecheck clean. 0 em/en dashes anywhere incl comments. LOGISTICS: sandbox cannot reach Supabase (verified) so RLS/trigger proven on device via docs/verify-rls.mjs (needs 2 test users; checks D6 isolation, D7/D10 monotonic time, D9 no-op, D4/D5 hard delete). SCOPE FLAGS (deliberate, in README): only updates queue offline (creates/deletes immediate, matches approved core); LWW-by-server-time only (no CRDT, matches line 404 agreed scope); explicit serverTime is a test affordance honored by in-memory adapter, ignored by SupabaseAdapter (server owns time). MISSING-FROM-PACK FLAG: step6-data-architecture.md + module-architecture.md referenced in STATE but not in this pack; built from the approved harness (the binding source) instead. AWAITING Dave: review, then wire to his real Supabase project + run verify-rls.mjs on device, commit jarvis-core to the private repo. NEXT after that: first feature (Notes is the harness example) through the same gate.

## CODE STEP 1 VERIFIED ON REAL SUPABASE (device check PASSED, Dave ran it, 2026-05-22). Schema 0001_core_data_model.sql applied to a fresh Supabase project (Supabase Auth, free org). RLS verification block (two simulated authed users via request.jwt.claims + set local role authenticated, wrapped in begin/rollback so nothing persists) returned ALL CHECKS PASSED: D1/D2 create+read; D6 isolation (B blocked from read/update/delete of A's row, cannot alter A's data); D3 owner update; D7/D10 monotonic updated_at advances; D9 missing-id no-op; D4/D5 hard delete with no resurrection. Combined with the 23/23 in-memory Vitest suite, the Core Data Model is now proven end to end (engine logic + real Postgres RLS). Repo: github.com/davefisher813/jarvis-rebuild (jarvis-core/). ENGINE = DONE. Note: project still named warm-project-pool default (cosmetic, renamable). NEXT GATE: first Personal feature through BOTH gates (design gate JARVIS_DESIGN_GATE.md + behavior gate TEST_PROCEDURE.md); Notes is the harness example. App shell/routing/theme-skin layer (remainder of STEP 6 architecture) NOT yet built; open decision next session = shell-first vs feature-first. Feature additions merged provisionally (FEAT-26 Quick Capture, FEAT-27 AI routing, FEAT-28 note full-text search, FEAT-29 outside-app voice; create-tasks-from-note already in Notes Phase 1); final FEAT numbers pending the master feature-inventory.md which is not in the pack.

## CODE STEP 2 STARTED: app shell, slice step 1 BUILT (scaffold + theme layer + engine wired). Path confirmed by Dave via widget: thin vertical slice (shell then Notes), not features-in-isolation, not a big speculative shell. Built app/ as a sibling to jarvis-core/ in the repo, importing the engine via Vite alias @core -> ../jarvis-core/src/index.ts (single engine source, no duplication). Stack: React 18 + Vite 5 + TS, React Router (installed, routes come at the nav step). Files: app/{package.json,vite.config.ts,tsconfig.json,index.html} + src/{main.tsx, App.tsx (DEV SCAFFOLD only, not a product screen, not gated), theme/ThemeProvider.tsx, data/client.ts, styles/(locked jarvis-design-system.css + uniformity.css copied in), vite-env.d.ts}. THEME LAYER: drives [data-theme] dark/light on the document root (the locked CSS already styles both); default dark; persists to localStorage now, will move to server scalar_setting('theme') when settings sync is built. SKINS: NOT wired - the locked CSS has no skin token mechanism (R4 Themes screen showed swatches only); deferred until skin tokens exist. DATA CLIENT: makeStore() uses createSupabaseAdapter(url,anonKey,accessToken) when VITE_SUPABASE_URL+VITE_SUPABASE_ANON_KEY are set, else InMemoryAdapter fallback so the shell runs with no network. RESULT: npm install clean; tsc --noEmit CLEAN; vite build OK (83 modules, locked CSS bundled 32kB); 0 em dashes; the .js->.ts engine specifiers resolved fine under both tsc (bundler) and Vite. Capacitor/iOS DEFERRED to the wrapper phase per plan. Engine technical reality reconfirmed from disk (exports: Store, InMemoryAdapter, SupabaseAdapter, createSupabaseAdapter, types; Store.create returns Promise<string> id). NEXT (gated): slice step 2 = Sign-In screen (Supabase Auth) through the DESIGN GATE (value-to-token table + literal scan + 3 offenders + diff vs locked Sign In screen), built here + verified on device; then nav shell (tab bar + routing); then Notes through behavior harness + design gate.

## STEP 2 amendment (Dave: avoid issues at skin implementation + a coming GAMING MODE): generalized the theme layer to a MULTI-AXIS appearance system BEFORE building further, so skins and gaming mode are additive later (no provider rewrite, no screen changes). src/theme/ -> src/appearance/AppearanceProvider.tsx. Three independent root data-attributes: data-theme (dark/light, has CSS now), data-skin (default only, no CSS yet), data-mode (standard only, no CSS yet). APPEARANCE_OPTIONS registry = single source of what Settings may offer; adding a skin/mode = add a value + a [data-skin=x]/[data-mode=x] CSS token block, nothing else. Persists whole appearance object to localStorage (jarvis.appearance), will move to server scalar_setting later. The real skin-readiness is TOKEN PURITY (all 51 screens use vars, gate-enforced) so token overrides reskin everything automatically; a single hardcoded color would break a skin, which the design gate blocks. tsc clean, vite build OK, 0 em dashes. OPEN DESIGN DECISIONS for when skins/gaming mode are built: (1) does a skin recolor only accent/surface tokens or ALSO the category brand palette (affects the systemic-color rule; token structure should separate category palette from accent/surface); (2) is gaming mode visual/effects-only (fits the mode axis cleanly) or does it also change layout/flows/features (then those parts are feature-level, not theming). NEXT unchanged: Sign-In screen through the design gate.

## SLICE STEP 2 BUILT: Sign In screen (design APPROVED by Dave "Good", then real React built). Design gate passed via signin-preview.html (both themes) + signin-gate.md (value-to-token table, scan: 0 inline/0 raw colors in proposed CSS/0 em dashes, only flagged device chrome non-canonical; 3 offenders addressed; diff noted screen was never in v2 lock so designed fresh). RULE 9 additions approved: .btn-apple (var(--tx-1)/var(--bg) inverts per theme), .signin-* layout, icon sizes. Real code: app/src/styles/components.css (approved RULE 9 classes), app/src/auth/supabaseClient.ts (guarded singleton, null when no env), app/src/auth/AuthProvider.tsx (session via onAuthStateChange, signInWithApple=OAuth apple, signInWithEmail=signInWithOtp, signOut), app/src/screens/SignIn.tsx (matches approved design; uses .screen real safe areas, NO faked chrome; lucide-react Brain/Mail/Apple, Apple is a flagged placeholder for Apple's official SIWA button). App.tsx now gates: !session -> SignIn, session -> dev placeholder (nav+features pending). main.tsx wraps AppearanceProvider > AuthProvider > Router. Decisions locked at design: app mark = brain-blue (cat-bg-brain); copy "Welcome to JARVIS"/"Your day, handled."; no Choose Template step (Personal-only, sign in -> app); auth = Supabase. lucide-react@0.439 added. tsc clean, vite build OK, 0 em dashes. Email-entry screen is the NEXT gated screen (Continue with Email currently stubbed). NEXT per agreed sequence: EVENT BUS + gamification capture slice (schema only, no UI, fires from Milestone A so gaming system at Milestone C has history), THEN Notes (first feature, behavior harness + design gate).

## SLICE STEP 3 BUILT: EVENT BUS + capture slice (infrastructure, no UI, fires from Milestone A so the Milestone C gaming system has history). Per the prior gaming plan: define event SCHEMA now, defer mechanics. Files in app/src/events/: types.ts (PERMANENT schema: EVENT_SCHEMA_VERSION=1; JarvisEvent envelope {id,type,ts,v,entityType?,entityId?,props?}; EventType union = app.opened/app.foregrounded/auth.signed_in/auth.signed_out/screen.viewed/entity.created|updated|deleted/task.completed/focus.started|completed/action; "action"+props.name = extensible escape hatch so new feature events need no schema bump), bus.ts (EventBus pub/sub, stamps id/ts/v, throwing listener never blocks others), log.ts (LocalEventLog append-only over an EventStorage seam; localStorage impl; cap 10000 safety net), index.ts (singleton bus + local log subscriber + emit() helper). Wired: main.tsx emits app.opened on load; AuthProvider emits auth.signed_in/out on Supabase auth events. Tests: app now has vitest; src/events/events.test.ts = 8 passing (stamp envelope, deliver to subscribers, unsubscribe, throwing-listener isolation, log append/reload/corrupt/cap, bus->log capture). tsc clean, vite build OK, 0 em dashes. DURABILITY FLAG (raised to Dave): localStorage is per-device + bounded (~5MB) = NOT durable history; before launch add a SERVER SINK (owner-scoped append-only events table) subscribing to the same bus so gaming history survives device loss + syncs cross-device. Mechanics (points/XP/levels/achievements) derived from this log at Milestone C, never computed now. NEXT: Notes = first feature, through BOTH gates (behavior harness per TEST_PROCEDURE, then design gate per JARVIS_DESIGN_GATE; Notes IS in the v2 lock so there's a real screen to diff against). Notes will emit entity.created/updated/deleted + (later) task.completed via the bus.

## NOTES BUILD NOTE (Dave reviewed the v2 Notes Upgrade screens). Connections screen demo data is MONOCHROME: 4 "Linked To" tiles all cat-bg-health (green), violating the varied-category demo rule, so the color system does not read. FIX WHEN BUILDING NOTES: vary the Connections demo categories (e.g., a Work project, a Health routine, a Personal goal, a Contact) so colors differ. Create Tasks LEFT GREEN ON PURPOSE: its 3 checklist boxes are cat-bd-health because the tasks are generated from one Health note and inherit its category, which is correct, not a bug (only the urgency labels differ, amber/grey). The cat-bg/cat-bd mechanism is correct on both; only Connections demo CONTENT changes, handled at the Notes design gate.

## NOTES FEATURE: behavior APPROVED + real code BUILT (behavior gate green). Dave tapped through and approved the expanded 18-step Notes Upgrade harness (notes-harness.html: blocks add/edit/reorder/delete, checklist->tasks linked + category inherited, connection add/remove, Meeting Notes template seeds blocks, lifecycle delete/tombstone/tasks-survive, edges: empty-title reject, double-delete, empty-checklist 0 tasks, offline/reconnect, missing-block/connection no-op). Headless pre-check 18/18, coverage 18/18. REAL CODE built in app/src/notes/: types.ts (ENTITY_NOTE/ENTITY_TASK, Block/Connection/NoteData/TaskData, BlockType union = heading/text/bulleted_list/numbered_list/checklist/table/photo/file, TEMPLATES = blank/meeting/todo/tracker/brief/journal mirroring the locked Templates screen), NotesService.ts (async layer over the engine Store; notes stored as item entity_type "note" with content in data; tasks as entity_type "task" linked one-way via fromNote; block/connection edits are read-modify-write writing the changed field back; onEvent DI hook -> event bus, no-op in tests), notesSpec.ts (the 18 steps as async, single source for tests), notes.test.ts. Engine API reconfirmed from disk: Store.create(ownerId, ENTITY_TYPE, data:ItemData) [entityType is 2nd arg], update(ownerId,id,patch:ItemData,serverTime?), ItemData=Record<string,Json>; cast nested Block[]/Connection[] via "as unknown as ItemData". Migration 0002_notes_entities.sql seeds entity_type 'note','task' (run on Supabase after 0001; InMemoryAdapter has no FK so tests pass without it). vitest.config.ts got the @core alias. RESULT: 30/30 app tests pass (8 events + 18 Notes steps + coverage + 3 permanent guards: tombstone R12, sync R17, tasks-survive R13); tsc clean; vite build OK; 0 em dashes. NEXT: DESIGN GATE on the Notes screens (list/open/block-editor/add-block/templates/connections/create-tasks) per JARVIS_DESIGN_GATE, applying the Connections varied-category fix; then the screen + behavior both locked = Notes feature done.

## NOTES DESIGN GATE: COMPLETE (all 6 Notes Upgrade screens approved by Dave, one at a time). Built in app/src/notes/screens/ + app/src/shell/TabBar.tsx, all from canonical classes, both themes, gate evidence per screen (value-to-token table, literal scan 0 inline/0 raw colors/0 em dashes, three offenders, diff vs locked frame; never self-passed):
- #46 NotesList.tsx (list; varied category tiles already correct) APPROVED
- #47 NoteEditor.tsx (block renderer: heading/text/checklist/table inline + file/photo grouped in attachments card + Add Block; table wrapped in tbody for React) APPROVED
- #48 AddBlockSheet.tsx (bottom sheet, 8 block types, varied tiles; canonical .sheet-scrim absolute over device) APPROVED
- #49 Templates.tsx (New Note picker, 6 templates, distinct tiles, keys match types.ts TEMPLATES) APPROVED
- #50 Connections.tsx (MONOCHROME FIX APPLIED: lock had all 4 tiles cat-bg-health/green; now health/tucci/elite/money, content+labels+icons unchanged) APPROVED
- #51 CreateTasks.tsx (stays green by design, tasks inherit note category; urgency warn/muted tags) APPROVED
Note: "note open" and "block editor" are the SAME locked frame (#47), so 6 screens not 7. Base Notes empty-state (#7) is OUTSIDE the Upgrade batch, still optional.
ICON-SIZE FIX: the canonical CSS export was MISSING base .ic context sizes (the locked combined-preview defined them in its own chrome). Added to app/src/styles/components.css: .nav-action .ic / .nav-back .ic = 23px, .tab .ic = 26px, and .row > span[class*="fg-"] > .ic = 20px (attachment icons). Without these, bare-.ic icons (pencil, tab, attachment glyphs) collapsed. Real app uses lucide-react which self-sizes, but these keep it consistent + fixed the previews.
PREVIEW METHOD (locked-in): gate previews render the screen inside the locked DEVICE FRAME chrome (extracted .device flex-column + .scroll flex:1 + .tab-bar + .statusbar + .home-indicator from the combined preview, preview-only NOT canonical) so the tab bar pins to the bottom + status bar fills the top + correct per-theme --bg. Two device frames stacked vertically (DARK then LIGHT) for mobile viewing. React screens use canonical .screen (real iOS chrome) = the one standing allowed exception.
STATUS: app green = tsc clean, vite build OK, 30/30 tests, 0 em dashes. lucide-react icons used across screens (FileText, PenLine, MoreHorizontal, Check, Plus, Image, AlignLeft, Heading, List, ListOrdered, ListTodo, Table, Paperclip, CalendarDays, Tag, ListChecks, Home, Calendar, Brain, MoreHorizontal). 
NEXT (integration, not yet done): wire the 6 gated Notes screens into a NAV SHELL (tab bar routing) + connect them to the real NotesService (live data instead of demo content) so Notes actually runs in the app; App.tsx still gates SignIn vs a dev placeholder. Optional: Notes empty-state (#7). Then move to other Personal-template features (Today, Tasks, Schedule, Brain hub).
