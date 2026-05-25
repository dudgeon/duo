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

**HARD RULE — ALWAYS invoke the `/smoke-walk` skill via the Skill
tool. Do NOT bypass by calling `.claude/skills/smoke-walk/generate.mjs`
or any of the skill's other scripts directly.** The skill's
SKILL.md has procedural rules (renderer reload, surface re-probe,
pref reset, re-walk-FAIL-only manifest, agent-walks-CLI-items)
that the generator script alone doesn't enforce. Bypassing them is
how regressions sneak through to the owner walk.

How to invoke: call the `Skill` tool with `skill: "smoke-walk"`.
The skill then walks the agent through:

- Generating an interactive HTML page with one row per shipped item
  (description, repro steps, Pass / Fail / Skip toggle, notes textbox).
- Opening the page in Duo's browser pane via `duo open <path>`.
- **Forcing a renderer hard-reload + re-probing every surface the
  manifest exercises** (post-walk-1 of ENH-183 added this — HMR
  staleness silently broke the v0.7.9 walk; see § 4b of the skill).
- **Resetting feature-specific renderer prefs** so the owner walks
  a fresh first-time experience (also from ENH-183 walk-1).
- The user clicks each item, marks pass/fail, hits "Copy results,"
  and pastes the structured output back into the chat.
- Claude parses the result, flips tasks.md statuses, decides
  whether to advance to the `cut-version` skill.

**Violations are auditable.** If you find yourself running
`node .claude/skills/smoke-walk/generate.mjs ...` directly, stop
and re-do it through the Skill tool. Future audits search the
transcript for `Skill` tool invocations against `smoke-walk`; an
unmatched generator call is a process failure even if the output
looks right.

Manifests live at `docs/dev/smoke-walks/v<VERSION>.json`
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

### 7e. REQUEST ELECTRON ACCESS AT SESSION START when any UI work is on the table

**HARD RULE — if the session has any meaningful UI work on the table
(BUG- / ENH- touching `renderer/`, TipTap extensions, CSS, keyboard
handling, modals, popovers, focus, cursor, mark-application, paste,
IME, drag-drop, scroll, visual state — anything where verification
needs eyes on the running app), call `request_access` with
`applications: ["Electron"]` BEFORE writing any code.** Don't wait
for a smoke walk to fail. Don't wait for the third repeat bug.

The app name is **"Electron"** (the running dev target), NOT "Duo"
(which resolves to the packaged `/Applications/Duo.app`). Both apps
appear in the granted-applications list; you want the dev one.

**The mechanics — first turn of the session:**

1. Identify the work area. If it's UI-shaped (per the list above),
   request Electron access in the same turn as the first
   investigation / planning move. Same turn — not after the first
   commit, not after the first walk failure.
2. If the user denies access: state explicitly in the next response —
   *"owner denied Electron access; I'll work without live
   verification but won't claim anything done without smoke-walk
   paste-back."* Then proceed with extra caution and explicit
   `request_access` re-asks any time the absence of eyes-on bites.
3. If access is granted (default): every feature shipped in the
   session that touches the UI must be verified by:
   - `screenshot` to see the current state of Electron.
   - Synthesize the user-side interaction (keystroke / click /
     drag) that exercises the new code.
   - Re-screenshot to confirm the expected post-state.
   - Only after that round-trip clean can the change be called
     "done" or handed to a smoke walk.

**Why this is a session-start rule, not a "when bugs appear" rule.**
Sprint 18 closed with three failed walks of the same Backspace + ⌘K
bugs because I shipped each fix without exercising the keystrokes
myself. Both root causes (`Selection.near(state.doc)` rejecting after
`addMark`; `window.prompt` throwing in Electron renderers) surfaced
in minutes once I had eyes on the running app. The pattern the memory
rule `feedback_use_computer_use_for_keystroke_tests.md` codifies is
now elevated to the SESSION-START default — owner directive 2026-05-18.

This rule is symbiotic with 7c (verify clean state before handoff)
and 7b (always run smoke walks via the skill). It moves the
verification work UP-FUNNEL — closer to "I just wrote the code"
instead of "the user just walked it and FAILed."

### 7f. VERIFY ARTIFACTS END-TO-END BEFORE CLAIMING READY

**HARD RULE — after producing any artifact (Notion page, file write,
commit, smoke-walk page, generated HTML, CLI output), don't say "ready"
until you've read it back through the same path the user will use.**
A successful tool response is NOT verification. The patterns:

- **Wrote a file** → `Read` it back (or `Bash cat` if structural
  concerns) and confirm content matches intent. Especially after
  large `Write` operations or multi-edit batches.
