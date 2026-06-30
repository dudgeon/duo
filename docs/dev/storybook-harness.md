# The design preview harness (ENH-239)

> How to render Duo's renderer **outside Electron** — for tight design
> iteration and the Claude Design round-trip. Built in ENH-239 (Option A of
> the ENH-238 stack study). PRD: [`docs/prd/enh-239-design-preview-harness.md`](../prd/enh-239-design-preview-harness.md).

## Why this exists

Duo's UI is React, but it only ran *inside* Electron, where the agent can't
screenshot the dev build and there's no component isolation. That broke the
generate → render → observe → correct loop. This harness lets the same
renderer run in a plain browser, two ways:

- **Whole-app preview** — `npm run preview:ui` → the full shell on
  `localhost:5199/preview/`, no Electron.
- **Component isolation** — `npm run storybook` → every component as a
  Storybook story on `localhost:6006`.

Neither ships in the Electron app. They're dev-only render paths.

## The one trick: mock the boundary, don't refactor

The renderer reaches Electron through ~478 `window.electron.*` call-sites
with no abstraction layer. Instead of editing them, we set `window.electron`
**once, before React mounts**, to a typed mock:

- `renderer/test-support/mock-electron.ts` — `createMockElectron(fixtures?)`
  returns a `Proxy` typed as `ElectronAPI` (`shared/host-api.ts`). Unknown
  namespaces auto-stub; `on*`/`subscribe*` return a no-op unsubscribe; other
  invokes resolve a default; boot-critical reads (`env`, `sessionState`,
  `files`, `git`, `session`, `pins`, `projects`, `browser`, `pty`, `vault`)
  get explicit fixtures so the app mounts. It's typed against `ElectronAPI`,
  so a bridge change is a **compile error here** — the mock can't silently drift.
- `renderer/test-support/fixtures.ts` — sample `env` / `SessionState`.

Both entry points install it:
- whole-app: `renderer/preview/main.preview.tsx` (sets it, then dynamic-imports `App`).
- Storybook: `.storybook/preview.tsx` (a global decorator sets it before any story).

If a story or the preview crashes on `Cannot read … of undefined`, a
mock method is returning the wrong shape — add an explicit stub for that
method in `mock-electron.ts` (most array-returning reads want `[]`, object
reads `{}`, `watch`-style reads `async () => async () => {}`).

## Adding a story

One co-located `*.stories.tsx` per source file, CSF3. The global decorator
already provides `window.electron`, so **never set it in a story**. Pattern:

```tsx
import type { Meta, StoryObj } from '@storybook/react'
import { Foo } from './Foo'

const meta = {
  title: 'Group/Foo',            // Chrome / Status / Modals / Panes / Home / Editor / Page …
  component: Foo,
  args: { onSomething: () => {} }, // callbacks → no-op arrows
} satisfies Meta<typeof Foo>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Empty: Story = { args: { items: [] } }   // one story per meaningful state
```

Conventions:
- Rich object props → build a **minimal inline fixture** matching the real
  type (import from `@shared/types` / `@shared/host-api`) so it typechecks.
- Narrow / dark-titlebar controls → wrap in a sized/dark `decorators` div
  (see `ThemeToggle.stories.tsx`).
- **Heavy containers** (editors needing a live TipTap/CodeMirror, iframe
  canvases, the xterm terminal) → a single minimal *smoke* story, or skip
  with a one-line reason. `MarkdownEditor` is currently skipped (needs a live
  TipTap instance).
- **`TS4023` ("… cannot be named")**: the component's `Props` interface isn't
  exported and `satisfies` leaks it through the exported `meta`. Fix by
  switching to an explicit annotation: `const meta: Meta<typeof Foo> = { … }`
  (drop the `satisfies`). See `Breadcrumb.stories.tsx` / `FilesPane.stories.tsx`.

## Verifying stories (the three gates)

Compiling is not rendering — verify all three:

1. `npm run typecheck` — props/types/imports.
2. `npm run build-storybook` — every story compiles + its module graph resolves.
3. **Render-check** — compile ≠ mount. Serve the static build
   (`npx serve storybook-static -p 6007`) and load each story's
   `/iframe.html?id=<id>&viewMode=story`, checking for a visible
   `.sb-errordisplay` + uncaught errors. The ENH-239 pass did this for all
   202 stories via the Claude Preview tools in ~20-story batches (a single
   batch over ~25 stories trips the 30s eval cap; cap each story's `onload`
   with a `Promise.race` so one hanging story doesn't stall the batch). The
   story index is at `/index.json`.

## What's NOT here yet (deferred — see tasks.md § ENH-239)

- **`/design-sync` round-trip** — pushing a component-card bundle up to a
  claude.ai/design project. Owner-gated: needs `/design-login` in an
  interactive terminal (or Claude Design's "Send to Claude Code Web") and a
  preview-card bundle build (the `/design-sync` skill), neither available in
  a headless/web session.
- **`@duo/ui` package extraction** — deferred: `/design-sync` reads the repo
  directly, so extraction is mostly churn (it would rewrite every story's
  import path). Revisit only if a *published* shared package is needed.
- **Lost Pixel visual-regression** — deferred until CI exists: its payoff is
  a CI gate, and standing it up now means committing ~202 baseline PNGs
  speculatively.
