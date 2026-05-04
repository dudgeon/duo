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
  tab strip for browser tabs, markdown-editor tabs, HTML canvases, and
  file previews. Each side is collapsible; the canvas can split into
  two files side-by-side ("Split View", v0.6.4).
- **Terminal tabs** (xterm.js + node-pty) with reader typography
  ("cozy mode", Stage 9), pin / reorder / drag-to-rearrange, and
  pane-aware ⌃Tab cycling.
- **Real Chromium browser pane** (Electron `WebContentsView`) with
  **persistent Google SSO** — sign in once, stay signed in across
  relaunches. URL-bar autocomplete from history (v0.5.1+); ⌘F
  find-in-page (v0.5.4+).
- **Rich markdown editor** (Stage 11): Google-Docs-like typography,
  TipTap/ProseMirror under the hood, GFM + task lists + tables + syntax-
  highlighted code. YAML frontmatter preserved. Autosave + `⌘S`.
  Find-in-document (v0.5.3+); toggleable line numbers (v0.6.3+).
- **HTML canvas** (Stage 17): edit raw HTML with the same toolbar +
  markdown shortcuts as the editor; `<pre>` blocks auto-get a Copy
  button; comment-rail annotations; per-file edit-mode toggle.
- **Lesson packs** (Stage 28, v0.6.0+): single-canvas FTUX tutorials
  and multi-canvas curricula that ship as defaults; "Start lesson"
  buttons spawn a Claude session pre-loaded with a guide skill.
- **Light / dark / system theme** with macOS appearance follow.
- **macOS Finder integration** (v0.6.4): Duo registers as an Open With
  candidate for `.md` and `.html` files; double-clicking from Finder
  routes through the same smart-open path as the in-app navigator.
- **Auto-update + session restore** (v0.4.2+): updates land via
  GitHub Releases; on relaunch the terminal tabs, browser tabs, file
  tabs, and Split View state come back where you left them.
- A `duo` **CLI** on your PATH. Any terminal process — including
  Claude Code running inside a Duo tab — can call it. Under the hood
  it's a Unix socket at `~/Library/Application Support/duo/duo.sock`
  (mode 0700) with a TCP fallback for sandboxed environments. See
  [docs/CLI-COVERAGE.md](docs/CLI-COVERAGE.md).
