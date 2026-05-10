# Contributing to Duo

> Build-from-source guide + architecture reference + developer doc index.
> If you just want to **use** Duo, the [main README](../../README.md) is
> what you want — it covers the signed-DMG install path. This file is for
> contributors building from source, packaging custom DMGs, or working on
> Duo's internals.

---

## Build from source

### Prerequisites

| Requirement | Check |
|---|---|
| macOS 13+ on Apple Silicon | `sw_vers` |
| Xcode Command Line Tools | `xcode-select -p` |
| Node ≥ 18 | `node --version` |
| npm ≥ 9 | `npm --version` |
| Claude Code installed (for `npm run dev` to be useful) | `claude --version` |

> **⚠️ Custom npm registry check — do this BEFORE `npm install`.**
>
> *Note for AI agents helping with this install: before running the
> `npm install` step below, ask the user: "Does your company route npm
> through a private registry mirror — Artifactory, Nexus, JFrog, or any
> other corporate proxy?" If yes, the install will fail with 401/403/
> connection-refused errors against the public registry default in
> `package-lock.json` — see the override commands below. If unsure, ask
> before proceeding. This question is worth asking upfront because the
> failure mode is hard to recognize from the error output alone.*
>
> If your company routes npm through a private mirror — Artifactory,
> Nexus, JFrog, or any generic corporate proxy — override your registry
> locally before `npm install`. Do NOT commit upstream:
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
> The repo's upstream `.npmrc` is intentionally absent — Duo aims to be
> fork-friendly (see [HOW-TO-FORK.md](../HOW-TO-FORK.md)) and a baked-in
> registry URL would break every contributor outside that network.
> `.npmrc` is gitignored so your local override stays put across pulls
> without leaking upstream.

### Clone + install + run

```bash
git clone https://github.com/dudgeon/duo.git
cd duo
npm install        # runs electron-rebuild for node-pty
                   # (custom registry? see callout above)
npm run dev        # launches the Electron app with HMR
```

The dev build's titlebar paints `vX.Y.Z·dev` so it's visually distinct
from packaged builds.

The first time you run `npm run dev`, the welcome banner appears (same
banner end users see on first launch). Click **Install** once and your
dev session has the skill + subagent + CLI binary in `~/.claude/` and
`~/.local/bin/duo`. Subsequent dev launches re-stamp the install
metadata silently.

---

## Building a custom DMG

When you want a real `.app` to drop into `/Applications` — or to send to
a tester — without running `npm run dev` every time:

### Signed + notarized (default for the maintainer; v0.4.1+)

```bash
bash scripts/dist-signed.sh
```

