# Duo distribution strategy — two shapes, one foundation

> **Status:** Draft, 2026-04-30. Supersedes the Phase 7/8 sketch in
> [`build-roadmap.md`](./build-roadmap.md). Lives on the
> `duo-chrome-extension-exploration` branch; promotes to main once
> the exploration's 🟡 phases verify and Stage A merges.

## Decision

Duo ships in **two shapes simultaneously**, both maintained
indefinitely:

1. **Duo Desktop** — the Electron app. Standalone workspace with an
   embedded Chromium pane. Today's `main` branch product. Macros to
   "I want a dedicated AI-paired coding environment, separate from
   my daily browser."
2. **Duo for Chrome** — a Chrome extension that gives the user a
   side-panel + canvas-tab surface inside their everyday Chrome.
   Macros to "I'm browsing in Chrome anyway; let Claude ride along
   and drive things."

These are **complementary products serving different jobs**, not one
product in two skins. The Electron app's primary surface is its
embedded browser pane; the extension's primary surface is the user's
real Chrome. The two share implementation but not session state.

## Architecture — Electron app as the foundation

Every Duo for Chrome user also has Duo Desktop installed. There is
no standalone helper PKG. The Electron app **is** the Native
Messaging host: when Chrome's NM system needs to spawn the host, it
launches `Duo.app --nm-shim`, which runs a thin stdio↔socket proxy
in the same process binary instead of opening a browser window.

```
Chrome extension SW
     │
     ▼ chrome.runtime.connectNative('com.duo.app')
Duo.app --nm-shim   (50-line proxy loop in electron/main.ts)
     │
     ▼ net.connect to ~/Library/Application Support/duo/duo.sock
     │  (or 127.0.0.1:<TCP-port> via duo.port file when sandboxed)
Electron app's socket-server.ts
     │
     ▼ dispatches to core/ services
core/pty/PtyManager · core/files/FilesService · BrowserManager · CdpBridge
```

Why this shape over a separate helper:

- **Single source of truth.** PTY, files, browser ops live in the
  Electron main process via `core/` services. The extension
  borrows the same code path. Bug fixed once, ships to both
  surfaces.
- **Single update channel.** electron-updater (Stage 21c) handles
  the desktop app + the embedded NM shim atomically. The Chrome
  Web Store handles the extension's UI shell. No separate helper
  to version-skew or auto-update.
- **No second installer.** macOS DMG drops Duo.app into
  `/Applications/`; on first launch Duo registers the NM manifest
  pointing at itself. Web Store handles the extension. Two
  one-click installs, neither bundles the other.

The cost: **the extension is dead when Duo Desktop isn't running.**
Mitigated by auto-launching Duo.app via `open -g` from the NM shim
when the extension first connects. Background-mode (menu bar
running with no visible window) is a follow-up if extension usage
warrants always-on.

## Browser surface disambiguation

With both surfaces installed, two browsers are reachable from the
CLI: Duo's embedded Chromium and the user's actual Chrome. Verbs
are **explicit-prefixed** to avoid ambiguity:

| Pattern | Surface |
|---|---|
| `duo nav <url>` | Default = the surface adjacent to the calling terminal. Duo Desktop terminal → embedded Chromium. Extension side-panel terminal → user's Chrome. |
| `duo chrome:nav <url>` | Always the user's Chrome (requires extension installed + connected). |
| `duo embedded:nav <url>` | Always Duo Desktop's embedded pane. |

Default behavior keys off the calling PTY's session origin: PTYs
spawned by the Electron app's renderer carry an env var; PTYs
spawned by the extension's helper carry a different one. The
agent's observed behavior matches the surface they're sitting next
to, with no explicit thinking needed for the common case.

## Install flows

### Universal (Electron only — most users)

```
1. Download Duo Desktop.dmg from the Duo website
2. Drag Duo.app → Applications
3. Launch. First run registers ~/.claude/duo/ skill files +
   Chrome NM manifest (idempotent)
4. Done — terminal + embedded browser, full CLI surface
```

### Universal + extension

```
1. Steps 1-3 above
2. Visit chrome.google.com/webstore — search "Duo for Chrome"
3. Click "Add to Chrome" → grant <all_urls> permission
4. Side panel + canvas-tab surface available immediately
   (auto-launches Duo.app on first NM connect if not running)
```

