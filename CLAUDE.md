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

**Stages 1–3 implemented.** All code is written and pushed. Awaiting first
end-to-end test on macOS (requires Electron/node-pty to build natively).

**What's done:**
- All config: `package.json`, `electron.vite.config.ts`, `tsconfig.*.json`,
  `electron-builder.yml`, Tailwind, PostCSS
- Electron main process: `BrowserWindow`, PTY manager, IPC handlers, preload
- Renderer: split layout, tab bar, xterm.js terminals (one per tab), keyboard shortcuts
- Browser pane: `BrowserManager` (WebContentsView, SSO persistence, tab management)
- CLI bridge: `CdpBridge` (CDP via debugger), `SocketServer` (Unix socket, 12 commands)
- CLI: `cli/duo` binary pre-built; `duo install` symlinks to `/usr/local/bin/duo`
- Skill: `skill/SKILL.md` + three example files
- Docs: `ROADMAP.md`, `docs/DECISIONS.md`, `docs/RESEARCH.md`, `docs/FIRST-RUN.md`

**What's next:**
1. Follow `docs/FIRST-RUN.md` on macOS — 10-step smoke test
2. Fix any issues found
3. Stage 4: Skills panel (collapsible sidebar, CWD-scan)

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
| Browser tab UX | Address bar + nav only; no visible tab bar; `duo tab <n>` for switching |
| Brainstem / MCP | **Not included** — Skills panel is CWD-scan only |
| Stage 2 + 3 | Implemented together in one pass |
| Skills panel layout | Collapsible sidebar — third column right of browser pane |
| Skills CWD source | PTY launch CWD (not moving shell CWD); two scopes: project + home |
| First-launch install | Electron permission dialog before installing CLI + skill |
| Distribution / cert | No cert yet — personal use only; get cert before Stage 6 |

## Open questions needing Geoff's input

| Question | Priority |
|---|---|
| Apple Developer ID cert | Before Stage 6 |
| Distribution timeline (personal → Trailblazers) | Before Stage 6 |
| Socket auth approach for Trailblazers | Before Stage 6 |
