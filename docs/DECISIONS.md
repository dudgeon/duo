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
