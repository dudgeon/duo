# Stage W — Duo Web (local web app distro)

> **Status:** R&D / proof-of-concept on `claude/duo-local-webapp-6AsuA`.
> Not yet a numbered roadmap stage; promotion to a stage card depends
> on whether the walking skeleton convinces us the model is worth
> productising. Coexists with the Electron app — does not replace it.

## Why

At enterprise sites where Duo's prospective users live (Capital One is
the motivating case), endpoint-security policy gates auth into Google
Docs / Gmail / Jira / Slack-in-browser / intranet to a
managed-and-approved browser. Duo's Electron app is its own browser
runtime, so users **cannot sign into those services from inside
Duo**. That cuts off the workflows where the agent would be most
valuable.

The bet: if Duo's UI runs *inside* the user's already-approved
browser, the auth problem evaporates. The user opens a tab to
`http://localhost:<duo-port>` and gets the agent + editor + canvas in
one tab; their other tabs still hold their authenticated SaaS
sessions.

## Scope (v1 / proof of concept)

In scope:
- **Local daemon** — Node process owning node-pty, file I/O, command
  bus, plus an HTTP server for the static bundle and a WebSocket for
  the renderer.
- **Browser-served renderer** — terminals on the left
  (xterm.js, multi-tab), editor + canvas + file tree on the right.
  Reuses existing `renderer/` components verbatim where possible.
- **CLI continuity** — the existing `cli/duo` binary, which already
  speaks NDJSON over Unix socket / loopback TCP, talks to the daemon
  unchanged. Verbs that depend on the embedded browser are stubbed
  with a clear "disabled in web mode" error rather than silently
  failing.
- **One target browser:** Chromium-based (Chrome, Edge, Brave). Island
  is the eventual primary target but assessed in a separate doc; v1
  goal is just to confirm Island doesn't break the model.

Out of scope (v1):
- The embedded sub-browser (`WebContentsView` / CDP-driven `duo
  click/type/screenshot`). The whole right-pane "browser tab" type is
  removed for this build. Site automation against authenticated SaaS
  is a future follow-up — see *Phase 2: companion extension* below.
- Auto-update / signed installer. Daemon ships as `npm` artifact + a
  start script for now.
- Cross-tab Duo (multiple browser tabs each connected to the same
  daemon). v1 daemon assumes one renderer client at a time; behaviour
  on a second connection is "kick the first" or "deny" — TBD by
  testing.
- Mobile / Safari support.

## Architecture in one paragraph

A **`duo-web` daemon** (Node, `web/daemon/`) hosts the app. It exposes
three surfaces on `127.0.0.1`: an HTTP server for the static SPA bundle
(`/`), a WebSocket endpoint for the renderer (`/ws/renderer`), and the
existing TCP+token bridge inherited from the Electron app
(`PORT_FILE`-style) so the unmodified `duo` CLI keeps working. PTY
sessions, file I/O, theme state, html-op routing, and CLI command
dispatch all live in the daemon. The **browser-side client**
(`web/client/`) is a Vite-built React app that mounts a slim shell
(`WebApp.tsx`) reusing the existing `TerminalPane`, `MarkdownEditor`,
`CanvasTab`, `FileTree` components. It connects to the daemon over
the renderer WebSocket and exposes a `window.electron` shim so those
existing components don't need to know they're not in Electron.

```
                 Browser tab (Chrome)                       Local daemon (Node)
   ┌─────────────────────────────────────────┐     ┌────────────────────────────────────┐
   │  WebApp.tsx                             │     │  HTTP /          → static bundle   │
   │  ├── TerminalPane (xterm) ──────────┐   │     │  WS   /ws/renderer ◄──────────────┐│
   │  ├── FileTree                       │   │     │  TCP  127.0.0.1:<port> + token   │ │
   │  └── WorkingPane                    │   │     │       (existing duo CLI)         │ │
   │      ├── MarkdownEditor (TipTap)    │   │     │                                  │ │
   │      └── CanvasTab (iframe)         │   │     │  CommandBus                      │ │
   │                                     │   │     │   ├── PtyDriver (node-pty)       │ │
   │  window.electron shim ◄─────────────┴───┴──ws─┤   ├── FilesService (chokidar)    │ │
   │  (request/response + event bus)         │     │   ├── State cache (theme, etc.) │ │
   └─────────────────────────────────────────┘     │   └── RendererBridge (WS push)  │ │
                                                   │                                  │ │
                                  duo CLI ◄────────┘  (NDJSON DuoRequest/Response) ◄─┘ │
                                                                                       │
```

## Build target / coexistence

- Lives under `web/` alongside the existing `electron/` and
  `renderer/` trees.
- Reuses `shared/types.ts`, `cli/duo.ts`, and most of `renderer/` —
  including `TerminalPane`, `MarkdownEditor`, `CanvasTab`, `FileTree`,
  `WorkingTabStrip`, `keyboard/`, `hooks/useTheme`,
  `hooks/useSelectionFormat`.
- Does **not** reuse `App.tsx` (1195 lines, deeply tied to BrowserPane
  / install banners / update checker / cross-pane shortcut routing
  unique to the desktop window). v1 ships a slim
  `web/client/WebApp.tsx` that composes the same children with a
  smaller layout and no banner stack.
