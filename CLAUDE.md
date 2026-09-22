# JARVIS, working notes

Decisions that outlive the session that made them. Short, dated, and only
the ones a future session would otherwise get wrong.

## Unfinished: the Colour Key sweep (paused 2026-09-22)

Dave paused a sweep to make the 2026-09-22 rulings (§AK one grey, §AL the
capsule, §AM the Colour Key and Subtext Catalog picks) hold on every screen,
to resume when his usage resets. **If he says "resume", start at
`qa/findings/2026-09-22-RESUME.md`** and follow it in order: it holds the
questions to ask him first, the 581 pending findings, the ready-to-run
workflow, and the pitfalls already hit. Do not re-audit from scratch.

## The writing bar and iOS's accessory pill (Dave, 2026-09-15)

When the keyboard is up in a document, two bars sit above the keys:

1. **Ours** (`.doc-kbar`, `shared/DocEditor.tsx`): Undo, Redo, Format, List,
   Insert, JARVIS, Done.
2. **iOS's own accessory pill**: the field chevrons and a tick. It belongs to
   WKWebView, not to us, and its tick duplicates our Done.

**Now, while the web app is the job: keep both.** The page renders above the
whole stack rather than under it. `DocEditor` publishes `--doc-kbar-clear`,
the distance from the top of our bar to the foot of the layout viewport, so
the room reserved on a writing screen covers our bar, the pill and the keys
without this code knowing which is which. `--doc-kbar-h` is our bar's own
height, for anything that wants only that.

**When the work moves to iOS: take option 3.** Hide the pill and put our bar
on the compact row. That is:

- `npm i @capacitor/keyboard`
- `Keyboard.setAccessoryBarVisible({ isVisible: false })` at startup, iOS only
- `npx cap sync ios`
- Compact row: `.doc-kbar-row` at 44px min-height, `.doc-kbtn` at 36px and
  14px type, icons at 18px. Measured 45px against today's 57px.

It is deferred, not rejected, for one reason: `@capacitor/keyboard` is a
**native dependency**, so it needs a pod install and a real iOS build. A web
deploy cannot carry it. Nothing else in the four options was worth the
rebuild on its own.

Options 1 and 3 were chosen from a rendered comparison of four, not from a
description. Build the same kind of preview before changing this again.

## Previews sent to Dave must pin their text size

He reviews on an iPhone. iOS Safari inflates text on a page that does not pin
it, and the app (a native webview) does not inflate, so an unpinned preview
shows text about twice the size the app draws and sends him chasing a size
problem that is not in the app. Every preview file gets:

```css
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
```

The app itself sets `text-size-adjust` nowhere; if that ever changes, this
note is why it mattered.

## Previews, generally

Dave asks to see a change before it is applied, and previews are built by
rendering the real component through the real stylesheets (a scratch bench
under `src/bench/`, captured with Playwright), never by hand-writing a mockup.
They are generated throwaways: `*-preview.html` is gitignored, and the scratch
bench is deleted before committing, or `laws.test.ts` fails it as unreachable.

A preview is not proof of what his phone does. It runs on Linux, which has no
SF font and falls back to something wider, so a title truncates earlier there
than on the phone.

## Reminders rows wear the task row's type

`.rem-card-title` takes `.ruled .task-row .task-title`'s exact numbers: 16px,
`--w-regular`, `-0.01em`. In Life the four lenses sit next to each other and
any difference reads as a mistake. If the task row's type moves, move this
with it.
