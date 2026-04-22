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

**Stage 1 scaffold complete.** The full project structure, build config, and
Stage 1 implementation are in place. The app is not yet tested end-to-end
(requires macOS with Electron/node-pty).

**What's done:**
- All config: `package.json`, `electron.vite.config.ts`, `tsconfig.*.json`,
  `electron-builder.yml`, Tailwind, PostCSS
- Electron main process: `BrowserWindow`, PTY manager, IPC handlers, preload
- Renderer: split layout, tab bar, xterm.js terminals (one per tab), keyboard shortcuts
- Stubs for Stages 2–4: `browser-manager.ts`, `cdp-bridge.ts`, `socket-server.ts`, `skills-scanner.ts`
- CLI: `cli/duo.ts` (complete command dispatch, socket client)
- Skill: `skill/SKILL.md` + three example files
- Docs: `ROADMAP.md`, `docs/DECISIONS.md`, `docs/RESEARCH.md`

**What's next (finish Stage 1):**
1. Run `npm install` on macOS (triggers `electron-rebuild` for node-pty)
2. Run `npm run dev` and verify the app launches with working terminal tabs
3. Fix any issues found during manual testing
4. Update `ROADMAP.md` checkboxes

---

## Key files

| File | Purpose |
|---|---|
| `duo-brief.md` | Full project brief — read before making decisions |
| `ROADMAP.md` | Stage-by-stage checklist with completion indicators |
| `docs/DECISIONS.md` | All architecture decisions with rationale |
| `docs/RESEARCH.md` | Technical research notes for each stage |
| `shared/types.ts` | All shared types + IPC channel names |
| `shared/constants.ts` | Paths, defaults, partition names |
| `electron/main.ts` | Electron main process entry |
| `electron/pty-manager.ts` | node-pty session pool |
| `renderer/App.tsx` | Root React component, split layout |
| `skill/SKILL.md` | The duo skill (teaches Claude Code how to use the CLI) |

---

## Instructions from the brief

1. **Do not re-debate the stack.** Electron, xterm.js, WebContentsView, Unix socket CLI — all locked. See `docs/DECISIONS.md`.

2. **The CLI is the spec.** Every time a new CLI command is added, update `cli/duo.ts`, `skill/SKILL.md`, and the command reference in `duo-brief.md §9`.

3. **The skill is a first-class deliverable.** Ship both the app and `skill/SKILL.md`, or neither. The skill is how Claude Code discovers the tool.

4. **If blocked on an open question in `duo-brief.md §7`, state the assumption and proceed.** Do not stall waiting for clarification on layout, aesthetics, or naming.

5. **Stage order matters.** Do not try to implement Stage 3 before Stage 2 is working. The socket server is useless without a real browser.

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

## Open questions needing Geoff's input

| Question | Priority |
|---|---|
| Brainstem.cc API access for Skills panel | Before Stage 4 |
| Distribution plan (personal vs. Trailblazers timeline) | Before Stage 6 |
| Apple Developer ID for code signing | Before Stage 6 |
