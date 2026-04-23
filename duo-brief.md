# Duo — Project Brief (engineering, Stages 1–5)

> **Name:** Duo (CLI: `duo`, socket: `~/Library/Application Support/duo/duo.sock`, skill: `~/.claude/skills/duo/`)
> **Owner:** Geoff
> **Status:** Stages 1–3 implemented; Stage 5 skill + subagent authored and verified end-to-end.
> **Last updated:** 2026-04-22

> **Product framing has moved to [docs/VISION.md](docs/VISION.md).** That
> doc is the current north star — persona, principles, and the flagship
> "readable terminal + docs-style markdown editor" bet. This brief is
> retained as the engineering reference for Stages 1–5: the CLI spec (§9),
> the architecture (§8), the Google Docs first-class read/write path (§17),
> and the acceptance criteria (§11) are still authoritative. Where the
> brief's product framing ("a tool for PMs using Claude Code at Capital
> One") differs from the vision doc, the vision doc wins.

> This is the full vision brief. For current build state see [ROADMAP.md](ROADMAP.md). For architecture decisions see [docs/DECISIONS.md](docs/DECISIONS.md). For first-time setup see [docs/FIRST-RUN.md](docs/FIRST-RUN.md). Brainstem.cc / MCP integration mentioned in §3, §8 is a future aspiration — the shipping Skills panel (Stage 4) is CWD-scan only.

-----

## 1. One-Liner

A macOS-native desktop app that pairs multiple Claude Code terminal sessions with an embedded Chrome-compatible browser, connected by a local CLI bridge so Claude Code can read and drive the browser (including authenticated Google Docs) as naturally as it runs shell commands.

-----

## 2. Why This Exists

Geoff leads an “AI in Product” program at Capital One aimed at helping ~2,600 product managers adopt agentic tools. A recurring friction point: PMs working with Claude Code need the agent to interact with web content — especially Google Docs for PRDs, specs, and collaborative artifacts — but today this requires awkward copy/paste, external MCP bridges, or browser automation that breaks on Google SSO.

Duo collapses the terminal + browser + agent-bridge into one signed macOS app that a PM can install by dragging to `/Applications`. No Node setup, no Chrome extensions, no auth dances.

It is also a **personal daily driver** for Geoff. The design choices reflect both roles: shippable quality for a Trailblazers-style cohort, but prototype-speed priorities for the MVP.

-----

## 3. Primary Use Cases

1. **PM works on a PRD in Google Docs while Claude Code drafts edits.** Claude reads the current doc content via `duo text`, proposes revisions, and the PM applies them.
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
- Agent can read DOM **and the accessibility tree**, click, fill, **type**, inject JS, navigate, screenshot, **read console logs**
- **Google Docs is a first-class target: the agent can both read and edit the doc currently open in the browser pane.** See §17 and the Stage 2/3/5 acceptance criteria in §11.
- Skills context panel scoped to active terminal's CWD
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
|Skill shipping        |**Bundled with the app**, installed to `~/.claude/skills/duo/`|Ensures every Claude Code session launched in-app has the duo skill available.                                                                                                    |

-----

## 7. Decisions Pending / Assumptions Made

The following were not directly answered by the owner; reasonable assumptions were made and should be confirmed before or during Stage 1. Rows marked **OPEN — OWNER ACTION** are hard blockers on their target stage and cannot be resolved by Claude without input from Geoff.

