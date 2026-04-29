# Changelog

All notable user-visible changes to Duo. Format follows [Keep a
Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html): pre-1.0
releases ship Duo as not-yet-stable; 1.0 ships with code-signed +
notarized distribution (Stage 21).

> **For the why behind each release** — design context, constraints,
> what almost-shipped — see [`docs/RELEASES.md`](docs/RELEASES.md).
> This file is the entry-level one-liner inventory; RELEASES is the
> prose log.
>
> **Cut process** — release notes are drafted by the `cut-version`
> skill (`.claude/skills/cut-version.md`) and proposed to the owner
> as a litmus test before anything bumps. If the proposed notes
> aren't substantive enough to feel like a release, the cut waits
> and the draft accumulates in `[Unreleased]`.

## [Unreleased]

## [0.5.2] — 2026-04-29

Bug-smashing sprint. Six PRs in one day closing longstanding canvas/install papercuts, plus one small new capability (preset pane sizes via menu + CLI).

### Added
- **ENH-014 — Preset pane sizes.** View → Pane size submenu (Even, Terminal heavy, Canvas heavy, Full terminal, Full canvas) with accelerators ⌘⌥1/⌘⌥2/⌘⌥3/⌘⌥0/⌘⌥9. CLI parity: `duo split <pct|preset>` (clamps 20–80; presets `even` / `terminal-heavy` / `canvas-heavy` / `terminal` / `canvas`). ⌘⌥ instead of bare ⌘ because ⌘1–⌘9 stayed bound to `jumpTerminalTab`.
- **ENH-017 — "Add to PATH" button in the install banner.** When `~/.local/bin/duo` lands but the dir isn't on the user's external-shell PATH, the success banner now offers a one-click action that appends a fenced PATH block to `~/.zshrc` / `~/.bash_profile` / `~/.config/fish/config.fish`. Idempotent (re-runs detect the fence). Replaces the v0.4.5 "passive hint" approach that was dropped as too confusing.

