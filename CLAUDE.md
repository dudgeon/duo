# Duo — CLAUDE.md

> Project context for Claude instances. Slim by design (best-practice
> ceiling: a CLAUDE.md that's too long gets ignored). Most domain
> detail lives in load-on-demand docs linked below.

## What this project is

A macOS desktop app ("Duo") pairing multiple Claude Code terminal
sessions with an embedded Chrome browser, connected by a local CLI
bridge (`duo`) so Claude Code can read and drive the browser as
naturally as it runs shell commands.

Owner: Geoff (Capital One, AI in Product program).

## Where to look

- **`docs/roadmap.html`** — canonical roadmap (status, layered build
  order, per-stage cards, owner-side comments). Served at
  `http://localhost:8765/roadmap.html` via `.claude/launch.json`. Edit
  this as the primary surface for any roadmap change.
- **`ROADMAP.md`** — synced markdown view of the HTML. Same content,
  grep-able, but the HTML wins when they diverge.
- **`docs/DECISIONS.md`** — locked architectural decisions + open
  ADRs (notably the sandbox-tolerant-transport ADR).
- **`docs/CLI-COVERAGE.md`** — authoritative CLI verb inventory +
  gap roadmap. Touched on every new CLI feature (see § Working
  style item 4).
- **`docs/prd/`** — per-stage PRDs with D-numbered decisions.
- **`docs/dev/smoke-checklist.md`** — test matrix walked before
  calling any UI change done.
- **`docs/dev/cert-procurement.md`** — Stage 21 cert tracker.
- **`docs/dev/session-log.md`** — running session-by-session log of
  what shipped, why, and what's owed. Most recent at the top. Read
  this if you need to know what happened in prior sessions; do NOT
  re-paste it into CLAUDE.md.
- **`docs/dev/intent-pause.md`** *(optional, present only when an
  intent conversation is pending — currently absent)* — open
  intent threads the user paused dev to talk through. Read before
  responding to the next turn if it exists.
- **`docs/dev/intent-conversations/`** — archived plan-mode
  working artifacts from past intent pauses, after their
  resolutions were feathered into the roadmap. NOT specs (specs
  live in the roadmap cards); reach for these only when you need
  the "why was this chosen?" context behind a stage's design.
  See the directory's `README.md` for the lifecycle convention.
- **`docs/design/atelier/`** — visual source-of-truth. Read its
  README before any UI-touching work.
- **`docs/VISION.md`** — product north star.

## Architecture in one paragraph

One Electron main process owns everything: the `BrowserWindow`, the
`PtyManager` (node-pty pool), the `BrowserManager` (WebContentsView,
Stage 2), the `CdpBridge` (Chrome DevTools Protocol commands, Stage
3), and the `SocketServer` (Unix socket listener, Stage 3). The
renderer process hosts React — xterm.js terminals, the browser pane,
the markdown editor (Stage 11), and the HTML canvas (Stage 17),
communicating with main via contextBridge IPC. The `duo` CLI
(standalone Node.js script) connects over the Unix socket to drive
both the browser and the renderer surfaces from inside any terminal
tab.

## Build commands

```bash
npm install          # installs deps + rebuilds node-pty for Electron
npm run dev          # launch app in dev mode (HMR)
npm run build        # production build → out/
npm run typecheck    # TypeScript type checking (no emit)
npm run dist         # build + package as macOS DMG → dist/
npm run build:cli    # rebuild cli/duo from cli/duo.ts (commit the binary)
npm run sync:claude  # copy skill/ + agents/ into ~/.claude/ (dev-only)
```

---

## Working style — Claude instances must follow these

### 1. Ask before deciding
Use `AskUserQuestion` whenever there's a meaningful choice to make
(layout, UX behaviour, approach, prioritisation). Do not silently
pick one and implement. Batch related questions (up to 4 per call)
so Geoff can answer in one shot.

### 2. Don't re-debate the stack
Electron, xterm.js, WebContentsView, Unix socket CLI — all locked.
See `docs/DECISIONS.md`.

### 3. The CLI is the spec
Every new CLI command updates `cli/duo.ts`, `skill/SKILL.md`,
`agents/duo.md`, **and** `docs/CLI-COVERAGE.md`. The plumbing
checklist in item 4 must be touched in full.

### 4. CLI parity with UI — every user-facing feature ships a `duo` counterpart

If the human can do it (click, menu, keystroke, toggle), the agent
must be able to do the same from the CLI. UI-only features silently
break Duo's pair-work premise. Patterns:

- UI toggle → `duo <thing>` reads state, `duo <thing> <value>` sets
  it (e.g. `duo theme system|light|dark`).
- Menu action → `duo <verb>` runs the same action.
- Agent-tunable runtime settings (no UI surface): same
  `duo <thing> [value]` shape, persisted in localStorage. Document
  any UI asymmetry in the PRD.
- Deliberately UI-only features must be called out in the PRD as
  explicit asymmetries.

#### Plumbing checklist for a new CLI verb (touch every one)

1. `shared/types.ts` — add to `DuoCommandName`; add IPC channel /
   state-snapshot shape if needed.
2. `electron/preload.ts` — minimal renderer API (push / subscribe).
3. `electron/main.ts` — ipcMain handler; dispatch helper for
   main→renderer; bridge-exposed getter/setter.
4. `electron/socket-server.ts` — new case in command switch;
   extend `NavBridge` if needed.
5. `cli/duo.ts` — verb + `printHelp()` update. Rebuild the binary.
6. `skill/SKILL.md` — agent discovery (then `npm run sync:claude`).
7. `agents/duo.md` — verb cheat-sheet entry under
   `## Verb cheat-sheet`. Verbs absent from the cheat-sheet are
   effectively invisible to the Haiku-driven subagent.
8. `docs/CLI-COVERAGE.md` — keep the inventory current.

#### Plumbing checklist for a new canvas op (`duo html *`)

1. `shared/types.ts` — extend `HtmlOpRequest` discriminated union.
2. `renderer/components/HtmlCanvas/htmlOps.ts` — add a case in
   `executeHtmlOp` + a `runX` function. Reuse `resolveTarget` /
   `resolveAppendTarget` for `--id` / `--selector` resolution.
3. `cli/duo.ts` — subcommand parser inside `case 'html'`. Reuse
   the `flagValue` helper.
4. **No main-process changes for new ops** — routing is generic
   via `'html-op'`. Only non-`html-op` verbs (e.g. sidecar field
   toggles) need a new `socket-server.ts` case.
5. `skill/SKILL.md` + `agents/duo.md` cheat-sheet entries (mandatory).
6. CanvasTab auto-appends a `recentEdits` entry for any op that's
   not `query` / `get`. Read-only ops should NOT generate edit log
   entries — list them in CanvasTab's reply handler.

#### Plumbing checklist for a new WorkingPane tab type

1. `shared/types.ts` — add to `WorkingTabType`; audit discriminated
   unions that should branch on it (e.g. `DuoSelection`).
2. `renderer/components/fileClassifier.ts` — map relevant
   extensions → type + mime. Wires FileTree click + `duo edit` /
   `duo view` automatically.
3. `renderer/components/<NewType>/` — host package, sibling to
   `editor/` and `HtmlCanvas/`.
4. `renderer/components/WorkingPane.tsx` — dispatch branch with
   `key={tab.id}` so the tab fully re-mounts on path change.
5. `renderer/App.tsx § onCommitNewFile` — if `⌘N` should create
   files of this type, branch on `classifyFile(path).type` and seed
   appropriate boilerplate.
6. CLI surface — if there's an agent-side "create from scratch"
   verb (the analog of `duo html new`), follow the CLI plumbing
   checklist above.
7. Skill stub at `skill/examples/<type>-authoring.md`.
8. PRD update — confirm v1 deferrals have a sub-stage home.

### 5. The skill is a first-class deliverable
Ship both the app and `skill/SKILL.md`, or neither.

### 6. State-and-proceed on minor open questions
If blocked on a layout/aesthetic/naming question, state the
assumption and proceed. Do not stall.

### 7. NEVER claim UI work done without previewing it
Build passing + types clean is not enough. Before saying "shipped"
on anything touching renderer / main / preload / CSS / menus:

- Confirm `npm run dev` is running.
- If `preload.ts` or `electron/main.ts` changed, **relaunch
  Electron** (HMR only covers the renderer).
- Use computer-use (`request_access` then `screenshot`) to actually
  see the window. Walk `docs/dev/smoke-checklist.md`.
- If the change is too wide for spot-checks, propose a regression
  spike to the user before calling the stage complete.

If you can't fill in the "saw in the live app" block from the
checklist's reporting template, the task isn't done.

### 8. After editing `skill/` or `agents/`, run `npm run sync:claude`
The repo is the canonical source; `~/.claude/skills/duo/` and
`~/.claude/agents/duo.md` are file copies, not symlinks. Edits
don't propagate automatically. Remind the user too if they edit
by hand. End-users get these from the Stage 18 installer; the
`sync:claude` script is dev-only.

### 9. After editing `cli/duo.ts`, regenerate the binary
`cli/duo` is a tracked esbuild bundle so users can install without a
build step. Always:

```bash
npm run build:cli
git add cli/duo
```

Commit the binary alongside the source change.

### 10. Propose a version cut after ship-moments — Geoff won't ask
After a stage flips ✅ on the roadmap, after a substantial commit
to a user-visible surface (`renderer/`, `electron/`, `cli/duo`,
`skill/`, `agents/`, IPC contracts in `shared/`, anything under
`~/.claude/duo/help/`), or when the user signals closure ("shipped",
"done", "let's commit") on something user-facing — **propose a cut
via the `cut-version` skill** (`.claude/skills/cut-version/`). The
proposal starts with drafted release notes; if the notes don't feel
substantive, the cut waits and the draft accumulates in
`docs/RELEASES.md § Pending`. Geoff will not remember to ask.
Trigger detection has to come from Claude.

---

## Claude Code sandbox — read before touching transport / install / CLI file I/O

Claude Code runs each Bash tool call inside a macOS Seatbelt sandbox
that gates Unix-domain-socket outbound connections behind explicit
`allowUnixSockets: true`. Duo's bridge is a Unix socket — meaning
**every `duo` command silently fails inside a sandboxed Claude Code
session** (hung Bash call or `ECONNREFUSED`).

Before changing `cli/duo.ts`, `electron/socket-server.ts`, the
install path, or skill troubleshooting docs, read
`docs/DECISIONS.md` → Open ADRs → **Sandbox-tolerant transport and
install paths for the `duo` CLI**. Roadmap items in Stages 5/13/14
cross-reference the ADR. New failure modes get added there, not
routed around ad hoc.

---

## Locked decisions (from owner)

| Decision | Choice |
|---|---|
| App name | Duo — CLI is `duo`, skill at `~/.claude/skills/duo/` |
| CLI packaging | esbuild compiled binary — no Node.js on user's PATH needed |
| Browser tabs | Visible tab strip inside BrowserPane; drivable via `duo tab <n>` |
| Brainstem / MCP | **Not included** — Skills panel is CWD-scan only |
| Skills CWD source | PTY launch CWD (not moving shell CWD); two scopes (project + home) |
| First-launch install | Electron permission dialog before installing CLI + skill + agent (deferred; currently manual) |
| Distribution / cert | Stage 18 ships uncert; Stage 21 ships signed + notarized |

## Open questions needing Geoff's input

| Question | Priority |
|---|---|
| Distribution timeline (personal → Trailblazers) | Before Stage 21 |
| Socket auth approach for Trailblazers | Before Stage 21 |
| Stage 17a.5 directions A/E (template gallery / registry) | Before any code work on templates |