### Sideload (early adopters / dev)

For users on the `duo-chrome-extension-exploration` branch or the
unlisted Web Store cohort:

```
1. chrome://extensions/ → Developer mode ON
2. Load unpacked → select Duo.app/Contents/Resources/extension/
   (post-Phase-7 the extension ships inside Duo.app for sideload
   convenience; production load comes from Web Store)
```

## Three-artifact release pipeline

| Artifact | What | Who needs it | Update path |
|---|---|---|---|
| `Duo Desktop.dmg` | Signed/notarized macOS app, ~150 MB | All users | electron-updater self-update (Stage 21c) |
| Web Store CRX | Chrome extension, ~500 KB minified | Optional add-on | Web Store auto-update |
| `cli/duo` | Pre-built Node binary tracked in repo | Power users / cohort installers | Bumped via `npm run build:cli`, ships via DMG |

A version bump cuts all artifacts simultaneously when changes touch
shared surface (`core/`, `renderer/components/`, the protocol). Each
artifact can also bump independently for shell-only changes.

## Protocol versioning

The extension's first NM message is a handshake:

```json
{"type": "hello", "protocolVersion": 1, "extensionVersion": "0.6.0"}
```

The Electron app replies:

```json
{
  "type": "hello-ack",
  "ok": true,
  "electronVersion": "0.6.0",
  "supportedProtocols": [1]
}
```

…or, on mismatch:

```json
{
  "type": "hello-ack",
  "ok": false,
  "error": "Duo Desktop must be v0.6.0 or later (you have 0.5.2)",
  "minRequiredVersion": "0.6.0"
}
```

The extension's side panel surfaces the error as a card with a
"Download / update Duo Desktop" link. Bumping `protocolVersion`
forces a coordinated release; both shapes move in lockstep when the
shared surface changes.

## Failure UX

| Condition | Side panel shows |
|---|---|
| Duo Desktop not installed | "Duo Desktop required. [Download Duo Desktop]" |
| Duo Desktop installed but too old | "Duo Desktop must be v0.6+ (you have v0.5). [Update]" |
| Auto-launch failed | "Duo Desktop didn't start. [Try again] / [Open Duo Desktop manually]" |
| NM manifest missing | "Chrome integration not configured. [Reset]" — calls a Help-menu reset flow inside Duo.app |
| Socket reachable but agent verb errored | Inline error in banner, retry available |

No silent timeouts. No "ECONNREFUSED" leaking to the user. Every
failure has a named cause and a recovery action.

## Sustainment model

Three release artifacts, **one codebase**. The shared work that
makes this sustainable:

- **`core/`** services (Stage A): PTY, files, browser-history,
  skills-scanner. Imported by both `electron/main.ts` and
  (transitively, via the NM shim path) by the extension's flows.
- **`renderer/components/`**: editor, file tree, primitives. Used
  by the Electron renderer; bundled into the extension's React
  canvas via esbuild (Phase 4b).
- **`skill/`, `agents/`, `cli/duo`**: dropped into `~/.claude/`
  by the Electron app's first-run install routine. Both shapes
  share the same skill knowledge and CLI surface.

What's *not* shared:

- **Shells.** `electron/` (BrowserWindow, BrowserManager, native
  menus) vs. `extension/` (manifest, sw.js, sidepanel, canvas).
  These will diverge as each platform's affordances evolve. That's
  fine.
- **Session state.** Each shape has its own browser session,
  separate cookies/history/sign-ins. Intentional — the user
  chooses which surface they're routing through.

Maintenance cost vs. today (Electron-only): roughly **+1 packaging
step (Web Store CRX upload) + ongoing extension-specific bug
triage**. Not 2× — the codebase isn't doubled, just the shipping
surface.

## Naming

| Surface | Public name | Internal/code name |
|---|---|---|
| Electron app | "Duo Desktop" | `duo` (existing) |
| Chrome extension | "Duo for Chrome" (Web Store listing) | `duo-extension` (under `extension/` after rename from `phase0/extension/`) |
| The umbrella product | "Duo" | — |

In Chrome's UI ("Add to Chrome", side panel header), the extension
appears as just "Duo". The "for Chrome" qualifier exists only to
disambiguate Web Store search results from Cisco Duo and similar.

