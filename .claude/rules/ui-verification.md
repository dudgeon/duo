---
paths:
  - "renderer/**"
  - "electron/main.ts"
  - "electron/preload.ts"
  - "**/*.css"
---

# UI verification discipline

Loaded when touching renderer / main / preload / CSS. **Build-passing +
types-clean is NOT enough to call UI work done.** Type checking verifies
code correctness, not feature correctness.

## Request Electron access at session start

If the session has meaningful UI work on the table, call `request_access`
with `applications: ["Electron"]` BEFORE writing code — not after a smoke
walk fails, not after the third repeat bug. The dev target is **"Electron"**
(the running `npm run dev` app), NOT "Duo" (which resolves to the packaged
`/Applications/Duo.app`). Verify each UI change by: `screenshot` → synthesize
the keystroke / click that exercises the new code → re-`screenshot` the
expected post-state. Only after that round-trip is clean is the change
"done". If the owner denies access, say so explicitly and don't claim done
without a smoke-walk paste-back. (Why session-start: Sprint 18 closed with
three failed walks of the same Backspace + ⌘K bugs; both root causes
surfaced in minutes once I had eyes on the running app.)

## Restart Duo yourself when verification needs it

**HARD RULE — never write any variant of "you need to restart Duo / re-run
`npm run dev`" in a handoff.** That offloads your job onto the user. If
verification needs a fresh dev session (main-process edits HMR won't pick
up, a stale socket, a hung validation app):

1. Find it: `ps -ef | grep -E "MacOS/Electron \." | grep -v grep`
2. Kill it: `kill <pid>` (`kill -9` if it ignores SIGTERM).
3. Relaunch: `Bash` with `command: "npm run dev"`, `run_in_background: true`.
4. Poll: `until duo doctor 2>&1 | grep -q "Unix socket"; do sleep 2; done`.
5. Confirm `duo doctor` shows the socket up + an app-version line.

The user's only job is to walk the page — not to debug whether Duo is running.

## Verify clean app state before any smoke-walk handoff

Never hand off a smoke-walk page without first confirming the running app
isn't crashed/errored (catching a stale error overlay is the agent's job):

1. `duo doctor` clean — socket transport up, CLI version matches app.
2. `duo nav-state` returns OK — renderer alive at the IPC layer.
3. Personally exercise the walk's FIRST step. Computer-use granted:
   `request_access` + `screenshot`, scan for ANY error overlay (React red
   screen, ErrorBoundary panel). Denied: exercise the first failure-prone
   step via CLI (e.g. `duo edit /tmp/preflight.md` mounts MarkdownEditor)
   and read the dev's stderr / DevTools console for uncaught traces.
4. If render state is unverifiable, say so as the **first sentence** of the
   handoff: *"I couldn't verify the app's render state — please check
   DevTools for an error overlay before walking."* Restart on uncertainty
   if many changes have accumulated since the last verified-clean state.

## End UI sprints with the smoke-walk skill

**HARD RULE — ALWAYS invoke `/smoke-walk` via the Skill tool.** Do NOT
bypass by calling `.claude/skills/smoke-walk/generate.mjs` or its other
scripts directly — the SKILL.md enforces renderer hard-reload, surface
re-probe, and feature-pref reset that the generator alone doesn't.
Manifests live at `docs/dev/smoke-walks/v<VERSION>.json`. Order: generate
the page FIRST, wait for the owner's pasted results, parse them, then
propose the cut.

## Never rewrite a fixture the editor already has open

Rewriting a file on disk while the running dev session's editor points at
it fires the (correct) file-changed-on-disk dialog — the agent's
fixture-rewrite-while-open is the bug, not the dialog. Two valid patterns:

1. **Unique paths per walk-rev (preferred)** — `/tmp/walk-{version}-{rev}-{slug}.md`.
2. **Close before rewrite** — `duo tabs` → `duo close <n>` → then rewrite.
