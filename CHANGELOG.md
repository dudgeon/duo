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
