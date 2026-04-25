# Duo

A macOS workspace where a human and an agent pair on the same surfaces —
terminal, browser, file tree, markdown editor — through a **CLI that
exposes every user-facing feature**. One `duo` command = one shared
action. The agent sees what you see and does what you can do.

Today the supported agent is
[Claude Code](https://www.anthropic.com/claude-code); the architecture is
BYO-harness.

![status: flagship reading/writing pair in progress](https://img.shields.io/badge/status-flagship_in_progress-brightgreen)

> **Why it's CLI-first.** If an agent can only watch but not act, you
> haven't built a pair — you've built a spectator. Every UI toggle,
> menu, and keystroke in Duo also has a `duo <verb>` counterpart. See
> [docs/CLI-COVERAGE.md](docs/CLI-COVERAGE.md) for the full inventory
> plus the gap roadmap.
>
> **Product north star lives in [docs/VISION.md](docs/VISION.md)** —
> persona, principles, and the flagship "readable terminal + docs-style
> markdown editor" bet. Read that for the *why*.

---

## Who this is for

Primarily, **product managers and other non-SWE knowledge workers** who
want to work with an agent the way they already work in Google Docs or
Notion — beautifully, safely, and without learning the terminal or the
file system first. Duo smooths the rough edges of running an agent like
Claude Code so the people least equipped to adopt it are actually able to.

Duo is **not an agent.** It is a harness for someone else's agent.
The terminal is still there — the agent lives in it — but everything
around the terminal is designed for someone who does not.

See [docs/VISION.md](docs/VISION.md) for the full persona and the
aspirational capability set.

---

## What it is today

The recurring pain point for the primary persona: they want the agent to
work with what's **on their screen** — a PRD in Google Docs, a live
dashboard, a generated HTML prototype — and every bridge is awkward.
Copy/paste, external MCP servers, browser-automation tools that break on
Google SSO. Duo collapses the terminal, the browser, the file tree, the
markdown editor, and the agent-bridge into one signed macOS app that
installs by dragging to `/Applications`. Authenticated Google Docs
read/edit is the flagship success test for this foundation layer.

What's shipped today:

- **Three-column workspace:** files on the left, terminal in the middle,
  a **polymorphic Viewer/Editor column** on the right with one unified
  tab strip for browser tabs, markdown-editor tabs, and file previews.
- **Terminal tabs** (xterm.js + node-pty) with reader typography
  ("cozy mode", Stage 9).
- **Real Chromium browser pane** (Electron `WebContentsView`) with
  **persistent Google SSO** — sign in once, stay signed in across relaunches.
- **Rich markdown editor** (Stage 11a): Google-Docs-like typography,
  TipTap/ProseMirror under the hood, GFM + task lists + tables + syntax-
  highlighted code. YAML frontmatter preserved. Autosave + `⌘S`.
  CriticMarkup-based comments and track-changes land in 11b–d.
- **Light / dark / system theme** with macOS appearance follow.
- A `duo` **CLI** on your PATH. Any terminal process — including
  Claude Code running inside a Duo tab — can call it. Under the hood
  it's a Unix socket at `~/Library/Application Support/duo/duo.sock`
  (mode 0700). See [docs/CLI-COVERAGE.md](docs/CLI-COVERAGE.md).
- Bundled **`duo` Claude Code skill** + **`duo-browser` subagent** so a
  fresh Claude Code session launched inside a Duo terminal
  auto-discovers them and can drive the browser + editor without priming.
- **First-class support for canvas-rendered apps** (Google Docs, Sheets,
  Slides, Figma) via the accessibility tree — not DOM scraping, which
  silently returns empty on these surfaces.

Duo is also a personal daily driver for the owner: shippable quality for a
broader cohort, prototype speed in the MVP.

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

The CLI is the agent's API surface. Every interaction below runs in
milliseconds against the live app — the same app the human is using.
This table is the headline set; the exhaustive, priority-tagged
inventory + gap roadmap lives in
[docs/CLI-COVERAGE.md](docs/CLI-COVERAGE.md).

**Browser — drive the page the human is looking at**

| Command | What it does |
|---|---|
| `duo navigate <url>` | Navigate the **active** browser tab |
| `duo open <path-or-url>` | Open a local file or URL in a **new** browser tab (for agent-generated HTML artifacts) |
| `duo url` / `duo title` | Current URL / title |
| `duo ax [--selector] [--format md\|json]` | **Accessibility tree** — the canvas-app read path (Docs / Sheets / Slides / Figma) |
| `duo text [--selector]` · `duo dom` · `duo eval <js>` | Plain text / HTML / JS eval |
| `duo click` · `duo fill` · `duo focus` · `duo type` · `duo key` | Interaction primitives |
| `duo screenshot [--out] [--selector]` | PNG |
| `duo console [--since] [--level] [--limit]` | Buffered console (NDJSON) |
| `duo tabs` / `duo tab <n>` / `duo close <n>` | List / switch / close browser tabs |
| `duo wait <selector> [--timeout]` | Block until visible |

**Files + navigator** (Stage 10)

| Command | What it does |
|---|---|
| `duo view <path>` | Open a file in the Viewer/Editor column (image / pdf / unknown) |
| `duo reveal <path>` | Move the file navigator to `<path>`, flash a chip |
| `duo ls [path]` | Directory listing (JSON) |
| `duo nav state` | Navigator snapshot: cwd, selection, expanded, pinned |

**Markdown editor** (Stage 11)

| Command | What it does |
|---|---|
| `duo edit <path>` | Open a `.md` in the rich editor |
| `duo selection` | Active editor's selection: `{path, text, paragraph, heading_trail, start, end}` |
| `duo doc write [--replace-selection\|--replace-all] [--text\|stdin]` | Apply text to the active editor; `--replace-all` accepts markdown |

**Appearance**

| Command | What it does |
|---|---|
| `duo theme [system\|light\|dark]` | Read or set theme mode |

**Meta**

| Command | What it does |
|---|---|
| `duo install` | Symlink CLI to `/usr/local/bin/duo` or `~/.local/bin/duo` |
| `duo --version` / `duo --help` | Self-explanatory |

> **Gap list.** Terminal tab management (`duo term new / close / tab`),
> pane focus (`duo pane focus`), in-buffer doc read (`duo doc read`),
> cozy-mode toggle, files-column toggle, and more are on the
> [CLI-COVERAGE roadmap](docs/CLI-COVERAGE.md) with priorities. If you
> find yourself wanting a verb, open an issue — keeping the inventory
> comprehensive is the point of the project.

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
│   ├── main.ts            # window, IPC, lifecycle, nav/theme/editor bridges
│   ├── preload.ts         # renderer ↔ main bridge
│   ├── pty-manager.ts     # node-pty pool
│   ├── browser-manager.ts # WebContentsView tabs + shortcut forwarding
│   ├── cdp-bridge.ts      # CDP command executor
│   ├── socket-server.ts   # Unix socket → all CLI verbs
│   ├── files-service.ts   # disk I/O (read, write, list, watch)
│   ├── skills-scanner.ts  # Stage 4 — CWD scan (not yet wired)
│   └── constants.ts       # Node-only paths/constants
├── renderer/              # React UI
│   ├── App.tsx            # three-column layout + theme + focus routing
│   ├── components/
│   │   ├── TabBar.tsx · TerminalPane.tsx
│   │   ├── FilesPane.tsx · FileTree.tsx · Breadcrumb.tsx
│   │   ├── WorkingPane.tsx · WorkingTabStrip.tsx
│   │   ├── BrowserRenderer.tsx · AddressBar.tsx
│   │   ├── MarkdownPreview.tsx · FileRenderers.tsx
│   │   ├── ThemeToggle.tsx
│   │   └── editor/         # Stage 11 markdown editor
│   │       ├── MarkdownEditor.tsx · EditorToolbar.tsx
│   │       ├── markdown-io.ts       # frontmatter split / encoding
│   │       └── extensions/          # TipTap extensions (TableShortcuts,
│   │                                #   PersistentSelection, …)
│   └── hooks/             # useNavigator, useBrowserState, useTheme, …
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
│   ├── VISION.md          # product north star
│   ├── DECISIONS.md       # locked architectural choices
│   ├── CLI-COVERAGE.md    # shipped verbs + gap roadmap (CLI parity)
│   ├── FIRST-RUN.md       # macOS setup + smoke-test procedures
│   ├── RESEARCH.md        # notes that informed decisions
│   ├── prd/               # per-stage PRDs
│   │   ├── stage-9-cozy-mode.md
│   │   ├── stage-10-file-navigator.md
│   │   └── stage-11-markdown-editor.md
│   ├── research/          # raw tech-choice notes
│   ├── dev/
│   │   └── smoke-checklist.md   # test-before-shipping matrix
│   └── ux/
├── duo-brief.md           # original brief (Stages 1–5; product framing
│                          #   superseded by docs/VISION.md)
├── ROADMAP.md             # stage-by-stage status + backlog
└── CLAUDE.md              # guidance for AI working on the project
```

---

## Status

Full stage-by-stage tracking lives in [ROADMAP.md](ROADMAP.md). Headlines:

**Shipped (foundation + flagship half #1):**
- ✅ **Stage 1** — Core shell (Electron + React + xterm.js + node-pty, tabs, keybindings)
- ✅ **Stage 2** — Browser pane (WebContentsView, SSO persistence, tab strip, address bar)
- ✅ **Stage 3** — `duo` CLI bridge (socket server, CDP primitives, rich Google Docs read via `/export?format=md`)
- ✅ **Stage 5** — Skill + `duo-browser` subagent (end-to-end verified in a fresh Claude Code session)
- ✅ **Stage 8** — `duo open` for agent-generated HTML artifacts (+ `duo close` for cleanup)
- ✅ **Stage 9** — Cozy-mode terminal (reader typography, TUI-safe, preview)
- 🔄 **Stage 10** — File navigator + WorkingPane reshape (spec locked, in progress)

**In progress — flagship half #2:**
- 🔄 **Stage 11** — Collaborative markdown editor. **Sub-stage 11a shipped
  2026-04-24:** TipTap editor, GFM tables, task lists, syntax-highlighted
  code blocks, `⌘N` new-file flow, `⌘S` + autosave, table contextual
  toolbar, persistent selection across focus changes, theme toggle
  (System/Light/Dark), `duo edit` / `duo selection` / `duo doc write` /
  `duo theme` CLI verbs. 11b–e (CriticMarkup track-changes, agent-write
  highlight, comments, outline, find/replace) next. Covers open issues
  [#5](https://github.com/dudgeon/duo/issues/5),
  [#6](https://github.com/dudgeon/duo/issues/6),
  [#7](https://github.com/dudgeon/duo/issues/7).

**After the flagship:**
- ⬜ **Stage 12** — Unified skill + connector management surface (supersedes Stage 4)
- ⬜ **Stage 13** — Interaction polish (`duo doctor`, TCP transport fallback, terminal selection refinements, `duo reload`, tab numbers in UI)
- ⬜ **Stage 15** — Human↔agent interaction primitives (`duo events`, `duo notify`, `duo tab name`, `duo zap`, file→composer, **15g "Send → Duo" cross-modality button raised 2026-04-25**)
- ⬜ **Stage 14 / old Stage 6** — Polish + distribution (code signing, installer, auto-update, theming refinement — held until the flagship pair lands)

---

## Further reading

- **[docs/VISION.md](docs/VISION.md)** — product north star: persona, jobs
  to be done, principles, flagship bet. Start here for *why* Duo exists.
- **[docs/CLI-COVERAGE.md](docs/CLI-COVERAGE.md)** — exhaustive CLI
  inventory + priority-tagged gap roadmap. Updated as verbs ship.
- **[ROADMAP.md](ROADMAP.md)** — current status, per stage, plus the
  unscheduled backlog.
- **[docs/DECISIONS.md](docs/DECISIONS.md)** — locked architectural
  choices and rationale, plus the open ADR on transport / sandbox.
- **[docs/prd/](docs/prd/)** — per-stage PRDs (Stages 9, 10, 11). Each
  captures D-numbered decisions with rationale.
- **[docs/dev/smoke-checklist.md](docs/dev/smoke-checklist.md)** — the
  test matrix every Claude instance walks before calling UI work done.
- **[docs/FIRST-RUN.md](docs/FIRST-RUN.md)** — step-by-step setup and
  smoke-test procedure.
- **[docs/RESEARCH.md](docs/RESEARCH.md)** — Electron, CDP, node-pty,
  xterm notes that shaped the build.
- **[skill/SKILL.md](skill/SKILL.md)** — the Claude Code skill installed
  alongside the app. Readable as-is for humans, too.
- **[CLAUDE.md](CLAUDE.md)** — rules for future Claude instances working
  on the project. Rule #4 is CLI parity — the project's load-bearing
  design principle.
- **[duo-brief.md](duo-brief.md)** — original engineering brief for
  Stages 1–5. Product framing is superseded by `docs/VISION.md`; the
  technical detail (especially the Google Docs read/write path in §17)
  remains the authoritative reference.

---

## License

MIT — see [LICENSE](LICENSE).
