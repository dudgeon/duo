# Duo — Project Brief

> **Working name:** `duo` (placeholder — not confirmed by owner)
> **Owner:** Geoff
> **Status:** Planning complete, ready to scaffold Stage 1
> **Last updated:** 2026-04-22

> ⚠️ **Implementation notes for Claude instances reading this brief:**
>
> 1. **Name is confirmed as "Duo".** The brief uses "orbit" / "Orbit" throughout as a placeholder — this was the working name before the owner confirmed "Duo". The CLI is `duo`, the socket is `duo.sock`, the skill installs to `~/.claude/skills/duo/`. Do not rename anything back to "orbit".
>
> 2. **Brainstem.cc / MCP integration is deferred.** Sections of this brief that describe brainstem.cc API queries for the Skills panel (§3, §8) reflect a future aspiration, not current scope. For MVP, the Skills panel is CWD-scan only. See `ROADMAP.md` for current Stage 4 spec.
>
> 3. **Socket path is `~/Library/Application Support/duo/duo.sock`**, not `/tmp/orbit.sock` as mentioned in some sections. The app data directory is preferred for persistence and security. See `docs/DECISIONS.md`.
>
> 4. **Stages 1–3 are implemented.** This brief describes the full vision; `ROADMAP.md` tracks what's actually done. Read `CLAUDE.md` for current state before making decisions.

-----

## 1. One-Liner

A macOS-native desktop app that pairs multiple Claude Code terminal sessions with an embedded Chrome-compatible browser, connected by a local CLI bridge so Claude Code can read and drive the browser (including authenticated Google Docs) as naturally as it runs shell commands.

-----

## 2. Why This Exists

Geoff leads an “AI in Product” program at Capital One aimed at helping ~2,600 product managers adopt agentic tools. A recurring friction point: PMs working with Claude Code need the agent to interact with web content — especially Google Docs for PRDs, specs, and collaborative artifacts — but today this requires awkward copy/paste, external MCP bridges, or browser automation that breaks on Google SSO.

Orbit collapses the terminal + browser + agent-bridge into one signed macOS app that a PM can install by dragging to `/Applications`. No Node setup, no Chrome extensions, no auth dances.

It is also a **personal daily driver** for Geoff. The design choices reflect both roles: shippable quality for a Trailblazers-style cohort, but prototype-speed priorities for the MVP.

-----

## 3. Primary Use Cases

1. **PM works on a PRD in Google Docs while Claude Code drafts edits.** Claude reads the current doc content via `orbit text`, proposes revisions, and the PM applies them.
1. **Multiple parallel Claude Code sessions.** PM has three terminal tabs: one on the main PRD, one doing research in the repo, one running tests. The browser is shared across all.
1. **Agent-generated web artifacts.** Claude Code generates an HTML prototype, loads it in the embedded browser, interacts with it, screenshots it, iterates.
1. **Contextual skill discovery.** When a PM opens a terminal in a project directory, the sidebar shows which Claude Code skills are available based on CWD (`SKILL.md` files, `.claude/` dirs, brainstem.cc context).

-----

## 4. Goals & Non-Goals

### Goals

- Dead-simple install (signed DMG, drag to Applications, done)
- Real Chromium (so Google SSO, Google Docs, modern web apps all work)
- Snappy, responsive UI — terminal must feel as fast as iTerm/Warp
- Multiple terminal tabs, one shared browser
- Agent can read DOM, click, fill, inject JS, navigate, screenshot
- Skills context panel scoped to active terminal’s CWD
- Ship an accompanying skill that teaches Claude Code how to use the app

### Non-Goals (explicitly out of scope for MVP)

- Cross-platform (macOS only for now)
- Multiple browser instances / profiles in one window (one shared browser is fine)
- Browser-initiated calls into the terminal (the reverse direction, terminal → browser, is the priority)
- MCP-based architecture (explicitly rejected — see §6)
- Remote/hosted mode
- Team/enterprise admin features

-----

## 5. Context on the Owner

