# Playground primitives — Sprint 5 (final scope, post-reframe)

> **Status:** Scoped. Implementation can start.
> **Filed:** 2026-05-04.
> **Two prior framings of this PRD existed (v1, v2) before owner pushback in the same session re-scoped the work substantially.** Git history at `7a62b60` (v1) and `6c1dda7` (v2) preserves the framing record; this file is the v3 (final) scope.

## What we're doing

**One thing: ship ENH-094 — extend the existing playground runtime to browser-pane pages via CDP injection.**

That's it. After it ships:
- Browser-pane pages (where scripts are allowed) get the same 9-verb action vocabulary that canvas-tab pages already have.
- `data-duo-action="duo:event"` works in browser pane → page-side interactions emit events Claude sees live via `duo events --follow`.
- The smoke walk gains live-event capability without losing its existing copy/paste fallback.
- Future agent-emitted worksheets (sprint plans, lesson dashboards, triage forms, retros) author with the existing patterns documented in `~/.claude/skills/duo/make-playground.md`.

## Why this is enough

The existing skill `make-playground.md` (376 lines) already documents how to author great playgrounds: the 9 action verbs, `data-payload-from`, the trust gate, paint regions, anti-patterns, lesson templates. **Future-Claude is a capable coder** — it doesn't need a binding-language / DSL / opinionated-shorthand layer to make a worksheet work. Inline JS for page-specific concerns (state save/restore, tally rendering, composition) is appropriate; the EXISTING action vocabulary is appropriate for live communication.

The **actual missing piece** was that browser-pane pages can't fire `duo:event` because the runtime isn't injected there. ENH-094 fixes exactly that, in proportion.

## What we're not doing

- **No `data-state-input` / `data-bind-text` / `data-bind-result` primitives.** Future-Claude writes inline JS for this; takes ~30 lines per worksheet; doesn't need centralization.
- **No `compose:json` / `compose:text` / `clipboard:copy` action verbs.** `navigator.clipboard.writeText(JSON.stringify(captureState()))` is one line of inline JS.
- **No expression DSL for `data-bind-text`.** No new computed-fields vocabulary.
- **No worksheet-generator refactor that strips out the inline `<script>`.** It works; touching it costs more than it saves. The 51 characterization tests at `4ef3e45` remain as regression coverage if anyone DOES touch it.
- **No new trust-gate posture for new verbs.** Existing canvas-action gate (`isPagePathTrusted` checks `~/.claude/duo/`) stays as-is. ENH-094's runtime, when injected into browser pane, applies the same gate consistently.

## Concrete deliverables

### 1. ENH-094 — CDP injection for browser-pane pages

The implementation plan from the original ENH-094 task entry stands:

- `electron/cdp-bridge.ts` — new `PLAYGROUND_RUNTIME_IIFE` constant + `Runtime.addBinding('duoPlaygroundAction')` + `Runtime.bindingCalled` handler.
- `electron/browser-manager.ts` — wire the listener to a new IPC channel.
- `shared/types.ts` — IPC channel addition.
- `electron/preload.ts` — pass-through.
- `renderer/App.tsx` — connect the IPC channel to the existing `onPlaygroundAction` dispatcher (one handler serves both panes).

The IIFE installs the same delegated-click listener for `data-duo-action` that `installPlaygroundActions` does in the canvas runtime — but routes through a `Runtime.binding` instead of a same-origin DOM event. Trust check (path under `~/.claude/duo/`) applies identically.

The same path-injection lifecycle as `SELECTION_OBSERVER_IIFE` and `PATH_LINK_FORWARDER_IIFE`: on every CDP attach + on `Page.frameNavigated`. **Same precedent, no new patterns.**

### 2. ENH-043 — minimal smoke-walk decorator update

Once ENH-094 ships, update `worksheet/generate.mjs` to emit `data-duo-action="duo:event" data-event="walk:item-changed" data-payload='{"id":"<id>"}'` on the per-item radio fieldsets so each PASS/FAIL/SKIP click fires a live event. Net change: ~5 lines.

The smoke-walk skill (`smoke-walk/SKILL.md`) gets a small section pointing at this — Claude can subscribe to `walk:item-changed` events to track walk progress live instead of waiting for the user to click "Copy results."

### 3. FOLLOWUP-007 — `window.duoSendResult` binding

Tracked separately. Small. Independent of ENH-094 in scope but reaches the same parts of the codebase, so likely lands alongside.

### 4. Skill update — `make-playground.md`

Add a small section: "Authoring for browser-pane pages." Covers the post-ENH-094 reality:
- When to choose canvas vs browser pane (scripts vs no scripts; live-event needs vs read-only-render needs).
- That the action vocabulary is identical in both panes after ENH-094.
- That browser-pane pages can mix inline JS with `data-duo-action` decorators freely.

## Implementation order

1. **Commit A** — ENH-094 CDP injection + IPC wiring + tests.
2. **Commit B** — FOLLOWUP-007 `window.duoSendResult` binding (if not already in place).
3. **Commit C** — ENH-043 worksheet decorator + smoke-walk skill update.
4. **Commit D** — `make-playground.md` skill update.
5. **Smoke walk** — owner-side validation that the browser-pane event flow works end-to-end.

Estimated 1 sprint (this one). Closes ENH-094, ENH-043, FOLLOWUP-007 in one cut.

## Out of scope (future)

- Relaxing the existing canvas-action trust gate (separate question; not needed for ENH-094 to work).
- A `duo state <page-key>` CLI verb for token-efficient state inspection (could be useful but speculative; defer until a use case actually surfaces).
- Refactoring the smoke-walk worksheet to be event-stream-only (drop copy/paste path). Not worth it; users sometimes legitimately want to copy results out.