### Fixed
- **BUG-031 — Split-divider drag now follows the cursor over canvas iframes.** A transparent overlay (`fixed inset-0 z-50 cursor-col-resize`) mounts during drag so mousemove keeps reaching the parent window listener instead of being trapped inside the canvas iframe's contentDocument. Same pattern VS Code / Figma use for resize handles over rich content. Browser-pane (WebContentsView) is out of scope — z-index can't push DOM above an Electron native view.
- **BUG-032 — Canvas iframe no longer steals focus from the terminal mid-typing.** `RenderedCanvas` accepts a `shouldStealFocus` prop (read through a ref), gated on `focusedColumn === 'working'`. BUG-022's "first keystroke after canvas open lands as content" ergonomic still fires when you open the canvas with intent; iframe re-mounts (srcdoc changes, HMR, post-doc-write reloads) under terminal focus no longer yank the cursor.
- **BUG-033 v1 — Autosave paused while a pending agent-write banner is up.** Both markdown editor and HTML canvas now block their autosave timers when `pendingWrite` / `pendingHtmlOp` is non-null. Closes the race where a queued autosave would fire mid-banner and write a stale snapshot. Markdown's replace-all banner copy also sharpened: now reads "Replace the whole document (your unsaved edits will be lost)". v2 (OT-style merge for replace-selection on dirty buffer) deferred to Stage 16.
- **BUG-034 — Canvas onboarding overlay no longer occludes populated content.** The "TYPE / SOON / SOON / SOON" card was mounting on every canvas open, dismissing only on first mutation (which never fires on read-only viewing). Disabled entirely; module preserved with a TODO for the Stage 17a.5 rebuild that will gate it on `isJustBoilerplate(doc)` at install time.
- **BUG-035 — False-positive "Couldn't find Claude Code on this Mac" banner.** Resolver now walks well-known install dirs (`~/.local/bin`, `~/.npm-global/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, `~/.volta/bin`, `~/.bun/bin`, `~/bin`) + `process.env.PATH` with `fs.access(..., X_OK)` BEFORE attempting any shell. Shell fallback timeout 5s → 15s; flag-sets reordered fastest-first. Verified ~6500x speedup on the affected machine (5236ms shell timeout → 0.8ms fast-path hit).

### Deferred
- **ENH-015** (collapse-button discoverability) and **ENH-016** (FileTree new-file/folder context menu) — backlog for v0.5.3.
- **BUG-033 v2** (OT-style merge for replace-selection on dirty buffer; per-section locks) — folds into Stage 16 external-write reconciliation.
- **Browser-pane (WebContentsView) drag coverage** for BUG-031 — needs IPC-driven `setBounds` suppression during drag; file when users hit it.

## [0.5.1] — 2026-04-28

Polish + the gating you asked for. Closes the known-issue list from v0.5.0, ships the editor-polish punch list deferred from v0.4.3, and lands strict claude-presence gating on the Send → Duo pill.

### Added
- **Stage 21c Phase 3 — Browser history persistence (closes [issue #27](https://github.com/dudgeon/duo/issues/27)).** Address bar grows a native `<datalist>` autocomplete from persisted history (`~/.claude/duo/browser-history.json`). Recorded on every `did-navigate` / `page-title-updated`. Ranked by `visitCount / (1 + ageHours)` — Wilson-style proxy favoring recent + repeated visits. Skip-list keeps `about:blank`, `chrome:`, `devtools:`, and `~/.claude/duo/help/` out of suggestions.
- **ENH-006 — Split-button new affordance on the WorkingPane tab strip.** `+` (file, primary) | `>` (new browser tab, secondary). Mirrors the terminal pane's Stage 19c split. Replaces the prior ⌥-click muscle memory with a discrete affordance visible at rest.
- **ENH-005 — Copy button on every code block** (markdown editor + HTML canvas). Hover-to-reveal top-right of each `<pre>`. Markdown editor uses ProseMirror node + widget decorations (survives the contentEditable reconciliation that reverts naive DOM mutations); canvas uses a runtime injection that the serializer strips on save.
- **ENH-013 — Send → Duo pill gated on live Claude.** New main-process `ClaudePresenceProbe` polls the active terminal's PTY child-process tree every 500ms; the pill renders only when a `claude` descendant exists (or in a 1.5s grace window after a `kind:'claude'` tab spawn). Strict mode (option a) — focus follows the user, not heuristics.
- **Stage 21b — App icon.** `build/icon.icns` + source `build/icon.png` committed; `npm run dist` picks them up automatically. (DMG background image deferred from this cut.)

### Changed
- **ENH-011 — Plain-English banner copy.** `FirstLaunchBanner`'s welcome + update states no longer mention "skill", "subagent", "priming shim", or "SessionStart hook". Welcome reads "Set up the files Duo needs to work with Claude — they go in `~/.claude/`, and we won't touch any of your existing files." Update reads "Refresh the agent files in `~/.claude/` (currently from v{version})."
- **ENH-007 — Comment rail collapses to a "N resolved" pill** when every thread is resolved. Click expands; "Hide" re-collapses. Primitive-level — both the canvas binding (Stage 17d) and future markdown binding (Stage 14) inherit it.
- **BUG-026 — Pasted markdown lands as structure, not a code block.** New `MarkdownPaste` TipTap extension (priority 1000) overrides tiptap-markdown's `inline:true`-everything paste rule with a block-aware parse — block markers (`^# `, `^- `, `^> `, ` ``` `, blank-line) trigger block mode; otherwise inline mode is preserved (for "paste a bold word mid-sentence").

### Fixed
- **BUG-007 — Deleted files no longer linger in the navigator.** v0.3.1's chokidar subscription was correct but a sub-resub gap could drop unlink events when the user expanded a folder mid-delete. Hardening: refresh visible folders once after the watcher attaches; clear stale `selected` row on `removed`.
- **BUG-027 — `⌘⇧T` from browser focus reopens the last-closed tab** (Chrome parity). New `closedTabs` stack on BrowserManager (cap 10, skips `about:blank`). Other panes keep BUG-008's universal "⌘⇧T → new Claude tab" spec.
- **BUG-028 — Escape dismisses inline rename in the navigator.** Defensive fix: explicit `inputRef.blur()` on Escape forces unmount even if React-18 batching delays the keydown's setState; `cancelledRef` prevents the resulting blur from double-cancelling.
- **BUG-029 — Right-click context menu flips upward when it would clip the viewport bottom.** `useLayoutEffect` measures rendered height + flips up/left as needed.
- **BUG-030 — Navigator pin state pushes to the renderer live when changed via CLI.** New `IPC.NAV_PINS_CHANGED` channel; main broadcasts on every IPC `NAV_PINS_TOGGLE` reply AND every socket-server `nav-pin` op.

### Reconciled
- `tasks.md` ↔ roadmap audit. 12 stale 🆕 entries (BUG-010, BUG-012/013/014, BUG-018..025, ENH-008/009/010) flipped to ✅ to match shipped status from v0.3.0 / v0.4.3 / v0.5.0.

### Deferred
- Stage 21b DMG background image — visual asset, not ship-blocking.
- ENH-013 CLI parity (`duo terminal claude-state`) — agent introspection of presence state; not used by core flow.

## [0.5.0] — 2026-04-27

First MINOR since v0.4.0. Three coherent surfaces ship together:
navigator polish (Stage 26), fork-friendly architecture (Stage 21e),
and the build / install / banner foundation from v0.4.4 + v0.4.5.

### Added
- **Stage 26 PR 1 — Navigator row-interaction.** Single-click selects, double-click opens (Finder/VS Code parity). Folder chevron is its own hit target (BUG-025). Right-click menu grew **Rename…** and **Move to Trash…**. Inline rename (Enter commits, click-outside cancels). Hover-action sparkle button on folder rows → new claude terminal in that folder. CLI parity: `duo file rename <old> <new>` + `duo file trash <path>`.
- **Stage 26 PR 2 — Pinned files & folders section (ENH-010).** New section at navigator bottom, hidden when empty. Right-click → "Pin to navigator". Grouped by parent dir. Single-click selects; double-click on a folder pin re-roots the tree. Persists at `~/.claude/duo/nav-pins.json`. CLI parity: `duo nav pin/unpin/pins`.
- **Stage 21e — Fork-friendly architecture.** Identity-bearing values move to `fork.config.default.json`; forkers copy to `fork.config.json` (gitignored). Build-time CLI overrides + Vite-injected runtime constants replace hard-coded `dudgeon/duo` and `*.capitalone.com` references. Provenance-aware install (SHA-256 tracking) preserves user customizations on upgrade. See [docs/HOW-TO-FORK.md](docs/HOW-TO-FORK.md).

### Changed
- "Your Claude settings" navigator pane defaults to **collapsed** on first install (ENH-012). Project tree gets the freed vertical space. Users who explicitly expanded stay expanded.

### Known issues at v0.5.0
- **BUG-028** — Escape inside the inline rename input doesn't dismiss. Workarounds: Enter on no-change cancels; click-outside cancels.
- **BUG-029** — right-click context menu on a Pinned-section row clips at viewport bottom. Workaround: `duo nav unpin <path>` from CLI.
- **BUG-030** — CLI pin/unpin doesn't push to the renderer in real time. Workaround: relaunch / reload.

## [0.4.5] — 2026-04-27

The "Claude detection + plainer install copy" hotfix. v0.4.4 fixed the
DMG launching but two issues with the install banner remained for
Finder-launched users:

1. Duo's two `claude`-detection sites both used PATH lookups that
   missed `.zshrc` — so users with `~/.local/bin` in `.zshrc` (the
   default shell rc the official Claude Code installer points at)
   got "Claude Code not detected on PATH" even when claude was
   installed. The same bug also caused every freshly-opened
   "claude" terminal tab to print the "Install Claude Code to enable
   agent tabs" banner instead of running claude.
2. The install banner included a "Add this dir to your PATH" hint
   for the `duo` CLI helper. Duo's CLI is designed to run inside
   Duo's own terminals (not external shells), so the hint was
   confusing to non-technical users without being load-bearing.

### Fixed
- **Claude binary detection now sources the user's interactive
  shell.** New `electron/resolve-claude.ts` helper walks
  `(shell × {-l -i, -i, -l})` flag combinations until one finds
  `claude`. Both `install-service.ts § resolveRealClaude` (priming
  shim install) and `main.ts § isClaudeOnPath` (terminal-tab spawn
  decision) route through it, so they can no longer disagree.
  Closes the "Claude Code not detected" banner regression and the
  "Install Claude Code to enable agent tabs" terminal echo for
  users with `~/.local/bin` in `.zshrc`.

### Changed
- Install banner copy on success state collapsed from two
  CLI-on-PATH variants into a single plain-English "Installed.
  Claude inside Duo's terminals will arrive Duo-aware." Dropped
  the `export PATH="$HOME/.local/bin:$PATH"` shell-rc hint for
  the `duo` CLI helper — the CLI is designed to run inside Duo's
  own terminals (not external shells), so the hint was a footgun
  for non-technical users without being load-bearing.
- "Claude Code not detected" follow-up note rewritten in plain
  English (no "shim" / "PATH" jargon).

## [0.4.4] — 2026-04-27

The "DMG launch fix" hotfix. v0.4.0–v0.4.3 all shipped DMGs that crashed
on first launch with `Cannot find module 'node-pty'` — `electron-builder.yml § files` had `"!node_modules/**/*"` which excluded
all production node_modules from the bundle. The asar built fine, the
DMG packaged fine, codesign and notarization succeeded; the only signal
was the end-user double-clicking and getting an Uncaught Exception.
The bug had been latent since the original Stages 1–3 scaffold; prior
versions worked when the user happened to be running `npm run dev` or
when a previous DMG install had left node-pty on disk by side effect.

Auto-update from v0.4.3 won't reach v0.4.4 — v0.4.3 crashes before
electron-updater fetches `latest-mac.yml`. v0.4.3 users need to install
v0.4.4 manually from the GitHub Release. v0.4.4 onwards resumes
auto-update normally.

### Fixed
- DMG no longer crashes on launch (`Cannot find module 'node-pty'`):
  `electron-builder.yml § files` replaced the catch-all `"!node_modules/**/*"` exclusion with `node_modules/**/*` so
  production deps actually ship. electron-builder smart-filters the
  glob down to `package.json § dependencies` (dev deps stay out).
  `app.asar.unpacked/node_modules/node-pty/build/Release/pty.node`
  now ships in every cut.

### Changed
- `cut-version` skill grew a mandatory **launch-smoke validation**
  step (`scripts/validate-dmg-launch.sh`). Two layers: (1) static —
  confirm every module in `REQUIRED_RUNTIME_MODULES` is reachable
  in either the asar or `app.asar.unpacked/`, and that native modules
  (`node-pty`) live specifically in unpacked; (2) dynamic — mount
  the DMG, `open` the .app, sleep 8s, confirm the main process is
  alive. `scripts/dist-signed.sh` now invokes the validator after
  the existing signature/notarization checks so signed cuts get the
  same coverage. Catches the entire class of "DMG builds but
  crashes on launch" failure modes before the cut proceeds.

## [0.4.3] — 2026-04-27

The "v0.4.2 punch list" patch. Owner installed v0.4.2, walked the
surfaces, came back with 7 bugs + 4 enhancements; this cut bundles 7
bug fixes + 2 enhancements (ENH-008 tooltip + ENH-009 expanded
off-host defaults). The other 3 enhancements (copy-button on code
blocks, right-pane new-browser-tab button, collapsed comment rail
with findable resolved) defer to v0.5.0 — more substantive work that
pairs better with Stage 21e + Stage 21c Phase 3.

### Fixed

- **BUG-018** — `⌘T` opens new browser tab landing on FAQ. Constructor's first-tab default stays at FAQ; the IPC `addTab` path now defaults to `about:blank` for fresh new tabs. (`electron/browser-manager.ts`)
- **BUG-019** — `⌘T` new tab doesn't focus the address bar. Two nested `requestAnimationFrame` calls push the focus past React's commit + the browser's paint cycle, so the address-bar DOM node is mounted + visible when `focus()` runs. (`renderer/App.tsx`, `renderer/components/WorkingPane.tsx`)
- **BUG-020** — first FAQ tab non-closeable. `BrowserManager.closeTab` no longer hard-fails on the last tab; opens a fresh `about:blank` first, switches to it, then closes the requested tab. Net: 1 tab remains, but it's a blank canvas. Mirrors Notion's "close last tab → open blank" pattern. (`electron/browser-manager.ts`)
- **BUG-021** — `⌃Tab` cycle skips restored tabs (regression from Stage 21c Phase 2 session restore in v0.4.2). `useKeyboardShortcuts` now reads `tabs` and `activeTabId` through refs that always point at the latest opts state, eliminating any stale-closure window between `setTabs(restoredArr)` resolving and the useEffect re-running. Browser-side cycle adds a "no active tab" fallback (defaults to index 0 instead of silently no-oping) + diagnostic logging. (`renderer/hooks/useKeyboardShortcuts.ts`)
- **BUG-022** — new HTML canvas doesn't focus the writing area on open. `RenderedCanvas` calls `doc.body.focus()` after wiring contentEditable, so the first keystroke lands as content. (`renderer/components/HtmlCanvas/RenderedCanvas.tsx`)
- **BUG-023** — HTML canvas click area too narrow. Boilerplate restructure: body fills the viewport (with `min-height: 100vh`) and the content column lives in `<main>` with the 720px width cap. Pre-fix, body itself was the 720px column; clicks in the flanking whitespace landed on `<html>` and didn't place a cursor. Now clicks ANYWHERE in the iframe land on body and the browser places the cursor at the nearest text node. (`shared/html-boilerplate.ts`)
- **BUG-024** — Comment button + Send→Duo pill occlude each other on canvas selection. Comment button now stacks BELOW the selection (Send→Duo stays above). Falls back to "stack above the SendToDuoPill" when the selection is at the viewport bottom. (`renderer/components/HtmlCanvas/CanvasTab.tsx`)

### Added

- **ENH-008** — explanatory tooltips on Stage 22 dual-pane navigator headers. "Your Claude settings" and "Project Claude context" each get a `title` attribute explaining what files the pane shows + where they live. Native browser tooltip (no styling cost; accessible). (`renderer/components/UserClaudePane.tsx`, `renderer/components/ProjectClaudeContext.tsx`)
- **ENH-009** — expanded `external-domains.json` bootstrap defaults. Fresh installs now seed Slack, Gmail + full Google Workspace (mail / docs / drive / calendar / meet / chat / accounts), Atlassian (Jira/Confluence), Microsoft 365 — all the daily-driver SaaS apps that fail in embedded browsers due to SSO + conditional access. `*.capitalone.com` stays in the list (Cap One AIP cohort). Bootstrap is "only-if-absent" so existing users don't get the expanded list automatically — see "Migration" below. (`electron/install-service.ts`, `package.json sync:claude`)

### Migration (existing users)

Bootstrap of `external-domains.json` is "only-if-absent" — existing users with a populated file from a prior version don't pick up the expanded ENH-009 defaults automatically. Two options:
- **Manual**: edit `~/.claude/duo/external-domains.json` and add the new entries.
- **Re-bootstrap**: `rm ~/.claude/duo/external-domains.json && relaunch Duo` (next launch re-creates the file with the new defaults). Loses any custom entries you added; copy them out first if needed.

Stage 21e-iii (v0.5.0) will add an additive-merge upgrade path so future expansions flow in automatically.

### Known issues at v0.4.3

- **BUG-020 follow-up**: did the FAQ pin from `pins.json` ENH-003 bootstrap show the pin glyph in v0.4.2? If not, that's a separate URL-string-mismatch bug between the bootstrap (manual `file://`) and `helpUrl`'s `pathToFileURL` form. Verify on the v0.4.3 install; file as a follow-up if the glyph still doesn't show.
- **ENH-005 (copy button on code blocks), ENH-006 (right-pane new-browser-tab button), ENH-007 (collapsed comment rail)**: deferred to v0.5.0.
- **Stage 21e (fork-friendly architecture)**: i/ii/iii implementation complete on the `stage-21e-fork-friendly` branch but NOT in this cut. v0.5.0 target.

## [0.4.2] — 2026-04-27

The "auto-update + session restore" release. Closes [issue #24](https://github.com/dudgeon/duo/issues/24) (resume where you left off on Duo relaunch) and lays the auto-update foundation that makes future signed releases roll out to existing users without a manual re-download.

### Added

- **Stage 21c Phase 1 — `electron-updater` integration.** Background-downloads new signed builds when GitHub Releases publishes a newer tag; surfaces macOS native dialog "Restart Duo to install update?" once download completes; auto-installs on next clean quit if user defers. Coexists with the v0.4.0 GH-Releases banner (which becomes informational/fallback). `electron/auto-updater.ts`, `electron-builder.yml` `publish: github` block, `electron-updater@6.8.3` dep, `latest-mac.yml` emitted per build.
- **Stage 21c Phase 2 — session restore on relaunch.** Terminal CWDs + kinds (shell vs claude), file-tab paths + types, browser-tab URLs, active selection persist across Duo relaunches. Storage at `~/.claude/duo/session-state.json` (atomic-write-rename, debounced 500ms in renderer + 250ms in main, flush-on-quit so cmd-Q never drops state). New `electron/session-state-service.ts`, `SessionState` schema in `shared/types.ts`, hydration + save loop in `App.tsx`, `BrowserManager.restoreFromSession()` called after did-finish-load. Pin restoration already worked via Stage 24's `pins.json`.
- **`docs/HOW-TO-FORK.md`** — for would-be forkers (internal enterprise teams, individuals, other orgs). Documents the two ways to get Duo running today (download prebaked DMG vs. self-compile), the five layered fork modes (Layer 0 = use as-is, Layer 1 = per-user customization, Layers 2-4 = "coming soon" via Stage 18b + 21e), and a "what's hard-coded today" inventory of the seven files where `dudgeon/duo` / `com.geoffdudgeon.duo` / `*.capitalone.com` appear. README cross-link in "Further reading" pointing here.
- **Stage 21e roadmap entries.** Fork-friendly architecture as a new sub-stage of Stage 21 with four sub-substages: 21e-i (build-time fork config via `fork.config.json`), 21e-ii (runtime upstream-update endpoint via Vite injection), 21e-iii (provenance-aware install with conflict detection), 21e-iv (this doc + future README updates). Targeted at v0.5.0; work in flight on `stage-21e-fork-friendly` branch.

### Changed

- `docs/roadmap.html` + `ROADMAP.md` snapshot bar updated to "post-v0.4.1, post-Stage-21" with v0.4.1 sandbox-resilience headline; Stage 21 status section flipped from "remaining work is mechanical" to "✅ shipped 2026-04-27" with the iCloud File Provider root cause documented inline.

### Known issues at v0.4.2

- **Pre-v0.4.1 unsigned installs cannot auto-update.** `electron-updater` verifies the new build's Developer ID matches the running app's; unsigned v0.4.0 lacks the cert chain. v0.4.0 users will need ONE manual upgrade to v0.4.1 or later before auto-update kicks in.
- **Browser history persistence (issue #27) deferred to a later cut** — Phase 3 of Stage 21c, not in this version. Address-bar autocomplete still suggests only currently-open tabs.
- **Session-restore caveats**: live `cd` movement inside the shell isn't tracked (only spawn cwd persists; Starship-style prompt-string injection would be needed for live tracking); unsaved file-tab edits at quit time are LOST (no autosave layer; matches macOS native-app norms); browser scroll / form state isn't captured (no `WebContentsView` snapshot API).
- **Stage 21e (fork-friendly architecture) not yet shipped.** Forkers today still patch seven files by hand; v0.5.0 will close that. See `docs/HOW-TO-FORK.md` for the current state.

## [0.4.1] — 2026-04-27

The "sandbox-resilience" release. Closes the silent-failure mode where every `duo` command died inside a sandboxed Claude Code session (the default Seatbelt policy in Capital One — and other enterprise — Claude Code installs blocks Unix-domain sockets, and Duo's entire agent-side bridge ran on one). Three pieces moved: TCP fallback transport alongside the Unix socket, a new `duo doctor` diagnostic that names the sandbox failure mode explicitly, and a sandbox-writable default install path. Plus a `duo wait --timeout` race fix.

### Added

- **Stage 20 — TCP fallback transport.** `electron/socket-server.ts` now dual-listens on the Unix socket (chmod 0700, primary) and an ephemeral 127.0.0.1 TCP port, with a per-launch random auth token published to `~/Library/Application Support/duo/duo.port` (mode 0600). The CLI tries the Unix socket first; on `EPERM` / `ECONNREFUSED` / `ENOENT` / connect-timeout it reads the port file and reconnects over TCP, sending the token as the first NDJSON line of the handshake. `DUO_TCP_ONLY=1` forces the fallback path for testing. Non-sandboxed sessions never notice — they stay on the faster Unix socket. (`electron/socket-server.ts`, `cli/duo.ts`, `electron/constants.ts`, `shared/types.ts`)
- **Stage 20 — `duo doctor` diagnostic.** New CLI verb that probes both transports via a cheap `ping` socket cmd, reports app/CLI version match, `$DUO_SESSION` presence, install-path discovery, and `~/.claude/skills/duo/` + `~/.claude/agents/duo.md` presence. Prints "Claude Code sandbox detected (Unix socket blocked) — using TCP fallback" with the recommended `.claude/settings.local.json` allowlist when that's the failure pattern. Skill troubleshooting now directs agents to run it first on any unrecognized failure. (`cli/duo.ts § runDoctor`)
- **Stage 20 — sandbox-safe `duo install` path.** Default install order is now `~/.claude/bin/duo` → `~/.local/bin/duo`. The `~/.claude/` tree is writable from inside a sandboxed Claude Code PTY, so the installer keeps working even when invoked from `claude`. `--system` opts back into `/usr/local/bin/duo` (sudo + outside the sandbox). The command prints a one-line `export PATH=...` hint when the chosen target isn't already on PATH. (`cli/duo.ts § runInstall`)

### Fixed

- **`duo wait --timeout` socket-cap race.** `duo wait --timeout 30000` no longer hits the 10s socket timeout and dies with a misleading "Timeout waiting for response" while the renderer is still polling. CLI socket cap is now `max(explicit + 5s buffer, default)`. (`cli/duo.ts`)

### Changed

- **Skill troubleshooting reframed.** `skill/references/sandbox-troubleshooting.md` updates the post-Stage-20 framing — the TCP fallback now ships, so `allowUnixSockets` becomes one option (faster path) rather than the only fix. The skill's main troubleshooting section already directed agents to `duo doctor` first; now that's the load-bearing instruction.

### Known issues at v0.4.1

- TCP fallback validated via `DUO_TCP_ONLY=1` simulation; first real-sandbox confirmation comes from the owner's next Capital One Claude Code session post-install. The `duo doctor` output names the failure mode if anything's off.
- Distribution remains unsigned. Stage 21 (signed + notarized + auto-update) is in flight on `stage-21-signing-toolchain` with an Electron 24→26 upgrade in scope.
- The rest of the Stage 20 cluster is still ⬜: tab numbers in the unified strip, terminal selection / clipboard refinements, `duo reload`, pane-aware zoom shortcuts (issues #22 / #23), PTY-side sandbox audit (issue #12).

## [0.4.0] — 2026-04-26

The "context pedagogy" release. Stage 22 reorganizes the file navigator into two panes that teach non-technical PMs that Claude reads from BOTH user-level and project-level context buckets. Plus four supporting features (GitHub Releases auto-update banner, Stage 25 post-redirect chrome banner with `*.capitalone.com` defaulted, Edit menu "Paste and Match Style", Stage 21 signed-cut script prep).

### Added

- **Stage 22 — Navigator dual-pane overhaul (context pedagogy).** The file navigator now splits into two panes vertically. The top pane "Your Claude settings" surfaces the user-level context Claude reads — `~/.claude/CLAUDE.md`, `~/.claude/skills/`, `~/.claude/agents/` — with a "Show all" toggle for power users who want the rest of `~/.claude/` (mcp/, hooks/, plans/, projects/, bin/, duo/, etc.). Header label is plain English (not the literal `~/.claude/` path). Collapsible. The bottom pane is the existing project tree, gaining a "Project Claude context" group above the regular file list that surfaces `./CLAUDE.md` / `./.claude/` / `./tasks.md` / `./AGENTS.md` when they exist. The pedagogy goal: visual separation teaches "the agent reads from both buckets" without making users learn dotfile conventions. (`renderer/components/UserClaudePane.tsx`, `renderer/components/ProjectClaudeContext.tsx`, `renderer/hooks/useUserClaudeNavigator.ts`, `renderer/components/FilesPane.tsx`, `renderer/components/FileTree.tsx` (TreeNodes export))
- **GitHub Releases update checker.** A new banner above the WorkingPane queries `api.github.com/repos/dudgeon/duo/releases/latest` once at boot (refreshed every 6h) and surfaces "Duo vX.Y.Z is available" with a one-click link to the release page. Distinct from the existing local-install banner (which fires when `~/.claude/duo/installed.json`'s recorded version drifts from `app.getVersion()`). Per-version dismissal: the user dismissing v0.4.0 stays quiet until v0.4.1 ships. Failure modes (network down, GitHub 5xx, anonymous-rate-limit hit at 60 req/hr/IP) silently skip the banner — no worse than today. (`electron/update-checker.ts`, `renderer/components/UpdateAvailableBanner.tsx`)
- **Stage 25 — Post-redirect chrome banner.** After `duo external <url>` succeeds (or any other `shell.openExternal` call from the duo subagent), main pushes a "Sent `<host>` to your default browser. ⌘Tab to find it." banner that auto-dismisses after 6s. Optional per-domain `reason` text from `external-domains.json`'s extended-schema entries (`{host, reason?}` form, backward-compatible with the old `[string]` shape). Solves the invisible-redirect problem: today the user clicks an off-host link and nothing visible happens in Duo, sometimes leading to repeated clicks or "did the action fail?" confusion. (`electron/main.ts § openExternalUrl`, `renderer/components/ExternalRedirectedBanner.tsx`)
- **`*.capitalone.com` default in `external-domains.json`** — install bootstrap now seeds the file with `["*.capitalone.com"]` so Trailblazers' Cap One web surfaces (which require the corporate-managed browser for SSO + internal CDN certs) auto-route to the system browser without manual config. Existing files are never clobbered. (`electron/install-service.ts`, `package.json` `sync:claude`)
- **Edit menu "Paste and Match Style"** (ENH-002 follow-up). Native macOS-standard menu item with `⌘⇧V` accelerator. Both editors (markdown + canvas) already handled the chord locally in v0.3.1; this adds the menu surface for discoverability. (`electron/main.ts`, `electron/preload.ts`, `renderer/components/editor/MarkdownEditor.tsx`, `renderer/components/HtmlCanvas/CanvasTab.tsx`)
- **Stage 21 prep — `scripts/dist-signed.sh` + `scripts/validate-signed-dmg.sh`.** Helper scripts for the signed + notarized DMG cut: source the cert env vars from `~/Documents/duo-private/.env`, run `npm run dist`, then validate with `codesign --verify --deep`, `spctl -a -t open`, and `xcrun stapler validate`. The actual signed cut still defers to a moment when the keychain prompt (FOLLOWUP-005 from v0.2.0) can be answered if it appears; v0.4.0 itself ships unsigned. The yml stays env-agnostic so today's unsigned `CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist` keeps working unchanged. (`scripts/dist-signed.sh`, `scripts/validate-signed-dmg.sh`, `electron-builder.yml` comments)

## [0.3.1] — 2026-04-26

A bug + small-enhancement sprint. Eight items in one cut: three regressions fixed, three enhancements paired together cleanly, two filed-but-stalled bugs from prior cycles closed.

### Added

- **Better default boilerplate for new HTML canvases (ENH-001 + ENH-004 paired).** `duo html new` (and ⌘N + `.html`) now stamps `data-duo-id` ULIDs on every element at write time and adds an inline Atelier-flavored stylesheet (cream paper / ink-soft body / serif headings, body width cap, dark-mode `prefers-color-scheme` media query, `<meta viewport>`). Closes the "Add stable IDs to all elements?" first-open prompt for Duo-authored canvases by construction (the prompt remains valuable for hand-authored / downloaded HTML the user opens later). The styles are intentionally local + editable — delete or rewrite them at will. (`shared/html-boilerplate.ts`, `shared/ulid.ts` — relocated from `renderer/components/HtmlCanvas/`)
- **Paste-as-plain-text (ENH-002).** `⌘⇧V` / `⌃⇧V` in both editors (markdown + HTML canvas) reads `text/plain` from the clipboard and inserts it without HTML formatting. Mirrors macOS's "Paste and Match Style." (`renderer/components/HtmlCanvas/canvasPaste.ts`, `renderer/components/editor/MarkdownEditor.tsx`)
- **Default-pinned help tabs (ENH-003).** Install bootstraps `~/.claude/duo/pins.json` with FAQ + What Duo Does pre-pinned. The browser-pane default landing now prefers the user-installed `~/.claude/duo/help/<file>` (so URLs match the pin entries; falls back to the bundle copy pre-install). When the user opens either help tab, it renders with the pin glyph + sorts to leftmost in the strip. (`electron/install-service.ts`, `electron/browser-manager.ts`)

### Fixed

- **BUG-005** — `duo key End --modifiers cmd` no longer triggers Electron's About panel on macOS. The CLI silently translates cross-platform navigation combos to Mac-native equivalents: `Cmd+End` → `Cmd+ArrowDown`, `Cmd+Home` → `Cmd+ArrowUp`, `Cmd+PageDown` / `Cmd+PageUp` drop the `Cmd` modifier (which was the trigger for the application-menu fall-through). 9/9 standalone test cases pass. Linux / Windows passes through unchanged. (`cli/duo.ts`)
- **BUG-007** — Deleted files no longer linger in the navigator until full reload. The chokidar `unlink` / `unlinkDir` handlers in `FilesService` were already firing correctly; the gap was that no renderer subscriber existed. `useNavigator` now installs `electron.files.watch` against `[cwd, ...expanded]` and refreshes the parent directory's listing on every event. External terminal `rm`, agent writes, Finder operations, etc. all reflect within a frame or two. (`renderer/hooks/useNavigator.ts`)
- **BUG-015** — HTML canvas comment rail no longer renders an empty column when there are no comment threads. Gated on `railThreads.length > 0`; reappears the moment the first comment lands. (`renderer/components/HtmlCanvas/CanvasTab.tsx`)
- **BUG-016** — Pasted bold text in dark mode no longer renders as illegibly low-contrast brown-on-brown. The new canvas paste handler scrubs inline `style="color: …"` and `style="background: …"` declarations from pasted HTML (plus `class` attributes that reference foreign stylesheets) so pasted nodes inherit the canvas's own ink token. Pairs with ENH-002 — fixing paste-with-styles fixes most paste-related grief. (`renderer/components/HtmlCanvas/canvasPaste.ts`)
- **BUG-017** — Theme toggle "system" mode now correctly follows macOS's dark/light preference. Root cause was `nativeTheme.themeSource = 'light'` hardcoded at boot, which forced the renderer's `prefers-color-scheme` query to `light` regardless of OS. The renderer now pushes its mode via the existing `IPC.THEME_STATE_PUSH` and main updates `nativeTheme.themeSource` to match (`'system'` / `'light'` / `'dark'`). Boot still defaults to `'light'` so the splash + first paint match Atelier; the renderer's mode push runs immediately after mount. (`electron/main.ts`)

## [0.3.0] — 2026-04-26

### Added

- **Stage 19b — passive priming.** Every Claude Code session launched inside a Duo PTY now arrives Duo-aware. Two delivery mechanisms ship together: (1) a load-bearing PATH shim at `~/.claude/duo/bin/claude` that wraps the real binary with `--append-system-prompt "$(cat ~/.claude/duo/priming.md)"` when `DUO_SESSION` is set, and (2) a redundant `SessionStart` hook in `~/.claude/settings.json` (idempotent, tagged `_duo: "managed-vN"`). Real-claude path resolved via login shell at install time and inlined into the shim. Bundled `priming.md` ships in `~/.claude/duo/` (bootstrap-only — never clobbers user edits). (`electron/install-service.ts`, `electron/pty-manager.ts`, `electron/constants.ts`, `skill/priming.md`)
- **Stage 23 — canvas actions: Claude ↔ HTML loop.** `<button data-duo-action="claude:spawn">`, `data-duo-action="terminal:send"` (with optional `data-enter="true"`), and `data-duo-action="browser:open" data-url="…"` give canvas HTML pages a 3-verb vocabulary for driving the workspace. Renderer-side dispatch via a delegated capture-phase listener on the iframe doc (no `allow-scripts` needed). Path-restricted trust: actions fire only on canvases under `~/.claude/duo/` (covers Duo's help pages and Stage 18b skill packs); user-marked-trusted folders deferred. Worked example at `~/.claude/duo/help/canvas-actions-demo.html` and skill reference at `~/.claude/skills/duo/examples/canvas-actions.md`. (`renderer/components/HtmlCanvas/canvasActions.ts`, `renderer/components/HtmlCanvas/CanvasTab.tsx`, `renderer/App.tsx`, `shared/types.ts`)
- **`duo send --enter` flag** (Stage 23b). Pairs with the canvas `data-enter="true"` attribute to submit the payload on the user's behalf instead of waiting for confirmation. (`cli/duo.ts`, `agents/duo.md`, `skill/SKILL.md`, `docs/CLI-COVERAGE.md`)
- **Preventative kb-shortcut architecture.** Single typed registry (`renderer/keyboard/globalShortcuts.ts`) defines the entire global-shortcut vocabulary. The `useKeyboardShortcuts` hook now installs a *capture-phase* document listener that fires before any focused element's bubble handlers — so TipTap, contentEditable, and the canvas iframe can no longer silently swallow shortcuts. Three escape patterns per surface kind: in-doc (capture-phase listener handles it directly), iframe (`installGlobalShortcutForwarder` redispatches to parent), native-bridged (xterm + WebContentsView consult the same `matchGlobalShortcut`). Adding a row to the registry gives every conforming surface free coverage; adding a surface that adopts one of the three patterns inherits every shortcut. (`renderer/keyboard/globalShortcuts.ts`, `renderer/keyboard/iframeForwarder.ts`, `renderer/hooks/useKeyboardShortcuts.ts`, `renderer/components/HtmlCanvas/RenderedCanvas.tsx`, `renderer/components/editor/MarkdownEditor.tsx`, `renderer/components/TerminalPane.tsx`)
- **GitHub Releases DMG distribution.** Direct download links for the latest unsigned DMG land in the README; `cut-version` Step 6.5 attaches DMG(s) to a `gh release create` on every cut. v0.2.0 backfilled.
- **Smoke-checklist matrix gains a Canvas (C) column** (defense-in-depth on top of the architectural fix). New trace steps and pre-flight file list updated. (`docs/dev/smoke-checklist.md`)
- **CLAUDE.md plumbing checklist for new tab types** now requires picking one of three documented escape patterns when wiring keyboard input. Skipping this step is the BUG-012/013/014 family. (`CLAUDE.md`)

### Fixed

- **BUG-010** — `waitForPtyReady` now strips ANSI/CSI/OSC escapes and matches a prompt-tail regex (`/[$%#❯>›→]\s*$/`) on the visible last 160 chars, instead of resolving on the first PTY data event. Fixes the cosmetic `claude` echo above the shell prompt that v0.2.0's BUG-009 fix left behind. 14/14 standalone test cases pass: bash, zsh, conda+zsh, root, starship, fish, ANSI-colored prompts, OSC 0 title-bar prompts; correctly ignores OSC 133 marks, alt-screen toggles, cursor-position queries, mid-startup rc output. (`renderer/App.tsx`)
- **BUG-012** — HTML canvas: ⌘N, ⌘T, ⌃Tab, ⌘W, ⌘L, ⌘`, etc. now reach the App-level handler from canvas focus. Closed by the preventative architecture above.
- **BUG-014** — Markdown editor: ⌃Tab cycles tabs (and every other global shortcut now fires from TipTap focus). Closed by the preventative architecture.
- **BUG-013** — Markdown editor ⌘T behavior: now reliably opens a new browser tab from editor focus per Stage 11 D33e (Chrome parity), instead of being swallowed by TipTap. The "spawning a duplicate FAQ" behavior was Stage 19c's `faq.html` default-landing rendering correctly; the regression was that the keystroke wasn't escaping at all.

## [0.2.0] — 2026-04-26

The FTUX foundation. First-launch self-install lands the skill / subagent
/ help-files / `duo` CLI binary into the user's `~/.claude/` and
`~/.local/bin/` in one click. The browser-pane default landing flips
from `about:blank` to a real FAQ. WorkingPane tabs are pinnable. Two
keyboard-routing bugs (BUG-008, BUG-009) and one cosmetic residual
(BUG-010, filed for follow-up) tracked.

### Changed

- New browser tabs now land on the bundled `help/faq.html` (FAQ + What's New + Getting started + Troubleshooting) instead of `about:blank`. Fallback to `about:blank` if the file resolution fails. (`electron/browser-manager.ts`)
- **`⌘T` is now always a new browser tab regardless of focus** (Chrome parity). Stage 19c's pane-aware spec ("from terminal focus, open claude") is reverted in favor of a universal mental model. **`⌘⇧T` is now a new Claude tab from anywhere** (replaces 19c's "vanilla shell" assignment). Vanilla shell only via the `>` button on the terminal strip; the `+` button still opens claude. Resolves BUG-008's spec conflict. (`renderer/hooks/useKeyboardShortcuts.ts`)

### Added

- `help/**/*` is now included in the production app bundle (`electron-builder.yml § files`) so the FAQ + What Duo Does ship in the DMG.
- `<meta name="duo-editable" content="false">` is now honored by the HTML canvas. When present, the canvas mounts read-only: no contentEditable, no toolbar, no comment composer, no agent-write banner, no ID-injection probe. Send → Duo selection still works (quoting from a reference HTML is useful). Used by `help/faq.html` and `help/what-duo-does.html` so the system reference HTMLs can't be accidentally edited if opened from the file navigator. (`renderer/components/HtmlCanvas/CanvasTab.tsx` + `RenderedCanvas.tsx`)
- `<meta name="duo-open-in" content="browser">` is now honored by the file-open dispatcher. When present in an `.html` file's head, clicking the file in the navigator (or opening it via `duo view` / `duo edit`) routes to a browser tab via `file://` URL instead of the canvas. Cheap pre-flight reads only the first 4KB of the file. Falls through to the canvas on parse failure or absent meta. Applies to file-tree clicks, markdown-preview link clicks, and the CLI's `view` / `edit` verbs. (`shared/types.ts`, `electron/files-service.ts`, `electron/main.ts`, `electron/preload.ts`, `renderer/App.tsx`)
- **Stage 24 — Pin WorkingPane tabs.** Right-click any working-pane tab → "Pin tab" / "Unpin tab." Pinned tabs render with a pin glyph (replaces the type icon), sort to leftmost, and gate `⌘W` behind a confirm modal. Pin identity is stable across sessions: browser tabs match by URL, file tabs by absolute path. Storage at `~/.claude/duo/pins.json` (atomic write via tmp + rename). Foundation for Stage 18b's `PACK.json § pins` distro pre-pins and Stage 21c's session-restore highest-priority entries. (`shared/types.ts`, `electron/pins-service.ts`, `electron/main.ts`, `electron/preload.ts`, `renderer/App.tsx`, `renderer/components/WorkingPane.tsx`, `renderer/components/WorkingTabStrip.tsx`, `renderer/components/PinnedCloseConfirm.tsx`)
- **Stage 18 — First-launch self-install (whole stage shipped).** A welcome banner appears on first launch (and on subsequent launches when an upgrade is detected). Click "Install" → main copies `skill/SKILL.md` + examples + references → `~/.claude/skills/duo/`, `agents/duo.md` → `~/.claude/agents/`, `help/*.html` → `~/.claude/duo/help/`, bootstraps `~/.claude/duo/external-domains.json` if absent (never clobbered), writes `~/.claude/duo/installed.json` with version + timestamp. **Phase 2:** `cli/duo` is also copied to `~/.local/bin/duo` (chmod 755). The install service detects whether `~/.local/bin` is on `$PATH`; if not, the success banner shows a one-line `export PATH="$HOME/.local/bin:$PATH"` snippet and stays visible until the user dismisses (instead of auto-hiding). The PATH-on case auto-hides after ~3s. Idempotent — re-running overwrites everything and re-stamps. (`shared/types.ts`, `electron/install-service.ts`, `electron/main.ts`, `electron/preload.ts`, `renderer/components/FirstLaunchBanner.tsx`, `renderer/App.tsx`)

### Fixed

- BUG-009: `+` (claude) button on the terminal tab strip now reliably auto-launches Claude. The previous `queueMicrotask`-only deferral raced the shell's startup; the new `waitForPtyReady` helper waits for the shell to emit its PS1 (first PTY data event) plus a 30ms paint settle before writing. Same fix covers `duo new-tab --kind claude` and `duo new-tab --cmd "..."`. (`renderer/App.tsx`)
- BUG-008: xterm.js no longer eats Duo-global keyboard shortcuts from terminal focus. The `attachCustomKeyEventHandler` allowlist in `TerminalPane.tsx` now lets `⌘T`, `⌘⇧T`, `⌘N`, `⌘W`, `⌘L`, `⌘B`, `⌘\``, `⌘0–9` (with/without shift), and `⌘+/=/-` bubble to the renderer's window-level handler. Class-of-issue sweep — kills the whole "next Duo-global shortcut won't reach its handler from terminal focus" family of bugs. (`renderer/components/TerminalPane.tsx`)

### Known issues at v0.2.0

- BUG-010: BUG-009 fixed the functional regression (claude DOES launch), but a literal `claude` still echoes on a bare line above the shell prompt — `waitForPtyReady` resolves on the shell's first PTY data event, which can be a pre-PS1 byte. Cosmetic; non-blocking. Suggested fix in `tasks.md` is a prompt-shape regex.
- V2–V27 verification walk inherited from the v0.1.0 cut still owed in eyes-on form. Recent ships (Stage 18, Stage 24, BUG-008, faq landing, duo-open-in / duo-editable metas) walked PASS during the v0.2.0 smoke pass; the canvas / editor V-walk is the remainder.
- Stage 18 banner appears in `npm run dev` too (the install service runs the same code path regardless of `app.isPackaged`). Only relevant to devs; end users hit it once per install.
- DMG is unsigned — Gatekeeper warns on first launch. Stage 21 (signing + notarization) closes this; cert pre-work done.

## [0.1.0] — 2026-04-26

The inaugural Duo release. Pre-distribution: this build runs from
`npm run dev` or `npm run dist` (uncert DMG); first-launch
self-install lands in v0.2.0 (Stage 18). What ships here is the
foundation: a working three-pane workspace, the `duo` CLI bridge,
the agent-driven HTML canvas, and the visual identity.

### Added

**Core shell**

- Three-column layout: file navigator (left), terminal pane (middle), working pane (right).
- Multiple terminal tabs per session (xterm.js + node-pty pool).
- Tab strip on each pane with `⌘W` close, `⌘⇧T` reopen, `⌃Tab` cycle.
- Atelier visual identity (Phases 1–3): paper / cream / mark token system, ~40px draggable titlebar, light-as-hero defaults, system / light / dark theme picker (top-right `System` button).

**File navigator**

- Tree rooted at home, expand-collapse, breadcrumb nav.
- Click a `.md` / `.html` / `.png` / `.pdf` file to open it as a working-pane tab (polymorphic — markdown editor, HTML canvas, image viewer, PDF viewer).
- `⌘B` toggles the navigator between expanded and collapsed rail.

**Terminal pane**

- Split `+` button on tab strip: `+` opens a Claude Code session, `>` opens a vanilla shell.
- `⌘T` from terminal focus opens a Claude tab; `⌘⇧T` always opens a vanilla shell.
- Tab title format: `claude · <basename>` (replaced by `Claude Code` once the REPL detects).
- Install banner appears when `claude` is not on the user's PATH.
- Env signals every Duo PTY: `DUO_SESSION`, `DUO_SOCKET`, `DUO_VERSION`, `TERM_PROGRAM=Duo`.

**Browser pane**

- Embedded WebContentsView, multiple browser tabs.
- `⌘T` from browser focus opens a new browser tab + focuses the address bar.
- `⌘L` focuses the address bar from anywhere in the working pane.
- Plain-click `+` on the working-pane strip → file-name interstitial; `⌥-click +` → new browser tab.

**Markdown editor (Stage 11a)**

- TipTap-backed rich editor for `.md` files in the working pane.
- Toolbar: heading picker, bold / italic / underline / strikethrough, link picker, bullet / ordered / task lists, blockquote, code block, horizontal rule, table insert + contextual table strip, undo / redo, save.
- Markdown shortcuts on typing: `# `, `## `, `- `, `1. `, `> `, ` ``` `, `**bold**`, etc.
- Just-added highlight (yellow `mark`, 6s fade) on agent-pushed edits (Stage 13).
- Warn-before-overwrite banner when an agent's write would clobber unsaved changes (Stage 13).

**HTML canvas (Stage 17a + 17b + 17c + 17d-A)**

- New WorkingPane tab type for `.html` files: render + edit primitive (iframe-srcdoc + contentEditable + MutationObserver autosave).
- Shared toolbar with the markdown editor (heading picker + lists + blockquote + code block + hr + table insert + B/I/U/S + link).
- Markdown shortcuts on typing inside the canvas.
- Smart-blank overlay (Stage 17a.5 D): fresh canvas shows a centered card with "doors" — markdown shortcuts active; three more labelled "soon."
- ULID injection on first open (per-directory persistent choice).
- `<file>.duo.json` sidecar with versioned schema, `recentEdits[]` capped at 50.
- Just-added wash on agent edits — paints affected element yellow + fades over 6s; class scrubbed from on-disk HTML.
- Recent-edits repaint at canvas open (sidecar's freshness window).
- Persistent blurred selection via CSS Custom Highlight Registry — selection paints in the Atelier mark color even when canvas loses focus, no DOM mutation.
- Comment rail: shared `<CommentRail>` primitive (will host markdown editor's comments in Stage 14). Numbered badges in the body, threaded replies, resolve / reopen, full sidecar persistence.
- New-comment flow: select text inside an anchored element → "💬 Comment" pill pairs with "Send → Duo" → composer popover.
- Pretty-printed serializer with stable attribute order + runtime-chrome strip (no comment / wash markup ever leaks to disk).

**Send → Duo (Stage 15.1 + 15.2)**

- Floating purple pill on text selection (markdown editor + browser pane + canvas).
- Click pill → selection lands in the active terminal's PTY.
- Three formats via `duo selection-format a|b|c`: provenance + quote, literal text, opaque token.

**`duo` CLI bridge (Stage 3)**

- Standalone Node.js binary at `cli/duo` (esbuild bundle, no Node-on-PATH needed).
- Unix-socket transport into Duo's main process.
- Verbs: `tabs`, `tab <n>`, `open <url>`, `external <url>`, `back`, `forward`, `reload`, `selection [--pane auto|editor|browser|canvas]`, `selection-format <a|b|c>`, `send`, `theme [system|light|dark]`, `new-tab [--shell|--claude] [--cwd] [--cmd]`, `edit <path>`, `view <path>`, `key <name>`, `events --follow` (partial), `help`.
- HTML canvas verbs: `duo html new`, `query`, `get`, `set`, `replace`, `append`, `remove`, `attr`, `comment`, `comments`.

**Skill + subagent (Stage 5 + 5 v2)**

- `~/.claude/skills/duo/SKILL.md` — agent discovery surface for the `duo` CLI; installed via `npm run sync:claude`.
- `~/.claude/agents/duo.md` — Duo subagent (Haiku 4.5) with bounded context, specialized prompt, web-routing rules, and session guard.
- `duo external <url>` verb routes off-host URLs through `shell.openExternal` (default-browser open) per the external-domains allowlist.

### Fixed

- BUG-001: `⌃Tab` from terminal focus now cycles terminal tabs (was cycling browser tabs).
- BUG-002: `⌘T` from browser focus now correctly focuses the address bar.
- BUG-003: pane focus indicator made more visible.
- BUG-004: `⌘\`` (pane focus toggle) no longer breaks subsequent keyboard input routing.
- BUG-005: `duo key End --modifiers cmd` no longer triggers the macOS About panel.
- BUG-006: Send → Duo pill now renders visibly on the browser pane.
- BUG-007: deleted files no longer linger in the navigator until full reload.
- Issue #10: `duo selection` now returns selected text + surrounding context.
- Issue #17: click-and-drag target made larger.
- Issue #20: `⌃Tab` cycles tabs in the active pane.
- Issue #21: `⌘N` opens a new file in the working pane with focus on the filename setter.
- Issue #26: `⌘T` focuses the browser address bar so the user can immediately type a URL.

### Known issues at v0.1.0

- BUG-008: `⌘T` from terminal focus is currently swallowed by xterm before reaching the new-tab handler; expected-behavior conflict with Stage 19c spec is open (see `tasks.md`).
- BUG-009: `+` (claude) button on terminal tab strip writes `claude\n` before the shell prompt is ready; user has to press Enter manually.
- V1–V27 in-app verification walk only partially completed at cut time (V1 PASS, 19c.2 BUG-009 filed); remaining items are owed for v0.2.0 cut.
- About:blank as the default new-tab landing in the working pane — replaced in v0.2.0 by the `faq.html` / `what-duo-does.html` reference surface.

[Unreleased]: https://github.com/dudgeon/duo/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/dudgeon/duo/releases/tag/v0.2.0
[0.1.0]: https://github.com/dudgeon/duo/releases/tag/v0.1.0