Geoff is Senior Director of Digital Product Management at Capital One, Product Lead for Conversational Servicing (US Card). He’s been building toward an “agent-native PM practice” including a four-phase PM upskilling framework for Claude Code, a Trailblazers pilot cohort, and a personal `brainstem.cc` MCP server for cross-session context. He’s technically deep (Python, Shapely/ezdxf, CNC g-code, Cloudflare Workers) and does substantial work in Claude Code directly. This app is both a personal productivity tool and a candidate artifact for his broader PM enablement work.

-----

## 6. Key Decisions — LOCKED

These have been discussed and settled. Do not reopen without cause.

|Decision              |Choice                                                          |Why                                                                                                                                                                                 |
|----------------------|----------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|App framework         |**Electron**                                                    |Only way to get real Chromium (required for Google SSO + Docs) with a native-feeling macOS shell. Tauri (WebKit), CEF, and native Swift+WKWebView all eliminated by this constraint.|
|Terminal renderer     |**xterm.js + node-pty**                                         |VS Code’s stack. Battle-tested, fast, full ANSI/mouse support, multi-instance trivial.                                                                                              |
|Browser embedding     |**WebContentsView** (Electron 28+)                              |Modern replacement for deprecated BrowserView. Full Chromium, shared session for SSO persistence.                                                                                   |
|Agent ↔ browser bridge|**Local CLI tool over Unix socket**                             |User explicitly rejected MCP. CLI tool on PATH is the simplest, most Claude-Code-native pattern — agent calls it like any other shell command, reads stdout.                        |
|UI framework          |**React + Tailwind**                                            |Standard Electron renderer stack, fast iteration.                                                                                                                                   |
|Build tooling         |**electron-vite + electron-builder**                            |Modern, fast HMR in dev; signed DMG output for distribution.                                                                                                                        |
|Target OS             |**macOS only** (Apple Silicon + Intel universal)                |Linux/Windows deferred.                                                                                                                                                             |
|MVP quality bar       |**Staged: core first, polish later**                            |Not shipping to a broad audience on day one.                                                                                                                                        |
|Skill shipping        |**Bundled with the app**, installed to `~/.claude/skills/orbit/`|Ensures every Claude Code session launched in-app has the orbit skill available.                                                                                                    |

-----

## 7. Decisions Pending / Assumptions Made

The following were not directly answered by the owner; reasonable assumptions were made and should be confirmed before or during Stage 1.

|Topic              |Assumption                                                                     |Confirm before                                                |
|-------------------|-------------------------------------------------------------------------------|--------------------------------------------------------------|
|Name               |`orbit` is a working placeholder                                               |Stage 5 (skill authoring, since the skill name is user-facing)|
|Distribution scope |Geoff personal → Trailblazers cohort → broader PM community (staged)           |Stage 6 (signing/notarization setup)                          |
|Layout model       |Resizable split: terminals on left, browser on right, sidebar for skills       |Stage 1                                                       |
|Skills data sources|CWD scan (SKILL.md, .claude/, CLAUDE.md) + brainstem.cc API                    |Stage 4                                                       |
|Starting point     |Greenfield                                                                     |—                                                             |
|Agent topology     |Each terminal tab = independent Claude Code session; all tabs share one browser|Stage 1                                                       |
|UI aesthetic       |Dark, dense, professional-tool feel (reference: Warp × Linear)                 |Stage 6                                                       |
|Browser tabs       |Multiple tabs within the single browser pane                                   |Stage 2                                                       |

-----

## 8. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Electron Main Process                 │
│                                                         │
│  ┌──────────────────┐   ┌──────────────────────────┐   │
│  │   node-pty pool  │   │   WebContentsView (Chrom)│   │
│  │  (one per tab)   │   │   Google SSO / Docs       │   │
│  └──────────────────┘   └──────────┬───────────────┘   │
│                                    │ CDP via             │
│  ┌──────────────────────────────┐  │ webContents        │
│  │  Unix Socket Server          │◄─┘ .debugger          │
│  │  /tmp/orbit.sock             │                       │
│  └──────────┬───────────────────┘                       │
│             │ IPC                                        │
└─────────────┼───────────────────────────────────────────┘
              │
     ┌────────▼────────┐
     │   orbit CLI     │  ← on PATH, Claude Code calls this
     │  (Node.js bin)  │
     └─────────────────┘
         called by
     ┌─────────────────┐
     │  Claude Code    │  (inside xterm.js / node-pty)
     │  (shell process)│
     └─────────────────┘
