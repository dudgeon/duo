# Smoke walk — pre-handoff clean-state verification

> Detail backing `.claude/skills/smoke-walk/SKILL.md § 5b`. The
> rules-of-thumb in SKILL.md tell you "always verify clean before
> handoff"; this doc has the *which checks* and *why each one
> exists*.

> **HARD RULE — never hand off the smoke walk page if the app is in
> a crashed / errored state.** Catching a stale error overlay is the
> agent's job, not the user's. Mirrors `CLAUDE.md § 7c`.

The failure mode this rule prevents: agent commits a renderer-
crashing bug, opens the smoke walk page (which lives in the browser
pane and renders fine on its own), tells the user "walk it." User
walks step 1 ("open a markdown file"), immediately hits the React
error boundary. The agent shipped a crash AND wasted the user's
verification cycle.

> Violated 2026-05-08 (Sprint 11 walk-1): agent shipped two
> `@tiptap/suggestion` instances both using the default `'suggestion'`
> plugin key. ProseMirror rejected the second one at MarkdownEditor
> mount. The crash was caught by the WorkingPane ErrorBoundary —
> agent had no clue because the smoke walk page itself rendered fine
> in the browser pane. User opened the editor and saw the error
> overlay before the agent did.

## Checks before handoff (in order, all must pass):

1. **`duo doctor` clean** — socket transport up, CLI version
   matches app version. If not: restart per CLAUDE.md item 7a.

2. **`duo nav-state` returns OK** — the renderer is alive at the
   IPC layer. (A crashed renderer with a live socket-server is
   possible in some edge cases; this catches the easy ones.)

3. **Exercise the worksheet primitive itself first.** Toggle a
   radio + add a note + click Copy via `duo eval`, verify
   localStorage round-trip, verify clipboard via `pbpaste`, then
   `localStorage.removeItem(STORAGE_KEY); location.reload()` to
   clear test state. Catches localStorage key collisions
   (BUG-110, 2026-05-09), `navigator.clipboard.writeText`
   permission failures, secure-context drift between page types
   (`.png` returns `origin: 'null'`; `.html` returns
   `origin: 'file://'`).

4. **Then exercise the FIRST failure-prone step the FEATURE walk
   exercises.** Don't hand off until you've personally exercised
   the code path the walk's first item exercises. Two paths:

   - **Computer-use granted (preferred):** call `request_access`
     for Electron, take a screenshot of Duo, visually scan for ANY
     error overlay (React red error screen, ErrorBoundary fallback
     panel, the localized `[ErrorBoundary:WorkingPane]` panel,
     "App hit an error" fallback). If anything looks wrong, FIX
     IT before handoff.

   - **Computer-use denied / unavailable:** at minimum, exercise
     the walk's first failure-prone step yourself via the CLI.
     For a markdown-editor walk: `duo edit /tmp/preflight-walk-N.md`
     to mount MarkdownEditor. If the editor's mount completes (the
     file appears as a tab, `duo url` matches), the mount probably
     succeeded — but you still can't see render errors past the
     ErrorBoundary catch, so move to step 4.

5. **Explicit warning when verification is impossible.** If
   computer-use is denied AND the walk's first step can't be
   exercised via the CLI (e.g. it requires a click or a keystroke),
   say so EXPLICITLY in the handoff message — first sentence, not
   buried:

   > "I couldn't verify the app's render state — please check
   > DevTools (Cmd+Opt+I) for any error overlay before walking."

6. **Restart on uncertainty.** If you've made many changes since
   the last verified clean state and the dev session has been
   running the whole time, restart the dev (CLAUDE.md item 7a)
   before the smoke walk even when the surface checks pass. HMR
   can leave the app in a half-applied state where one extension
   is the new code + another is the old; a clean restart bisects
   the question.

## Common error-overlay patterns to scan for:

- **React error overlay** — full-screen red panel with stack
  trace; renderer-level uncaught exceptions. Almost always means
  a render-time throw in your code OR a TipTap extension mount
  failure.
- **App-level ErrorBoundary** — "App hit an error" fallback in
  `renderer/components/ErrorBoundary.tsx`. Catches anything past
  WorkingPane / localized boundaries.
- **WorkingPane ErrorBoundary panel** — "WorkingPane hit a render
  error" with Try Again + Reload Renderer buttons (BUG-093
  instrumentation, Sprint 7). Localized; rest of app keeps
  running. Your fix-and-recover cycle is "fix the underlying
  cause, click Try Again, verify clean mount."
- **Pending-write banner** that's stale (BUG-033) — if the agent
  just submitted an html-op or doc-write that errored, the
  banner can persist past the rejection.
- **External-conflict banner** (BUG-085) — "This file changed on
  disk while you were editing." Sometimes a real disk drift, but
  often a chokidar / autosave race surfaced by Sprint 11+ work.

If any of these is up: resolve it (or restart) before handoff.
Don't hand the walk to the user with a stale error visible.

## Verify the walk page is the active visible tab

After `duo open`, run:

```bash
duo url
duo title
```

`duo url` returns the URL of the currently-active browser tab;
`duo title` returns its document title. Confirm the URL matches
the worksheet path (`file://.../v<VERSION>.html`) and the title
matches the manifest's `title` field. If either doesn't match —
or the command errors — the page is not focused or the bridge is
dead. Re-issue `duo open`, or if you suspect socket trouble, fall
back to the pre-flight probe in
`references/restart-and-preflight.md`.

> Violated 2026-05-04: agent ran `duo open` once, then immediately
> wrote a "smoke walk is ready, walk it" handoff message. Geoff
> reported back that no smoke walk file was active — the prior
> `duo open` had landed on a now-killed duplicate Electron, and
> the agent never verified the survivor had actually accepted the
> open. Always verify focus AFTER the open, BEFORE the handoff.
