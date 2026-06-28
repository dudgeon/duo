# ENH-239 — Design preview harness (unlock the Claude-design loop)

> PRD for the Option-A build from the ENH-238 stack study. Locks scope +
> the owner's 5 decisions. Companion artifacts: the decision playgrounds
> [`docs/research/stack-alternatives-electron.html`](../research/stack-alternatives-electron.html)
> and [`docs/research/option-a-unlock-design-loop-plan.html`](../research/option-a-unlock-design-loop-plan.html).

## Problem

Duo's renderer is React (~53k LOC, 237 components) but only runs *inside*
Electron, where there is no component-preview harness and the agent can't
screenshot the dev build. So the Claude-design loop (generate → render →
observe → correct) and Claude Design's `/design-sync` import + Claude-Code
handoff are blunt: the handoff lands in an app Claude can't see. We fix the
*packaging*, not the stack — no migration, no loss of CDP browser control.

## Goal

Make the existing renderer previewable **outside Electron** — a whole-app
browser entry + an isolated component harness — so the design loop is
observable, and Claude Design's round-trip imports a real kernel.

## Non-goals

- No stack migration (Electron stays; see ENH-238 for why).
- No reduction of Electron's runtime footprint (different goal).
- Not a replacement for in-app integration verification: anything touching
  CDP / pty / sockets is still verified in the real app. The browser
  preview is for **look & interaction** only.

## Owner decisions (locked 2026-06-28, from the plan playground)

- **D1 — Harness: Storybook (Vite builder).** Run CSF `*.stories.tsx` in
  Storybook 8/10 on its Vite builder (matches electron-vite's Vite, so
  cold-start/HMR are far below the generic Webpack numbers). Stories are
  CSF, so Ladle remains a drop-in fallback if speed ever bites.
- **D2 — Scope: Phases 0–2.** Through the `@duo/ui` kernel extraction +
  a committed `DESIGN.md`. (Phasing below.)
- **D3 — Stories: systematic.** Story the whole component library, not just
  a seed set. *Sequencing:* land the harness + the story pattern + a first
  batch now; the bulk authoring is tracked + parallelizable (see § Rollout).
- **D4 — Round-trip artifacts: both now.** Run `/design-sync` → commit
  `DESIGN.md`, and extract `@duo/ui`.
- **D5 — Design-ops gate: Lost Pixel.** Visual-regression in CI via Lost
  Pixel's Storybook integration (free, self-hosted; no Chromatic).

## Architecture — the mock seam

The renderer reaches Electron through 478 `window.electron.*` call-sites
across ~30 files with **no abstraction layer** (typed by `interface
ElectronAPI`, `shared/host-api.ts:1066`, ~45 sub-namespaces). Because access
is global, we satisfy *all* of it by setting `window.electron` once before
React mounts — **no call-site edits**.

- `renderer/test-support/mock-electron.ts` — `createMockElectron(fixtures?)`
  returns a `Proxy` typed as `ElectronAPI`: unknown namespaces auto-stub;
  `on*`/`subscribe*`/`watch*` return a no-op unsubscribe; other invokes
  resolve a default. Boot-critical reads (`env`, `sessionState.load`,
  `files.exists/dirExists`, `vault.getDefault`, `browser.onTabsChange`,
  `pty.onData`) get explicit fixtures so `App.tsx` mounts without crashing.
  Typed against `ElectronAPI`, so a bridge change is a compile error.
- `renderer/test-support/fixtures.ts` — sample `ElectronEnv` + `SessionState`.
- Template precedent: `renderer/hooks/useNavigator.flicker.test.ts` already
  fakes `window.electron.files.*`.

## Phases

- **Phase 0 — mock seam + browser-runnable renderer (this PR).**
  `mock-electron.ts` + `fixtures.ts` + `renderer/preview/{index.html,
  main.preview.tsx}` + `vite.preview.config.ts` (standalone Vite, replicates
  the FORK_DEFINES the renderer needs) + `npm run preview:ui`. **Acceptance:**
  the full app shell renders on localhost in a plain browser; the agent
  drives it with the preview tools.
- **Phase 1 — Storybook + CSF stories + the story pattern.** `@storybook/
  react-vite`, a global decorator injecting `createMockElectron()`, the
  first batch of leaf-component stories, `npm run stories`.
- **Phase 2 — `@duo/ui` + DESIGN.md.** Extract pure-presentational
  components + the token layer (`renderer/styles/globals.css`, already the
  single source of truth bound into `tailwind.config.mjs`) into a package
  consumed by both Electron and the harness. Run `/design-sync` → commit
  `DESIGN.md`. Lint/generate `skill/references/duo-atelier.css` from the
  canonical tokens so playgrounds can't drift.
- **Phase 3 (follow-on) — design-ops hardening.** Lost Pixel CI gate; a
  `duo preview`/`duo stories` verb (CLI-parity); stories-as-Vitest-tests;
  CI story build.

## Rollout note — D3 systematic story authoring

237 components is a large, mechanical, parallelizable authoring task. It is
sequenced *after* the harness + pattern land (you can't story against a
harness that doesn't exist). The bulk pass is a strong fit for a parallel
multi-agent run (one agent per component cluster) — to be proposed to the
owner as an explicit opt-in once Phases 0–1 are green. Tracked here so
"systematic" is not silently narrowed to "seed".

## Verification

Phase 0 needs **no Electron** — it's verified in a plain browser (compile +
serve + headless render/screenshot). Phases 1–2 add story-render checks.
Integration paths remain in-app per the non-goal above.