```

### Key architectural properties

- **One Electron main process** owns everything: windows, PTYs, browser, socket server.
- **One renderer process** hosts the React UI, terminals, and iframes/views.
- **One WebContentsView** is shared across all terminal tabs’ agents. No per-tab browser.
- **One Unix socket** at a predictable path (`/tmp/orbit.sock` or `~/.orbit/sock`) is how the CLI reaches the main process.
- **CDP access** happens inside the main process via Electron’s built-in `webContents.debugger` API — no external Chrome DevTools connection required.

-----

## 9. The `orbit` CLI Specification

The CLI is the agent’s API surface. It must be stable, predictable, and output in formats Claude Code can parse naturally.

### Command reference (draft)

|Command                                         |Description                             |Output                  |
|------------------------------------------------|----------------------------------------|------------------------|
|`orbit navigate <url>`                          |Navigate the browser to URL             |JSON: `{ok, url, title}`|
|`orbit url`                                     |Current URL                             |plain text              |
|`orbit title`                                   |Current page title                      |plain text              |
|`orbit dom`                                     |Full page HTML (outerHTML)              |HTML to stdout          |
|`orbit text`                                    |Visible text content (innerText of body)|plain text              |
|`orbit text --selector <css>`                   |innerText of matching element           |plain text              |
|`orbit click <selector>`                        |Click element by CSS selector           |JSON: `{ok, error?}`    |
|`orbit fill <selector> <value>`                 |Fill input                              |JSON: `{ok, error?}`    |
|`orbit eval <js>`                               |Execute JS, return result               |JSON-serialized result  |
|`orbit screenshot [--out path] [--selector css]`|PNG screenshot                          |Path to file            |
|`orbit tabs`                                    |List open browser tabs                  |JSON array              |
|`orbit tab <n>`                                 |Switch to browser tab N                 |JSON: `{ok}`            |
|`orbit wait <selector> [--timeout ms]`          |Wait for element                        |JSON: `{ok, error?}`    |
|`orbit --version`                               |Version string (must match skill)       |plain text              |

### Protocol (CLI ↔ socket)

JSON-over-Unix-socket, line-delimited:

```json
→ {"id": "uuid", "cmd": "text", "args": {"selector": "article"}}
← {"id": "uuid", "ok": true, "result": "..."}
← {"id": "uuid", "ok": false, "error": "Element not found"}
```

### Error semantics

- Non-zero exit code on failure
- Human-readable error to stderr
- Machine-readable error in JSON output when `--json` flag present
- Claude Code should interpret non-zero exits as retryable for navigation/timing issues

-----

## 10. The `orbit` Skill (ships with the app)

The skill lives at `~/.claude/skills/orbit/SKILL.md` after install. It teaches Claude Code:

1. **When to reach for `orbit`** vs. alternatives (WebFetch, file reads)
1. **The command surface** — ref to §9
1. **Common patterns:**
- “Read a Google Doc” → `orbit navigate <url>` → wait for load → `orbit text --selector .kix-appview-canvas`
- “Fill and submit a form” → `orbit fill`, `orbit click`
- “Verify a visual state” → `orbit screenshot` → report back to user
- “Iterate on a generated HTML artifact” → write file → `orbit navigate file://...` → `orbit screenshot`
1. **Error recovery** — when a selector fails, retry with `orbit dom` to inspect, or use `orbit eval` for custom queries
1. **When NOT to use it** — static fetches (use WebFetch), reading local files (use Read), reading terminal state (not its job)
1. **Pinned version** — skill tests `orbit --version` matches its compatible range

The skill is the spec. If it’s painful to write, the CLI surface is wrong.

-----

## 11. Roadmap — Build Stages

### Stage 1 — Core shell (Week 1)

- Electron app scaffold with electron-vite + React + Tailwind
- Resizable split layout (terminal left, browser right placeholder)
- xterm.js + node-pty: one working terminal
- Tab bar for multiple terminal sessions
- Keyboard shortcuts: new tab, close tab, cycle tabs, focus toggle
- **Exit criteria:** Geoff can open the app, get multiple terminal tabs, run Claude Code in them.