|Topic              |Status / Assumption                                                                                                                                          |Confirm before                                                |
|-------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------|
|Name               |`duo` is a working placeholder                                                                                                                             |Stage 5 (skill authoring, since the skill name is user-facing)|
|Distribution scope |Geoff personal → Trailblazers cohort → broader PM community (staged)                                                                                         |Stage 6 (signing/notarization setup)                          |
|Layout model       |**OPEN — OWNER ACTION.** Ten candidates (Cockpit, Classic IDE, Mirror, Tri-column, Diptych, Stage, Shell-first, Focus, Duplex, Zen) laid out in `docs/ux/layout-options.html`. Owner must pick one (or a hybrid) — this choice rewrites §4, §8, §11 Stage 1, and §12. **Blocks Stage 1 scaffolding.** |Stage 1 start                                                 |
|Working pane model |**OPEN — OWNER ACTION (dependent on layout choice).** The working pane is polymorphic (browser / file viewer / markdown editor). Decide: (a) single instance with mode toggle vs. tabbed like VS Code, (b) per-terminal-tab state vs. shared across terminals, (c) whether the markdown editor is a local-files surface only or also a Docs edit surface.|Stage 1 start                                                 |
|Skills data sources|CWD scan (SKILL.md, .claude/, CLAUDE.md) + brainstem.cc API                                                                                                  |Stage 4                                                       |
|Starting point     |Greenfield                                                                                                                                                   |—                                                             |
|Agent topology     |Each terminal tab = independent Claude Code session; all tabs share one browser                                                                              |Stage 1                                                       |
|UI aesthetic       |Dark, dense, professional-tool feel (reference: Warp × Linear)                                                                                               |Stage 6                                                       |
|Browser tabs       |Multiple tabs within the single browser pane                                                                                                                 |Stage 2                                                       |

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
│  │  /tmp/duo.sock             │                       │
│  └──────────┬───────────────────┘                       │
│             │ IPC                                        │
└─────────────┼───────────────────────────────────────────┘
              │
     ┌────────▼────────┐
     │   duo CLI     │  ← on PATH, Claude Code calls this
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
- **One Unix socket** at a predictable path (`/tmp/duo.sock` or `~/.duo/sock`) is how the CLI reaches the main process.
- **CDP access** happens inside the main process via Electron’s built-in `webContents.debugger` API — no external Chrome DevTools connection required.

-----

## 9. The `duo` CLI Specification

The CLI is the agent’s API surface. It must be stable, predictable, and output in formats Claude Code can parse naturally.

### Command reference (draft)

|Command                                                |Description                                                                            |Output                      |
|-------------------------------------------------------|---------------------------------------------------------------------------------------|----------------------------|
|`duo navigate <url>`                                 |Navigate the browser to URL                                                            |JSON: `{ok, url, title}`    |
|`duo url`                                            |Current URL                                                                            |plain text                  |
|`duo title`                                          |Current page title                                                                     |plain text                  |
|`duo dom`                                            |Full page HTML (outerHTML)                                                             |HTML to stdout              |
|`duo text`                                           |Visible text content (innerText of body)                                               |plain text                  |
|`duo text --selector <css>`                          |innerText of matching element                                                          |plain text                  |
|`duo ax [--selector <css>] [--format md\|json]`      |Accessibility-tree snapshot. **Required** for canvas-rendered apps (Google Docs, etc.) |Markdown (default) or JSON  |
|`duo click <selector>`                               |Click element by CSS selector                                                          |JSON: `{ok, error?}`        |
|`duo fill <selector> <value>`                        |Fill input (DOM-level `value =` + input events)                                        |JSON: `{ok, error?}`        |
|`duo type <text>`                                    |Synthesize keystrokes into the focused element via CDP `Input.insertText`              |JSON: `{ok, error?}`        |
|`duo key <keyname> [--modifiers cmd,shift,...]`      |Dispatch a single key event (e.g. `Enter`, `ArrowDown`, `Backspace`)                   |JSON: `{ok, error?}`        |
|`duo focus <selector>`                               |Move focus to the matching element (for subsequent `type`/`key`)                       |JSON: `{ok, error?}`        |
|`duo eval <js>`                                      |Execute JS, return result                                                              |JSON-serialized result      |
|`duo screenshot [--out path] [--selector css]`       |PNG screenshot                                                                         |Path to file                |
|`duo console [--since <ts>] [--follow] [--level ...]`|Dump buffered console messages; with `--follow`, stream live                           |NDJSON (one event per line) |
|`duo tabs`                                           |List open browser tabs                                                                 |JSON array                  |
|`duo tab <n>`                                        |Switch to browser tab N                                                                |JSON: `{ok}`                |
|`duo wait <selector> [--timeout ms]`                 |Wait for element                                                                       |JSON: `{ok, error?}`        |
|`duo --version`                                      |Version string (must match skill)                                                      |plain text                  |

### Notes on the read/write primitives