## Phase 7 scope (revised)

Replaces the prior single-line "distribution dry-run" with this
concrete sequence:

1. **Refactor helper → NM shim.** Move PTY/files logic out of
   `phase0/helper/duo-helper.js`; helper becomes a thin
   stdio↔socket proxy. (~50 LOC after refactor.)
2. **Wire `Duo.app --nm-shim` mode.** New flag in `electron/main.ts`
   that bypasses `BrowserWindow` and runs the proxy loop instead.
3. **Extend `electron/socket-server.ts`** with the `agent:*` and
   `cli:request` message types the extension sends. Reuse the
   existing dispatcher; add new switch cases.
4. **First-run install routine** in Electron: drops NM manifest at
   `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.duo.app.json`
   pointing at the app binary. Idempotent. Strips xattrs.
5. **Protocol handshake** in both shapes; surface mismatches as the
   side-panel failure card.
6. **Web Store listing prep**: minified CRX (`--minify` on the
   esbuild canvas bundle), icon, screenshots, privacy policy,
   permission justification text for `<all_urls>` and `debugger`.
7. **Unlisted Web Store upload.** $5 dev account, upload, set to
   unlisted. Get private install URL.
8. **Stage 21d Trailblazers cohort.** Cohort installs Duo
   Desktop.dmg + clicks the unlisted Web Store URL. Both surfaces
   dogfooded simultaneously for ≥30 days.

## Phase 8 scope (revised)

End-to-end demo + buffer becomes:

- **Public Web Store promotion.** Move the unlisted listing to
  public after the cohort dogfood window passes with no critical
  bugs and at least one positive signal (sustained engagement,
  enthusiasm, etc.).
- **Marketing alignment.** Update the Duo website / README to
  position both shapes clearly; add the install matrix above to
  the docs.
- **Background-mode menu bar option** (deferred from Phase 7) if
  cohort feedback says always-on is needed.
- **Rename `phase0/` → top-level.** Once production-ready, drop
  the "phase 0 prototype" naming and move to `extension/`,
  `nm-shim/` (or whatever the helper becomes after the refactor).
  Adjust paths, install scripts, and docs accordingly.

## What this strategy is **not**

- **Not "deprecate the Electron app."** The Electron app is the
  foundation. It stays.
- **Not "extension as a lite version of the Electron app."** They
  serve different jobs. The extension is a peer product, not a
  trimmed-down sibling.
- **Not "one installer for both."** Two independent installs (DMG
  + Web Store), each idempotent and complete on its own. The
  shared piece is the codebase, not the artifact.
- **Not a 12-month transition.** No transition. Both ship; both
  stay.

## Open follow-ups

These don't block Phase 7 but should land before the public Web
Store promotion in Phase 8:

- **Cross-platform.** Electron app is macOS-only today. Linux /
  Windows reach is a separate decision tied to the Electron app's
  platform roadmap; the extension follows automatically.
- **Background-mode menu bar.** Defer until cohort feedback says
  always-on is needed.
- **CLI consolidation.** Drop `phase0/cli/duo-ext` after the
  refactor; the unified `cli/duo` handles both transports
  transparently.
- **Stage 21d socket auth.** The Electron app's socket already has
  a per-install token (Stage 20 ADR); the extension's NM channel
  doesn't need it because Chrome enforces the
  `chrome-extension://<id>` origin allowlist in the NM manifest.
  This is correct; documenting for future reference.

## Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-04-30 | Both shapes ship indefinitely | Different jobs-to-be-done; sustainment via shared `core/` codebase, not deduplicated shells |
| 2026-04-30 | Electron app is the NM host (no separate helper PKG) | One install path, one update channel, no PTY/files duplication |
| 2026-04-30 | Auto-launch Duo.app from NM shim | UX simplicity; background-mode is a later add |
| 2026-04-30 | Explicit `chrome:` / `embedded:` verb prefixes; default = adjacent surface | Predictable agent behavior; no implicit-by-context magic |
| 2026-04-30 | Protocol version handshake on extension connect | Lets either shape iterate without coordinated downtime |
| 2026-04-30 | "Duo for Chrome" as Web Store name; "Duo" in Chrome UI | Avoids Cisco Duo collision in Web Store search |