- Bundled **`duo` Claude Code skill** + **`duo` subagent** (Haiku 4.5) so
  a fresh Claude Code session launched inside a Duo terminal
  auto-discovers them and can drive the browser + editor without priming.
  The subagent owns multi-step CLI orchestration so the parent
  Sonnet/Opus session keeps a clean context.
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
| Claude Code installed | `claude --version` ([install](https://docs.claude.com/claude-code)) |

### Install Duo (recommended — download the latest DMG)

The fastest path: grab the latest **signed + notarized** DMG from
[**GitHub Releases**](https://github.com/dudgeon/duo/releases/latest)
and drop the `Duo.app` it mounts into `/Applications`. Pick the
`-arm64` build for Apple Silicon and the unsuffixed build for Intel.

For the latest signed + notarized DMG, browse
[**GitHub Releases**](https://github.com/dudgeon/duo/releases/latest)
and pick the asset that matches your CPU (`-arm64` for Apple Silicon
Macs, the unsuffixed build for Intel). Direct-download URLs are
versioned per cut, so the canonical link to the latest is the
Releases page itself.

> **No Gatekeeper warning** since v0.4.1 — the DMGs are signed with
> Apple Developer ID and notarized, so first launch is a clean
> double-click. (Pre-v0.4.1 builds were unsigned and required a
> right-click → Open workaround; that's gone.)

The first launch shows the install banner described in
[Install the `duo` CLI and skill](#install-the-duo-cli-and-skill);
clicking Install once is the rest of the setup.

### Build from source (dev)

| Extra requirement | Check |
|---|---|
| Xcode Command Line Tools | `xcode-select -p` |
| Node ≥ 18 | `node --version` |
| npm ≥ 9 | `npm --version` |

> **⚠️ Custom npm registry check — do this BEFORE `npm install`.**
>
> *Note for AI agents helping with this install: before running the
> `npm install` step below, ask the user: "Does your company route
> npm through a private registry mirror — Artifactory, Nexus, JFrog,
> or any other corporate proxy?" If yes, the install will fail with
> 401/403/connection-refused errors against the public registry
> default in `package-lock.json` — see the override commands below.
> If unsure, ask before proceeding. This question is worth asking
> upfront because the failure mode is hard to recognize from the
> error output alone.*
>
> If your company routes npm through a private mirror — Artifactory,
> Nexus, JFrog, or any generic corporate proxy — override your
> registry locally before `npm install`. Do NOT commit upstream:
>
> ```bash
> # Option A — per-command override
> npm install --registry=https://your-internal.example.com/npm/
>
> # Option B — persistent local config (.npmrc is gitignored)
> echo "registry=https://your-internal.example.com/npm/" > .npmrc
> npm install
> ```
>
> The repo's upstream `.npmrc` is intentionally absent — Duo aims to
> be fork-friendly (see [docs/HOW-TO-FORK.md](docs/HOW-TO-FORK.md))
> and a baked-in registry URL would break every contributor outside
> that network. `.npmrc` is gitignored so your local override stays
> put across pulls without leaking upstream.

```bash
git clone https://github.com/dudgeon/duo.git
cd duo
npm install        # runs electron-rebuild for node-pty
                   # (custom registry? see callout above)
npm run dev        # launches the Electron app
```

### Install the `duo` CLI and skill

**One click.** When Duo first launches you'll see a welcome banner at the
top of the window:

> **Welcome to Duo.** Install the skill + subagent + help files into
> `~/.claude/` and the `duo` CLI to `~/.local/bin`. Your existing files
> won't be touched. **[Install]** [Skip for now]

Click **Install**. This copies the skill / subagent / help files into
`~/.claude/`, copies `cli/duo` to `~/.local/bin/duo`, and writes a
provenance file at `~/.claude/duo/installed.json`. Idempotent — re-running
on an upgrade overwrites everything and re-stamps the version.

If `~/.local/bin` isn't on your `$PATH` (default on macOS zsh is no), the
banner will stay visible with a one-liner to add to your shell rc:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Verify:

```bash
duo help                     # lists every verb (any terminal, after PATH update)
```

> **Note for devs.** The same banner appears in `npm run dev` because the
> install service runs the same code path regardless of `app.isPackaged`.
> Click Install once on a fresh dev machine and you won't see it again
> until the version bumps.

### Build a custom DMG to share

When you want a real `.app` to drop into `/Applications` (or send to
a tester) without running `npm run dev` every time:

```bash
# Signed + notarized — DEFAULT for the owner (v0.4.1+)
bash scripts/dist-signed.sh
# (sources cert env from ~/Documents/duo-private/.env, builds + signs +
#  notarizes both archs, copies signed DMGs back to dist/, validates
#  via codesign + spctl + xcrun stapler. ~5–8 min on M1.)

# Unsigned — fallback for contributors without certs
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist
# (end users see Gatekeeper "Apple cannot check this" on first launch
#  and need right-click → Open. Useful for quick local-test cuts.)

# Validate either build
bash scripts/validate-signed-dmg.sh
```

Output:

```
dist/
├── Duo-X.Y.Z-arm64.dmg          # Apple Silicon
└── Duo-X.Y.Z.dmg                # x64
```

Open the DMG, drag `Duo.app` to `/Applications`, double-click to launch.

**Cert pre-work (one-time, owner only).** `scripts/dist-signed.sh`
expects an env packet at `~/Documents/duo-private/.env` containing
`CSC_NAME`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`,
`APPLE_TEAM_ID`. The full procurement walkthrough lives at
[`docs/dev/cert-procurement.md`](docs/dev/cert-procurement.md) — it
also has a Sequoia compatibility appendix covering the iCloud File
Provider gotcha and the FOLLOWUP-005 keychain prompt.

**FOLLOWUP-005 — keychain prompt on first signing per session.**
The first time `codesign` accesses the cert's private key after a
system reboot, macOS pops:

> "codesign wants to use the key in keychain. Allow / Always Allow / Deny."

Click **Always Allow.** If you miss the prompt, the build hangs
silently. Persists across builds in the same session; recurs after
reboot.

**iCloud File Provider gotcha — already solved by `dist-signed.sh`.**
If your repo lives under `~/Documents/` (the macOS default with
iCloud Desktop & Documents sync), iCloud tags directories inside
Electron helper bundles with attrs that `codesign` rejects with
*"resource fork, Finder information, or similar detritus not
allowed."* The script sidesteps this by building to
`$HOME/.cache/duo-build` (outside iCloud territory) and copying DMGs
back. If you override `DUO_BUILD_OUTPUT` to a path inside
`~/Documents/`, signing will fail. Don't.

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
│   └── duo.md
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
└── CLAUDE.md              # guidance for AI working on the project
```

---

## Status

Full stage-by-stage tracking lives in
**[docs/roadmap.html](docs/roadmap.html)** — the canonical roadmap
with status, layered build order, per-stage cards, and owner-side
comments. Versioned releases are tracked in
**[CHANGELOG.md](CHANGELOG.md)** with prose context in
**[docs/RELEASES.md](docs/RELEASES.md)**. Pre-renumber stage history
+ Layout ADR + GitHub-issue mapping live at
**[docs/dev/roadmap-history.md](docs/dev/roadmap-history.md)**.

Most recent release: see the top of [CHANGELOG.md](CHANGELOG.md). The
release headlines worth pulling forward in this README:

- **Foundation shipped** — Stages 1–3, 5 (+ 5 v2), 8, 9 (cozy mode).
- **Editor surfaces shipped** — Stage 11 (markdown editor), Stage 17 (HTML canvas with comments rail), Stage 12 (Atelier visual identity).
- **Agent ergonomics shipped** — `duo` CLI + skill + Haiku 4.5 subagent (Stage 5/5 v2), Send → Duo selection pill (Stage 15.1/15.2), `duo events --follow` event bus (Stage 27, v0.6.0+).
- **First-launch + workspace polish shipped** — Stage 18 (welcome banner installs skill / subagent / CLI binary + priming shim + SessionStart hook into `~/.claude/`), Stage 24 (pin WorkingPane tabs).
- **Duo-aware Claude shipped (v0.3.0)** — Stage 19b passive priming via PATH shim + hook; Stage 23 canvas actions (`data-duo-action` Claude↔HTML loop); preventative kb-shortcut architecture.
- **Context pedagogy shipped (v0.4.0)** — Stage 22 navigator dual-pane ("Your Claude settings" + "Project Claude context"); GitHub Releases auto-update banner; Stage 25 post-redirect chrome banner with off-host blocklist; Edit-menu "Paste and Match Style".
- **Sandbox resilience shipped (v0.4.1)** — Stage 20's TCP fallback transport (some enterprise sandboxes block Unix-domain sockets; CLI falls through to `127.0.0.1` with a per-launch auth token), `duo doctor` diagnostic that names the failure mode, sandbox-writable install path (`~/.claude/bin/duo`).
- **Signed + notarized DMG shipped (v0.4.1, Stage 21a)** — first launch is a clean double-click; Gatekeeper accepts as Notarized Developer ID. Toolchain in `scripts/dist-signed.sh` (env-driven, iCloud-aware, builds outside `~/Documents/` to dodge File Provider xattrs that block codesign).
- **Auto-update + session continuity shipped (v0.4.2 / v0.5.1)** — Stage 21c Phase 1+2 (electron-updater + session restore: terminal tabs, browser tabs, file tabs, navigator path); Phase 3 browser-history persistence with URL-bar autocomplete (closes [issue #27](https://github.com/dudgeon/duo/issues/27)).
- **Fork-friendly architecture shipped (v0.5.0, Stage 21e)** — build-time fork config + Vite runtime injection + provenance-aware install. See [docs/HOW-TO-FORK.md](docs/HOW-TO-FORK.md) for the five layered fork modes.
- **Canvas authoring + lesson packs shipped (v0.6.0)** — Stage 27 canvas action vocabulary (`data-duo-action` Claude↔HTML verbs), Stage 28 first-launch lesson packs (single-canvas + multi-canvas curricula), `duo events --follow` streaming.
- **Native menus + workspace polish shipped (v0.6.3 work, ships in v0.6.4)** — ENH-050 native NSMenu / system sheet dialogs (retires the WCV-mute pattern), ENH-040/066 collapse-pane buttons + vertical rails, ENH-042 tab reorder via drag-and-drop, ENH-069 toggleable line numbers, BUG-067 smart `duo open` routing.
- **Split View shipped (v0.6.4)** — the canvas (right pane) can host two files side-by-side. Open via `duo split-view open <path>`, the right-click "Move/Open in Split View" entries on tabs/FileTree/PinnedNav, the `⌘\` chord, or per-page `<meta name="duo-path-target" content="split">` opt-in. Persists across launch (paths + activeIndex + splitPct).
- **Vitest regression-test framework shipped (v0.6.4)** — first 100+ tests covering BUG-061 markdown-trigger regex, fileClassifier extension routing, cycleNext, pathFromFileUrl, expandTilde, and `matchEnterTrigger` / `matchBlockTrigger` pure helpers. Run via `npm run test` (watch) or `npm run test:run`.
- **Coming next** — Phase 3c-iv browser-in-aux (BrowserManager bounds tracking for two WebContentsViews; v0.6.5), MISSING-001 markdown editor CommentRail binding (Stage 14a), ENH-080 `⌘⇧A` open-tab search palette, ENH-052 mechanical canvas → page rename, the `claude-code-basics` curriculum-template refactor.

---

## Further reading

- **[docs/VISION.md](docs/VISION.md)** — product north star: persona, jobs
  to be done, principles, flagship bet. Start here for *why* Duo exists.
- **[docs/HOW-TO-FORK.md](docs/HOW-TO-FORK.md)** — five layered fork modes,
  what works today (Layer 0 = use as-is, Layer 1 = per-user
  customization), what's coming via Stage 21e (Layer 2 = drop-in org
  pack, Layer 3 = build-time partial fork, Layer 4 = build-time full
  fork), and what's hard-coded today vs. what becomes configurable.
  Worth reading if you're an enterprise team considering an internal
  Duo distro.
- **[docs/CLI-COVERAGE.md](docs/CLI-COVERAGE.md)** — exhaustive CLI
  inventory + priority-tagged gap roadmap. Updated as verbs ship.
- **[docs/roadmap.html](docs/roadmap.html)** — current status, per
  stage, plus the unscheduled backlog. Canonical roadmap (single
  source of truth as of 2026-05-04).
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