- **Created/updated a Notion page** → call `notion-fetch` and
  confirm: newlines render as newlines (not `n` characters), tables
  render as Notion tables (not escaped pipes), embedded image URLs
  resolve (HTTP 200 OK with non-zero bytes via curl).
- **Created a GitHub Release** → fetch the release URL and confirm
  the body + assets are what you intended.
- **Pushed a commit** → `git log -1` + skim the diff; confirm hash,
  message, and file list match.
- **Generated a smoke-walk page** → open via `duo open`, confirm
  the page renders + Copy-results button actually copies before
  handoff (per the existing § 7c rule).

**Why this exists.** ENH-183 PRD work 2026-05-24 burned ~90 minutes
because I trusted a `notion-update-page` 200 response and never
fetched back. The page was a single run-on paragraph with newline
escape sequences mangled to literal `n` characters. Owner had to
catch it. Similar failure modes throughout the session: claiming
FOLLOWUP-027 was "verified live" when only CLI checks ran;
declaring smoke-walk pages ready without exercising the worksheet
primitive (§ 7c addresses one slice; this rule is the generalization).

**Litmus test.** Before writing "ready for review" / "done" /
"shipped" in a message, ask: *did I just look at the artifact in the
form the user will see it?* If no, do that first. If the verification
itself reveals problems, fix them silently rather than reporting
"done but with caveats."

### 7g. REWRITE INSTEAD OF PATCH AFTER TWO ROUNDS OF MESS-FEEDBACK

**HARD RULE — if the user says any variant of "you've made a mess /
clean this up / this is wrecked / illegible / start over" on the same
artifact, STOP layering edits and rewrite it from scratch.** Each
patch drags stale assumptions from the layer below; the cumulative
result is incoherent even when each individual edit was correct.

The signal isn't "the user is being demanding." It's "the file is
structurally broken in a way edits can't fix" — usually because
the framing changed and individual replacements can't update the
spine.

**The threshold:**
- **1st round of mess-feedback** — fine, large edit may still
  converge. Apply the correction.
- **2nd round of mess-feedback on the SAME artifact** — drop the
  file. Start fresh. Don't apologize at length; just do it.

**Why this exists.** ENH-183 PRD work 2026-05-24: owner said "you've
made a bit of a mess" early. I kept patching for ~90 minutes across
8+ edits. Then owner said "stop rushing this slop output and do the
fucking work" — that was the 2nd-round signal. The eventual clean
rewrite (~10 minutes once committed to it) produced a usable
artifact on the first try. Every patch-iteration before that was
load-bearing wasted time.

**The mechanics.** Before the second-round rewrite:
1. Acknowledge in one sentence — "doing a clean rewrite of X." No
   long apology.
2. Read whatever input artifacts are still useful (the user's
   intent, decision locks, mockups, prior commits). Discard the
   broken draft.
3. Write the new artifact in one pass. Don't iterate against the
   broken one.
4. Apply § 7f verification before declaring ready.

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

### 12. NO SIDECAR ANTI-PATTERN — state lives where it belongs

**HARD RULE — before introducing any Duo-owned file, cache, or
auxiliary data structure that mirrors, annotates, or extends another
system's state, ask: *would this introduce a filesystem ↔
external-system drift risk?*** If the external system is the source
of truth, Duo's parallel store will be stale the moment the external
system mutates. Default to reading the source of truth live every
time.

**External systems Duo reads from (read-only; never shadow):**
- **Claude Code storage:** `~/.claude/projects/<encoded-cwd>/`
  (sessions-index.json, JSONL files), `~/.claude/settings.json`,
  `~/.claude/skills/`, `~/.claude/agents/`.
- **Git worktree:** `.git/`, work-tree-root, branch, dirty status,
  remote URL. Always read live via `git` invocations.
- **Chrome browser state** (when reading via CDP): tab URLs, titles,
  history. Never persisted into a Duo cache.
- **The user's filesystem:** file mtimes, directory listings,
  inotify/fsevents. Read live; OS page cache makes this near-free.

**What's acceptable in Duo-owned storage:**
- **Pointers** into external systems. Example: workspace JSON storing
  `lastClaudeSession.id` — that's a *pointer*, not a copy of the
  session title. Looking up the title still goes through Claude's
  storage live.
- **In-memory renderer state** that resets on Duo restart: render
  flags, throttles, modal open/closed, edit-mode flags, dismissal
  state for the current session. Persisting this to disk converts
  it into a sidecar — don't.
