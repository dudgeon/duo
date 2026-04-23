# Duo — Architecture Decisions

> All decisions in §6 of the brief are LOCKED. This document adds rationale,
> implementation notes, and records any decisions made during build.

---

## LOCKED decisions (from brief §6)

### App framework: Electron

**Choice:** Electron 32+ (targets Chromium 128+)

**Why locked:** The two hard constraints are (1) Google SSO must work and
(2) the agent must read the DOM. Only Electron provides real Chromium with
Node.js IPC access in the same process. All alternatives fail on one constraint:

| Alternative | Failure mode |
|---|---|
| Tauri | Uses WebKit (no Google SSO) |
| CEF (standalone) | No Node.js IPC; C++ bridge needed |
| Swift + WKWebView | WebKit, not Chromium |
| Electron + remote CDP | External Chrome instance; auth state not shared |

**Implementation note:** Pin Electron version in `package.json`. Electron minor
updates are safe; major updates (Chromium bump) require testing Google SSO.

---

### Terminal renderer: xterm.js + node-pty

**Choice:** `@xterm/xterm` ^5.5 + `node-pty` ^1.0

**Why locked:** VS Code's stack. Battle-tested, full ANSI/mouse, multi-instance
trivial (one `Terminal` object per tab), `FitAddon` handles resize.

**Implementation notes:**
- `node-pty` is a native module; must be in `asarUnpack` in `electron-builder.yml`
- Requires `electron-rebuild` after `npm install` (in `postinstall` script)
- Use `@xterm/xterm` (new scoped package, v5.5+), not the old `xterm` package

---

### Browser embedding: WebContentsView

**Choice:** `WebContentsView` (Electron 28+)

**Why locked:** Direct replacement for the deprecated `BrowserView`. Full
Chromium, same session for SSO persistence across navigation. The view is
owned by the main process and positioned behind the renderer window.

**Implementation notes:**
- The renderer has no direct access to the WebContentsView — it's a main-process
  construct. The renderer sends bounds via IPC; the main process repositions the view.
- Session partition: `persist:duo-browser` → survives app restart
- The view should be created once and repositioned, not recreated on tab switch

---

### Agent ↔ browser bridge: Unix socket + CLI

**Choice:** `duo` CLI over `~/Library/Application Support/duo/duo.sock`

**Why locked:** User explicitly rejected MCP. CLI tool on PATH is the most
Claude-Code-native pattern — the agent calls it like any shell command. No
protocol overhead, no schema negotiation, no extra install step.

**Implementation notes:**
- Protocol: JSON line-delimited (request/response matched by UUID)
- Socket path: in `~/Library/Application Support/duo/` (sandbox-safe vs `/tmp`)
- Security: for MVP, any local process can send commands. Before wider distribution,
  add a launch-time auth token written to `~/.duo/token` and validated on each connection.
- Error contract: non-zero exit on failure, human-readable stderr, JSON result on stdout

---

### UI framework: React + Tailwind

**Choice:** React 18 + Tailwind 3 + electron-vite

**Why locked:** Standard Electron renderer stack. Fast iteration, Tailwind's
utility classes avoid CSS-in-JS overhead, electron-vite gives HMR in dev.

**Implementation notes:**
- Tailwind config: custom color palette (`surface.*`, `border.*`, `accent.*`) in
  `tailwind.config.js` for consistent dark theme
- Font: system-ui for UI chrome; JetBrains Mono (with fallbacks) for terminals
- No CSS-in-JS; all styling via Tailwind utilities + `globals.css` for xterm overrides

---

### Build tooling: electron-vite + electron-builder

**Choice:** `electron-vite` ^2.3 + `electron-builder` ^24.13

**Why locked:** electron-vite provides HMR for all three Electron contexts
(main, preload, renderer) in a single `npm run dev`. electron-builder handles
universal macOS DMG + code signing in one config file.

**Implementation notes:**
- Custom source directories (`electron/`, `renderer/`) configured via
  `rollupOptions.input` in `electron.vite.config.ts`