- **`duo ax` is first-class, not a fallback.** Modern web apps increasingly render to `<canvas>` (Google Docs/Sheets/Slides, Figma, newer Notion editors, spreadsheets, whiteboards). For these, `duo text` and `duo dom` return structural chrome without document content. The accessibility tree — which apps expose for screen readers — is the only reliable text path. Implemented via CDP `Accessibility.getFullAXTree` and `Accessibility.getPartialAXTree` (scoped by selector). Default Markdown output mirrors VS Code 1.110's `readPage` approach; JSON mode returns the raw tree for programmatic use. See `docs/research/vscode-1.110-integrated-browser.md`.
- **`duo type` + `duo key` are the edit path for canvas apps.** Canvas editors route input through a hidden `contenteditable` or input element; setting `value` does nothing. We synthesize input via CDP `Input.insertText` (text) and `Input.dispatchKeyEvent` (named keys) against the focused element.
- **`duo console` surfaces what the agent would otherwise miss.** Main process subscribes to CDP `Runtime.consoleAPICalled` + `Log.entryAdded` and maintains a ring buffer per browser tab. Claude Code reaches for this after `duo eval` or page interactions to diagnose failures.

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

## 10. The `duo` Skill (ships with the app)

The skill lives at `~/.claude/skills/duo/SKILL.md` after install. It teaches Claude Code:

1. **When to reach for `duo`** vs. alternatives (WebFetch, file reads)
1. **The command surface** — ref to §9
1. **Common patterns:**
- **Read a Google Doc** → `duo navigate <url>` → `duo wait '[role="document"]'` → `duo ax --selector '[role="document"]'`. Do **not** use `duo text --selector .kix-appview-canvas` — Docs renders to a canvas and the DOM selector yields almost no content. The accessibility tree is the read path. (See §17.)
- **Edit a Google Doc** → focus the editing surface (`duo focus '[role="document"]'` or `duo click '[role="document"]'`) → `duo type "<text>"` and/or `duo key Enter/Backspace/ArrowDown/...`. For structural edits (tables, headings), prefer the Google Docs REST API path documented in §17.
- **Fill and submit a form** → `duo fill`, `duo click`
- **Verify a visual state** → `duo screenshot` → report back to user
- **Diagnose a failing page interaction** → `duo console --since <ts>` to inspect errors/warnings emitted since the last action
- **Iterate on a generated HTML artifact** → write file → `duo navigate file://...` → `duo screenshot`
1. **Error recovery** — when a selector fails, retry with `duo dom` to inspect, or use `duo eval` for custom queries
1. **When NOT to use it** — static fetches (use WebFetch), reading local files (use Read), reading terminal state (not its job)
1. **Pinned version** — skill tests `duo --version` matches its compatible range

The skill is the spec. If it’s painful to write, the CLI surface is wrong.

-----

## 11. Roadmap — Build Stages

> **Open decisions blocking the roadmap** — track these in §7, action belongs to the owner:
>
> 1. **Layout model (blocks Stage 1).** Pick one of the ten candidates in `docs/ux/layout-options.html` (or a hybrid). This determines the window chrome, the sidebars, and where the terminal lives. Stage 1 cannot scaffold the window layout without it.
> 2. **Working pane model (blocks Stage 1).** Working pane is polymorphic (browser / file viewer / markdown editor). Decide tabbed vs. mode-toggle, per-tab state vs. shared, and whether the markdown editor is a local-files surface or also an edit path for Google Docs. Interacts with the layout decision.
>
> Everything below assumes both decisions are made. Until they are, Stage 1 is only safe to advance on scaffolding that is layout-agnostic (Electron app shell, build tooling, one PTY, one browser view — wired up without committing to a window layout).

### Stage 1 — Core shell (Week 1)

- Electron app scaffold with electron-vite + React + Tailwind
- **Window layout per the §7 "Layout model" decision** (see `docs/ux/layout-options.html`). Resizable split; exact geometry determined by the chosen layout option.
- **Working pane shell** per the §7 "Working pane model" decision (tabbed vs. mode-toggle; per-tab vs. shared state). Browser / file viewer / markdown editor modes stubbed even if only one is wired up in Stage 1.
- xterm.js + node-pty: one working terminal
- Tab bar for multiple terminal sessions
- Keyboard shortcuts: new tab, close tab, cycle tabs, focus toggle; plus any hotkeys the chosen layout needs (e.g. drawer toggles for Focus/Stage/Shell-first).
- **Exit criteria:** Geoff can open the app, get multiple terminal tabs, run Claude Code in them.
- **Blocked on:** §7 "Layout model" and "Working pane model" rows. Do not scaffold the window until both are resolved.