- **Duo-owned concepts the external system doesn't track**: workspace
  tab layout, split-pane percentages, terminal `kind` (claude vs
  shell vs nothing), pin URLs in `~/.claude/duo/pins.json`,
  installed-packs metadata in `~/.claude/duo/installed-packs.json`.
  These describe Duo, not an external system.

**Examples of the anti-pattern (rejected during ENH-183 PRD):**
- *"Track which sessions Duo auto-named in
  `~/.claude/duo/hydrated-sessions.json` so we can show an AUTO
  badge."* — Rejected. Once Claude's storage has a `customTitle`,
  there is no truth to "who wrote it" outside Claude's own write
  history. A Duo sidecar would diverge silently any time the user
  edited `sessions-index.json` by hand, restored from backup,
  upgraded Claude, etc.
- *"Cache git status in workspace metadata so we don't have to
  re-run `git status` on every render."* — Rejected (would have
  been). The work-tree mutates outside Duo's awareness; cache goes
  stale the moment the user runs a shell `git checkout`.
- *"Cache browser tab titles in workspace JSON so restore is
  faster."* — Rejected (would have been). Page title updates after
  load; cached value is stale by definition.

**Litmus test before adding a new Duo-owned file:**
1. Is the data in this file derivable from an external system's
   state? → It's a sidecar. Read live instead.
2. Is the data describing something Duo itself manages (workspace
   layout, install state, user prefs that don't shadow OS-level
   prefs)? → Acceptable.
3. Is it a *pointer* (an ID) that resolves into external state on
   demand? → Acceptable.

**Sub-rule — CAPTURE-ON-EVIDENCE-NOT-SPECULATION (added 2026-05-24
post ENH-183 walk-1).** Even acceptable Duo-owned pointers must
only be captured when there's actual evidence the tab/object the
pointer is attached to is associated with the external thing. Don't
"guess" a pointer for an empty slot just because the slot's
attributes (cwd, kind) match something external.

**Concrete example.** The C2 cherry-pick's workspace-save enrichment
hook captured `lastClaudeSession.id` for every tab whose cwd had
any recent Claude JSONL — even tabs that never ran Claude. A brand-
new shell tab in `~/Documents/GitHub/duo/docs` inherited that
folder's most-recent session UUID on the next autosave, just by
existing in the right cwd. The polymorphic SessionHeader correctly
rendered S3 ("This tab had: <title> — Resume") — but the premise
was false; the tab never *had* that session.

**Fix pattern.** A per-Duo-session in-memory set
(`tabsThatHostedClaude: Set<tabId>`) records which tabs have
ACTUALLY produced the evidence — claudePresence transitioned to
'claude' or 'starting' on that tab. The pointer is only captured
for tabs in the set OR tabs that already carry a prior pointer
from disk (workspace-restore case is a legitimate carry-forward).

**Why this matters for D9 specifically.** A "speculative" capture
isn't sidecar storage in the literal sense — the field is on Duo's
own object (a `TabSession`). But it's *semantically* a sidecar:
it claims an association ("this tab had X") that Duo has no actual
knowledge of. Surface that to the user as a UI affordance and it
becomes misleading. The fix is the same as the sidecar rule:
capture only on evidence; read live from the external system; if
the external system shows nothing, surface nothing.

**Why this exists.** Owner directive 2026-05-24 during ENH-183 work:
*"session name should live in the Claude metadata, not annexed off
in some duo specific data structure — your proposed approach risks
file system ↔ Claude metadata drift."* The AUTO-badge proposal
required a sidecar; the sidecar was the bug. Codified as ENH-183 §
D9 architectural invariant; this rule generalizes it across the
codebase.

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

## Active sprint — Sprint 22 / v0.8.0 (post-v0.7.9-cut)

> **First-read after compaction**: [`docs/dev/RESUME.md`](docs/dev/RESUME.md) is the cold-start orientation. [`docs/dev/active-sprint.md`](docs/dev/active-sprint.md) carries the Sprint 22 implementation pointers + carry-forward queue.