- Output: `out/` (development + production builds), `dist/` (DMG artifacts)
- `asar: true` with `asarUnpack: ["**/node_modules/node-pty/**"]` — node-pty's
  native `.node` file cannot be asar-packed

---

### Target OS: macOS only

**Choice:** macOS (arm64 + x64 universal binary)

**Why locked:** Linux/Windows deferred. Universal binary covers Apple Silicon
and Intel; no separate downloads.

---

## Decisions made during build

### Socket path: `~/Library/Application Support/duo/` not `/tmp`

**Decision date:** Stage 1 scaffold  
**Rationale:** `/tmp` is cleaned on reboot and is not sandbox-safe on macOS.
`~/Library/Application Support/duo/` is the conventional macOS app data location
and persists across reboots. Consistent with `BROWSER_SESSION_PATH`.

---

### PTY sessions keyed by tab ID (UUID)

**Decision date:** Stage 1 scaffold  
**Rationale:** Tab IDs are `crypto.randomUUID()`. Using them as PTY session keys
makes IPC channel names deterministic (`pty:data:<uuid>`) and avoids a separate
session registry.

---

### Terminal instances always mounted, hidden by CSS

**Decision date:** Stage 1 scaffold  
**Rationale:** Unmounting a terminal on tab switch would kill the PTY session and
lose scroll buffer. Instead, `TerminalInstance` components remain mounted but
set `display: none` when inactive. `FitAddon.fit()` is called via `requestAnimationFrame`
when a tab becomes visible to handle deferred layout.

---

### App name: "Duo" — confirmed by owner

**Status:** Confirmed  
**Decision:** The app is named "Duo". The CLI is `duo`. The skill installs to
`~/.claude/skills/duo/`. No further confirmation needed.

---

### Layout model + working-pane model — resolved by owner

**Status:** Confirmed 2026-04-23  
**Supersedes:** the "Layout model" and "Working pane model" rows in
`duo-brief.md §7` (both previously marked OPEN — OWNER ACTION), and the
ten-option mockup at `docs/ux/layout-options.html`, which is now
historical.

**Decision — three-column layout:**

```
┌────┐┌─────────────────┐┌─────────────────┐
│    ││                 ││ Viewer/Editor   │
│Files││    Terminal    ││ (polymorphic:   │
│    ││                 ││  browser / .md  │
│    ││                 ││  editor / file  │
│    ││                 ││  preview)       │
│    ││                 ││                 │
│    │└─────────────────┘│                 │
│    │┌─────────────────┐│                 │
│    ││  Agent tools    ││                 │
│    ││  (collapsible,  ││                 │
│    ││   Stage 12)     ││                 │
└────┘└─────────────────┘└─────────────────┘
```

- **Files** (left, full-height, narrow) — file browser / context
  drawer. Stage 10.
- **Middle column** — stacked vertically:
  - **Terminal** (top, primary) — PTY session(s) where the agent lives.
  - **Agent tools** (bottom, collapsible, optional) — unified skill +
    connector surface. Stage 12. Collapsed state gives the terminal
    the full middle column.
- **Viewer/Editor** (right, full-height, wide) — single polymorphic
  surface. Shows one thing at a time:
    - Browser (current behavior, with its own in-mode tab strip).
    - Markdown editor for `.md` files (Stage 11).
    - File preview for non-`.md` types (images, PDF, CSV — Stage 10
      per-type registry).

**Working-pane model — resolved sub-decisions:**

- **Single slot, not tabbed** for v1 (keeps the old Stage 7
  commitment: component API stable so a later tabbed wrapper can
  multiplex without rewriting callers).
- **Shared across terminal tabs**, not per-tab. The viewer/editor is
  one surface the user looks at; switching terminals does not change
  what's on the right.
- **Markdown editor scope: local `.md` files only.** Google Docs
  stays in the browser mode of the viewer (via the verified
  `/export?format=md` read and the `duo` write primitives). The
  Stage 11 editor does not edit live Docs.

