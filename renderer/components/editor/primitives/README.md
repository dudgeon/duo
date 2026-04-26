# `primitives/` — editor-agnostic visual chrome

Components and styles in this directory are the **visual layer** of
editor features that span multiple surfaces (the markdown editor today,
the HTML canvas in Stage 17, possibly future surfaces). They take typed
data records as props and know nothing about the underlying editor.

## The contract

A primitive belongs here only if **all four** of these hold:

1. **No editor-specific imports.** No `@tiptap/*`, no `prosemirror-*`,
   no `import * as canvas from '../canvas'`. If you reach for them,
   you're writing a binding, not a primitive.
2. **Props are surface-shaped, not editor-shaped.** Take a
   `DuoSelection`, a generic change record, an anchor rect, an
   `onAccept` handler — never a TipTap `Editor` instance, never an
   iframe `Window` reference.
3. **No singleton state.** State that needs to span surfaces lives in
   a Provider that the host surface mounts. Primitives consume context;
   they don't own it.
4. **Visual-only side effects.** Animations, focus moves *within* the
   primitive's own DOM, decorations of ranges supplied as props.
   Nothing that reaches into the host editor's document model.

If a "shared" component starts violating any of these, it's leaking
binding concerns. Fix it before merging — the cost of a wrong
abstraction here ripples into every surface.

## What lives here today

- **`duo-just-added`** keyframe (Stage 13a — defined in
  `renderer/styles/globals.css` so xterm and the canvas iframe can also
  use it via the same class). Single source of truth for the 6s yellow
  fade applied to agent-written ranges.
- **`<WriteWarningBanner>`** (Stage 13b) — the banner shown when the
  agent attempts to write while the human has unsaved edits.

## What's coming

- **Stage 14** — `<TrackChangesProvider>`, `<TrackedRangeMark>`,
  `<AcceptAllBanner>`, `<CommentRail>`.
- **Stage 15** — `<SendToDuoPill>`.
- **Stage 17** — uses everything above, contributes nothing
  primitive-side; canvas-specific code lives under
  `renderer/components/canvas/` (future).

## Bindings (not here)

- Markdown editor bindings: [`../extensions/`](../extensions/). TipTap
  extensions that translate the editor's native model into the records
  the primitives expect.
- HTML canvas bindings: `renderer/components/canvas/bindings/` (future,
  Stage 17). DOM observers + `data-duo-*` attribute manipulation.

## Why this contract exists

See [docs/DECISIONS.md → "Editor-agnostic primitives"](../../../../docs/DECISIONS.md#editor-agnostic-primitives-shared-visual-chrome-surface-bound-data-bindings).

The short version: Stage 17 (HTML canvas) is in scope, not hypothetical.
Its PRD already names which Stage 11/13/14 primitives it expects to
reuse. Building Stage 13/14/15 with a "MD only" assumption guarantees
a refactor when 17 lands. The data layers are intrinsically different
(TipTap vs. iframe DOM); the visual layer is what's genuinely common.