### Stage 2 — Browser pane (Week 1–2)

- WebContentsView embedded in right pane
- Browser address bar, back/forward/reload
- Google SSO session persistence (partition → `~/Library/Application Support/duo/browser-session`)
- Multiple browser tabs within the browser pane
- **Exit criteria:** Geoff can log into Google once, reopen the app, still be logged in. Google Docs renders correctly.
- **Google Docs acceptance criteria (required to exit Stage 2):**
  - A.2.1 — Open a Google Doc URL after a cold app launch with a logged-in session; the doc renders fully (no SSO bounce, no `X-Frame-Options` error, no accounts chooser loop).
  - A.2.2 — Typing into the doc directly in the browser pane using the host keyboard produces characters at the cursor and they persist after reload. (Proves the WebContentsView passes keyboard focus through.)
  - A.2.3 — Closing and reopening the app preserves the session — the same Doc reopens without re-authentication.
  - A.2.4 — The user-agent the Electron browser presents to Google does not trip challenge flows (no repeated "unusual activity" interstitials over a 10-minute session).

### Stage 3 — `duo` bridge (Week 2)

- Unix socket server in main process
- CDP wiring: navigate, dom, text, **ax**, click, fill, **type**, **key**, **focus**, eval, screenshot, **console** (core set first; see §9)
- `duo` CLI binary (compiled or Node.js shebang), installed via postinstall or bundled in DMG with a symlink step
- Install script: `/usr/local/bin/duo` symlink
- Console capture: main process subscribes to `Runtime.consoleAPICalled` and `Log.entryAdded` per tab and maintains a per-tab ring buffer (default 500 entries)
- **Exit criteria:** From any terminal tab in the app, `duo text` returns the contents of whatever's in the browser.
- **Google Docs acceptance criteria (required to exit Stage 3):**
  - A.3.1 — **Read round-trip.** With a Google Doc loaded in the browser pane, `duo ax --selector '[role="document"]'` returns the full document text in the same order as it appears on screen, including headings and list structure, within 2s for a 20-page doc.
  - A.3.2 — **Write round-trip.** From a terminal, the sequence `duo focus '[role="document"]'` → `duo key End` → `duo type "Duo smoke test ⟨uuid⟩"` causes the string to appear at the end of the document and to persist after reload.
  - A.3.3 — **Read-after-write.** Re-running `duo ax` after A.3.2 returns text that contains the same `⟨uuid⟩`. (Proves read and write operate on the same live document state.)
  - A.3.4 — **Multi-tab isolation.** With two Claude Code terminal tabs, both can issue `duo ax` / `duo type` against the shared browser without cross-talk (no lost events, no interleaved text at the wrong cursor position when issued sequentially).
  - A.3.5 — **Console visibility.** `duo eval 'console.warn("hello")'` followed by `duo console --since <ts>` returns a row containing `"hello"` with level `warn`.
  - A.3.6 — **No DOM fallback regression.** `duo text --selector '.kix-appview-canvas'` returns an empty or near-empty string on Google Docs — documenting *why* `duo ax` exists. The skill example is explicit about this.

### Stage 4 — Skills context panel (Week 2–3)

- Per-tab CWD watcher (chokidar)
- Scan for `SKILL.md`, `.claude/skills/`, `CLAUDE.md`, MCP config
- Brainstem.cc API integration for personal knowledge context
- Right sidebar or collapsible overlay showing skills scoped to active tab’s CWD
- **Exit criteria:** Switching between tabs changes the sidebar contents to reflect that tab’s project context.

### Stage 5 — `duo` skill (Week 3)