**Implementation implications:**

- Today's layout — terminal-left, browser-right, no Files column — is
  a waypoint. The reshape happens as part of Stage 10 (which adds the
  Files column) and Stage 11 (which adds the .md editor mode to the
  Viewer/Editor column).
- The current `BrowserPane` becomes the "browser mode" of the
  Viewer/Editor polymorphic shell — one of several modes. Browser
  tabs stay; they're in-mode chrome.
- The terminal moves from the left column to the middle column at
  reshape time. The xterm.js / node-pty plumbing is unaffected.
- Agent tools panel (middle-bottom) is deferred to Stage 12 but the
  layout shell must reserve space for it (or cleanly collapse when
  absent).

---

## Open ADRs (pending decision)

### Skill scoping — global install vs. Duo-session-only

**Status:** 🟡 Open / Undecided  
**Raised:** 2026-04-23  
**Needed before:** Stage 5 ships (skill install step)

**Question:** Should the `duo` skill be installed globally to
`~/.claude/skills/duo/` (current plan per brief §6), or scoped so it only
appears inside Claude Code sessions that Duo itself spawned?

**Why it matters:**
- The skill teaches Claude how to call `duo <command>` to drive Duo's
  embedded browser. It's meaningless outside Duo.
- We want to add stronger anti-improvisation guidance ("don't reach for
  `osascript` / Playwright / system-Chrome CDP when `duo` is available") —
  that guidance is irrelevant, and potentially confusing, in non-Duo
  sessions (Terminal.app, VS Code terminals, CI, etc.).
- A global install pollutes every Claude session on the machine with
  Duo-specific context.

**Options under consideration:**

1. **Keep global install at `~/.claude/skills/duo/`** (current plan)
   - Pro: Zero extra plumbing; `duo --version` failing is the implicit
     "not in Duo" signal.
   - Con: Pollutes all sessions; can't safely add Duo-specific guardrails
     without them leaking elsewhere.

2. **Per-session via shell init + `claude --plugin-dir` wrapper**
   - `PtyManager.create` spawns zsh with a Duo-owned `ZDOTDIR` pointing
     at a generated `.zshrc` that (a) sources the user's real `~/.zshrc`
     and (b) defines a `claude()` function forwarding `--plugin-dir
     <duo-bundled-skill-dir>` into every invocation. Bash gets equivalent
     treatment via `--rcfile` / `BASH_ENV`.
   - Pro: Cleanly scoped to Duo PTYs; invisible outside Duo;
     CWD-independent; doesn't touch `~/.claude/`.
   - Con: Skill becomes a plugin (namespaced as `/duo:<name>`); one more
     layer of shell init that can break; users who invoke `/usr/local/bin/claude`
     directly bypass the wrapper.

3. **Per-session via `claude --add-dir <duo-bundled-skill-parent>`**
   - Same shell-init wrapper, but uses `--add-dir` so Claude
     auto-discovers `.claude/skills/duo/` inside the bundled path without
     plugin namespacing.
   - Pro: Same scoping win as option 2, without the `/duo:` prefix on
     every skill name.
   - Con: `--add-dir` also grants filesystem access to the bundled path
     (fine — it's ours). Same shell-init fragility as option 2.

4. **Project-level `.claude/skills/duo/` only**
   - Symlink the skill into the PTY's launch CWD.
   - Pro: No shell-init hop.
   - Con: Evaporates when the user `cd`s away from launch CWD;
     unreliable as the *only* mechanism.

**Interference with user's existing skills:**
- Options 2 / 3 / 4 are purely additive — `~/.claude/skills/` keeps
  loading normally.
- Plugin namespacing (option 2) means no name collisions.
- The `ZDOTDIR` hop *must* source the user's real `.zshrc` or it will
  nuke their aliases / PATH / prompt.

**Related change if we pick 2/3/4:** Drop the global install step from
Stage 5's first-launch flow — skill no longer lives under `~/.claude/`.

**Decision owner:** Geoff.

---

### Sandbox-tolerant transport and install paths for the `duo` CLI

**Status:** 🟡 Open / Proposed
**Raised:** 2026-04-23
**Needed before:** Stage 14 (distribution). Skill-docs portion is cheap
and can land before the flagship pair; transport + install changes land
with polish.

**Problem statement.** Claude Code runs each Bash tool invocation inside
a macOS Seatbelt-based sandbox. Enterprise deployments (e.g. Capital
One) have this enabled by default. The sandbox:

- **Blocks filesystem writes outside the current working directory.**
  Reads outside cwd are generally allowed.
- **Gates Unix-domain-socket outbound connections behind explicit
  `allowUnixSockets: true`.** The default disallows them; the Claude
  Code docs warn that `allowUnixSockets` "can inadvertently grant
  access to powerful system services" (e.g. the Docker socket), so
  enterprise admins tend to leave it off.
- **Permits localhost TCP by default.** The network filter is
  domain/proxy-based, not a blanket loopback block. `127.0.0.1` and
  `::1` are reachable.
- **Is inherited by all child processes** spawned from a sandboxed
  Bash call. Detaching / unref'ing doesn't escape it.

Duo's entire agent-side bridge runs on a single Unix domain socket at
`~/Library/Application Support/duo/duo.sock`. Every `duo` CLI command
opens a fresh `net.createConnection(SOCKET_PATH)`. In a sandboxed
Claude Code session this means **every** `duo` call fails — and it
fails silently enough that Claude sees one failed Bash call, keeps
following the skill's instructions, and the user is left debugging
without any signal pointing at the sandbox as the culprit.

This is the same shape of problem that hit `pasky/chrome-cdp-skill`:
page-level CDP operations broke under Claude Code's sandbox while
list/window operations (which happen to be plain HTTP GETs against
`localhost:9222/json/list`) still worked. The
`dudgeon/chrome-cdp-skill` fork's fix is a per-tab detached daemon
listening on `127.0.0.1:<random-port>` with an NDJSON + auth-token
protocol — localhost TCP passes the sandbox's network filter. See
that repo's `skills/chrome-cdp/scripts/cdp.mjs` lines 555–679 for the
reference implementation (TCP listener, token file, CLI reconnect).

**Impact inventory** (2026-04-23 audit of current tree):

| Operation | File:line | Sandbox verdict |
|---|---|---|
| Every `duo` command (navigate, url, title, dom, text, ax, click, fill, focus, type, key, eval, screenshot, console, tabs, tab, close, wait, open) | `cli/duo.ts:29` — `net.createConnection(SOCKET_PATH)` | ❌ **All fail** — Unix socket blocked without explicit opt-in |
| `fs.existsSync(SOCKET_PATH)` pre-connect check | `cli/duo.ts:24` | ✅ Reads outside cwd allowed |
| `duo install` symlink creation | `cli/duo.ts:266–272` — `/usr/local/bin/duo`, falls back to `~/.local/bin/duo` | ❌ Both paths write outside cwd |
| `duo screenshot --out <path>` | `cli/duo.ts:195` | ⚠️ Only if `<path>` resolves outside cwd |
| `duo open <relative/path>` resolution | `cli/duo.ts:237–257` | ✅ Pure reads; only the socket hop matters |
| First-launch installer → `~/.claude/skills/duo/` | `scripts/postinstall.ts` | ✅ `~/.claude/` is writable per docs |
| Skill discovery scanning `~/.claude/skills/` | `electron/skills-scanner.ts` | ✅ Runs in unsandboxed Electron main process |

The Electron side (socket creation, chmod, bind, listen in
`electron/socket-server.ts`) is unaffected: the user's Electron app
runs outside the Claude Code sandbox. The failure surface is entirely
on the CLI side — what `claude` shells out to from inside a Duo
terminal.

A note on the existing "Decisions made during build → Socket path:
`~/Library/Application Support/duo/` not `/tmp`" entry above: that
choice is still correct (persistence across reboots, macOS convention)
but the "sandbox-safe" framing overstated the case. The path is
*read-reachable* from inside the Claude Code sandbox, but the **Unix
socket connection itself is not** on default policy. This ADR
clarifies and supersedes that framing.

**Proposed direction.**

1. **TCP fallback alongside the Unix socket.** In
   `electron/socket-server.ts`, additionally
   `server.listen(0, '127.0.0.1')` (ephemeral port; Electron owns
   both listeners). Write the chosen port and a per-install auth
   token to `~/Library/Application Support/duo/duo.port` — a small
   JSON file the sandboxed CLI can *read* (reads outside cwd are
   allowed). In `cli/duo.ts`, try the Unix socket first; on `EPERM`
   / `ECONNREFUSED` / connect timeout, read the port file and
   reconnect over TCP, sending the token as the first NDJSON line
   of the handshake. Keeps the fast path, heals sandboxed runs
   transparently. ~100 LoC change; mirrors the chrome-cdp-skill
   pattern.

2. **`duo doctor` diagnostic.** A new CLI verb that reports, in
   order: Electron app reachable via Unix socket? via TCP
   fallback? install path writable? `~/.claude/skills/duo/` present
   and current? `duo --version` vs. Electron app version? Prints a
   clear "Claude Code sandbox detected (Unix socket blocked) —
   falling back to TCP" line when the fallback kicks in. The skill
   instructs the agent to run `duo doctor` on the first failed
   command so the sandbox failure mode is named, not inferred.

3. **Sandbox-safe install path.** Change `duo install` to prefer
   `~/.claude/bin/duo` (the `~/.claude/` tree is writable under
   Claude Code's sandbox), fall back to `~/.local/bin/duo`, and
   only touch `/usr/local/bin/duo` on explicit opt-in. Emit a
   one-line `export PATH=…` fragment for the user's rc after a
   successful install.

4. **Ship a recommended Claude Code settings fragment.** In
   `skill/SKILL.md`, add a "Troubleshooting → Claude Code sandbox"
   section with a copy-pasteable `.claude/settings.json` allowlist
   (socket path read-allowed + `allowUnixSockets: true`) for teams
   who prefer the Unix-socket fast path. The CLI's TCP fallback
   means nobody *needs* this, but it documents the minimum
   allowlist for sandbox-conscious reviewers.

5. **Last-resort escape hatch.** `dangerouslyDisableSandbox` is
   surfaced as a Bash tool parameter in some Claude Code builds but
   disabled outright in managed enterprise settings
   (`allowUnsandboxedCommands: false`). We mention it in the skill's
   troubleshooting section as a manual option, do not rely on it.

**Rejected alternatives.**

- **File-based IPC (request/response files in cwd).** Would work
  under the sandbox's cwd-scoped writes, but the Electron app does
  not know which PTY CWDs to watch, and each Duo tab has an
  independent launch CWD. Adds state explosion for no win over TCP.
- **Named pipes / FIFOs.** Same sandbox class as Unix sockets; no
  advantage.
- **Daemon-per-tab like chrome-cdp-skill.** Duo already owns one
  long-lived Electron process; per-tab daemons solve a problem
  (Chrome "Allow debugging" modal) that doesn't exist here.
- **Ship the CLI as a native-compiled binary with a different
  sandbox surface.** Doesn't change Seatbelt's behavior — the
  sandbox wraps the process, not the binary.

**Cross-references into the roadmap:**
- **Stage 5 (skill + subagent authoring, ✅ shipped)** picks up a
  new doc item: "Troubleshooting → Claude Code sandbox" section in
  `skill/SKILL.md` + `agents/duo-browser.md`. Cheap, can land
  immediately.
- **Stage 13 (interaction polish, ⬜)** picks up the TCP fallback
  and `duo doctor` work items.
- **Stage 14 (polish & distribution, ⬜)** picks up the install-path
  cleanup and the bundled settings fragment.

**Decision owner:** Geoff.