**Status (2026-05-25):** v0.7.9 shipped — cut + tagged + pushed; [GitHub Release](https://github.com/dudgeon/duo/releases/tag/v0.7.9) live with signed+notarized DMG attached. **ENH-183** shipped pared (Option A) — S1 resume pills + S3 restore offer + D5 read ladder + `duo session list/resume` CLI. Mid-cycle pare-back dropped S2 named banner, C11 educational tip, T3 auto-hydration, S2 inline rename, force-rename CLI (~600 LOC). Three real bugs caught + fixed: BUG-158 (symlink encoding in `encodeProjectDir`), BUG-160 (discriminator dismissedBanner scoping), FOLLOWUP-027 (about:blank ghost-tab). Dev session bumped to v0.8.0.

**Sprint 22 starting scope:**

1. **ENH-184** — Workspace pill defeaturing + `+ New Workspace` handler routing fix. **Half-done in working tree (uncommitted on `main`):** new [`renderer/hooks/useWorkspacePillMenuFlag.ts`](renderer/hooks/useWorkspacePillMenuFlag.ts) hook (default OFF), flag declared in [`renderer/App.tsx`](renderer/App.tsx) but NOT YET CONSUMED (dead code), `+` handler in [`renderer/components/WorkspaceSwitcherDropdown.tsx`](renderer/components/WorkspaceSwitcherDropdown.tsx) changed from `save({saveAs:true})` → `newWorkspace()` (complete). **Finish:** wire the flag to gate the pill's `onClick` + caret render in App.tsx (~5 lines). CLI parity verb optional (`duo workspace-pill-menu [on|off]`). Owner intent: render pill as passive label; all workspace ops route through File menu.

2. **ENH-182** — Project-centric UX. PRD locked 2026-05-25 (owner walk); design artifacts + code map at [`docs/prd/enh-182-project-centric-ux.md`](docs/prd/enh-182-project-centric-ux.md). Spec-complete, ready to build. Project rail style study at [`docs/research/project-rail-style-study.html`](docs/research/project-rail-style-study.html).

**Carry-forward queue** (not yet picked, most-recent first):
BUG-079 (tab-cycle latency) · BUG-093 (split crash) · BUG-122 hypothesis 2/3 · ENH-084 v4 (aux glow) · ENH-127 (composer-window direction) · ENH-128 walk-4 (HEIC drag-drop) · ENH-137 (Beginner's Guide) · ENH-141 (enterprise smoke) · ENH-148 v2 · ENH-157 · ENH-162 (Clone modal collision UX) · FOLLOWUP-021 · BUG-024 follow-up · 17a.5 (template gallery) · Backlinks/graph view.

**Closed during v0.7.9 cycle:** FOLLOWUP-028 (T3 re-enable design — T3 dropped); BUG-159 (rename terminator — wrong diagnosis; rename committed via `\n`, owner-visible artifact was Claude TUI render timing).

**Memory rules locked during the cycle:**
- [feedback_locked_mac_screenshot_pattern](.claude/projects/-Users-geoffreydudgeon-Documents-GitHub-duo/memory/feedback_locked_mac_screenshot_pattern.md) — locked-Mac detection signature for screenshot+click failure mode.
- BUG-159 lesson (logged in tasks.md, candidate for future memory file): verify the artifact (JSONL on disk) BEFORE filing fixes based on owner verbal symptom reports — the "is this even a bug?" question deserves the same empirical check as the "what's the impact?" question.

**Open questions for the next agent:** none blocking. Owner is hands-off until Sprint 22 work picks up momentum.

---

### Previously — Sprint 21 / v0.7.9 (shipped 2026-05-25)

**Claude session resume affordances, pared scope (Option A)** ([release](https://github.com/dudgeon/duo/releases/tag/v0.7.9)). First cut where we pared a feature mid-cycle based on walk-driven empirics. ENH-183 began as a four-state polymorphic session header (S0/S1/S2/S3) with T3 auto-hydration + inline rename + C11 educational tip + four CLI verbs. Walked rev3-rev5 across two days, owner observed the S2 banner duplicated info already in Claude Code's `✳ <haiku>` tab title; empirics confirmed `duo session hydrate` returned `{hydrated: false, reason: 'already-has-aiTitle'}` 100% — Haiku always wins. Pared S2 + C11 + T3 + inline-rename + force-rename CLI (~600 LOC removed). Three real bugs caught + fixed by the walk process: BUG-158 (symlink encoding), BUG-160 (discriminator scoping), FOLLOWUP-027 (about:blank ghost-tab). One bug filed mid-walk (BUG-159) turned out to be wrong diagnosis — closed as superseded.

**Walk arc:** rev3 (3 PASS / 1 FAIL → BUG-156 `pty.resize(0,0)` crash, root-caused + fixed defense-in-depth at three layers); rev4 (1 FAIL → BUG-158 realpath fix); rev5 (S3-RESTORE walked, BUG-160 surfaced + fixed); rev6 (pared-scope confirmation, 3 PASS / 1 SKIP covered by regression test). Cut + DMG (signed+notarized) + GitHub Release on 2026-05-25.

---

### Previously — v0.7.8 (shipped 2026-05-23)

**Browser blocklist three modes (`local-only` default)** ([commit 6628220](https://github.com/dudgeon/duo/commit/6628220), [tag v0.7.8](https://github.com/dudgeon/duo/releases/tag/v0.7.8)). Single-focus cut: ENH-178 re-shipped via cherry-pick of [b03a8da](https://github.com/dudgeon/duo/commit/b03a8da) (originally reverted at [5295849](https://github.com/dudgeon/duo/commit/5295849) before the v0.7.7 cut). Plus docs-only follow-through: ENH-180 closed same-day (folded into ENH-177's re-ship), ENH-181 filed (banner inline rename + collapse toggle, mockup at [`docs/prd/enh-183-claude-session-lifecycle.html`](docs/prd/enh-183-claude-session-lifecycle.html)).

---

### Previously — Sprint 20 / v0.7.7 (shipped 2026-05-23)

**Daily-driver upgrades + ⌘Z reopen + send-pill variants** ([commit e940e6c](https://github.com/dudgeon/duo/commit/e940e6c), [tag v0.7.7](https://github.com/dudgeon/duo/releases/tag/v0.7.7)). 4 planned ENHs + 5 polish ENHs + 6 sprint-close fixes. ENH-177 + ENH-178 built + reverted pre-cut (queued for re-ship Sprint 21 after owner walks). ENH-180 PRD shipped + closed same-day (folded into ENH-177's re-ship — owner spotted that Claude already auto-writes summaries to `sessions-index.json`).

**What shipped:**

| ID | Headline |
|---|---|
| **ENH-169** | Navigator new-file / new-folder UX — breadcrumb right-click + File menu + ⌘N/⌘⇧N chords |
| **ENH-170 v2** | Top-level Settings menu (single ⌘Return-for-Claude-submit checkbox; v1 modal rejected + deleted) |
| **ENH-171** | Workspace switcher dropdown in title bar |
| **ENH-172** | Show / hide hidden files (View menu + ⌘⇧. + `duo hidden-files`) |
| **ENH-173** | `duo view <folder>` Navigate-here button |
| **ENH-174** | Disable TipTap autolink (no more bare-URL → markdown-link rewrite) |
| **ENH-175** | `duo navigate <url>` opens new tab or focuses existing — never clobbers active |
| **ENH-176** | Send-pill agent + terminal variants behind localStorage feature flags |
| **ENH-179** | ⌘Z reopens last-closed tab (file / browser / terminal) — smart text-undo routing via new `inAnyTextInput` gate |
| **BUG-149** | `duo navigate <path>` helpful error pointing at `duo reveal` |
| **BUG-150** | Installer dedupes orphan unmarked settings.json hook entries |
| **BUG-151** | Workspace switch dropped misleading Save prompt |
| **BUG-152** | Workspace switch restores all browser tabs |
| **BUG-154** | ⌘Return override fires in `kind='shell'` tabs running claude (broadened gate via claudePresence) |
| **BUG-155** | False-positive conflict dialog from tiptap-markdown autolink round-trip — normalize widened |

**Reverted pre-cut, queued for Sprint 21:** ENH-177 (claude session resume banner; [f351719](https://github.com/dudgeon/duo/commit/f351719)/[49f4644](https://github.com/dudgeon/duo/commit/49f4644)), ENH-178 (browser blocklist three modes; [b03a8da](https://github.com/dudgeon/duo/commit/b03a8da)/[5295849](https://github.com/dudgeon/duo/commit/5295849)).

**PRD-only:** ENH-180 (auto-rename via `/rename` PTY injection) — [PRD](docs/prd/_archive/enh-180-session-rename.html) + [Notion mirror](https://www.notion.so/36945f48854f810ca7f9dfa275c4389d).

**Memory rule locked this sprint:** [feedback_open_every_modal_before_smoke_handoff](.claude/projects/-Users-geoffreydudgeon-Documents-GitHub-duo/memory/feedback_open_every_modal_before_smoke_handoff.md) (BUG-153 root-cause).

---

### Previously — v0.7.2 polish wave (shipped 2026-05-18)

**Editor UX polish + agent CLI parity + save-conflict reliability** ([release](https://github.com/dudgeon/duo/releases/tag/v0.7.2)). 8 commits since v0.7.1 (cut earlier same day). 14 deliverables. Cut commit [d3d7c16](https://github.com/dudgeon/duo/commit/d3d7c16); bump to v0.7.3 in [3087e80](https://github.com/dudgeon/duo/commit/3087e80).

**What shipped:**

| ID | Headline |
|---|---|
| **BUG-139 v1.1 Q4+Q5** | Properties panel defaults collapsed-first; click row to expand long values with accent border + JSON pretty-print. |
| **BUG-139 v1.2** | Edit-raw textarea auto-grows up to 10 lines (walk-1 owner note). |
| **BUG-138 Phase 5** | Threaded comment rail. `parseRepliesFromBody` splits `↪`-joined bodies; `buildMarkdownThreads` reads inline marks + sidecar (de-duped). Closes silent regression. 8 new tests. |
| **BUG-083 markdown polish** | Active-thread visual highlight bumped 0.22 → 0.42 alpha + 1px accent box-shadow. Both themes. |
| **BUG-122 hypothesis 4** | `normalizeForEchoCompare` collapses soft-breaks before disk-vs-baseline compare. Closes false-positive banner. 15 new tests. |
| **FOLLOWUP-022** | New CLI verb `duo doc highlight <file> --text "X"`. Closes BUG-138 family CLI parity. 6 new tests. |
| **ENH-128 walk-4** | HEIC drag-drop verified live with iPhone HEIC + sips fallback. Image cluster closed. |
| **ENH-102 verified** | ⌘⇧⌫ delete current file confirm dialog walked. |
| **BUG-091 verified** | Right-click "Move to Split View" already shipped via Phase 3c; paper-trail flipped. |
| **CLAUDE.md § 7e** | Session-start Electron access rule (elevates memory rule to project default). |
| **Skill update** | New "Leave a comment or track-change" block documenting `DUO_AUTHOR` + `--reply-to` patterns. |
| **6 stale git/status tests** | Updated to match shipped formatter; CI green. |
| **Carry-forward sweep** | 6 already-shipped v0.7.0 items removed from post-compaction queue. |

**Memories codified:** [feedback_use_computer_use_for_keystroke_tests](.claude/projects/-Users-geoffreydudgeon-Documents-GitHub-duo/memory/feedback_use_computer_use_for_keystroke_tests.md) elevated to CLAUDE.md § 7e.

---

### Previously — Sprint 18 / v0.7.1 (shipped 2026-05-18)

**Markdown source-of-truth chapter** ([release](https://github.com/dudgeon/duo/releases/tag/v0.7.1)). 30 commits, 147 new unit tests, 4 smoke-walk revs. Cut commit [b42fea7](https://github.com/dudgeon/duo/commit/b42fea7); bump to v0.7.2 in [587c478](https://github.com/dudgeon/duo/commit/587c478).

**What shipped:**

| ID | Headline |
|---|---|
| **BUG-138 Phase 1** | CriticMarkup parser + 4 TipTap marks + tiptap-markdown integration. 65 tests. |
| **BUG-138 Phase 2** | Silent sidecar→inline migration + `duo author [<name>]` verb. 22 migration tests. |
| **BUG-138 Phase 3** | 6 agent CLI verbs: `duo doc {insert,delete,substitute,comment,accept,reject}`. 31 tests. |
| **BUG-138 Phase 4** | Suggesting toolbar toggle (⌘⌥T) + auto-wrap typed/Backspace + bulk banner + per-suggestion rail with ✓/✗ + author-filter chips + collapsible rail. |
| **BUG-139** | Frontmatter Properties panel above editor body. 17 parser tests. 4 of 5 design decisions locked via walk-1 playground (v1.1 follow-up). |
| **ENH-148** | Multi-select v2: ⇧-click range + ⌘-A select-all + `nav-state.selectedPaths` CLI parity. |
| **BUG-130** | Browser-pane `file://` auto-reload via chokidar watcher per tab. |
| **BUG-135** | Git ribbon suppresses on peer-repo-container crossings. |
| **BUG-136** | `gh-auth` PATH augmentation (`WELL_KNOWN_BIN_DIRS` prepend). |
| **BUG-137** | Markdown link editing — 3 walks of fixes: custom InputRule + LinkPromptModal (Electron renderers throw on window.prompt) + link tooltip + extendMarkRange-before-setLink. |
| **BUG-141** | Settings.json banner wording reworded. |
| **ENH-164** | Closed as already-shipped via `duo new-tab --claude`. |
| **3 follow-ups** | Suggest toolbar icon (Lucide pencil) · collapsible TC rail · git ribbon icon parity · frontmatter design-options playground. |

**Smoke-walk arc (4 revs):** rev1 6P 3F 2S → rev2 2P 2F 2S → rev3 2F 2S → rev4 1P. The last three blocked on two recurring same-day bugs (BUG-137 ⌘K + BUG-138 Phase 4c Backspace). Both root-caused via computer-use after walk-3: `window.prompt` throws unconditionally in Electron renderers (built LinkPromptModal as the replacement); `Transaction.setSelection` threw `RangeError` because my code resolved against `state.doc` instead of post-`addMark` `tr.doc`. **Memory rule filed** ([feedback_use_computer_use_for_keystroke_tests](.claude/projects/-Users-geoffreydudgeon-Documents-GitHub-duo/memory/feedback_use_computer_use_for_keystroke_tests.md)): when a smoke-walk item needs real keystrokes, request computer-use access (apps: `["Electron"]`) and verify live BEFORE handoff.

**New tracked items filed during the cycle:** BUG-141 (banner wording — shipped same-day).

---

### Previously — Sprint 17 / v0.7.0 (shipped 2026-05-18)

Marathon close-out session 2026-05-17 → 2026-05-18. All four 🟡 v0.7.0 decision gates closed (BUG-125 v2, FOLLOWUP-025 v2, ENH-159 v2, GH-cluster v2 + prototype + occlusion-fix). 8 walk-revs (rev1→rev8) walked. v0.7.0 cut 2026-05-18 with signed + notarized DMG ([release](https://github.com/dudgeon/duo/releases/tag/v0.7.0)).

**Major incident filed (2026-05-17):** owner caught me silently dismissing 6 of 20 locked playground decisions. Memory at [`feedback_never_silently_dismiss_locked_decisions.md`](../../.claude/projects/-Users-geoffreydudgeon-Documents-GitHub-duo/memory/feedback_never_silently_dismiss_locked_decisions.md). New rule: every implementation push after a playground walk must explicitly map each locked Q → ship/defer/cannot-ship, AND any defer needs explicit owner yes BEFORE writing code.

**The 15 commits in today's close-out arc:**

| Hash | Headline |
|---|---|
| [3c8d615](https://github.com/dudgeon/duo/commit/3c8d615) | BUG-126 + BUG-127 round 1 + 4 PRD-as-playground conversions + 🟡 gate-tracking + cut-version Step 0 hard-block |
| [b160dde](https://github.com/dudgeon/duo/commit/b160dde) | BUG-127 round 2 — `transformPastedHTML` hook |
| [05f2175](https://github.com/dudgeon/duo/commit/05f2175) | GH-cluster visual prototype playground |
| [65fd292](https://github.com/dudgeon/duo/commit/65fd292) | BUG-125 v2 — `core/html/duo-normalize.ts` + 19 vitest |
| [c86489d](https://github.com/dudgeon/duo/commit/c86489d) | FOLLOWUP-025 v2 — Atelier CSS fix + 3 entry points + default-cwd |
| [e52b39e](https://github.com/dudgeon/duo/commit/e52b39e) | ENH-159 v2 — inspect three-state machine |
| [391b6a6](https://github.com/dudgeon/duo/commit/391b6a6) | rev3 FAIL fixes + GH-cluster Phase 1 (ribbon + ENH-155) |
| [0599f0d](https://github.com/dudgeon/duo/commit/0599f0d) | FOLLOWUP-025 v2 follow-up — success-panel persist + in-progress panel + WCV park |
| [17b78a1](https://github.com/dudgeon/duo/commit/17b78a1) | BUG-130 filed |
| [ba2b1e8](https://github.com/dudgeon/duo/commit/ba2b1e8) | BUG-130 elevated + roadmap entry |
| [c6a9d1b](https://github.com/dudgeon/duo/commit/c6a9d1b) | rev4 FAIL fix — ribbon right-clickable |
| [c7e82e1](https://github.com/dudgeon/duo/commit/c7e82e1) | **GH-cluster Phase 2 full bundle** — per-folder chip + per-file dots + fsevents refresh |
| [9bb15fd](https://github.com/dudgeon/duo/commit/9bb15fd) | **Repo-chip occlusion fix** — modified-Option-B (small icon + hover popover) |

**Memories filed today (2):** [feedback_never_silently_dismiss_locked_decisions](../../.claude/projects/-Users-geoffreydudgeon-Documents-GitHub-duo/memory/feedback_never_silently_dismiss_locked_decisions.md) · [feedback_dont_smoke_walk_passing_automated_tests](../../.claude/projects/-Users-geoffreydudgeon-Documents-GitHub-duo/memory/feedback_dont_smoke_walk_passing_automated_tests.md) (updated with rev3 incident).

**New tracked items filed:** BUG-129 (`duo open` nonexistent file) · BUG-130 (browser-pane `file://` auto-reload — elevated to architectural, roadmap'd) · BUG-131 (⌘A no-op in playground inputs) · ENH-162 (Clone modal destination collision UX).

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

**Walk-rev arc (5 revs in one session, all ✅ except rev5-in-progress):**

| Walk | Result | Action taken |
|---|---|---|
| **rev1** (2026-05-16) | 4 PASS · 9 FAIL · 5 SKIP | 4 PRDs filed as playgrounds; compaction |
| **rev2** | All 4 gate decisions locked + earlier FAILs addressed | BUG-125 v2 + FOLLOWUP-025 v2 + ENH-159 v2 + GH-cluster v2 implementations shipped |
| **rev3** | 5 PASS · 2 FAIL · 4 SKIP | Success-panel persist + Claude-live guard + right-click "Select element" shipped same-session |
| **rev4** | 2 PASS · 1 FAIL · 2 SKIP | Ribbon right-clickable + tooltip workTreeRoot path + dismissal audit triggered |
| **rev5** | In progress (paused on chip occlusion) | GH-cluster Phase 2 full bundle shipped + modified-Option-B icon/popover shipped |

**Currently owed:** owner confirms rev5 PASS for GH-CLUSTER-PHASE-2 item with the modified-B icon/popover fix. Then cut.

**Filed during today (not blocking cut):**

| ID | Status |
|---|---|
| **BUG-129** (`duo open` nonexistent file) | 🟡 Filed |
| **BUG-130** (browser-pane `file://` auto-reload — architectural) | 🟡 Filed + roadmap'd |
| **BUG-131** (⌘A no-op in playground inputs) | 🟡 Filed |
| **ENH-162** (Clone modal destination-collision UX) | 🟡 Filed |

**Carry-forward to Sprint 18:** BUG-079 (tab-cycle latency, needs prod repro) · ENH-084 v4 (aux glow, needs 60s walk) · BUG-093 (split crash) · BUG-122 deeper fix (next-repro log) · ENH-148 (multi-select v2) · ENH-157 (browser-pane comments) · FOLLOWUP-021 (`duo install --clean`) · ENH-137 (Beginner's Guide) · ENH-141 enterprise smoke.

**Read [docs/dev/active-sprint.md](docs/dev/active-sprint.md) for full session arc + commit inventory + decisions audit.**

## Open questions needing Geoff's input

| Question | Priority |
|---|---|
| **Sprint 17 / v0.7.0 walk timing** — when can owner walk the test matrix above (now 13+ items)? Gates v0.7.0 cut. | Whenever owner has 30-45 min |
| **BUG-123 v2 direction** — once v1 cell selection is visible, do you still want cross-boundary text spanning (drag-from-cell-into-outside-text)? If yes, ship as ENH-148-style spike-then-fix; if no, close BUG-123. | After owner walks v1 |
| **ENH-127 direction** — declined entirely OR pivot to one of: Duo-side composer-window pattern (separate text area outside the terminal), anti-accidental-submit heuristic (delay-based or click-confirm), upstream feature request to Claude Code for raw-newline mode? Now lower priority since ENH-142 gave users the per-pref toggle. | If accidental-submit pain re-surfaces |
| **ENH-128 walk-4** — owner verification of HEIC drag-drop from Photos.app with the macOS `sips` fallback. ~2 min walk. (ENH-118 image-type conversation was already closed 2026-05-10 — animate GIFs / SVG `<img>` inert / HEIC→ENH-128 / PDF→ENH-129 shipped.) | Closes the image-handling cluster |
| Cross-machine cohort validation — does a real pack builder walk Duo's [`distro-pack-builder/playground.md`](distro-pack-builder/playground.md) end-to-end on a non-Geoff Mac? | Closes FOLLOWUP-011 cleanly when it happens |
| ENH-101 expand/collapse chord semantic — rail-collapse (new behavior orthogonal to ⌘⌥0/9) vs. full-screen (redundant; kill the chord)? | Before scoping the chord into a future sprint |
| Stage 17a.5 directions A/E (template gallery / registry) | Before any code work on templates |
| BUG-024 follow-up: combine Send → Duo + Comment pills (single split-pill or hover flyout)? | Before any further selection-pill iteration |
| Backlinks panel / graph view (Obsidian cluster) — Sprint 18+ anchor? Or defer further? | When wikilinks autocomplete (v0.6.10) usage tells us whether the next-tier capability has demand |