- Author `SKILL.md` per §10
- Worked examples folder alongside the skill: `read-google-doc.md`, `edit-google-doc.md`, `fill-form.md`, `iterate-artifact.md`, `diagnose-console.md`
- Installer drops skill into `~/.claude/skills/duo/`
- Version pinning between CLI and skill
- **Exit criteria:** A fresh Claude Code session in the app autonomously discovers and uses `duo` to read a Google Doc.
- **Google Docs acceptance criteria (required to exit Stage 5 — this is the flagship success test):**
  - A.5.1 — **Unprimed read.** With no prior context, a fresh Claude Code session given the prompt "summarize the doc open in my browser" discovers the `duo` skill, reads via `duo ax`, and returns an accurate summary. No human guidance, no reminder about canvas rendering.
  - A.5.2 — **Unprimed edit.** A fresh session given "add a bullet to the risks section of the doc open in my browser saying '⟨X⟩'" completes the edit autonomously using `duo focus` + `duo key` + `duo type`, and the bullet is visible to the user. The agent verifies with a follow-up `duo ax`.
  - A.5.3 — **Error recovery.** If the agent's first approach fails (e.g. wrong selector, focus lost), the skill's guidance leads it to retry successfully within 3 attempts — no dead end where the agent concludes "it can't be done."
  - A.5.4 — **Honest non-goals.** The skill is explicit that complex structural edits (inserting a table, reformatting a heading block) should prefer the Docs REST API path (§17.5) rather than synthesized keystrokes, and documents when the API path is available.

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
duo/
├── electron/
│   ├── main.ts                  # app bootstrap, window, IPC
│   ├── pty-manager.ts           # node-pty pool, lifecycle
│   ├── browser-manager.ts       # WebContentsView lifecycle, tabs
│   ├── cdp-bridge.ts            # CDP command executor
│   ├── socket-server.ts         # Unix socket → CDP bridge
│   └── skills-scanner.ts        # CWD scanning logic
├── cli/
│   ├── duo.ts                 # CLI tool (ships with app)
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
- **User install:** Drag `Duo.app` to `/Applications`. First launch asks permission to create `/usr/local/bin/duo` symlink (or writes to `~/.local/bin` if non-admin)
- **Skill install:** First launch copies `SKILL.md` to `~/.claude/skills/duo/`. Updates overwrite.
- **Browser profile:** `~/Library/Application Support/duo/browser-session/`
- **Socket path:** `~/Library/Application Support/duo/duo.sock` (sandbox-friendlier than /tmp)
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
|Skill drifts from CLI surface                                                  |Medium  |Version-pin the skill against `duo --version`; add a smoke test that runs each example in CI.                       |
|Apple notarization friction                                                    |Low     |One-time setup cost; standard process.                                                                                |
|Performance: large DOM dumps (e.g. a long Google Doc) blow past terminal buffer|Medium  |`duo text` + `--selector` narrowing; add `duo text --max-chars N`; consider a `--save-to <file>` option.          |
|Canvas-rendered apps (Google Docs/Sheets/Slides, Figma) invisible to DOM reads |High    |First-class `duo ax` accessibility-tree path (§9, §17); skill explicitly steers agents off `duo text` for these.  |
|Google Docs DOM changes break synthesized-input edits                          |Medium  |Target ARIA roles (`[role="document"]`) not class names; skill's error-recovery loop retries with refocus (§17.6); REST API escape hatch for structural edits (§17.4).|
|Docs REST API consent UX interrupts agent flow                                 |Low     |One-time consent; cached in Electron session; skill documents the prompt so the agent surfaces it to the user.        |

-----

## 15. Glossary

- **CDP** — Chrome DevTools Protocol. The wire protocol used to inspect and control Chromium. Electron exposes this via `webContents.debugger`.
- **WebContentsView** — Electron's modern API for embedding a Chromium view inside a BrowserWindow. Replaces the deprecated BrowserView.
- **node-pty** — Node.js bindings for spawning pseudo-terminal processes. Used to run real shells with full terminal semantics.
- **xterm.js** — Browser-side terminal emulator. Renders PTY output into a canvas/DOM terminal.
- **Accessibility tree (AXTree)** — The structured representation of a page that browsers expose to screen readers, reachable via CDP `Accessibility.getFullAXTree`. For canvas-rendered apps like Google Docs, this tree — not the DOM — is where the actual document content lives. See §17 and `docs/research/vscode-1.110-integrated-browser.md`.
- **Kix** — Google Docs' editor engine. Renders the document body to a `<canvas>` element with a hidden contenteditable for input. The reason `duo ax` exists.
- **Brainstem** — Geoff's personal knowledge management system at brainstem.cc, exposed as an MCP server. Relevant for the skills panel's "context" source.
- **Trailblazers** — Geoff's pilot cohort of Capital One PMs getting early Claude Code access.