### Stage 2 — Browser pane (Week 1–2)

- WebContentsView embedded in right pane
- Browser address bar, back/forward/reload
- Google SSO session persistence (partition → `~/Library/Application Support/orbit/browser-session`)
- Multiple browser tabs within the browser pane
- **Exit criteria:** Geoff can log into Google once, reopen the app, still be logged in. Google Docs renders correctly.

### Stage 3 — `orbit` bridge (Week 2)

- Unix socket server in main process
- CDP wiring: navigate, dom, text, click, fill, eval, screenshot (core set first)
- `orbit` CLI binary (compiled or Node.js shebang), installed via postinstall or bundled in DMG with a symlink step
- Install script: `/usr/local/bin/orbit` symlink
- **Exit criteria:** From any terminal tab in the app, `orbit text` returns the contents of whatever’s in the browser.

### Stage 4 — Skills context panel (Week 2–3)

- Per-tab CWD watcher (chokidar)
- Scan for `SKILL.md`, `.claude/skills/`, `CLAUDE.md`, MCP config
- Brainstem.cc API integration for personal knowledge context
- Right sidebar or collapsible overlay showing skills scoped to active tab’s CWD
- **Exit criteria:** Switching between tabs changes the sidebar contents to reflect that tab’s project context.

### Stage 5 — `orbit` skill (Week 3)

- Author `SKILL.md` per §10
- Worked examples folder alongside the skill
- Installer drops skill into `~/.claude/skills/orbit/`
- Version pinning between CLI and skill
- **Exit criteria:** A fresh Claude Code session in the app autonomously discovers and uses `orbit` to read a Google Doc.

### Stage 6 — Polish & distribution (ongoing)

- App icon + branded DMG (`electron-builder`)
- Code signing + notarization (Apple Developer ID)
- Theming pass (dark, dense, intentional)
- Auto-update via electron-updater
- Session restore on relaunch
- Notifications for agent-driven browser changes
- **Exit criteria:** A PM in the Trailblazers cohort can install and use without terminal setup.

-----

## 12. Repository Structure

```
orbit/
├── electron/
│   ├── main.ts                  # app bootstrap, window, IPC
│   ├── pty-manager.ts           # node-pty pool, lifecycle
│   ├── browser-manager.ts       # WebContentsView lifecycle, tabs
│   ├── cdp-bridge.ts            # CDP command executor
│   ├── socket-server.ts         # Unix socket → CDP bridge
│   └── skills-scanner.ts        # CWD scanning logic
├── cli/
│   ├── orbit.ts                 # CLI tool (ships with app)
│   └── install.sh               # symlink setup
├── skill/                       # ships inside app bundle
│   ├── SKILL.md
│   └── examples/
│       ├── read-google-doc.md
│       ├── fill-form.md
│       └── iterate-artifact.md
├── renderer/
│   ├── App.tsx
│   ├── components/
│   │   ├── TerminalPane.tsx
│   │   ├── BrowserPane.tsx
│   │   ├── TabBar.tsx
│   │   ├── AddressBar.tsx
│   │   └── SkillsPanel.tsx
│   ├── hooks/
│   │   ├── useTerminal.ts
│   │   ├── useSkillsContext.ts
│   │   └── useKeyboardShortcuts.ts
│   └── styles/
├── shared/
│   ├── types.ts                 # socket protocol types
│   └── constants.ts
├── scripts/
│   └── postinstall.ts
├── electron-builder.yml
├── electron.vite.config.ts
├── tsconfig.json
└── package.json
```

-----

## 13. Distribution & Install

- **Build:** `electron-builder` → universal (arm64 + x64) signed DMG
- **Signing:** Apple Developer ID + notarization (required for Gatekeeper on modern macOS)
- **User install:** Drag `Orbit.app` to `/Applications`. First launch asks permission to create `/usr/local/bin/orbit` symlink (or writes to `~/.local/bin` if non-admin)
- **Skill install:** First launch copies `SKILL.md` to `~/.claude/skills/orbit/`. Updates overwrite.
- **Browser profile:** `~/Library/Application Support/orbit/browser-session/`
- **Socket path:** `~/Library/Application Support/orbit/orbit.sock` (sandbox-friendlier than /tmp)
- **Updates:** `electron-updater` with a GitHub Releases feed or private S3 bucket