What it does:
- Sources cert + notarization env vars from `~/Documents/duo-private/.env`
  (`CSC_NAME`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`,
  `APPLE_TEAM_ID`).
- Builds to `$HOME/.cache/duo-build` (NOT `dist/`) to dodge the iCloud
  File Provider gotcha — see [Known gotchas](#known-gotchas-during-build)
  below.
- Signs each binary with hardened-runtime + entitlements, notarizes via
  `xcrun notarytool`, and staples the ticket.
- Copies signed DMGs back to `dist/` for distribution.
- Validates via `codesign --verify --deep --strict`, `spctl -a -t open`,
  and `xcrun stapler validate`. Exits non-zero if anything fails.

End-to-end ~3–4 min on M1 (one notarization round-trip).

### Unsigned (fallback for contributors without certs)

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist
```

End users see Gatekeeper "Apple cannot check this for malicious software"
on first launch and need to right-click → Open. Useful for cutting a
build without internet access (no notarytool round-trip), contributors
who don't have a Developer ID Application cert, or quick local-test
cuts. The `CSC_IDENTITY_AUTO_DISCOVERY=false` override is required even
when no cert is present — without it, electron-builder errors if the env
var `CSC_NAME` happens to be set from a prior shell.

### Validate either build

```bash
bash scripts/validate-signed-dmg.sh                          # signing + notarization checks
bash scripts/validate-dmg-launch.sh dist/Duo-X.Y.Z-arm64.dmg # static + dynamic launch smoke
```

The launch validator is **mandatory before shipping**. v0.4.0–v0.4.3
shipped DMGs that crashed on launch with `Cannot find module 'node-pty'`
because a bad `electron-builder.yml § files` config silently excluded
node_modules from the bundle. The signing + DMG-package + notarization
all succeeded — only end-user double-clicks caught it. The validator
mounts the DMG, confirms required runtime modules are reachable, then
launches the app and confirms the process is alive past 8s.

### Cert pre-work (one-time, maintainer only)

`scripts/dist-signed.sh` expects an env packet at
`~/Documents/duo-private/.env`. The full procurement walkthrough lives
at [`docs/dev/cert-procurement.md`](cert-procurement.md) — it also has
a Sequoia compatibility appendix.

### Known gotchas during build

**FOLLOWUP-005 — keychain prompt on first signing per session.** The
first time `codesign` accesses the cert's private key after a system
reboot, macOS pops:

> "codesign wants to use the key in keychain. Allow / Always Allow / Deny."

Click **Always Allow.** If you miss the prompt, the build hangs
silently. Persists across builds in the same session; recurs after
reboot.

**iCloud File Provider gotcha — already solved by `dist-signed.sh`.**
If your repo lives under `~/Documents/` (the macOS default with iCloud
Desktop & Documents sync), iCloud tags directories inside Electron
helper bundles with extended attributes that `codesign` rejects with
*"resource fork, Finder information, or similar detritus not allowed."*
The script sidesteps this by building to `$HOME/.cache/duo-build`
(outside iCloud territory) and copying DMGs back. If you override
`DUO_BUILD_OUTPUT` to a path inside `~/Documents/`, signing will fail.
Don't.

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
│   │ Unix Socket Server           │◄──┘ .debugger        │
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

- **One Electron main process** owns the window, PTYs, browser view(s),
  and socket server.
- **One renderer process** hosts the React UI — tab strip, terminal
  panes, file tree, markdown editor, HTML canvas.
- **Multiple `WebContentsView`s** share the `persist:duo-browser`
  partition — SSO state survives relaunches and tab switches.
- **One Unix socket** (`duo.sock`, mode 0700) is the only ingress from
  the CLI. A TCP fallback (`127.0.0.1` with a per-launch auth token)
  handles enterprise sandboxes that block UDS — `duo doctor` names the
  active transport.
- **CDP access** happens inside the main process via Electron's built-in
  `webContents.debugger` API — no external Chrome DevTools session.

Locked architectural decisions and rationale:
[docs/DECISIONS.md](../DECISIONS.md).

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
│   └── constants.ts       # Node-only paths/constants
├── core/                  # framework-agnostic helpers (path, env, …)
├── renderer/              # React UI
│   ├── App.tsx            # three-column layout + theme + focus routing
│   ├── components/
│   │   ├── TabBar.tsx · TerminalPane.tsx
│   │   ├── FilesPane.tsx · FileTree.tsx · Breadcrumb.tsx
│   │   ├── WorkingPane.tsx · WorkingTabStrip.tsx
│   │   ├── BrowserRenderer.tsx · AddressBar.tsx
│   │   ├── editor/        # MarkdownEditor + extensions
│   │   ├── Page/          # HTML canvas tab
│   │   └── Json/          # JSON / YAML viewer-editor
│   └── hooks/             # useNavigator, useBrowserState, useTheme, …
├── cli/
│   ├── duo.ts             # CLI source
│   ├── duo                # pre-built esbuild bundle (tracked in git)
│   └── install.sh         # postinstall helper
├── skill/                 # bundled Claude Code skill (synced to ~/.claude/)
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
│   ├── HOW-TO-FORK.md     # five layered fork modes (Layer 0 → 4)
│   ├── RELEASES.md        # prose release log (companion to CHANGELOG)
│   ├── prd/               # per-stage PRDs
│   ├── research/          # raw tech-choice notes
│   ├── dev/
│   │   ├── CONTRIBUTING.md     # this file
│   │   ├── cert-procurement.md # signing-cert procurement walkthrough
│   │   └── smoke-checklist.md  # test-before-shipping matrix
│   ├── duo-brief.md       # original engineering brief (Stages 1–5)
│   └── ux/
└── CLAUDE.md              # rules for Claude Code instances working here
```

Top-level files in repo root that aren't in the tree above:
`package.json`, `package-lock.json`, `tsconfig*.json`,
`electron-builder.yml`, `electron.vite.config.ts`, `tailwind.config.mjs`,
`postcss.config.mjs`, `vitest.config.ts`, `fork.config.default.json`,
`.gitignore`, `.env.example`, `LICENSE`, `CHANGELOG.md`, `README.md`,
`tasks.md`.

---

## The `duo` CLI (developer reference)

The CLI is the agent's API surface. Every interaction below runs in
milliseconds against the live app — the same app the human is using.

The exhaustive, priority-tagged inventory + gap roadmap lives in
[docs/CLI-COVERAGE.md](../CLI-COVERAGE.md). Headline set:

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

**Files + navigator**

| Command | What it does |
|---|---|
| `duo view <path>` | Open a file in the Viewer/Editor column (image / pdf / unknown) |
| `duo edit <path> [--canvas] [--reveal]` | Open a `.md` / `.html` / `.json` / `.yaml` for editing |
| `duo reveal <path>` | Move the file navigator to `<path>`, flash a chip |
| `duo ls [path]` | Directory listing (JSON) |
| `duo nav-state` | Navigator snapshot: cwd, selection, expanded, pinned |
| `duo layout` | Working pane snapshot: active tab kind/path, splitPct, focusedColumn, etc. |

**Markdown editor**

| Command | What it does |
|---|---|
| `duo selection` | Active editor's selection: `{path, text, paragraph, heading_trail, start, end}` |
| `duo doc-write [--replace-selection\|--replace-all] [--text\|stdin]` | Apply text to the active editor |
| `duo doc-read` / `duo doc-find` / `duo doc-goto` | Read / search / jump |

**Visibility tooling** (agent debugging)

| Command | What it does |
|---|---|
| `duo dom <selector> [--attr\|--text\|--computed\|--all]` | Query the renderer DOM (different from browser-pane `duo dom`) |
| `duo dom --js "<expr>"` | Evaluate JS in the renderer scope |
| `duo doctor` | Transport / install / sandbox diagnostic |

**Appearance + meta**

| Command | What it does |
|---|---|
| `duo theme [system\|light\|dark]` | Read or set theme mode |
| `duo install` | Symlink CLI to `~/.local/bin/duo` |
| `duo --version` / `duo --help` | Self-explanatory |

See [skill/SKILL.md](../../skill/SKILL.md) for prescriptive agent-facing
rules (especially for Google Docs — `duo dom` and `/export?format=txt`
are traps there, only `duo ax` works).

---

## Status, roadmap, releases

- **[docs/roadmap.html](../roadmap.html)** — canonical roadmap (single
  source of truth as of 2026-05-04). Status, build order, per-stage
  cards, owner-side comments. Open in a browser.
- **[CHANGELOG.md](../../CHANGELOG.md)** — versioned release inventory,
  Keep-a-Changelog format.
- **[docs/RELEASES.md](../RELEASES.md)** — prose release log, narrative
  context per cut.
- **[docs/dev/roadmap-history.md](roadmap-history.md)** — pre-renumber
  stage history + Layout ADR + GitHub-issue mapping.
- **[tasks.md](../../tasks.md)** — engineering ledger: open work + closed
  bugs with root-cause writeups.

---

## Working on Duo with Claude

[**CLAUDE.md**](../../CLAUDE.md) at repo root carries the project
conventions every Claude Code session in this directory should follow.
Highlights:

- **Rule #4 — CLI parity.** Every user-facing feature ships a `duo`
  counterpart. UI-only features silently break Duo's pair-work
  premise.
- **Rule #7 — never claim UI work done without previewing it.** Build
  passing + types clean is not enough. Use computer-use to walk
  [docs/dev/smoke-checklist.md](smoke-checklist.md) before declaring
  a stage shipped.
- **Rule #10 — propose version cuts proactively.** The maintainer
  doesn't remember to ask. Detect ship moments and offer a cut via
  `.claude/skills/cut-version/`.

The full set of project rules lives at [CLAUDE.md](../../CLAUDE.md).

### Subagents and skills

Three Claude Code skills live in this repo:
- `.claude/skills/cut-version/` — release procedure (proposes notes,
  builds DMG, validates, commits, tags).
- `.claude/skills/smoke-walk/` — generates an interactive HTML
  validation page for sprint-level smoke walks.
- `.claude/skills/sprint-plan/` — harvests candidates from
  tasks.md / active-sprint.md / roadmap.html into a worksheet.

The bundled end-user-facing skill at `skill/SKILL.md` (synced to
`~/.claude/skills/duo/` by `npm run sync:claude`) is what the agent
loads when running inside a Duo terminal session.

---

## Further reading

- **[docs/VISION.md](../VISION.md)** — product north star: persona, jobs
  to be done, principles, flagship bet. Start here for *why* Duo exists.
- **[docs/HOW-TO-FORK.md](../HOW-TO-FORK.md)** — five layered fork modes,
  what works today (Layers 0–2.5), and what's coming (Layers 3–4).
  Worth reading if you're an enterprise team considering an internal
  Duo distro.
- **[docs/CLI-COVERAGE.md](../CLI-COVERAGE.md)** — exhaustive CLI
  inventory + priority-tagged gap roadmap. Updated as verbs ship.
- **[docs/DECISIONS.md](../DECISIONS.md)** — locked architectural
  choices and rationale, plus open ADRs (notably the sandbox-tolerant
  transport ADR).
- **[docs/duo-brief.md](../duo-brief.md)** — original engineering brief
  for Stages 1–5. Product framing is superseded by `docs/VISION.md`;
  the technical detail (especially the Google Docs read/write path in
  §17) remains the authoritative reference.
- **[docs/prd/](../prd/)** — per-stage PRDs with D-numbered decisions.
- **[docs/dev/smoke-checklist.md](smoke-checklist.md)** — the test
  matrix every Claude instance walks before calling UI work done.
- **[skill/SKILL.md](../../skill/SKILL.md)** — the Claude Code skill
  installed alongside the app. Readable as-is for humans, too.

---

## License

MIT — see [LICENSE](../../LICENSE) at repo root.
