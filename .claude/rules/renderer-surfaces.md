---
paths:
  - "renderer/components/**"
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