-----

## 16. Handoff Notes — For the Next Claude Instance

If you are a Claude instance picking this up, here’s what you need to know:

1. **Confirm the working name.** “Duo” was coined by the previous Claude assistant, not by Geoff. Before Stage 5 (skill authoring), ask whether to keep it or rename.
1. **Start with Stage 1.** The owner explicitly said “ship it in stages: core first, polish later.” Do not try to make Stage 1 beautiful — make it functional, with a clean internal structure that won’t need rewriting for Stages 2–4.
1. **Do not re-debate the stack.** The Electron decision is load-bearing and was derived from two hard constraints: Google SSO must work, and the agent must read the DOM. If either constraint ever relaxes, revisit — otherwise, build on Electron.
1. **The CLI is the spec.** Every time a new CLI command is added, update §9 and the skill in `skill/SKILL.md`. The skill is how Claude learns the tool; if it’s missing, the feature effectively doesn’t exist for agent use.
1. **Geoff’s working style.** He’s technical, prefers concrete recommendations over options, appreciates forcing functions and clean seams. He’ll often answer “TBD, recommend” — take that as permission to decide and document, not an invitation to ask again.
1. **The skill-along-with-the-app is not an afterthought.** It is Stage 5 and a first-class deliverable. The app without the skill is 60% of the value. The skill without the app is 0%. Ship both or ship neither.
1. **If blocked on an open question in §7, state the assumption and proceed.** Do not stall waiting for clarification on layout, aesthetics, or naming — these can be resolved in-flight.
1. **Suggested first task:** scaffold the repo per §12, get electron-vite + React + Tailwind running, render a single xterm.js terminal backed by node-pty. One file, one window, one working terminal. Everything else builds from there.
1. **Before touching Stage 2/3/5, read §17 and `docs/research/vscode-1.110-integrated-browser.md`.** Google Docs read/edit is the flagship success test for this project, and the naive DOM approach does not work — canvas rendering requires the accessibility tree for reads and synthesized input (or the Docs REST API) for writes. The acceptance criteria in §11 Stages 2, 3, and 5 are the go/no-go gates.
1. **Do not commit the window layout before the owner picks one.** The ten candidates are in `docs/ux/layout-options.html`; the decision is tracked as OPEN — OWNER ACTION in §7 and blocks Stage 1 scaffolding of the window chrome (see the call-out at the top of §11). Scaffolding that is layout-agnostic (Electron shell, build tooling, PTY, browser view wiring) can proceed in parallel.

-----

## 17. Google Docs First-Class Support

> Google Docs is the flagship target for Duo's agent↔browser bridge (see §2 and §3.1). This section consolidates the design decisions that make read-and-edit work end-to-end. It exists because the obvious approach (DOM scraping) does not work on Google Docs, and the failure mode is silent — a selector returns an empty string, the agent assumes the doc is empty, and the user sees hallucinated summaries. Do not ship without the acceptance criteria in §11 Stages 2/3/5 passing.

### 17.1 The core problem

Google Docs (the "Kix" editor, since ~2021) renders the document body to an HTML `<canvas>` element, not to a live DOM tree. Consequences:

- `document.body.innerText` contains the Docs chrome (menus, toolbars) but almost none of the document text.
- `document.querySelector('.kix-appview-canvas')` returns the canvas element, but `.innerText` on it is empty because canvas has no text children.
- Keyboard input is not captured by visible elements — Docs uses a hidden `contenteditable` element (roughly `.docs-texteventtarget-iframe` descendants) for IME and input handling.

This is the same pattern used by Google Sheets, Google Slides, Figma, and increasingly Notion's newer surfaces. Solving it for Docs unlocks the class.

### 17.2 Read strategy — accessibility tree

Google Docs exposes the full document to screen readers via ARIA. The browser's accessibility tree therefore contains the actual document content with structure (headings, lists, tables). We reach it via CDP:

- `Accessibility.getFullAXTree` — full tree for the current page
- `Accessibility.getPartialAXTree { backendNodeId }` — subtree rooted at a selector (we resolve the selector via `DOM.querySelector` first)

The `duo ax` command (see §9) wraps this and by default renders to Markdown using a small converter in the main process. For a Google Doc, the canonical invocation is:

```bash
duo navigate https://docs.google.com/document/d/<id>/edit
duo wait '[role="document"]'
duo ax --selector '[role="document"]'
```

Output should be stable (paragraph order matches screen order) and fast (< 2s for a 20-page document; see A.3.1).

### 17.3 Edit strategy — synthesized input

For casual edits (appending text, replacing a selection, applying Cmd-B to the current selection), synthesizing keystrokes is sufficient:

1. Focus the document: `duo focus '[role="document"]'` (uses CDP `DOM.focus` on the resolved node; falls back to a click if focus fails).
2. Position the cursor: `duo key End`, `duo key Home`, or use `duo key ArrowDown --modifiers shift` to select.
3. Insert text: `duo type "..."` issues `Input.insertText`, which mimics IME input and is what Docs' hidden event target expects.
4. Named keys for structure: `duo key Enter` (new paragraph), `duo key Tab` (list indent), `duo key Backspace`, and modifier chords like `duo key b --modifiers cmd` (bold).

Synthesized-input edits are the default because they work without any extra OAuth scope beyond what the user's Google login already provides.

### 17.4 Edit strategy — when to escalate to the Docs REST API

Synthesized keystrokes are fragile for structural edits: inserting a table, rewriting a whole heading block, moving content across sections. For those, prefer the Google Docs REST API:

- Endpoint: `https://docs.googleapis.com/v1/documents/{id}:batchUpdate`
- Auth: bootstrap an OAuth access token from the signed-in Electron session (the user already consented at login). Scope: `https://www.googleapis.com/auth/documents`. First call triggers a consent dialog in the browser pane.
- Exposed to agents as `duo docs apply <json-patch>` (future command; not in Stage 3 core). Implementation lives in the main process so the access token never leaves the app.

Skill guidance (§10, A.5.4): prefer synthesized input for simple text edits, escalate to the API for structural changes. The skill's `edit-google-doc.md` example documents both paths.

### 17.5 Security posture

Duo's threat model is a single trusted user on a trusted machine, so unlike VS Code 1.110 (see `docs/research/vscode-1.110-integrated-browser.md`) we do not require per-page "Share with Agent" consent. However:

- The Unix socket is mode `0600` and lives under `~/Library/Application Support/duo/` (user-owned).
- The Docs REST API path requires one-time explicit consent in the browser pane before the first write. The consent is cached in the Electron session, not in the socket bridge.
- A future "paranoid mode" (Stage 6+) could adopt VS Code's per-tab share-with-agent gating. Not in MVP scope.

### 17.6 Failure modes and telemetry

Before Stage 5 declares done, the following failure modes must have explicit handling in the skill:

| Failure                                                           | Detection                                        | Skill guidance                                                                     |
|-------------------------------------------------------------------|--------------------------------------------------|------------------------------------------------------------------------------------|
| Agent uses `duo text` on a Google Doc and gets ~nothing         | Empty/near-empty output on a known-large doc     | Skill teaches: retry with `duo ax`. `text` on `.kix-appview-canvas` is a trap.   |
| Focus is lost between `duo focus` and `duo type`              | Text appears in the wrong element or not at all  | Skill: re-issue `duo focus` immediately before `duo type`; check `duo url`.  |
| Doc opens behind account chooser / SSO bounce                     | `duo ax` returns a Google account-picker tree  | User remediation: log in once in the browser pane. Skill surfaces this clearly.    |
| Docs API consent not yet granted                                  | `duo docs apply` returns `{error: "consent"}`  | Skill: tell user to click through the consent prompt that appeared in the pane.    |
| Long doc + naive full-tree fetch exceeds terminal buffer          | `duo ax` output > N MB                         | Skill: use `--selector` to narrow; use `--format json` and pipe to `jq`.           |

### 17.7 Acceptance criteria summary

The Google Docs experience ships only when **all** of the following pass:

- §11 Stage 2: A.2.1 – A.2.4 (browser + SSO foundation)
- §11 Stage 3: A.3.1 – A.3.6 (CLI read, write, round-trip, multi-tab, console, no-regression)
- §11 Stage 5: A.5.1 – A.5.4 (unprimed read, unprimed edit, error recovery, honest non-goals)

If any criterion is failing at the end of its stage, the stage does not exit. This is the forcing function that keeps the flagship use case real instead of aspirational.
