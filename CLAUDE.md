# Duo — CLAUDE.md

> Project context for Claude instances. Slim by design (best-practice
> ceiling: a CLAUDE.md that's too long gets ignored). Most domain
> detail lives in load-on-demand docs linked below.

## What this project is

A macOS desktop app ("Duo") pairing multiple Claude Code terminal
sessions with an embedded Chrome browser, connected by a local CLI
bridge (`duo`) so Claude Code can read and drive the browser as
naturally as it runs shell commands.

Owner: Geoff.

## Audience and references

Duo is a personal, open-source project intended for both individual
users and enterprise teams. **Do not write company-specific
references into the codebase, docs, or commit messages** — no
employer names, internal project / program / cohort codenames, or
anything else that ties Duo to a specific organization. Use generic
descriptors instead (e.g. "early-adopter cohort", not a real cohort
name). Exceptions: references to Claude / Anthropic, and specific
domain names that appear in the browser blocklist.

## Where to look

- **`docs/roadmap.html`** — **canonical roadmap, single source of
  truth** (status, layered build order, per-stage cards, owner-side
  comments). Served at `http://localhost:8765/roadmap.html` via
  `.claude/launch.json`. Edit this as the primary (and only) surface
  for roadmap changes. The retired `ROADMAP.md` markdown view was
  removed 2026-05-04 — preserved historical fragments (Number history,
  Layout commitment, GitHub-issue mapping) live at
  [`docs/dev/roadmap-history.md`](docs/dev/roadmap-history.md).
- **`docs/DECISIONS.md`** — locked architectural decisions + open
  ADRs (notably the sandbox-tolerant-transport ADR).
- **`docs/CLI-COVERAGE.md`** — authoritative CLI verb inventory +
  gap roadmap. Touched on every new CLI feature (see § Working
  style item 4).
- **`docs/prd/`** — per-stage PRDs with D-numbered decisions.
- **`docs/dev/smoke-checklist.md`** — test matrix walked before
  calling any UI change done.
- **`docs/dev/cert-procurement.md`** — Stage 21 cert tracker.
- **`docs/dev/active-sprint.md`** — running scratchpad for the
  active sprint. **Read this FIRST after any conversation
  compaction** or when picking up an in-flight initiative. Points
  at the formal PRD + tracks commit-by-commit progress. Updated
  at the end of each commit.
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
- **`.claude/skills/worksheet/`** — schema-driven primitive for
  generating interactive HTML pages where the user fills out
  per-item radios + notes and hits Send-to-Claude / Copy results.
  Reach for it whenever you'd otherwise hand-build a long
  bullet list in chat asking "which of these…". Two consumers
  ship today: `.claude/skills/smoke-walk/` (sprint validation)
  and `.claude/skills/sprint-plan/` (next-sprint prioritization,
  fed by a gatherer that harvests tasks.md + active-sprint.md +
  roadmap.html).
- **`docs/design/atelier/`** — visual source-of-truth. Read its
  README before any UI-touching work.
- **`docs/VISION.md`** — product north star.
- **`docs/research/duo-as-chrome-extension/build-roadmap.md`** —
  Chrome-extension exploration roadmap (Stages A–H), lives on
  branch `duo-chrome-extension-exploration`. **Non-gating** — does
  not block any main-roadmap stage. **Stage A** is a no-regrets
  refactor (services to `core/`, EventSink, `host-api.ts` split)
  that's a merge candidate back to `main` once smoke-walked. The
  `phase0/` prototype directory is exploration-only; not in the
  Electron build pipeline.
- **`docs/research/duo-as-chrome-extension/distribution-strategy.md`** —
  the **strategic** decision the exploration produced: both Duo
  Desktop (Electron) and Duo for Chrome (extension) ship
  indefinitely; the Electron app serves as the Native Messaging
  host (`Duo.app --nm-shim`); explicit `chrome:` / `embedded:`
  verb prefixes disambiguate the two browser surfaces. **Read
  this before any Phase 7+ work.**

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

## Glossary — internal-name mapping for contributors

> **User-facing vocabulary lives in [`skill/references/vocabulary.md`](skill/references/vocabulary.md)**
> (shipped 2026-05-04, Stage 19e ENH-089). That's the canonical doc
> for the page / playground / lesson / canvas / start-tab hierarchy.
> Both `make-page.md` and `make-playground.md` cite it. End users
> follow the pointer and arrive at a doc they can read.
>
> **This section is the internal-name mapping** — what each user-
> facing term resolves to in the codebase. Contributor-facing only;
> end users don't need it.
>
> **Terminology lock 2026-05-02 (v0.6.1).** "Canvas" used to be
> overloaded ("the right pane" AND "the interactive HTML thing in
> Stage 17"). Owner clarified the hierarchy. The internal code names
> (`WorkingTab.kind === 'page'`, `renderer/components/Page/`) match
> the external vocabulary as of v0.6.5 (ENH-052 mechanical rename).
> Pack subdirectories (`packs/<name>/canvases/`) and skill/examples
> paths (`canvas-templates/`, `canvas-actions.md`) are intentionally
> deferred — they're external API surfaces with backwards-compat
> implications.

| User says | Internal name |
|---|---|
| **the canvas** (the slot) | `WorkingPane` / `activeWorking` |
| **canvas mode** (HTML in canvas iframe — editable, scripts blocked, buttons inert) | `WorkingTab` with `kind: 'page'` (component: `PageTab` in `renderer/components/Page/`) |
| **browser mode** (HTML in browser pane — scripts run, buttons fire) | `WorkingTab` with `kind: 'browser'` rendered via `BrowserManager` WebContentsView |
| **a tab** | `WorkingTab` (kinds: `editor`, `page`, `browser`, `image`, `pdf`, ...) |
| **a page** | HTML tab; **defaults to canvas mode** (`kind: 'page'`). Static or read-and-edit content. |
| **a playground** | HTML tab; **defaults to browser mode** (`kind: 'browser'`) — declared via `<meta name="duo-open-in" content="browser">` in the file's `<head>`. Action runtime: `playgroundActions.ts`; browser-pane CDP injection wired in ENH-094. |
| **a lesson** | Stage 28 lesson pack at `packs/<name>/{canvases/, lesson-skill/}`. Each canvas in the pack ships with `duo-open-in: browser` (modality lock — ENH-097). |
| **the navigator** | `FileTree` / `useNavigator` |
| **the terminal** | `TerminalPane` / `tabs[]` |
| **a terminal tab** | `TabSession` |

**Modality lock — playground = browser, canvas mode = inert edit (ENH-097, 2026-05-06).**

A playground is an HTML file that opens in browser mode by default — declared via `<meta name="duo-open-in" content="browser">`. Scripts run, buttons fire, the user **interacts** with the running surface. Canvas mode is the override for **editing** the same file's source — buttons render but clicks place a cursor (no `allow-scripts` in the canvas iframe).

The override surfaces:
- CLI: `duo edit --canvas <path>` forces canvas mode regardless of the file's `duo-open-in` declaration.
- UI: right-click a `file://` browser tab → "Edit in canvas."

User-facing guidance lives in [`skill/references/vocabulary.md`](skill/references/vocabulary.md). Pre-ENH-097, the page/playground split was content-only — both rendered as `kind: 'page'` (canvas iframe) with parent-side click delegation faking interactivity. Post-ENH-097, the split is **modality-level**: page → canvas iframe, playground → browser pane. The same source file can flip between modes via the meta declaration + override.

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

#### Plumbing checklist for a new page op (`duo html *`)

1. `shared/types.ts` — extend `HtmlOpRequest` discriminated union.
2. `renderer/components/Page/htmlOps.ts` — add a case in
   `executeHtmlOp` + a `runX` function. Reuse `resolveTarget` /
   `resolveAppendTarget` for `--id` / `--selector` resolution.
3. `cli/duo.ts` — subcommand parser inside `case 'html'`. Reuse
   the `flagValue` helper.
4. **No main-process changes for new ops** — routing is generic
   via `'html-op'`. Only non-`html-op` verbs (e.g. sidecar field
   toggles) need a new `socket-server.ts` case.
5. `skill/SKILL.md` + `agents/duo.md` cheat-sheet entries (mandatory).
6. PageTab auto-appends a `recentEdits` entry for any op that's
   not `query` / `get`. Read-only ops should NOT generate edit log
   entries — list them in PageTab's reply handler.

#### Editor-canvas parity rule

Locked 2026-05-02 — see `docs/DECISIONS.md § Editor / canvas convergence`.
The markdown editor (TipTap, Stage 11) and the HTML canvas (raw
contentEditable iframe, Stage 17) are intentionally parallel
codebases. Every editor feature added to ONE surface must explicitly
declare its disposition for the OTHER. PR descriptions must include
one of:

- **(a) Mirrored** — same feature also ships in the other surface,
  same PR or paired PR within the sprint.
- **(b) Skipped — surface-specific** — feature has no analog on the
  other surface; one-line reason (e.g. "bullet-marker round-trip is a
  markdown-source concept; canvas hand-writes `list-style`").
- **(c) Deferred** — feature ships to one surface for v1; mirror-port
  queued as a tracked ENH/BUG with cross-reference back to this PR.

Skipping the disposition is a review-block. Drift between the two
surfaces is acceptable but must be deliberate.

#### Plumbing checklist for a new WorkingPane tab type

1. `shared/types.ts` — add to `WorkingTabType`; audit discriminated
   unions that should branch on it (e.g. `DuoSelection`).
2. `renderer/components/fileClassifier.ts` — map relevant
   extensions → type + mime. Wires FileTree click + `duo edit` /
   `duo view` automatically.
3. `renderer/components/<NewType>/` — host package, sibling to
   `editor/` and `Page/`.
4. `renderer/components/WorkingPane.tsx` — dispatch branch with
   `key={tab.id}` so the tab fully re-mounts on path change.
5. `renderer/App.tsx § onCommitNewFile` — if `⌘N` should create
   files of this type, branch on `classifyFile(path).type` and seed
   appropriate boilerplate.
6. **Wire global-keystroke escape** for the new surface. Pick one of
   the three patterns; do NOT roll your own:
   - **In-document surface** (TipTap, contentEditable inside the
     parent doc): the document capture-phase listener in
     `useKeyboardShortcuts` already catches global shortcuts before
     local handlers fire. If the surface uses ProseMirror /
     CodeMirror, add a `handleKeyDown` that consults
     `matchGlobalShortcut(e, ctx)` and returns `true` when matched
     (mirrors `MarkdownEditor.tsx`).
   - **Iframe surface** (anything mounting an iframe whose body
     accepts keystrokes — canvas does this): import
     `installGlobalShortcutForwarder` from
     `renderer/keyboard/iframeForwarder.ts` and call it in the
     iframe's `load` handler with the iframe's document and the
     parent `window`. One line.
   - **Native-bridged surface** (xterm-style or WebContentsView-
     style — keystrokes never reach a JS document): consult
     `matchGlobalShortcut` in the surface's existing escape hook
     (`attachCustomKeyEventHandler` for xterm,
     `before-input-event` IPC for WebContentsView). Yield to the
     matcher; never duplicate the registry locally.
   The single source of truth is
   `renderer/keyboard/globalShortcuts.ts`. Adding a row there gives
   every surface that follows one of the three patterns automatic
   coverage. Skipping this step is the BUG-012/013/014 family.
7. CLI surface — if there's an agent-side "create from scratch"
   verb (the analog of `duo html new`), follow the CLI plumbing
   checklist above.
8. Skill stub at `skill/examples/<type>-authoring.md`.
9. PRD update — confirm v1 deferrals have a sub-stage home.

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

### 7a. RESTART DUO YOURSELF when verification needs it

**HARD RULE — never write any variant of "you (the user) need to
restart Duo / restart the dev environment / re-run npm run dev"
in a handoff or verification prompt.** That offloads your job onto
the user. If verification needs a fresh dev session — main-process
edits that HMR doesn't pick up, a stale dev session whose socket
file is gone, post-cut DMG-build that left the validation app
hanging around, anything — **YOU restart it**:

1. Find the running dev session: `ps -ef | grep -E "MacOS/Electron \." | grep -v grep`
2. Kill it: `kill <pid>` (or `kill -9 <pid>` if it doesn't exit on
   SIGTERM after a couple of seconds).
3. Start a fresh one in the background: call `Bash` with
   `command: "npm run dev"` and `run_in_background: true`.
4. Poll for readiness: `until duo doctor 2>&1 | grep -q "Unix
   socket"; do sleep 2; done` (the Monitor tool also works for
   this, but the until-loop is the simplest pattern).
5. Verify: `duo doctor` shows the socket up + an `app version`
   line.

Only when steps 1–5 are clean do you continue with verification or
the smoke walk. The user's only job is to walk the page or use the
feature — not to debug whether Duo is running.

This rule applies to every Sprint 8+ verification flow, every
post-cut smoke walk, every "open Duo and check this works" moment.
If you find yourself about to write "once you restart the dev
environment...", stop, restart it yourself, then write the followup.

### 7b. End every UI sprint with a generated smoke-walk page
After 7 confirms the work runs locally, hand the user-side
verification to them via the **`smoke-walk` skill**
(`.claude/skills/smoke-walk/`). The skill:

- Generates an interactive HTML page with one row per shipped item
  (description, repro steps, Pass / Fail / Skip toggle, notes textbox).
- Opens the page in Duo's browser pane via `duo open <path>`.
- The user clicks each item, marks pass/fail, hits "Copy results,"
  and pastes the structured output back into the chat.
- Claude parses the result, flips tasks.md statuses, decides whether
  to advance to the `cut-version` skill.

**Use the skill, don't ad-hoc this.** A consistent format for
sprint-to-sprint smoke walks is part of the data — drift defeats
the point. Manifests live at `docs/dev/smoke-walks/v<VERSION>.json`
(gitignored by default; the skill's SKILL.md has the format spec).

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

**Order with the smoke walk (item 7b):** if the sprint touched
user-visible surfaces, generate the smoke-walk page FIRST, wait for
the user's pasted results, parse them, and only then propose the
cut. Skip-and-go-straight-to-cut is fine ONLY for doc-only changes
or refactors with no observable behavior delta.

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
| Distribution / cert | Stage 21a ✅ shipped v0.4.1 (signed + notarized DMG via `bash scripts/dist-signed.sh`); 21c Phase 1+2 ✅ shipped v0.4.2 (auto-update + session restore); 21c Phase 3 ✅ shipped v0.5.1 (browser history persistence + datalist autocomplete; closes [issue #27](https://github.com/dudgeon/duo/issues/27)); 21b app icon ✅ shipped v0.5.1; 21e ✅ shipped v0.5.0 (fork-friendly architecture). Still ⬜: 21b DMG background image · 21d early-adopter cohort (socket auth + agent-driven-nav notifications + README). |

## Open questions needing Geoff's input

| Question | Priority |
|---|---|
| Distribution timeline (early-adopter cohort) | Before Stage 21d (socket auth + early-adopter README) |
| Socket auth approach for cross-machine cohort distribution | Before Stage 21d |
| Stage 17a.5 directions A/E (template gallery / registry) | Before any code work on templates |
| BUG-024 follow-up: combine Send → Duo + Comment pills (single split-pill or hover flyout)? | Before any further selection-pill iteration |