- npm scripts:
  - `web:daemon` — `tsx web/daemon/server.ts`
  - `web:client:dev` — `vite -c web/client/vite.config.ts`
  - `web:dev` — runs both concurrently
  - `web:build` — produces `web/dist/{daemon,client}/`
- The Electron app's `dev` / `build` / `dist` scripts are untouched.

## Decisions (D-numbered)

**D1 — Compatibility shim, not abstraction refactor.** v1 ships a
`window.electron` shim in the web client that forwards each method to
the daemon over WebSocket. We do **not** introduce a parallel
`window.duo` API or refactor `renderer/` to talk to a generic bridge.
Trade-off: locks the web client to today's Electron-shaped API. Worth
it for R&D speed; if Duo Web ships, we revisit.

**D2 — Reuse the existing CLI protocol verbatim.** The daemon
publishes the same TCP+token NDJSON surface the Electron app does
(`PORT_FILE` + `DUO_PORT_FILE`). Unmodified `cli/duo` works. Verbs
that depend on the dropped embedded browser
(`navigate/click/type/screenshot/url/title/dom/text/ax/console/errors/network/tabs/tab/close/wait/eval`)
return a `web mode: <verb> requires the embedded browser` error.

**D3 — One renderer connection at a time.** The daemon serves one
authoritative renderer over `/ws/renderer`. A second connection
either kicks the first or is denied (TBD by feel). State (PTY
sessions, theme) lives in the daemon, so a reload reattaches to the
same PTYs.

**D4 — Loopback only, with a launch token.** The HTTP server binds
`127.0.0.1`. The renderer WS handshake requires a token written to
`~/.duo/web-token` (mode 0600); the SPA bootstraps by reading
`/api/bootstrap` (which validates an `Origin` header against the
daemon's own origin) to receive the token, then upgrades. Keeps a
malicious cross-origin tab from driving the daemon.

**D5 — Drop the WebContentsView surface, keep the right pane
polymorphic.** WorkingTabType narrows in the web build to `editor |
html-canvas | image | pdf | unknown` — `browser` is removed at the
type level so no code path can produce one. SessionState restoration
ignores `browserTabs`.

**D6 — File system access via daemon, not File System Access API.**
The daemon has full FS via Node, identical to the Electron build.
Requires the user to trust the daemon process (same boundary as
trusting the Electron app today). FSAA is a future option for a
"daemon-less" build target but adds a per-folder permission UX that
we don't want in v1.

**D7 — No PATH shim / DUO_SOCKET injection in PTYs (v1).** The
Electron build prepends `~/.claude/duo/bin` to spawned PTYs and sets
`DUO_SESSION` / `DUO_SOCKET`. Duo Web inherits all of those env vars —
the daemon is its own SHIM-installer in production, but for the R&D
build we just rely on the user's existing install (if any) plus
`DUO_PORT_FILE` pointing at the web daemon's port file.

**D8 — Island browser support is a separate exploration.** Island
ships a Chromium-based browser with policy-enforced
isolation/extension restrictions. v1 of Duo Web targets stock
Chromium; Island compatibility lives in
`web/notes/island-compat.md` and gets validated empirically once we
have an Island test seat.

## Phase 2 candidates (not in this branch)

- **Companion browser extension** to restore `duo click/type/screenshot`
  against the user's *real* authenticated tabs. This is the killer
  feature that the v1 architecture deliberately drops; an extension
  is the only way back without going through cross-origin iframe
  policy.
- **Daemon-less mode** using File System Access API + an in-page
  WebSocket-server-in-extension transport.
- **Multi-renderer support** (open Duo in two tabs, share state) —
  needs a real conflict-resolution model for editor saves.
- **PWA / "Add to home screen" packaging** for nicer launch UX.

## Open questions (carried into the implementation)

| Question | Notes |
|---|---|
| Does enterprise IT actually allow a localhost daemon process? | Will need to ask Capital One IT directly. The localhost-only binding + per-launch token is the security story. |
| Do we ship the daemon as a signed `.pkg` / `.dmg` / `npx`? | Distribution decision, deferred to a real Stage W. |
| What's the auth boundary if someone installs Duo Web but Duo Desktop is also running? | Two daemons, two port files, two sockets — coexist by accident, but the CLI picks `DUO_PORT_FILE` from env. Keep an eye on it during dogfooding. |
| Does the SocketServer's CDP-dependent verbs need a softer failure mode than "error"? | Maybe. Currently they throw. We could return `{ ok: false, mode: 'web', reason: '...' }` if it helps the agent recover. |

## What this branch ships

A minimal but real walking skeleton that proves:

1. The daemon can host a PTY end-to-end and a browser xterm sees a
   live shell.
2. The daemon serves the file tree + opens markdown files in the
   reused TipTap editor; saves write back to disk.
3. The HTML canvas works including `duo html *` ops.
4. The unmodified `cli/duo` binary, pointed at the daemon's port
   file, dispatches commands that hit the renderer over WS and
   resolve.
5. The `WebApp.tsx` shell is small enough that we know what we'd
   touch to harden it for distribution.

Once 1–5 land we decide whether to promote this to a real numbered
stage.
