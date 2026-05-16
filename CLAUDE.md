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
- **`idle-thoughts.md`** — Geoff's scratchpad inbox of un-triaged
  ideas / bug reports / "while I'm thinking about it" items.
  **Notion is canonical** — the page at
  [Duo Idle Thoughts](https://www.notion.so/Duo-Idle-Thoughts-34d45f48854f8032ba68fae6dc0473fe)
  is the source of truth (Geoff edits it from any device, including
  mobile). The local `idle-thoughts.md` file is a **gitignored
  read-only mirror** that Claude refreshes via the Notion MCP every
  time it reads idle-thoughts. Do NOT edit the local file directly —
  edits will be lost on next sync. **To process a thought:**
    1. Read canonical via `mcp__...__notion-fetch` with the page URL
       (also rewrite `idle-thoughts.md` to match — that's the sync).
       **Always preserve the YAML frontmatter block at the top
       (`duo-default-editable: false`) — it's forward-compat for
       ENH-106 (markdown lock/unlock).**
    2. For each Unprocessed bullet, decide → recommend → execute (with
       permission). File in `tasks.md` as ENH-/BUG-/FOLLOWUP- entries.
    3. Edit canonical via `mcp__...__notion-update-page` to strikethrough
       the bullet, move it under `# Processed`, and add an
       `**Action <date>:**` sub-bullet describing what was filed/shipped.
    4. Re-fetch to refresh the local mirror so the two stay aligned.
- **`.claude/skills/worksheet/`** — schema-driven primitive for
  generating interactive HTML pages where the user fills out
  per-item radios + notes and hits Send-to-Claude / Copy results.
  Reach for it whenever you'd otherwise hand-build a long
  bullet list in chat asking "which of these…". Two consumers
  ship today: `.claude/skills/smoke-walk/` (sprint validation)
  and `.claude/skills/sprint-plan/` (next-sprint prioritization,
  fed by a gatherer that harvests tasks.md + active-sprint.md +
  roadmap.html).
- **`distro-pack-builder/`** — workshop for first-time distro pack
  builders (ENH-112, Sprint 9). Repo-only; does NOT ship to end
  users. When Claude opens a session with cwd inside this folder
  it activates a scoped CLAUDE.md + project-only assistant skill
  that walks `playground.md` step-by-step, defers to the canonical
  global `/pack-builder` skill (`skill/pack-builder/SKILL.md`) for
  the mechanical work (validate / build / smoke), and helps
  builders make the small decisions a first pack needs (naming,
  `requiresDuoVersion` constraint, FTUX defaults, distribution
  path). Pairs with `examples/distro-pack-template/` (the
  copy-and-customize starting point).
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
| **a tab** | `WorkingTab` (kinds: `editor`, `page`, `browser`, `image`, `pdf`, `json`, ...) |
| **JSON / YAML viewer-editor** (Tier 3 collapsible tree + raw-text source toggle, autosave on edit) | `WorkingTab` with `kind: 'json'` (component: `JsonView` in `renderer/components/Json/`). Format (json\|yaml) implicit from path extension via `formatFromPath()` — `.json` / `.jsonl` / `.har` / `.webmanifest` parse as JSON; `.yml` / `.yaml` parse as YAML. Both share one tab kind (single-kind decision, ENH-110 walk-3). |
| **a page** | HTML opened in canvas mode (`kind: 'page'`) — source-editable, scripts blocked, buttons inert. Reached via `duo edit <html>` (the verb that says "modify the source") — ENH-156 verb-driven routing. |
| **a playground** | HTML opened in browser mode (`kind: 'browser'`) — scripts run, buttons fire, the user interacts with the running surface. Reached via `duo open <html>` (the verb that says "show me the thing") — ENH-156 verb-driven routing. Action runtime: `playgroundActions.ts`; browser-pane CDP injection wired in ENH-094. |
| **a lesson** | Stage 28 lesson pack at `packs/<name>/{canvases/, lesson-skill/}`. Each canvas in the pack opens in browser mode by default (via `duo open`); inspecting/modifying the source uses `duo edit`. |
| **the navigator** | `FileTree` / `useNavigator` |
| **the terminal** | `TerminalPane` / `tabs[]` |
| **a terminal tab** | `TabSession` |

**Modality is verb-driven (ENH-156, 2026-05-16).**

The same HTML source file flips between two surfaces depending on which verb opens it:

- **`duo open <path>` → browser mode** (`kind: 'browser'`). Scripts run, buttons fire, the user **interacts** with the running surface. This is the default for "show me the thing."
- **`duo edit <path>` → canvas mode** (`kind: 'page'`). Source-editable, scripts blocked, buttons render but clicks place a cursor (no `allow-scripts` in the canvas iframe). This is the default for "modify the source."

Overrides:
- `duo open --canvas <path>` → force canvas mode (rare; for inspecting a playground's source without firing scripts).
- `duo edit --browser <path>` → force browser mode (rare; symmetric).
- UI: right-click a `file://` browser tab → "Edit in canvas" (same as `duo edit`).

History — pre-ENH-097, the page/playground split was content-only (both rendered as canvas iframe with parent-side click delegation faking interactivity). ENH-097 made the split **modality-level** via `<meta name="duo-open-in" content="browser">` declarations. ENH-156 (2026-05-16) flipped that to **verb-driven** — the meta declaration is no longer consulted; the verb decides surface. Existing meta declarations on user HTML files are harmless under the new default (HTML already lands in browser via `duo open`).

User-facing guidance lives in [`skill/references/vocabulary.md`](skill/references/vocabulary.md).

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

### 3a. Visibility-tooling cluster — three CLI verbs to remove agent blind spots

When you're debugging Duo blind (no computer-use, can't take a screenshot, don't know what surface is active), reach for the visibility cluster instead of guessing past ~15 minutes:

- **`duo dom <selector>`** ([ENH-122](tasks.md)) — query the main renderer's DOM. Selectors, `--attr`, `--text`, `--computed`, `--all`, `--js`. Mirrors `duo eval` but for the React shell, not the browser pane.
- **`duo devtools [--browser-pane] [--close]`** ([ENH-123](tasks.md)) — open Elements / Network / Console for the renderer (default) or active browser tab.
- **`duo layout`** ([ENH-124](tasks.md)) — JSON snapshot: active main tab kind/path, aux state, splitPct, focusedColumn, navigatorCollapsed, tab counts. Pairs with existing **`duo nav-state`** for file-tree state.

These four verbs (`duo dom` + `duo devtools` + `duo layout` + `duo nav-state`) together answer "what is the user looking at right now?" without computer-use. Reach for them BEFORE building bespoke debug instrumentation.

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

### 7c. VERIFY CLEAN APP STATE BEFORE asking the user to smoke walk

**HARD RULE — never hand the smoke-walk page to the user without
first confirming the running Duo isn't in a crashed / errored state.**
Catching a stale error overlay before the user sees it is the agent's
job, not the user's.

The failure mode this rule prevents: agent commits a renderer-
crashing bug, opens the smoke-walk page (which lives in the
browser pane and renders fine), tells the user "walk it." User
walks step 1 ("open a markdown file") and immediately hits the
React error boundary. The agent shipped a crash AND wasted the
user's verification cycle. Sprint 11 walk-1 (2026-05-08) violated
this: the WikilinkSuggestion + AtMention plugins both used the
default `'suggestion'` plugin key, which ProseMirror rejected at
MarkdownEditor mount, and the error boundary caught it — but the
agent had already handed off the smoke walk page.

**The pre-handoff check, in order:**

1. **`duo doctor` clean** — socket transport up, CLI version matches
   app version. If not: restart per item 7a.
2. **`duo nav-state` returns OK** — the renderer is alive at the
   IPC layer. (A crashed renderer with a live socket-server is
   possible in some edge cases; this catches the easy ones.)
3. **Take responsibility for the FIRST step of the walk.**
   Don't hand off until you've personally exercised the code path
   the walk's first item exercises. Two paths, depending on
   computer-use:
   - **Computer-use granted (preferred):** call `request_access`
     for Electron, take a screenshot of Duo, visually scan for
     ANY error overlay (React red error screen, ErrorBoundary
     panel, "WorkingPane hit a render error" / "App hit an error"
     fallback panels). If anything looks wrong, FIX IT before
     handoff.
   - **Computer-use denied / unavailable:** at minimum, exercise
     the smoke walk's first failure-prone step yourself via the
     CLI. For the wikilink-autocomplete case, that's
     `duo edit /tmp/preflight-walk-N.md` to mount MarkdownEditor.
     If the editor's load completes (the file appears as a tab,
     `duo url` returns the path), the mount succeeded. Then read
     the dev's stderr / DevTools console output (via the dev's
     background log file) for any uncaught exception trace
     mentioning your changed modules.
4. **Explicit warning when verification is impossible.** If
   computer-use is denied AND the walk's first step can't be
   exercised via the CLI (e.g. it requires a click or a
   keystroke), say so EXPLICITLY in the handoff message: *"I
   couldn't verify the app's render state — please check
   DevTools (Cmd+Opt+I) for any error overlay before walking."*
   Don't bury this in a paragraph; it's the first sentence.

**Restart on uncertainty.** If you've made many changes since the
last verified clean state and the dev session has been running
the whole time, restart the dev (item 7a) before the smoke walk
even when the surface checks pass. HMR can leave the app in a
half-applied state where one extension is the new code + another
is the old; a clean restart bisects the question.

This rule applies whether the smoke walk is the formal close-out
walk OR a mid-sprint verification handoff. It applies even when
the user explicitly asks to walk now — the answer is "let me
verify the app's clean first, give me 30 seconds."

### 7d. NEVER rewrite a fixture file the editor has already opened

Closed BUG-115 (2026-05-10) traced to the same agent-behavior pattern
across multiple walks: the smoke-walk preparation pipeline rewrites a
fixture (e.g. `/tmp/v2-viewsrc-smoke.md`) while a previous walk-rev
still has the editor pointed at the old version. First edit fires
the BUG-107 file-changed-on-disk dialog **correctly** — the file
genuinely DID change on disk. The dialog isn't a bug; the agent's
fixture-rewrite-while-open IS.

**Two valid patterns** for walk-prep fixtures:

1. **Unique paths per walk-rev (preferred)** — every walk-rev's
   fixtures get a fresh path: `/tmp/walk-{version}-{rev}-{slug}.md`.
   Removes the race by construction. The smoke-walk skill's manifest
   convention should generate paths this way.
2. **Close before rewrite** — if a fixture path must be reused, the
   prep step closes the editor's existing tab first: `duo tabs` to
   find the matching tab id → `duo close <n>` → THEN rewrite.

**Never** rewrite a fixture file with `Write` / `echo >` / `cat >`
while the editor in the running dev session has it open — even if
the new content is "essentially the same." The byte-level diff
triggers the watcher's reconciliation path correctly.

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

### 11. Planning artifacts default to HTML interactive playgrounds — never plain markdown

Owner directive 2026-05-10: *"you should always use html to make the
planning artifacts rich, interactive, context rich playgrounds with
diagrams etc to explain and contrast approaches."* When a research
note, refactor proposal, or architectural plan needs owner input,
write it as an HTML page at `docs/research/<slug>.html`, NOT as
`docs/research/<slug>.md`.

**The shape — model after [`docs/research/data-primitives-canvas.html`](docs/research/data-primitives-canvas.html) (ENH-110, the precedent) and [`docs/research/dogfood-distro-packs-plan.html`](docs/research/dogfood-distro-packs-plan.html) (ENH-134):**

- No meta declaration needed for routing — ENH-156 made HTML routing
  verb-driven. `duo open <path>` lands the playground in the browser
  pane (interactive) by default; `duo edit <path>` is the path to its
  canvas-mode source view. `<meta name="duo-editable" content="false">`
  is still honored for the read-only canvas-mode case (ENH-106).
  Legacy `<meta name="duo-open-in" content="browser">` on existing
  artifacts is harmless — it's no longer consulted.
- **Atelier styling — inline the canonical kernel** at
  [`~/.claude/skills/duo/references/duo-atelier.css`](skill/references/duo-atelier.css)
  into the `<style>` block of every new playground. The kernel covers
  the universal patterns (color tokens, typography, `.intro`,
  `.decision-card`, `.q-option`, `.q-notes`, `.copy-bar`,
  `details.deferred`). Per-playground overrides go AFTER the kernel
  in the same `<style>` block. The class library and a minimal-
  skeleton template are documented at
  [`skill/references/atelier-css.md`](skill/references/atelier-css.md).
  Do NOT copy a whole `<style>` block from one of the precedents
  (ENH-146 — that pattern wasted ~200 lines of authoring tokens per
  playground).
- Body sections — context, current state with **diagrams** (ASCII art
  in `<pre>`, comparison cards via CSS grid, inventory tables with
  semantic color tags), problem statement, options compared side-by-
  side via `.option-card` blocks (with a `.recommended` highlight on
  the recommended option).
- **Interactive decision blocks** — for each owner-decision needed,
  use a `<section class="decision-card">` with radio `<input>`s wrapped
  in `<label class="q-option">` + a `<textarea class="q-notes">`.
  Decisions are inline alongside the relevant theme — let the owner
  decide as they read, not by scrolling to a consolidated § X.
- **Sticky `.copy-bar` footer** — `<X / N> decisions answered` counter
  + a `Copy decisions` button that assembles a structured
  `[OPTION-VALUE] Q-title\n    notes…` payload and writes to clipboard.
  Owner pastes back to Claude.
- **File the artifact as a tracked task** (ENH-XXX) in `tasks.md` per
  the `feedback_research_reports_must_file_review_task.md` memory
  rule. The entry surfaces in every smoke walk until the owner closes
  the gate by Copy-decisions-back.

**Why HTML over markdown.** Markdown decision docs sit on a list page
the owner has to remember to revisit. HTML playgrounds open in Duo's
browser pane via `duo open <path>`, render with diagrams + interactive
controls, and round-trip decisions back to Claude in one button click.
ENH-110 was lost across 3 sprints when it was a markdown research
doc; the moment it became a playground (data-primitives-canvas.html)
the owner walked it and the gate closed in one session.

**When markdown IS appropriate** — implementation notes (no owner
decisions; engineer reads + executes), PRDs (Stage X scope locked
already; live in `docs/prd/<slug>.md`), session-log / active-sprint
breadcrumbs (machine-readable, agent-consumed), `tasks.md` ledger
entries. The HTML rule is for **owner-decision-shaped artifacts** —
options, gates, AUQs, pick-one-from-N.

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
| Distribution / cert | Stage 21a ✅ shipped v0.4.1 (signed + notarized DMG via `bash scripts/dist-signed.sh`); 21c Phase 1+2 ✅ shipped v0.4.2 (auto-update + session restore); 21c Phase 3 ✅ shipped v0.5.1 (browser history persistence + datalist autocomplete; closes [issue #27](https://github.com/dudgeon/duo/issues/27)); 21b app icon ✅ shipped v0.5.1; 21e ✅ shipped v0.5.0 (fork-friendly architecture); **21d ✅ shipped v0.6.8** (cohort distribution via distro packs — discovery + atomic install/uninstall + CLI verbs + pack-builder skill + sample template + HOW-TO-FORK Layer 2.5; reframed mid-sprint — original socket-auth + nav-notifications scope deferred to FOLLOWUP-011/012, revisit on real cross-machine demand); **ENH-112 ✅ shipped v0.6.9** (Distro Pack Builder Workshop — repo-only `distro-pack-builder/` folder, scoped CLAUDE.md + 11-step playground.md + project-scoped assistant skill; layered tutorial wrapping the canonical `/pack-builder` skill; renumbered from ENH-106 at merge time — main had filed ENH-106 = markdown lock/unlock concurrently). Still ⬜: 21b DMG background image. |

## Active sprint — Sprint 17 morphed into v0.7.0 cleanup cut (15+ commits, pre-cut, walk deferred)

**Sprint 17 opened 2026-05-11** (immediately after v0.6.15 cut earlier the same day). Owner originally picked the **A+C+D bundle** (Navigator + tab UX polish + Diagnostic + instrumentation + Papercut sweep). On **2026-05-16** the sprint expanded into the **v0.7.0 cleanup cut**: 4 PRs cleaned (BUG-125, ENH-158/159/160), 3 new code features landed on main (BUG-124, ENH-152a Navigator git status chip, ENH-151 `duo clone` CLI + FOLLOWUP-025 Clone modal), and the parity-rule violation surfaced during ENH-143 was closed (FOLLOWUP-020 `duo close-tab` / `duo close-terminal-tab`). Walk + cut still pending — owner deferred the walk.

**8 sprint commits (pre-cut), all on `main`:**

| ID | Headline | Shape |
|---|---|---|
| **ENH-146** | `skill/references/duo-atelier.css` kernel + class-library doc + CLAUDE.md § 11 redirect — closes ~200-line CSS authoring tax per playground | Ship |
| **ENH-144** | Close-tab focus shifts to LEFT-neighbor file tab. One-spot fix in `App.tsx § closeFileTab` (other strips already correct) | Ship |
| **BUG-079** | Cycle-entry/exit timing trace. Synthetic test: total renderer-keydown → switchTab return = ~15ms regardless of pacing. H1 + H3 ruled out; H4 (modifier release) + new H5 (upstream consumer) lead | Diagnose — fix gated on production repro |
| **ENH-147 v1** | Navigator multi-select. ⌘-click toggle + multi-row "Move N items to Trash…" + pruning on external delete. ⇧-click + ⌘-A → **ENH-148** | Ship v1 |
| **ENH-143** | New entry 55b "Close the active tab with ⌘W" in what-duo-does.html. Found CLI parity gap → **FOLLOWUP-020** filed | Ship — docs only |
| **ENH-084 v4** | `mainColRef` + `auxColRef` + capture-phase focusin/mousedown/blur instrumentation. NO behavior change | Diagnose — fix gated on owner 60s click-around walk |
| **BUG-123 v1** | Root cause: Duo never imported `prosemirror-tables/style/tables.css`; CellSelection rendered invisibly. 9-line CSS fix in globals.css with Duo accent orange overlay | Ship — owner AUQ pick (after grounding pass corrected my initial A/B/C trade-off framing) |

**Memories filed this sprint (2):** [verify-current-behavior-before-proposing-fix](../../.claude/projects/-Users-geoffreydudgeon-Documents-GitHub-duo/memory/feedback_verify_current_behavior_before_proposing_fix.md) + [AUQ descriptions must be short](../../.claude/projects/-Users-geoffreydudgeon-Documents-GitHub-duo/memory/feedback_auq_descriptions_must_be_short.md). Both triggered by BUG-123's framing error.

**New tracked items filed:** **BUG-124** (`writeConflictLog` logs-dir mkdir gap), **ENH-148** (multi-select v2: ⇧-click + ⌘-A + CLI parity), **FOLLOWUP-020** (`duo close-tab` CLI parity for active working/terminal tab).

**v0.6.15 shipped 2026-05-11** ([release](https://github.com/dudgeon/duo/releases/tag/v0.6.15)) — Sprint 16 close-out (commits 3-9): stability + install/upgrade chapter end-cap + Return-key user toggle. **BUG-119** fsevents SIGABRT on Cmd-Q (disposes moved into `before-quit`). **FOLLOWUP-019** brings BUG-085 + BUG-099's three-layer external-write reconciliation from MarkdownEditor into PageTab (canvas-side silent-edit-loss class closed). **ENH-140 install-service cluster** — orphan cleanup on upgrade (reuses Stage 21e-iii's `installed.json § files` SHA map as diff source) + pin URL auto-migration (PIN_RENAMES rewrites `duo/help/what-duo-does.html` → pack-mirrored location; drops retired-no-successor pins) + op #8 pivot (pins.json bootstraps from each pack's `defaults[].pin: true` instead of hardcoded WDD literal). **BUG-122 defensive hardening + diag enrich** — owner repro of save-conflict banner re-surface on v0.6.14: TTL 2s → 5s, normalize widened (BOM + CRLF + per-line trailing), production-readable log at `~/.claude/duo/logs/last-conflict.log` via new shared `renderer/utils/conflictDiagnostic.ts`, new `duo doc conflict-log` CLI verb. **ENH-142** flips default Claude-tab plain Return from 'newline' (ENH-127 v2) back to 'submit' (universal terminal default); preserves override behind `duo claude-return [submit|newline]` + `duo shift-return [submit|newline]` localStorage toggles.

**v0.6.14 shipped 2026-05-10** ([release](https://github.com/dudgeon/duo/releases/tag/v0.6.14)) — Sprint 16 commits 1+2: enterprise hotfix. **ENH-141** install-path hardening — `duo` CLI reaches PTY $PATH inside Duo terminals + Claude Code sandboxes (SHIM_DIR target `~/.claude/duo/bin/duo`); **BUG-121** closing the last browser tab no longer respawns about:blank in a loop.

**Sprint 17 / v0.7.0 owner walk owed (gates the cut).** See the **explicit walk doc at [`docs/dev/walks/v0.7.0-walk.md`](docs/dev/walks/v0.7.0-walk.md)** for plain-English descriptions, exact repro steps, expected-pass criteria, and failure-mode notes for each of the 18 items. Summary of what's in scope:

| # | ID | One-line summary | Where |
|---|---|---|---|
| 1 | ENH-144 | Close-tab focus shifts to LEFT-neighbor file tab | on main |
| 2 | ENH-147 v1 | Navigator ⌘-click multi-select + batch trash | on main |
| 3 | ENH-143 | ⌘W entry 55b in what-duo-does.html (+ new CLI verbs) | on main |
| 4 | BUG-123 v1 | Markdown table cell selection paints orange | on main |
| 5 | BUG-079 + ENH-084 v4 | Passive instrumentation (no behavior change) | on main |
| 6 | ENH-156 | HTML verb-split: `duo open`→browser, `duo edit`→canvas | on main |
| 7 | BUG-125 | Watcher reload on symlinked paths (/tmp/foo) | **PR #49** |
| 8 | ENH-158 | Boot-time CLI shim self-heal at `~/.claude/duo/bin/duo` | **PR #52** |
| 9 | ENH-159 | Browser send carries DOM context + ⌘⇧C inspect mode | **PR #51** |
| 10 | ENH-160 | `scripts/build-pkg.sh` .pkg installer for distro packs | **PR #50** |
| 11 | ENH-152a | Navigator git status root chip (clean stays invisible) | on main |
| 12 | ENH-151 | `duo clone`, `duo gh-auth`, `duo git-status` CLI verbs | on main |
| 13 | FOLLOWUP-025 | `⌘⇧K` File→Clone… modal (UI for ENH-151) | on main |
| 14 | FOLLOWUP-020 | `duo close-tab` + `duo close-terminal-tab` CLI | on main |
| 15 | BUG-124 | `~/.claude/duo/logs/` mkdir-p at boot | on main |
| 16 | v0.6.15 enterprise smoke | ENH-141 + BUG-119 on owner's work machine | carry-forward |
| 17 | ENH-154 playground | 5 owner decisions on `duo gh-link` shape | gates ENH-154 |
| 18 | ENH-150 playground | 4 owner decisions on Doctor panel framework | gates ENH-150 |

**Carry-forward to Sprint 18 (post-walk):**

| ID | Title | Gate |
|---|---|---|
| **BUG-079 fix** | Tab-cycle latency — instrumentation captured; awaits prod repro for forensic data | Owner triggers naturally |
| **ENH-084 v4 fix** | Aux pane focus glow — instrumentation captured; awaits 60s click-around walk | Owner walks (5 min) + pastes captured `[ENH-084-v4]` log |
| **BUG-093** | Move to Split View renderer crash. Carried from Sprint 16; CLI repro didn't fire | User-triggered repro |
| **BUG-122 deeper fix** | Save-conflict banner re-surface. Defensive hardening shipped v0.6.15 | Next-repro `last-conflict.log` capture |
| **BUG-123 v2** | Cross-boundary drag-to-outside-table (collapses to single-cell today). Override `tableEditing()`'s `move()` handler | Owner walks v1; if still feels broken, file v2 spec |
| **ENH-148** | Multi-select v2: ⇧-click + ⌘-A + CLI parity | None — half-day to full-day |
| **ENH-152b** | Per-file dirty dots in Navigator (Slice 2 of ENH-152) — same data source as the root chip | None — half-day |
| **ENH-152c** | fsevents-driven invalidation of the git status chip (replace focus-poll) | None — half-day |
| **ENH-157** | Comments in browser pane (CDP-injected sidecar) — exposed by ENH-156 verb-split | Half-to-full sprint |
| **FOLLOWUP-021** | `duo install --clean` — strip vestigial install fences + dead Stage-20 shim paths | None — half-day |
| **FOLLOWUP-026** | Native File menu "Clone…" entry (renderer modal exists at ⌘⇧K via FOLLOWUP-025; menu entry deferred) | None — half-day |
| **ENH-137** | Beginner's Guide content | Owner-authored draft |
| **ENH-141 enterprise smoke** | v0.6.15 work-machine validation | Owner work-machine session |

**Shipped in v0.7.0 cleanup cut (no longer carry-forward):** BUG-124 (logs-dir mkdir) · FOLLOWUP-020 (`duo close-tab` CLI) · FOLLOWUP-019 (canvas external-write reconciliation — actually shipped Sprint 16, status was stale).

**Read [docs/dev/active-sprint.md](docs/dev/active-sprint.md) for the full Sprint 17 detail + Sprint 16 close-out + v0.6.15 cut record.**

## Open questions needing Geoff's input

| Question | Priority |
|---|---|
| **Sprint 17 / v0.7.0 walk timing** — when can owner walk the test matrix above (now 13+ items)? Gates v0.7.0 cut. | Whenever owner has 30-45 min |
| **BUG-123 v2 direction** — once v1 cell selection is visible, do you still want cross-boundary text spanning (drag-from-cell-into-outside-text)? If yes, ship as ENH-148-style spike-then-fix; if no, close BUG-123. | After owner walks v1 |
| **ENH-127 direction** — declined entirely OR pivot to one of: Duo-side composer-window pattern (separate text area outside the terminal), anti-accidental-submit heuristic (delay-based or click-confirm), upstream feature request to Claude Code for raw-newline mode? Now lower priority since ENH-142 gave users the per-pref toggle. | If accidental-submit pain re-surfaces |
| **ENH-118 image-type handling** — animate GIFs by default (today's behavior) or freeze first-frame Slack-style? SVG safety review owed (currently rendered via `<img>`, scripts blocked)? HEIC/RAW reject vs. convert? | Before any image-polish sprint |
| Cross-machine cohort validation — does a real pack builder walk Duo's [`distro-pack-builder/playground.md`](distro-pack-builder/playground.md) end-to-end on a non-Geoff Mac? | Closes FOLLOWUP-011 cleanly when it happens |
| ENH-101 expand/collapse chord semantic — rail-collapse (new behavior orthogonal to ⌘⌥0/9) vs. full-screen (redundant; kill the chord)? | Before scoping the chord into a future sprint |
| Stage 17a.5 directions A/E (template gallery / registry) | Before any code work on templates |
| BUG-024 follow-up: combine Send → Duo + Comment pills (single split-pill or hover flyout)? | Before any further selection-pill iteration |
| Backlinks panel / graph view (Obsidian cluster) — Sprint 18+ anchor? Or defer further? | When wikilinks autocomplete (v0.6.10) usage tells us whether the next-tier capability has demand |
