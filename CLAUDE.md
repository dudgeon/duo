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

## Current state (as of 2026-04-22)

**Stages 1–3 shipped and verified end-to-end. Stage 5 skill + subagent shipped and verified.**

**What's done:**
- Electron main process, preload, PTY manager
- Renderer: split layout, terminal tab bar, xterm.js terminals, keyboard shortcuts (`⌘T` browser tab, `⌘⇧T` terminal tab, `⌘L` address bar, `⌘W`, `⌘1-9`, `⌘⇧[`/`]`)
- Browser pane with its own **tab strip** (add/switch/close, numeric IDs via `duo tab <n>`)
- SSO persistence across relaunches (Google Docs stays logged in)
- `CdpBridge` full set: navigate, url, title, dom, text, **ax** (accessibility tree — the canvas-app read path), click, fill, **focus**, **type**, **key**, eval, screenshot, **console** (ring buffer + filters), tabs, tab, wait
- CLI: `cli/duo` esbuild binary + `duo install` symlinks to `~/.local/bin/duo` or `/usr/local/bin/duo`
- Skill: `skill/SKILL.md` with YAML frontmatter so Claude Code auto-discovers it; prescriptive Docs rules (no `duo dom`, no `/export?format=txt`, only `duo ax`); scroll-to-expand technique for long docs
- **Subagent:** `agents/duo-browser.md` — Bash-only driver, preferred entry point for multi-step browser work (keeps parent context clean)
- End-to-end verification: fresh Claude Code in Duo terminal → auto-discovers skill → drives browser → returns accurate summary (A.5.1 + A.5.3 covered)

**What's next (see `ROADMAP.md`):**
- First-launch installer that copies `skill/` + `agents/` into `~/.claude/` automatically (currently manual)
- Stage 4 — wire SkillsPanel into the layout (scanner already exists)
- Backlog items raised by owner: reader-mode typography, markdown editor pane, browser tab numbers in UI, terminal selection improvements, file navigator (Stage 7)

---

## Key files

| File | Purpose |
|---|---|
| `README.md` | Elevator pitch, quick start, CLI reference, architecture diagram |
| `duo-brief.md` | Full vision brief — read before making architectural decisions |
| `ROADMAP.md` | Stage-by-stage status with completion indicators + unscheduled backlog |
| `docs/DECISIONS.md` | Locked architectural decisions with rationale (+ open ADR on skill scoping) |
| `docs/FIRST-RUN.md` | Thorough setup + smoke-test procedure |
| `docs/RESEARCH.md` | Technical research notes that informed decisions |
| `shared/types.ts` | Shared types + IPC channel names |
| `electron/constants.ts` | Node-only paths (socket, session partition, skill install dir) |
| `electron/main.ts` | Electron main process entry |
| `electron/cdp-bridge.ts` | CDP command executor (ax tree renderer, console ring buffer, key/focus/type) |
| `electron/browser-manager.ts` | WebContentsView tabs + SSO partition |
| `electron/pty-manager.ts` | node-pty session pool |
| `renderer/App.tsx` | Root React component, split layout |
| `skill/SKILL.md` | Claude Code skill (auto-discovered via YAML frontmatter) |
| `agents/duo-browser.md` | Subagent for multi-step browser work |

---

## Working style — Claude instances must follow these

1. **Ask before deciding.** Use the `AskUserQuestion` tool whenever there is a meaningful choice to make — layout, UX behaviour, approach, prioritisation, open questions. Do not silently pick one option and implement it. Batch related questions (up to 4 per call) so Geoff can answer them in one shot and you can proceed without interruption.

2. **Do not re-debate the stack.** Electron, xterm.js, WebContentsView, Unix socket CLI — all locked. See `docs/DECISIONS.md`.

3. **The CLI is the spec.** Every time a new CLI command is added, update `cli/duo.ts`, `skill/SKILL.md`, and the command reference in `duo-brief.md §9`.

4. **The skill is a first-class deliverable.** Ship both the app and `skill/SKILL.md`, or neither. The skill is how Claude Code discovers the tool.

5. **If blocked on an open question in `duo-brief.md §7`, state the assumption and proceed.** Do not stall waiting for clarification on layout, aesthetics, or naming.

6. **Stage order matters.** Do not try to implement Stage 3 before Stage 2 is working. The socket server is useless without a real browser.

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
| Distribution / cert | No cert yet — personal use only; get cert before Stage 6 |

## Open questions needing Geoff's input

| Question | Priority |
|---|---|
| Apple Developer ID cert | Before Stage 6 |
| Distribution timeline (personal → Trailblazers) | Before Stage 6 |
| Socket auth approach for Trailblazers | Before Stage 6 |