-----

## 14. Risks & Tradeoffs

|Risk                                                                           |Severity|Mitigation                                                                                                            |
|-------------------------------------------------------------------------------|--------|----------------------------------------------------------------------------------------------------------------------|
|Electron bundle size (~150–200 MB)                                             |Low     |Internal tool context; users don’t care. Call it out once, move on.                                                   |
|Google could detect Electron-Chromium and challenge SSO                        |Medium  |Use a consistent user-agent; persist the profile; if issues arise, switch session to a Chrome-installed profile reuse.|
|CDP changes between Chromium versions                                          |Low     |Electron abstracts this; pin Electron versions per release.                                                           |
|`node-pty` native module rebuild pain on Electron updates                      |Medium  |Use `electron-rebuild` in CI; document for contributors.                                                              |
|Security: local socket = anything on the machine can drive the browser         |Medium  |Acceptable for personal/trusted-machine use. Add a launch-time token or uid check before broader distribution.        |
|Skill drifts from CLI surface                                                  |Medium  |Version-pin the skill against `orbit --version`; add a smoke test that runs each example in CI.                       |
|Apple notarization friction                                                    |Low     |One-time setup cost; standard process.                                                                                |
|Performance: large DOM dumps (e.g. a long Google Doc) blow past terminal buffer|Medium  |`orbit text` + `--selector` narrowing; add `orbit text --max-chars N`; consider a `--save-to <file>` option.          |

-----

## 15. Glossary

- **CDP** — Chrome DevTools Protocol. The wire protocol used to inspect and control Chromium. Electron exposes this via `webContents.debugger`.
- **WebContentsView** — Electron’s modern API for embedding a Chromium view inside a BrowserWindow. Replaces the deprecated BrowserView.
- **node-pty** — Node.js bindings for spawning pseudo-terminal processes. Used to run real shells with full terminal semantics.
- **xterm.js** — Browser-side terminal emulator. Renders PTY output into a canvas/DOM terminal.
- **Brainstem** — Geoff’s personal knowledge management system at brainstem.cc, exposed as an MCP server. Relevant for the skills panel’s “context” source.
- **Trailblazers** — Geoff’s pilot cohort of Capital One PMs getting early Claude Code access.

-----

## 16. Handoff Notes — For the Next Claude Instance

If you are a Claude instance picking this up, here’s what you need to know:

1. **Confirm the working name.** “Orbit” was coined by the previous Claude assistant, not by Geoff. Before Stage 5 (skill authoring), ask whether to keep it or rename.
1. **Start with Stage 1.** The owner explicitly said “ship it in stages: core first, polish later.” Do not try to make Stage 1 beautiful — make it functional, with a clean internal structure that won’t need rewriting for Stages 2–4.
1. **Do not re-debate the stack.** The Electron decision is load-bearing and was derived from two hard constraints: Google SSO must work, and the agent must read the DOM. If either constraint ever relaxes, revisit — otherwise, build on Electron.
1. **The CLI is the spec.** Every time a new CLI command is added, update §9 and the skill in `skill/SKILL.md`. The skill is how Claude learns the tool; if it’s missing, the feature effectively doesn’t exist for agent use.
1. **Geoff’s working style.** He’s technical, prefers concrete recommendations over options, appreciates forcing functions and clean seams. He’ll often answer “TBD, recommend” — take that as permission to decide and document, not an invitation to ask again.
1. **The skill-along-with-the-app is not an afterthought.** It is Stage 5 and a first-class deliverable. The app without the skill is 60% of the value. The skill without the app is 0%. Ship both or ship neither.
1. **If blocked on an open question in §7, state the assumption and proceed.** Do not stall waiting for clarification on layout, aesthetics, or naming — these can be resolved in-flight.
1. **Suggested first task:** scaffold the repo per §12, get electron-vite + React + Tailwind running, render a single xterm.js terminal backed by node-pty. One file, one window, one working terminal. Everything else builds from there.
