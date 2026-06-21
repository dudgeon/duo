---
paths:
  - "renderer/**"
---

# Renderer surface architecture

## Editor / canvas parity (locked 2026-05-02 — `docs/DECISIONS.md`)

The markdown editor (TipTap, Stage 11) and the HTML canvas (contentEditable
iframe, Stage 17) are intentionally parallel codebases. Every editor feature
added to ONE surface must declare its disposition for the OTHER in the PR
description — skipping the disposition is a review-block:

- **(a) Mirrored** — also ships in the other surface (same or paired PR).
- **(b) Skipped — surface-specific** — no analog on the other surface;
  one-line reason (e.g. "bullet-marker round-trip is a markdown-source
  concept").
- **(c) Deferred** — ships to one surface for v1; mirror-port queued as a
  tracked ENH/BUG cross-referencing the PR.

Drift between the two surfaces is acceptable, but must be deliberate.

**Shared reconciliation layer (ENH-195 D5).** The file-watch / echo-detect /
reload-or-banner pipeline now lives in ONE shared `useDiskReconciliation` hook,
consumed by the markdown editor, the canvas, AND the JSON/YAML viewer. When you
touch *reconciliation*, change the hook — its parity disposition is implicitly
**(a) Mirrored** (one implementation covers all three surfaces). Surface-specific
*editing* (the `serialize`/`applyReload` callbacks each surface injects, input
rules, the change-highlight) still follows the (a)/(b)/(c) rule above — e.g. the
markdown on-reload change-highlight is **(c) Deferred** for the canvas under
ENH-196. Cross-ref the [DECISIONS.md:620 amendment](../../docs/DECISIONS.md)
("Editor / canvas convergence" § ENH-195 D5).

## New WorkingPane tab type — touch every step

1. `shared/types.ts` — add to `WorkingTabType`; audit discriminated unions
   that should branch on it (e.g. `DuoSelection`).
2. `renderer/components/fileClassifier.ts` — map extensions → type + mime
   (wires FileTree click + `duo edit` / `duo view` automatically).
3. `renderer/components/<NewType>/` — host package, sibling to `editor/`
   and `Page/`.
4. `renderer/components/WorkingPane.tsx` — dispatch branch with
   `key={tab.id}` so the tab fully re-mounts on path change.
5. `renderer/App.tsx § onCommitNewFile` — branch on
   `classifyFile(path).type` if ⌘N should seed boilerplate for this type.
6. **Wire the global-keystroke escape** — pick ONE of the three patterns,
   don't roll your own (skipping this is the BUG-012/013/014 family). The
   single source of truth is `renderer/keyboard/globalShortcuts.ts`:
   - **In-document** (ProseMirror / CodeMirror): add a `handleKeyDown` that
     consults `matchGlobalShortcut(e, ctx)` and returns `true` on match
     (mirrors `MarkdownEditor.tsx`).
   - **Iframe** (canvas-style): call `installGlobalShortcutForwarder` from
     `renderer/keyboard/iframeForwarder.ts` in the iframe's `load` handler.
   - **Native-bridged** (xterm / WebContentsView): consult
     `matchGlobalShortcut` in the existing escape hook
     (`attachCustomKeyEventHandler` / `before-input-event` IPC).
7. CLI surface — if there's a "create from scratch" verb, follow the
   new-CLI-verb checklist (`.claude/rules/cli-plumbing.md`).
8. Skill stub at `skill/examples/<type>-authoring.md`.
9. PRD update — confirm v1 deferrals have a sub-stage home.

## Theme-legibility — a hardcoded color needs its hardcoded counterpart

Duo ships **light by default** (`electron/main.ts` sets
`nativeTheme.themeSource = 'light'`) and has a dark theme via the
`[data-theme="dark"]` attribute. A color that's only correct on ONE surface
tone is a **recurring** bug class — verify any colored status/error/banner text
in BOTH themes before calling it done. The two failure directions:

- **Fixed background + theme-var foreground** → dark-on-dark in dark mode (e.g.
  a `bg-[#2a201a]` toast with `text-ink`/`text-accent`).
- **Fixed *light* foreground on a theme surface** → light-on-light in light
  mode (e.g. `text-red-300` / `text-red-200`, or a dark-only banner tint
  `bg-{c}-950/30 + text-{c}-200`, on `bg-surface-0` = `--duo-paper` `#FBF8EE`
  light / `#1A1611` dark). The inverse of the first, equally illegible.

**Use the shared theme-aware classes, not ad-hoc Tailwind color utilities.**
`globals.css` defines both-themes-legible classes (a `color-mix` tint + a
`[data-theme="dark"]` foreground split — same precedent as `.bg-claude-context`):
banners (set bg + border-color + fg; pair with a `border`/`border-b` width util)
`duo-banner-error` / `duo-banner-warn` / `duo-banner-ok` / `duo-banner-info`;
bare text `duo-text-error` / `duo-text-warn` / `duo-text-ok` / `duo-text-info`.
**Tailwind's `dark:` variant does NOT work here** — there is no `darkMode` key in
`tailwind.config.mjs`, so `dark:` would track the OS scheme, not Duo's in-app
`[data-theme]` toggle.

This keeps recurring: ENH-222 removal banner (dark-on-dark) `4475df8`; #104
History-modal diff legend (dark-on-dark) `dfc7593`; ENH-223 cron preview-error +
the repo-wide banner sweep (light-on-light, this PR).
