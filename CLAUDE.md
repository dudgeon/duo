# Duo — CLAUDE.md

> Context for Claude instances working on this project.
> Keep this file updated as stages complete.

---

## What this project is

A macOS desktop app ("Duo") that pairs multiple Claude Code terminal sessions
with an embedded Chrome browser, connected by a local CLI bridge (`duo`) so
Claude Code can read and drive the browser as naturally as it runs shell commands.

Owner: Geoff (Capital One, AI in Product program)  
Brief: `duo-brief.md` (read this first — it's comprehensive and locked)

---

## Current state (as of 2026-04-26)

**Foundation shipped. Flagship half #1 (cozy-mode terminal) shipped
2026-04-22, graduated 2026-04-25 (`(preview)` label dropped).
Flagship half #2 — sub-stage 11a of the markdown editor — shipped
2026-04-24; 11a tail (3 items) and 11b–e next.**

**Latest session (2026-04-26) — P0 CLI gaps shipped:**
- `duo doc read [path]` — live editor buffer (frontmatter + body,
  including unsaved edits). Body to stdout, `# <path> (unsaved
  changes)` header to stderr so it pipes cleanly.
- `duo selection [--pane auto|editor|browser]` — extended to a unified
  `DuoSelection` shape. `auto` (default) prefers a non-empty browser
  highlight, falls back to the editor cache. Browser shape carries
  `{kind, url, text, surrounding, selector_path}`.
- `duo errors [--since] [--limit]` — separate ring (200 entries) fed
  by `Runtime.exceptionThrown`. Catches the uncaught exceptions that
  `duo console` silently misses.
- `duo network [--since] [--filter <regex>] [--limit]` — request
  lifecycle stitched from `Network.requestWillBeSent` →
  `responseReceived` → `loadingFinished`/`loadingFailed`. Ring size
  300; in-flight entries surfaced too. CDP `Network.enable` added to
  the attach sequence; `networkInFlight` is cleared on tab switch so
  prior-tab requests don't sit forever as pending.

**Same-day follow-ups (2026-04-26) — all stage refs use NEW numbers per the same-day renumber, see ROADMAP § Number history for old↔new map:**
- Old Stage 14 split into **Stage 18** (first-launch self-install
  — no cert needed) + **Stage 21** (cert-gated distribution polish)
  so the user-facing first-launch UX isn't blocked on cert
  procurement.
- Atelier visual-redesign bundle imported to
  [docs/design/atelier/](docs/design/atelier/); **Stage 12**
  (Atelier) created and pulled to the front as the L0 visual
  foundation that every L1+ stage inherits. Per-feature visuals
  fold into hosts: **Stage 9 follow-up** (cozy completion),
  **Stage 13** (just-added highlight — yellow + 6s fade overrides
  "blue fade" placeholder), **Stage 14** (Suggesting / Accepted
  track changes), **Stage 15** (Send → Duo pill).
- BUG-001 fixed (commit `3976039`) — pane-aware ⌃Tab cycling.
  Three-part fix: pane-aware routing in the keyboard hook, xterm
  `attachCustomKeyEventHandler` so the keystroke isn't eaten as
  PTY input, and a `paneOverride` for the browser-forwarded-key
  path because WebContentsView clicks don't bubble to the
  working-column wrapper. See `tasks.md` for the full trace.
- **Layered build-order renumber** — stage numbers now reflect
  actual build order, not chronology of planning. See
  [ROADMAP.md § Number history](ROADMAP.md). Commit messages from
  before the renumber use old numbers; the map translates them.

**Previous session (2026-04-25):**
- Stage 9 cozy mode graduated — daily-driver validation passed; menu
  label, PRD, ROADMAP all updated.
- Stage 15 PRD ([docs/prd/stage-15-send-to-duo.md](docs/prd/stage-15-send-to-duo.md))
  refined — G10 payload format locked to **A** (quote + provenance);
  G19 added making the format runtime-configurable via the new P1
  CLI verb `duo selection-format [a|b|c]` so agents can opt into
  format C (opaque tokens) for compact multi-step sessions.
- Open ADR "Skill scoping" resolved — locked to global
  `~/.claude/skills/duo/`. Per-session alternatives kept on the
  books in DECISIONS.md for future reference.
- Two thematic commits pushed (`feat(editor+theme)` + `docs`),
  rebased over upstream skill-sandbox-troubleshooting commit.

**Foundation (shipped + verified):**
- Electron main process, preload, PTY manager
- Three-column layout (Files / Terminal / WorkingPane) with one unified
  tab strip across browser + editor + preview tab types
- Terminal tabs (xterm.js + node-pty) with cozy mode typography
- Browser pane (`WebContentsView`, SSO via `persist:duo-browser`, tab
  strip, shortcut forwarding for the allowlisted `⌘<letter>` set)
- File navigator (Stage 10) — shared tree, breadcrumb, pending-CWD for
  new terminal tabs, follow-mode
- Theme toggle — System / Light / Dark; follows macOS appearance in
  System mode; xterm terminal theme swapped in lock-step (so the
  terminal isn't white-on-black in light mode)
- `duo` CLI over a Unix socket at
  `~/Library/Application Support/duo/duo.sock` (mode 0700). Full
  inventory + gap roadmap in [docs/CLI-COVERAGE.md](docs/CLI-COVERAGE.md).
- Markdown editor (Stage 11a): TipTap/ProseMirror, tiptap-markdown
  round-trip with frontmatter preservation, table contextual toolbar,
  syntax-highlighted code, `⌘N` new-file flow with filename
  interstitial + focus-to-prose on commit, persistent selection
  overlay across focus changes, `⌘S` + autosave, dirty dot
- Bundled `duo` Claude Code skill + `duo-browser` subagent

**CLI verbs shipped (see [docs/CLI-COVERAGE.md](docs/CLI-COVERAGE.md) for
the authoritative inventory):** navigate · open · url · title · dom ·
text · ax · click · fill · focus · type · key · eval · screenshot ·
console · errors · network · tabs · tab · close · wait · view ·
reveal · ls · nav-state · edit · selection · doc read · doc write ·
theme · install

**What's next (see `ROADMAP.md` + `docs/CLI-COVERAGE.md`):**

**Build order is layered.** See [ROADMAP.md § Layered build order](ROADMAP.md)
for the full graph. The actual next thing depends on which layer is
the binding constraint:

1. **Stage 12 — Visual redesign (Atelier).** ⭐ *Layer 0 foundation —
   recommended next.* System-wide token swap + light-as-hero + layout
   depth + tab-strip rhyme + files-pane width 208. Every L1+ stage
   (13, 14, 15, 17, 19c) inherits its tokens; building those first
   means re-skinning later. Design locked at
   [docs/design/atelier/](docs/design/atelier/); Stage 9 cozy-visual
   completion folds in.
2. **Stage 15 — Send → Duo (cross-modality selection primitive).** L1
   priority unlock. PRD locked at
   [docs/prd/stage-15-send-to-duo.md](docs/prd/stage-15-send-to-duo.md);
   G10 payload format locked. Visual chrome from Stage 12 — start
   either way, but the pill ships its final color when 12 lands.
3. **Stage 13 — Editor: just-added highlight + warn-before-overwrite.**
   L1, smaller. Atelier mock supplies the visual (yellow `mark` + 6s
   fade — overrides PRD's old "blue fade" placeholder).
4. **Stage 18 — First-launch self-install.** L3 (parallel track —
   independent of L0–L2). No cert needed. `npm run dist` validated
   2026-04-26 (commit `20b4701`); next is the consent sheet + the
   actual `fs.copyFile` install action. Bring this forward whenever
   the "Trailblazer can't double-click" friction outranks the next
   feature.
5. **Stage 19 Phase 19b — Passive priming.** L3, follows from 19a
   (env signals, shipped 2026-04-26 in commit `640ec0e`). SessionStart
   hook + PATH shim + `priming.md`. Folds into Stage 18's consent
   sheet when both land.

**Owner pre-work runs in parallel:** ROADMAP.md § Owner pre-work has
the cert-procurement checklist. Apple Developer ID enrollment lead
time is 1–2 business days minimum — kicking it off shaves real weeks
off Stage 21.

**P0 CLI gaps shipped 2026-04-26 — done.**
Remaining `Browser observability` items in [docs/CLI-COVERAGE.md](docs/CLI-COVERAGE.md)
(`duo network --bodies`, `duo storage`, `duo styles`) are P1/P2 — pull
in if a concrete agent task wants them.

**Backlog** (no fixed order): 11a tail items (frontmatter panel,
drag-drop images, slash menu), Stage 11e (outline + find), skill +
connector surface (was old Stage 12), multi-window (was old Stage
16), 15-family primitives that didn't get promoted (events, notify,
tab-name, tab-cmd, zap, file→composer). Pull in when convenient.

**Notes on the 2026-04-26 renumber:**
- The renumber moved every unshipped stage to a number that reflects
  build order. Old commit messages still use old numbers — see
  [ROADMAP.md § Number history](ROADMAP.md) for the translation map.
- **Stage 12 (Atelier) reframed:** previously held "until after the
  flagship pair" as if it were polish. It's not — it's a Layer 0
  *foundation* every Layer 1+ stage inherits. Building features
  first means re-skinning later. Reframed as the recommended L0
  next ship; per-feature visuals (just-added highlight → 13, track
  changes → 14, Send → Duo pill → 15, cozy completion → 9
  follow-up) fold into their host stages but the system-wide
  token swap belongs to Stage 12.
- **Old Stage 14 split → new Stages 18 + 21.** Stage 18 (first-
  launch self-install, no cert) is independently shippable;
  Stage 21 (cert-gated distribution polish) waits on cert
  procurement (see § Owner pre-work in ROADMAP.md).
- **Old Stage 11 split → top-level stages.** 11b → 16
  (reconciliation), 11c → 13 (just-added highlight), 11d → 14
  (track changes), 11e → Backlog (outline + find), 11a tail →
  Backlog. Stage 11 itself remains as 11a (core editor — shipped).
- **Stages 18a/b/c (Duo detection) → 19a/b/c.** Phase 19a env
  signals shipped 2026-04-26 in commit `640ec0e` (commit message
  uses old "18a" label). 19b folds into Stage 18 consent sheet;
  19c needs Stage 12 split-button visual.
- **Issue triage swept** — see [ROADMAP § Open issue → stage
  mapping](ROADMAP.md). 5 already shipped and closed (#10, #17,
  #20, #21, #26); 11 mapped to existing stages; #22/#23/#27
  promoted to roadmap bullets in Stage 20 + 21.

**Known issues live in [`tasks.md`](tasks.md).** As of 2026-04-26:
no open bugs. (BUG-001 — `⌃Tab` pane-aware cycling — fixed
2026-04-26 in commit `3976039`. The fix needed three parts, not
one as the original trace expected; see `tasks.md` for the full
write-up so the next reader doesn't re-discover the
xterm-key-eating and WebContentsView-mousedown gotchas.)

---

## Key files

| File | Purpose |
|---|---|
| `README.md` | Elevator pitch, quick start, CLI reference, architecture diagram |
| `docs/VISION.md` | Product north star — persona, principles, flagship bet. Read before making product/UX decisions. |
| `docs/CLI-COVERAGE.md` | Authoritative CLI verb inventory + priority-tagged gap roadmap. Touched on every new feature. |
| `docs/prd/` | Per-stage PRDs (9, 10, 11) with D-numbered decisions + rationale |
| `docs/design/atelier/` | Visual-redesign source bundle (Atelier direction). Tokens, mock components, and the interactive prototype that drives Stage 17 + per-feature visuals (cozy mode, just-added highlight, track changes, Send → Duo pill). Read [its README](docs/design/atelier/README.md) before any UI-touching work. |
| `docs/dev/smoke-checklist.md` | Test matrix walked before calling any UI change done |
| `duo-brief.md` | Original engineering brief (Stages 1–5). Architecture + Google Docs path are authoritative; product framing is superseded by `docs/VISION.md`. |
| `ROADMAP.md` | Stage-by-stage status with completion indicators + unscheduled backlog. **Authoritative.** |
| `docs/roadmap.html` | Visual single-page snapshot of `ROADMAP.md` with per-stage comment boxes (Atelier-styled, Geoff's own surface for inline notes via localStorage). **Keep in sync** with every `ROADMAP.md` update — at minimum: update the snapshot date in `<header>`, the main commit SHA, the Recent shipments list, the Status sidebar counts, and any stage-card status / sub-items / cross-refs that changed. Same `<details class="stage done">` collapsing pattern for fully-done stages (no pending sub-items); leave in-progress / pending stages always-expanded. |
| `docs/DECISIONS.md` | Locked architectural decisions with rationale (+ open ADR on sandbox-tolerant transport) |
| `docs/FIRST-RUN.md` | Thorough setup procedure |
| `docs/RESEARCH.md` | Technical research notes that informed decisions |
| `shared/types.ts` | Shared types + IPC channel names + `DuoCommandName` |
| `electron/constants.ts` | Node-only paths (socket, session partition, skill install dir) |
| `electron/main.ts` | Electron main process entry; theme, nav, editor-doc-write bridges |
| `electron/cdp-bridge.ts` | CDP command executor (ax tree renderer, console ring buffer, key/focus/type) |
| `electron/browser-manager.ts` | WebContentsView tabs + SSO partition + **shortcut forwarding allowlist** |
| `electron/files-service.ts` | Disk I/O: list, read, write (atomic tmp+rename), chokidar watch |
| `electron/pty-manager.ts` | node-pty session pool |
| `electron/socket-server.ts` | Unix socket → CLI verb dispatch (single switch; touch for every new verb) |
| `cli/duo.ts` | CLI source — rebuilt with `npm run build:cli`; tracked binary at `cli/duo` |
| `renderer/App.tsx` | Root React component, three-column layout, theme + focus routing |
| `renderer/components/editor/MarkdownEditor.tsx` | Stage 11 rich editor (TipTap + tiptap-markdown + custom extensions) |
| `renderer/components/editor/EditorToolbar.tsx` | Top toolbar + contextual table controls (PRD D5, D12a) |
| `renderer/components/editor/extensions/` | `TableShortcuts`, `PersistentSelection` |
| `renderer/hooks/useTheme.ts` | Theme mode state + push to main + CLI-override listener |
| `skill/SKILL.md` | Claude Code skill (auto-discovered via YAML frontmatter) |
| `agents/duo-browser.md` | Subagent for multi-step browser work |

---

## Working style — Claude instances must follow these

1. **Ask before deciding.** Use the `AskUserQuestion` tool whenever there is a meaningful choice to make — layout, UX behaviour, approach, prioritisation, open questions. Do not silently pick one option and implement it. Batch related questions (up to 4 per call) so Geoff can answer them in one shot and you can proceed without interruption.

2. **Do not re-debate the stack.** Electron, xterm.js, WebContentsView, Unix socket CLI — all locked. See `docs/DECISIONS.md`.

3. **The CLI is the spec.** Every time a new CLI command is added, update `cli/duo.ts`, `skill/SKILL.md`, and **[docs/CLI-COVERAGE.md](docs/CLI-COVERAGE.md)** (the authoritative inventory + gap roadmap). `duo-brief.md §9` holds the original Stage-1–3 draft for historical context but is no longer updated with new verbs.

4. **CLI parity with UI — every user-facing feature ships a `duo` counterpart.** If the human can do it with a click, a menu, a keystroke, or a UI toggle, the agent must be able to do the same thing from the CLI. This is load-bearing for the whole product: Duo's premise is human↔agent pair work on shared surfaces, and a UI-only feature silently breaks that premise. Concrete patterns:
    - UI toggle → `duo <thing>` reads state, `duo <thing> <value>` sets it (example: `duo theme`, `duo theme system|light|dark`).
    - Menu action → `duo <verb>` runs the same action.
    - In-app shortcut that changes state → `duo <verb>` does the same without the keystroke.
    - **Agent-tunable runtime settings** (no UI surface, agent-only): same `duo <thing> [value]` shape, persisted in localStorage. The agent calls it at the start of a session to pick the mode that suits its workflow (example: `duo selection-format [a|b|c]` for Stage 15's Send → Duo payload format). When you build one of these, check if there's a *user* parallel; if there isn't yet, document the asymmetry in the PRD so a later UI surface can be added without breaking the CLI shape.
    - Deliberately UI-only features (e.g. drag-to-reorder) must be called out in the PRD as explicit asymmetries.

    Plumbing checklist for a new CLI verb — every one of these must be touched:
    1. `shared/types.ts` — add the command name to `DuoCommandName`, plus any new IPC channel / state-snapshot shape
    2. `electron/preload.ts` — expose a minimal renderer API (push / subscribe)
    3. `electron/main.ts` — ipcMain handler for state push; dispatch helper for main→renderer pushes; bridge-exposed getter/setter
    4. `electron/socket-server.ts` — new case in the command switch; extend `NavBridge` if it needs renderer state or a renderer dispatch
    5. `cli/duo.ts` — the verb itself + `printHelp()` update
    6. `skill/SKILL.md` — so the agent discovers it (plus `npm run sync:claude`)

5. **The skill is a first-class deliverable.** Ship both the app and `skill/SKILL.md`, or neither. The skill is how Claude Code discovers the tool.

6. **If blocked on an open question in `duo-brief.md §7`, state the assumption and proceed.** Do not stall waiting for clarification on layout, aesthetics, or naming.

7. **Stage order matters.** Do not try to implement Stage 3 before Stage 2 is working. The socket server is useless without a real browser.

8. **NEVER claim UI work is done without previewing it yourself.** Build
   passing and types clean are not sufficient evidence that a UI change
   works. Before saying "shipped" / "done" on anything that touches the
   renderer, main process, preload, CSS, or menus:

   - Confirm `npm run dev` is running. The dev-server log is tailable at
     `/private/tmp/claude-501/…/tasks/<hash>.output` (look for the
     process spawning `electron-vite dev`).
   - **If `preload.ts` or `electron/main.ts` changed, relaunch Electron**
     — HMR only covers the renderer. Either kill and restart the dev
     server, or ask the user to Cmd+Q and restart.
   - Use computer-use (`request_access` for Electron, then `screenshot`)
     to **actually see the window**. Then walk
     [`docs/dev/smoke-checklist.md`](docs/dev/smoke-checklist.md) — it
     covers the boot path, terminal, files pane breadcrumb nav, working
     pane, keyboard shortcuts from *both* terminal and browser focus,
     cozy mode, and the agent CLI bridge.
   - Include in the end-of-task summary the "saw in the live app" block
     from the checklist's reporting template. If I can't fill it in, the
     task isn't done.
   - If the change set is wide enough that spot-checks won't cover it,
     propose a dedicated regression spike to the user **before** calling
     the stage complete.

   The user lost time on Stage 9 because I shipped code that typechecked
   but crashed the renderer at mount time. That is exactly what a
   two-minute preview pass would have caught.

9. **After editing `skill/` or `agents/`, sync to `~/.claude/`.** The repo
   tracks the canonical source, but Claude Code running on this machine
   reads from `~/.claude/skills/duo/` and `~/.claude/agents/duo-browser.md`.
   These are plain-file **copies**, not symlinks — edits in the repo do
   not propagate automatically. After any change to `skill/SKILL.md`,
   `skill/examples/*.md`, or `agents/duo-browser.md`, run:

   ```bash
   npm run sync:claude
   ```

   This copies the repo versions into `~/.claude/` so live Claude Code
   sessions — including whatever session is driving this repo — pick up
   the change on their next skill / subagent lookup. If you don't sync,
   your edits are invisible until the user either restarts their Claude
   Code session or manually re-copies. The rule applies equally to edits
   the user makes by hand: remind them to `npm run sync:claude` after any
   manual edit.

   End users don't run this script — they get the skill + agent from the
   **Stage 18** first-launch installer (which does its own `fs.copyFile`
   from the app bundle into `~/.claude/`). `sync:claude` is a dev-only
   convenience.

---

## Claude Code sandbox — must read before touching transport, install, or CLI file I/O

Claude Code runs each Bash tool call inside a macOS Seatbelt sandbox that
(a) blocks writes outside the working directory, (b) gates
Unix-domain-socket outbound connections behind an explicit
`allowUnixSockets: true`, and (c) permits localhost TCP. Duo's entire
agent-side bridge today is a single Unix socket at
`~/Library/Application Support/duo/duo.sock` — which means **every `duo`
command silently fails inside a sandboxed Claude Code session**.
The user sees a hung or `ECONNREFUSED` Bash call with no hint that the
sandbox is the cause.

Before changing any code in `cli/duo.ts`, `electron/socket-server.ts`,
the install path, or the skill's troubleshooting guidance, read
`docs/DECISIONS.md` → Open ADRs → **Sandbox-tolerant transport and
install paths for the `duo` CLI**. That ADR inventories what breaks,
explains the `dudgeon/chrome-cdp-skill` precedent (localhost TCP +
auth-token file), and names the planned direction: TCP fallback
alongside the Unix socket, `duo doctor` diagnostic,
`~/.claude/bin/duo` as the preferred install target, skill-docs
troubleshooting section, and a bundled settings fragment. Roadmap
items cross-reference the ADR from Stages 5, 13, and 14.

The work is planful and roadmap-aligned — not a patch. If you find a
new sandbox failure mode not listed in the ADR, add it there rather
than routing around it ad hoc.

---

## Pre-built CLI binary (`cli/duo`)

`cli/duo` is a compiled esbuild bundle intentionally tracked in git so Geoff
can install the CLI without running a build step (`node cli/duo install`).

**If you change `cli/duo.ts`**, you must regenerate and commit the binary:
```bash
npm run build:cli   # rebuilds cli/duo from cli/duo.ts
git add cli/duo && git commit -m "build: regenerate cli/duo binary"
```

---

## Build commands

```bash
npm install          # installs deps + rebuilds node-pty for Electron
npm run dev          # launch app in dev mode (HMR)
npm run build        # production build → out/
npm run typecheck    # TypeScript type checking (no emit)
npm run dist         # build + package as macOS DMG → dist/
```

---

## Architecture in one paragraph

One Electron main process owns everything: the `BrowserWindow`, the `PtyManager`
(node-pty pool), the `BrowserManager` (WebContentsView, Stage 2), the `CdpBridge`
(Chrome DevTools Protocol commands, Stage 3), and the `SocketServer` (Unix socket
listener, Stage 3). The renderer process hosts React — it shows xterm.js terminals
and a placeholder browser pane, communicating with the main process via contextBridge
IPC. The `duo` CLI (a standalone Node.js script) connects over the Unix socket to
send CDP commands from inside any terminal tab, making the browser programmable from
Claude Code.

---

## Locked decisions (from owner)

| Decision | Choice |
|---|---|
| App name | Duo — CLI is `duo`, skill at `~/.claude/skills/duo/` |
| CLI packaging | esbuild compiled binary — no Node.js on user's PATH needed |
| Browser tabs | Visible tab strip inside BrowserPane; also drivable via `duo tab <n>` from the CLI |
| Brainstem / MCP | **Not included** — Skills panel is CWD-scan only |
| Stage 2 + 3 | Implemented together in one pass |
| Skills panel layout | Collapsible sidebar — third column right of browser pane (scanner implemented; UI not yet wired) |
| Skills CWD source | PTY launch CWD (not moving shell CWD); two scopes: project + home |
| First-launch install | Electron permission dialog before installing CLI + skill + agent (deferred; currently manual) |
| Distribution / cert | No cert yet — personal use only; get cert before Stage 21 (Stage 18 does not need one) |

## Open questions needing Geoff's input

| Question | Priority |
|---|---|
| Apple Developer ID cert | Before Stage 21 |
| Distribution timeline (personal → Trailblazers) | Before Stage 21 |
| Socket auth approach for Trailblazers | Before Stage 21 |
