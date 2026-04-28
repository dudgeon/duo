# Duo Web — local web app distro (R&D)

Walking-skeleton exploration of running Duo as a local web app served
inside the user's regular browser, instead of as the Electron desktop
app. Lives alongside the Electron build; doesn't replace it.

**Why:** at sites where SSO + endpoint-security policy gate auth into
Google Docs / Gmail / Jira / Slack-in-browser to a managed,
approved browser, the Electron build can't hold those sessions. Putting
Duo's UI inside the approved browser makes the auth problem disappear
— at the cost of dropping the embedded sub-browser surface (CDP-driven
`duo click/type/screenshot` against arbitrary sites). v1 of this build
is "Duo without the browser tab"; restoring browser automation is a
Phase 2 question (likely a companion extension).

See `docs/prd/stage-web-distro.md` for the full design + decision log.

## Status

R&D / proof of concept on branch `claude/duo-local-webapp-6AsuA`. Not
yet a numbered roadmap stage. What works today:

- ✅ Daemon boots, serves HTTP + WS + the CLI's TCP bridge
- ✅ `duo doctor`, `duo theme`, `duo nav state`, `duo selection-format`
  end-to-end against the daemon (no Electron app needed)
- ✅ `duo ls /path` end-to-end (uses the daemon's FilesService directly)
- ✅ PTY round-trip: WS auth → spawn shell → stream output → kill
- ✅ `window.electron` shim covers the full ElectronAPI surface
- ✅ Slim `WebApp.tsx` shell wires up TerminalPane + FileTree +
  MarkdownEditor + CanvasTab against the shim
- ✅ `vite build` produces a working static bundle
- ✅ Daemon serves that bundle from `/`
- ✅ TypeScript clean across all four configs

What's not yet validated end-to-end (because R&D is still on Linux
and the user is on macOS — these are next-session work):

- ⏳ Live browser session: open `http://localhost:<port>`, type into
  xterm, double-click a file, edit it
- ⏳ `duo edit ~/notes.md` from a terminal driving the renderer's
  working pane via the nav:edit channel
- ⏳ `duo doc-write` / `duo html-op` reqId round-trips
- ⏳ Native trash (currently best-effort `fs.unlink` — see
  `web/daemon/src/files-service.ts § trash`)

## Run it (dev)

```bash
# 1. Install deps + rebuild node-pty for system Node (if it was
#    rebuilt for Electron previously, you'll need to do this again
#    in a fresh checkout; both ABIs can't coexist in one node_modules).
npm install
npm rebuild node-pty

# 2. Start daemon + Vite dev server concurrently. Daemon proxies
#    /, /assets/*, etc. to Vite's :5173 in dev so HMR works through
#    the same origin as the WS upgrade.
npm run web:dev
```

Then open the URL the daemon prints (e.g. `http://127.0.0.1:8765`).

## Run it (production-ish)

```bash
# 1. Build the static bundle.
npm run web:build

# 2. Boot the daemon. It'll serve web/client-dist/ from /.
npm run web:daemon
```

To use the CLI against the daemon:

```bash
# Tell cli/duo to find the daemon via the web port file.
export DUO_PORT_FILE=$HOME/.duo/web.port
duo doctor      # confirms transport
duo ls $HOME    # works without a renderer
duo edit foo.md # forwards to the connected browser tab
```

## What's where

```
web/
├── README.md              ← this file
├── shared/
│   └── protocol.ts        ← WireMessage type (auth/request/response/event)
├── daemon/
│   ├── tsconfig.json
│   └── src/
│       ├── server.ts          ← entry: HTTP + WS + CLI TCP
│       ├── constants.ts       ← STATE_DIR, PORT_FILE, defaults
│       ├── pty-driver.ts      ← node-pty wrapper, abstract Sink
│       ├── files-service.ts   ← chokidar + fs (port of electron/)
│       ├── state-cache.ts     ← in-mem theme/nav/selection cache
│       ├── renderer-bridge.ts ← WS handle + reqId/reply pairing
│       ├── command-bus.ts     ← single dispatcher for renderer + CLI
│       ├── ws-transport.ts    ← attach-renderer-socket glue
│       └── cli-bridge.ts      ← legacy NDJSON+token TCP for cli/duo
├── client/
│   ├── index.html
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx           ← bootstrap → connect → mount
│       ├── electron-shim.ts   ← window.electron over WS
│       └── WebApp.tsx         ← slim shell using existing components
└── notes/
    └── island-compat.md       ← Island browser compatibility plan
```

