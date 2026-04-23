# Duo

A macOS-native desktop app that pairs multiple Claude Code terminal sessions
with an embedded Chromium browser, connected by a local CLI bridge so Claude
Code can read and drive the browser — including authenticated Google Docs —
as naturally as it runs shell commands.

![status: Stages 1–3 shipped, Stage 5 skill verified end-to-end](https://img.shields.io/badge/status-stages_1--3_shipped-brightgreen)

---

## Why this exists

Product managers using Claude Code hit a recurring wall: they want the agent
to work with what's **on their screen** — a PRD in Google Docs, a live
dashboard, a generated HTML prototype — and every bridge is awkward. Copy /
paste, external MCP servers, browser-automation tools that break on Google
SSO. Duo collapses the terminal, the browser, and the agent-bridge into one
signed macOS app that installs by dragging to `/Applications`.

Duo is also a personal daily driver: shippable quality for a broader PM
cohort, prototype speed in the MVP.

---

## What it does today

- **Terminal tabs** (xterm.js + node-pty) side-by-side with a real
  **Chromium browser pane** (Electron `WebContentsView`), in one window.
- **Google SSO persists** across app restarts — sign into Docs once and it
  stays signed in.
- A `duo` **CLI** on your PATH that any terminal process can call. Under the
  hood it talks to the running app over a Unix socket
  (`~/Library/Application Support/duo/duo.sock`, mode 0700).
- Bundled **`duo` Claude Code skill** + **`duo-browser` subagent** so a
  fresh Claude Code session launched inside a Duo terminal
  auto-discovers them and can drive the browser without priming.
- **First-class support for canvas-rendered apps** (Google Docs, Sheets,
  Slides, Figma) via the accessibility tree — not DOM scraping, which
  silently returns empty on these surfaces.

---

## Quick start

### Prerequisites

| Requirement | Check |
|---|---|
| macOS 13+ | `sw_vers` |
| Xcode Command Line Tools | `xcode-select -p` |
| Node ≥ 18 | `node --version` |
| npm ≥ 9 | `npm --version` |

### Install and run

```bash
git clone https://github.com/dudgeon/duo.git
cd duo
npm install        # runs electron-rebuild for node-pty
npm run dev        # launches the Electron app
```

### Install the `duo` CLI and skill

```bash
# Symlink the CLI into ~/.local/bin (or /usr/local/bin if writable):
./cli/duo install

# Install the skill + subagent so fresh Claude Code sessions discover them:
mkdir -p ~/.claude/skills/duo/examples ~/.claude/agents
cp skill/SKILL.md            ~/.claude/skills/duo/SKILL.md
cp skill/examples/*.md       ~/.claude/skills/duo/examples/
cp agents/duo-browser.md     ~/.claude/agents/duo-browser.md

# Verify:
duo --version                # 0.1.0
```

> **Auto-install on first launch** is a Stage 6 polish item — today you run
> the commands above once.

### Try it

With the app running and the CLI installed, open any terminal (including
the one in Duo) and:

```bash
duo navigate https://example.com
duo title                   # → "Example Domain"
duo ax                      # accessibility tree in Markdown
duo screenshot --out /tmp/example.png
```

Then from a Duo terminal tab, run `claude` and ask
> summarize the page open in my browser

The nested Claude Code session will find the `duo` skill and drive the
browser for you.

---

## The `duo` CLI

The CLI is the agent's API surface. Everything below runs in milliseconds
against the live browser.

| Command | What it does |
|---|---|
| `duo navigate <url>` | Navigate the active browser tab |
| `duo url` / `duo title` | Current URL / page title |
| `duo text [--selector <css>]` | Visible text (DOM `innerText`) |
| `duo ax [--selector <css>] [--format md\|json]` | **Accessibility tree** — required for canvas apps |
| `duo dom` | Full page HTML |
| `duo click <selector>` | Click an element |
| `duo fill <selector> <value>` | Set an input value |
| `duo focus <selector>` | Focus an element |
| `duo type <text>` | Synthesize text input into the focused element |
| `duo key <name> [--modifiers cmd,shift,alt,ctrl]` | Dispatch a named key (Enter, ArrowDown, Backspace, or any single letter) |
| `duo eval <js>` | Run JS in the page, return result |
| `duo screenshot [--out <path>] [--selector <css>]` | PNG capture |
| `duo console [--since <ms>] [--level ...] [--limit N]` | Buffered console events (NDJSON) |
| `duo tabs` / `duo tab <n>` | List / switch browser tabs |
| `duo wait <selector> [--timeout <ms>]` | Block until element appears |
| `duo install` | Symlink CLI into PATH |

See [skill/SKILL.md](skill/SKILL.md) for the prescriptive agent-facing rules
(especially for Google Docs — `duo dom` and `/export?format=txt` are traps
there, only `duo ax` works).

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                 Electron main process                   │
│                                                         │
│   ┌──────────────────┐   ┌────────────────────────────┐ │
│   │   node-pty pool  │   │  WebContentsView(s) —      │ │
│   │  (one per tab)   │   │  real Chromium, persist:   │ │
│   └──────────────────┘   │  duo-browser partition     │ │
│                          └───────────┬────────────────┘ │
│                                      │ CDP via          │
│   ┌──────────────────────────────┐   │ webContents      │
│   │ Unix Socket Server           │◄──┘ .debugger         │
│   │ ~/Library/.../duo/duo.sock   │                      │
│   └──────────┬───────────────────┘                      │
│              │ IPC                                      │
└──────────────┼──────────────────────────────────────────┘
               │
      ┌────────▼────────┐
      │   duo CLI       │  ← on PATH, Claude Code calls this
      │  (esbuild bin)  │
      └─────────────────┘
          called by
      ┌─────────────────┐
      │  Claude Code    │  (running inside xterm.js / node-pty)
      │  (shell process)│
      └─────────────────┘
```

- **One Electron main process** owns the window, PTYs, browser view(s), and
  socket server.
- **One renderer process** hosts the React UI (tab bars, terminal
  canvases).
- **Multiple `WebContentsView`s** share the `persist:duo-browser`
  partition — SSO state survives relaunches and tab switches.
- **One Unix socket** (`duo.sock`, mode 0700) is the only ingress from the
  CLI. Anything running as the same user can drive the browser; MVP
  threat model is a single trusted machine.
- **CDP access** happens inside the main process via Electron's built-in
  `webContents.debugger` API — no external Chrome DevTools session.

Locked architectural decisions and rationale: [docs/DECISIONS.md](docs/DECISIONS.md).

---

## Repo layout

```
duo/
├── electron/              # main process
│   ├── main.ts            # window, IPC, lifecycle
│   ├── preload.ts         # renderer ↔ main bridge
│   ├── pty-manager.ts     # node-pty pool
│   ├── browser-manager.ts # WebContentsView tabs
│   ├── cdp-bridge.ts      # CDP command executor
│   ├── socket-server.ts   # Unix socket → CDP bridge
│   ├── skills-scanner.ts  # Stage 4 — CWD scan (not yet wired)
│   └── constants.ts       # Node-only paths/constants
├── renderer/              # React UI
│   ├── App.tsx
│   ├── components/        # TabBar, TerminalPane, BrowserPane, ...
│   └── hooks/
├── cli/
│   ├── duo.ts             # CLI source
│   ├── duo                # pre-built esbuild bundle (tracked in git)
│   └── install.sh         # postinstall helper
├── skill/                 # bundled Claude Code skill
│   ├── SKILL.md
│   └── examples/
├── agents/                # bundled Claude Code subagent
│   └── duo-browser.md
├── shared/
│   └── types.ts           # cross-process types + IPC channel names
├── docs/
│   ├── DECISIONS.md       # locked architectural choices
│   ├── FIRST-RUN.md       # macOS setup + smoke-test procedures
│   ├── RESEARCH.md        # notes that informed decisions
│   ├── research/
│   │   └── vscode-1.110-integrated-browser.md
│   └── ux/
│       └── layout-options.html
├── duo-brief.md           # full vision brief
└── ROADMAP.md             # stage-by-stage status + backlog
```

---

## Status

Full stage-by-stage tracking lives in [ROADMAP.md](ROADMAP.md). Headlines:

- ✅ **Stage 1 — Core shell** (Electron + React + xterm.js + node-pty, tabs, keybindings)
- ✅ **Stage 2 — Browser pane** (WebContentsView, SSO persistence, browser tab strip, address bar)
- ✅ **Stage 3 — `duo` bridge** (socket server, CLI, all read + write + console primitives including the `ax` accessibility-tree reader for canvas apps)
- ⏸ **Stage 4 — Skills context panel** (scanner implemented; UI not yet in layout)
- ✅ **Stage 5 — Skill authoring** (SKILL.md + `duo-browser` subagent + examples; end-to-end A.5.1 verified in a fresh Claude Code session)
- ⬜ **Stage 6 — Polish + distribution** (app icon, code signing, auto-update, first-launch installer, session restore)
- ⬜ **Stage 7 — File navigator + viewer** (scoped, not scheduled)

---

## Further reading

- **[duo-brief.md](duo-brief.md)** — the full vision brief. Read this for
  the "why" and for features not yet implemented.
- **[ROADMAP.md](ROADMAP.md)** — current status, per stage, plus the
  unscheduled backlog.
- **[docs/DECISIONS.md](docs/DECISIONS.md)** — locked architectural
  choices and the rationale, plus the open ADR on skill scoping.
- **[docs/FIRST-RUN.md](docs/FIRST-RUN.md)** — step-by-step setup and
  smoke-test procedure.
- **[docs/RESEARCH.md](docs/RESEARCH.md)** — Electron, CDP, node-pty,
  and xterm notes that shaped the build.
- **[skill/SKILL.md](skill/SKILL.md)** — the Claude Code skill installed
  alongside the app. Readable as-is for humans, too.

---

## License

MIT — see [LICENSE](LICENSE).
