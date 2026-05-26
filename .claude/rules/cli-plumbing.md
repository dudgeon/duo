---
paths:
  - "cli/**"
  - "shared/types.ts"
  - "electron/socket-server.ts"
  - "agents/duo.md"
  - "skill/SKILL.md"
  - "docs/CLI-COVERAGE.md"
---

# CLI plumbing & parity

Loaded when touching the `duo` CLI surface or its docs. The *principles*
live in `CLAUDE.md` § Working style; this file is the mechanical detail.

## The CLI is the spec

Every new CLI verb stays in sync across FOUR surfaces: `cli/duo.ts`,
`skill/SKILL.md`, `agents/duo.md`, and `docs/CLI-COVERAGE.md`. A verb
absent from the `## Verb cheat-sheet` in `agents/duo.md` is effectively
invisible to the Haiku-driven subagent.

## CLI parity with UI

If the human can do it (click, menu, keystroke, toggle), the agent must
be able to do the same from the CLI — UI-only features silently break
Duo's pair-work premise.

- UI toggle → `duo <thing>` reads state, `duo <thing> <value>` sets it
  (e.g. `duo theme system|light|dark`); persist in localStorage if there's
  no backing store.
- Menu action → `duo <verb>` runs the same action.
- Deliberately UI-only features must be called out as explicit
  asymmetries in the PRD.

## Visibility cluster — reach for these BEFORE bespoke debug instrumentation

When debugging Duo blind (no computer-use), these four answer "what is the
user looking at right now?":

- **`duo dom <selector>`** — query the main renderer's DOM (`--attr`,
  `--text`, `--computed`, `--all`, `--js`). The React-shell analog of
  `duo eval`.
- **`duo devtools [--browser-pane] [--close]`** — open DevTools for the
  renderer (default) or active browser tab.
- **`duo layout`** — JSON snapshot: active tab kind/path, aux state,
  splitPct, focusedColumn, navigatorCollapsed, tab counts.
- **`duo nav-state`** — file-tree state.

## Plumbing checklist — a new CLI verb (touch every step)

1. `shared/types.ts` — add to `DuoCommandName`; add IPC channel /
   state-snapshot shape if needed.
2. `electron/preload.ts` — minimal renderer API (push / subscribe).
3. `electron/main.ts` — ipcMain handler; main→renderer dispatch helper;
   bridge-exposed getter/setter.
4. `electron/socket-server.ts` — new case in the command switch; extend
   `NavBridge` if needed.
5. `cli/duo.ts` — verb + `printHelp()`. Then `npm run build:cli` &&
   `git add cli/duo` (the binary is tracked).
6. `skill/SKILL.md` — agent discovery. Then `npm run sync:claude`.
7. `agents/duo.md` — entry under `## Verb cheat-sheet`.
8. `docs/CLI-COVERAGE.md` — keep the inventory current.

## Plumbing checklist — a new page op (`duo html *`)

Routing is generic, so fewer steps:

1. `shared/types.ts` — extend the `HtmlOpRequest` discriminated union.
2. `renderer/components/Page/htmlOps.ts` — add a case in `executeHtmlOp`
   + a `runX` function. Reuse `resolveTarget` / `resolveAppendTarget` for
   `--id` / `--selector` resolution.
3. `cli/duo.ts` — subcommand parser inside `case 'html'`. Reuse the
   `flagValue` helper.
4. **No main-process changes** — routing is generic via `'html-op'`. Only
   non-`html-op` verbs (e.g. sidecar field toggles) need a new
   `socket-server.ts` case.
5. `skill/SKILL.md` + `agents/duo.md` cheat-sheet entries (mandatory).
6. PageTab auto-appends a `recentEdits` entry for any op that's not
   `query` / `get` — list read-only ops in PageTab's reply handler so they
   don't generate edit-log noise.

## Sandbox gotcha — read before transport / install / CLI file-I/O changes

Claude Code runs each Bash call inside a macOS Seatbelt sandbox that gates
Unix-socket outbound connections behind `allowUnixSockets: true`. Duo's
bridge is a Unix socket, so **every `duo` command silently fails inside a
sandboxed session** (hung Bash call or `ECONNREFUSED`). Before changing
`cli/duo.ts`, `electron/socket-server.ts`, or the install path, read
`docs/DECISIONS.md` → Open ADRs → *Sandbox-tolerant transport and install
paths for the `duo` CLI*. New failure modes get added there, not routed
around ad hoc.
