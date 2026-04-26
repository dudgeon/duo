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

### Changed

- New browser tabs now land on the bundled `help/faq.html` (FAQ + What's New + Getting started + Troubleshooting) instead of `about:blank`. Fallback to `about:blank` if the file resolution fails. (`electron/browser-manager.ts`)

### Added

- `help/**/*` is now included in the production app bundle (`electron-builder.yml § files`) so the FAQ + What Duo Does ship in the DMG.

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

[Unreleased]: https://github.com/dudgeon/duo/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/dudgeon/duo/releases/tag/v0.1.0