## Architecture in one paragraph

A **`duo-web` daemon** (Node, `web/daemon/`) hosts the app. It exposes
three surfaces on `127.0.0.1`: HTTP for the SPA bundle and a
`/api/bootstrap` endpoint, a WebSocket for the renderer
(`/ws/renderer`) with token auth, and a legacy NDJSON+token TCP
endpoint for the unmodified `cli/duo` binary. PTY sessions, file I/O,
state cache, html-op routing, and CLI command dispatch all live in the
daemon. The browser-side client is a Vite-built React app that mounts
a slim `WebApp.tsx` shell reusing the existing `TerminalPane`,
`MarkdownEditor`, `CanvasTab`, and `FileTree` components verbatim. It
exposes a `window.electron` shim that translates each Electron IPC
method into a wire request/event, so renderer code doesn't know it's
not running in Electron.

```
                 Browser tab (Chrome)                       Local daemon (Node)
   ┌─────────────────────────────────────────┐     ┌────────────────────────────────────┐
   │  WebApp.tsx                             │     │  HTTP /            → static bundle │
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

## CLI verbs in web mode

| Status | Verbs |
|---|---|
| ✅ Works (no renderer needed) | `ping`, `doctor`, `ls`, `theme` (read), `selection-format` (read), `nav-state`, `external`, `file rename/trash`, `nav pin/unpin/list`, `html-new` |
| ✅ Works (renderer connected) | `view`, `edit`, `reveal`, `selection`, `doc-read`, `doc-write`, `html-op`, `html-comment`, `html-comments`, `theme` (set), `selection-format` (set), `send`, `new-tab` |
| ❌ Disabled in web mode | `navigate`, `open`, `url`, `title`, `dom`, `text`, `ax`, `click`, `fill`, `focus`, `type`, `key`, `eval`, `screenshot`, `console`, `errors`, `network`, `tabs`, `tab`, `close`, `wait` (require the embedded browser, which v1 drops) |

Disabled verbs return a clear error rather than hanging or silently
failing: `web mode: '<verb>' requires the embedded browser (not
available in duo-web v1)`.

## Known gotchas

- **node-pty native module ABI:** `npm install` runs `electron-rebuild`
  which compiles node-pty for Electron's ABI. The web daemon needs the
  same module compiled for the system Node ABI. If you switch back and
  forth, run `npm run postinstall` (Electron) or `npm rebuild node-pty`
  (system Node) accordingly. Future work: stand up two `node_modules`
  trees, or pin a separate `node-pty` install for the daemon.

- **Single renderer at a time (D3):** the daemon assumes one connected
  browser tab. Opening a second tab to the same URL will (currently)
  override the first; PTY data routes to whichever ws is "current".
  Hardening this is Phase 2.

- **No native trash on Linux:** `electron.shell.trashItem` doesn't
  exist outside Electron. The web FilesService falls back to
  `fs.unlink` / `fs.rm`. Real distribution should ship a native
  recovery path.

- **Loopback only:** the HTTP server binds 127.0.0.1. Don't try to
  reach the daemon from another device on the LAN — even with the
  token, exposing PTY-spawn over the wire is a non-starter.

## Phase 2 candidates

- **Companion browser extension** to restore `duo
  click/type/screenshot` against the user's *real* authenticated tabs.
  This is the killer feature v1 deliberately drops.
- **Multi-renderer support** — open Duo in two tabs sharing daemon
  state. Needs a real conflict-resolution model for editor saves.
- **Daemon-less mode** using File System Access API + an in-page
  WebSocket-server-in-extension transport.
- **Distribution** — signed daemon installer (`.pkg` / `.dmg`) +
  `npx duo-web` ergonomics. Stage-21-style notarization story.

## Island browser

See `web/notes/island-compat.md`. Short version: Island is Chromium so
the platform code should work, but extension policy and CSP changes
need empirical validation. We can't test from this branch.
