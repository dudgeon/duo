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

> Empty — v0.7.5 cut 2026-05-22.

## [0.7.5] — 2026-05-22

### Fixed

- **FOLLOWUP-024** — Pasted, drag-dropped, and agent-inserted images now land as block nodes in the markdown editor. Previously inserted as inline images at the cursor, producing markdown like `![](foo.png)text` on a single line — GitHub rendered the image and text running together. `DuoImage` now declares `group: 'block'` + `inline: false`; paste / drag-drop / `duo image insert` all produce block images with the GFM-required blank-line spacing automatically. Trade-off: inline-image-mid-sentence (`Click the ![icon](foo.png) button`) is no longer supported; acceptable for Duo's docs-shaped editor.

### Docs

- Added [`docs/about-duo.md`](docs/about-duo.md) — narrative "why Duo exists" intro for new visitors to the GitHub repo. Linked from `README.md` near the top. Images compressed (4.3 MB → 1.6 MB total, 63% smaller) for faster github.com page loads.

## [0.7.4] — 2026-05-21

### Added

- **Workspace-as-file** (ENH-167) — round-trip Duo's open tabs + terminals + browser pane state to a user-saved `.duo-workspace` file. New File menu items: `New Workspace`, `Save Workspace…`, `Save Workspace As…`, `Open Workspace…`, `Open Recent Workspace ▸` (10 entries, prune-missing-on-open) + `Clear Recent Workspaces`. CLI parity: `duo workspace <save|open|list-recent|current|new>`.
- **Title-bar workspace-name badge** (ENH-167 v1.2) — when a workspace is loaded, its name appears right of the macOS traffic lights; blank when untitled. Tracks live across Save / Save As / Open / Open Recent / New Workspace via a new `WORKSPACE_FILE_ACTIVE_CHANGED` push channel.
- **Autosave continues to mirror the active workspace** (ENH-167 v1.2) — every autosave flush writes both `~/.claude/duo/session-state.json` AND the active `.duo-workspace`. The `.duo-workspace` is the LIVE workspace, not a snapshot of last-manual-save. No-op when untitled.

### Changed

- **New Workspace = workspace reset, not just pointer-clear** (ENH-167 v1.1) — when anything is open, File > New Workspace now prompts Save / Don't Save / Cancel; on Don't Save it resets in-place into ONE fresh shell terminal at the **live CWD** (lsof-based, spawn-CWD fallback) of the previously-frontmost terminal, with every working-pane tab dropped EXCEPT pinned (file + browser pins both survive via existing boot-time hooks).
- **In-place reset replaces `app.relaunch()`** for Open Workspace + New Workspace (ENH-167 v1.1.1) — close browser WCVs + dispose PTYs + reload renderer. Works uniformly in dev and packaged; faster (~200ms vs ~2s).
- `SessionStateService.setMirrorHook()` — services can inject a secondary write that runs inside `flush()`, debounced by the same 250ms as the primary write. Used by the autosave mirror above.

### Notes

- The Stage 21c "session" terminology (autosave file `session-state.json`, type `SessionState`, service `sessionStateService`) is preserved internally — only the new user-facing surface uses "workspace". Decision rationale in [`docs/prd/enh-167-workspace-as-file.md`](docs/prd/enh-167-workspace-as-file.md) § Naming.

## [0.7.3] — 2026-05-19

### Added

- **Unified annotation rail in the markdown editor** (ENH-166). Replaces the two
  side-by-side rails (tracked-changes + comments, each ~280px wide) with one
  280px column where items interleave by document position. Cards keep their
  kind-specific shape (✓/✗ for tracked changes; reply/resolve for comment
  threads); one header + merged "All / Mine / Agent / Others" filter chips
  span both kinds. Comment thread numbering reassigns 1-based after the merge
  sort so badges reflect document order across mixed kinds. Net effect:
  ~280px of horizontal real estate reclaimed for the prose column. New
  component at `renderer/components/editor/UnifiedAnnotationRail.tsx`.
- **`duo doc comment --reply-to <c-id>` no longer requires `--anchor`** (BUG-143).
  New `addCommentReply` pure function finds the parent token by id and
  appends `↪ @<author> <ts>: <body>` inside the parent's `{>>…<<}` body —
  the canonical threading format `parseRepliesFromBody` already reads. 6 new
  vitest fixtures (37 → 43 docEdit cases; 649 → 655 total). Closes the bug
  report where an agent burned 16 shell calls + 2 minutes guessing the right
  anchor shape.
- **Focused per-verb help via `duo doc --help` and `duo doc <sub> --help`**
  (BUG-145). ~15-line subcommand list vs. the ~200-line global help. Sections
  cover read / write / goto / find / insert / delete / substitute / highlight
  / comment / accept / reject / conflict-log.
- **`skill/references/comments.md`** (BUG-147). Full comment lifecycle
  reference — surface decision table, on-disk CriticMarkup shape, anchor /
  reply / accept / reject patterns with one runnable example each, the
  3-call expected agent path, and the live-editor refresh semantics.
- **`skill/SKILL.md § "Comment disambiguation"`** (BUG-146). New decision tree
  keyed on `duo layout § main.kind` that disambiguates the user's word
  "canvas" — markdown editor (`duo doc comment`) vs. HTML canvas (`duo html
  comment`) — before the agent picks a verb cluster.

### Fixed

- **`duo doc read <path>` (and `doc goto / find / write`) on non-active editors**
  (BUG-144). Each mounted MarkdownEditor's path-mismatch IPC branch used to
  error-reply, so with multiple files open the wrong editor would race and
  win the reply — the CLI saw a bogus "Active editor is at Y, not X" error.
  Path-mismatch is now a silent ignore; only the matching editor responds.
- **Main-process EPIPE crash dialog when parent stdout closes** (BUG-148).
  The dev-only renderer-console forwarder at `electron/main.ts:651` calls
  `console.log` on every renderer log line; when the launching parent (npm /
  electron-vite / terminal) detaches its stdout pipe, the next write threw
  EPIPE → uncaught exception → user-visible JavaScript error dialog.
  Installs canonical Node-on-broken-pipe handlers on `process.stdout` /
  `process.stderr` that suppress EPIPE silently while still propagating
  other stream errors.

### Changed

- **`skill/SKILL.md § "Leave a comment or track-change"`** — example flipped
  from the v1 `--anchor + --reply-to` form (which corrupted the parent
  token) to the canonical `--reply-to` alone (BUG-143).

### Known issues

- **FOLLOWUP-023** — chokidar reload after a reply leaves the tracked-
  changes rail momentarily misclassified (existing `{==X==}` anchors render
  as `+ ins` cards until the file is closed + reopened). Reply IS written
  correctly to disk and parses correctly on remount; only the in-place
  re-render path has a transient inconsistency. Documented in the new
  comments reference page so agents know the close-reopen workaround.

## [0.7.2] — 2026-05-18

### Added

- **`duo doc highlight <file> --text "X"` CLI verb** — closes a CLI-parity
  gap in the BUG-138 family. HighlightMark already existed in the editor;
  agents now have `{==X==}` symmetric with insert / delete / substitute /
  comment. 6 new vitest fixtures (FOLLOWUP-022).
- **CLAUDE.md § 7e — session-start Electron access rule.** Codifies the
  v0.7.1 walk-3 lesson: any UI-touching session calls
  `request_access(["Electron"])` BEFORE writing code, not after the third
  failed smoke walk.
- **Skill — comment attribution patterns.** New `skill/SKILL.md § Leave a
  comment or track-change` documents the `DUO_AUTHOR` env-var pattern for
  agent-stamped comments + the `--reply-to` threading shape.

### Changed

- **Properties panel — default collapsed on first open** (BUG-139 v1.1 Q4).
  Sidecar field undefined → collapsed; explicit user toggle still persists.
- **Properties panel — click row to expand long values inline** with a left
  accent border + JSON pretty-print for arrays/objects (BUG-139 v1.1 Q5).
- **Properties panel — Edit-raw textarea auto-grows up to 10 lines** when
  frontmatter is long (BUG-139 v1.2, walk-1 owner note).
- **Comment rail — threaded display restored for `↪`-joined bodies**
  (BUG-138 Phase 5). `buildMarkdownThreads` now reads inline CommentMarks +
  sidecar entries (de-duped by author+ts); `parseRepliesFromBody` splits
  body-joined reply chains back into separate rail bubbles. Closes a silent
  regression where post-Phase-2 inline-only files showed an empty rail.
- **Markdown editor — active-thread visual highlight visibly pops**
  (BUG-083 markdown polish). Active CommentMark alpha bumped 0.22 → 0.42 +
  1px accent box-shadow + border-radius. Both light + dark themes.

### Fixed

- **Save-conflict false-positive banner on soft-break-wrapped markdown**
  (BUG-122 hypothesis 4). `normalizeForEchoCompare` now collapses single
  newlines between non-blank lines to spaces before the disk-vs-baseline
  compare. CommonMark equates them; tiptap-markdown does the same on
  serialize round-trip. Real external edits (added paragraph break,
  added / changed content) still surface as a banner.
- **ENH-128 walk-4 — HEIC drag-drop from Photos.app converts to JPEG and
  embeds inline.** Walk-4 verified live with a real iPhone HEIC; image-
  handling cluster closed. (Code shipped 2026-05-10; this cut closes the
  verification gate.)
- **ENH-102 — ⌘⇧⌫ delete current file with confirm.** Sprint 9 plumbing
  verified live via computer-use; native dialog fires + Cancel preserves
  the file on disk. (Code shipped 2026-05-07.)
- **BUG-091 — right-click "Move to Split View" in WorkingTabStrip.**
  Already shipped silently via Sprint 7 Phase 3c plumbing; flipped status
  with code-confirmed paper trail.

### Internal

- 6 stale `core/git/status.test.ts` assertions updated to match the
  shipped `formatGitStatusChip` (counts prefix; ref-only when clean —
  v0.7.0 walk rejected the empty-on-clean rule). All 10 tests green.
- Carry-forward queue cleanup — post-compaction queue in CLAUDE.md +
  docs/dev/active-sprint.md had 6 already-shipped v0.7.0 items listed as
  open; swept.
- BUG-122 diagnostic capture — owner's walk-1 spot-check captured the
  hypothesis-4 repro live; `~/.claude/duo/logs/last-conflict.log` payload
  pinned the soft-break-vs-space root cause deterministically.
- 29 new vitest cases total (parseRepliesFromBody · normalize · highlight
  · git-status formatter realignment). 649 total, all green.

## [0.7.1] — 2026-05-18

Sprint 18 — markdown source-of-truth chapter. Comments + track-changes move from sidecar JSON to inline CriticMarkup tokens; the frontmatter Properties panel surfaces what the editor used to hide; the browser pane closes its file:// auto-reload gap; navigator multi-select gets the ⇧-click + ⌘-A polish.

### Added

- **BUG-138** — Markdown comments + track-changes via inline CriticMarkup. Four-phase chapter:
  - **Phase 1** — Parser/serializer for all 5 ops (`{++…++}` / `{--…--}` / `{~~old~>new~~}` / `{==…==}` / `{>>id\|author\|ts\|body<<}`) with Duo's opinionated pipe-delimited metadata extension. 4 TipTap marks + tiptap-markdown integration. 65 unit tests.
  - **Phase 2** — Silent sidecar→inline migration on first load when a file has sidecar comments AND zero CM tokens. `duo author [<name>]` CLI verb + full 8-touchpoint plumbing. 22 unit tests. Closes "comments invisible to agent inspecting the file" (owner directive).
  - **Phase 3** — Six agent CLI verbs: `duo doc insert / delete / substitute / comment / accept / reject`. Disk-only edits via pure helpers (`core/markdown/docEdit.ts`); anchor matching against the stripped-CM view of the body; overlap-safe (refuses when the resolved range crosses an existing CM token). 31 unit tests.
  - **Phase 4** — Suggesting toolbar toggle (⌘⌥T) + auto-wrap typed text as `{++…++}` (via `appendTransaction`) + auto-wrap Backspace/Delete as `{--…--}` (via `props.handleKeyDown` at priority 1000) + bulk banner "N suggestions · Accept all · Reject all" + per-suggestion rail with ✓/✗ buttons + All/Mine/Agent/Others author-filter chips. Rail collapsible via chevron header.
- **BUG-139** — Frontmatter Properties panel above the markdown editor body. Always-visible when a file has YAML frontmatter; chevron-collapse persisted per-doc; "Edit raw" toggle reveals a textarea with live parse-error feedback; "+ Add properties" call-to-action for files without frontmatter. 17 parser tests.
- **ENH-148** — Navigator multi-select v2: ⇧-click range select (Finder-style, depth-first across expanded folders) + ⌘-A select-all (capped at cwd's immediate children, not the whole expanded tree) + `duo nav-state` exposes the full `selectedPaths: [{path, kind}]` array for CLI parity.
- **BUG-130** — Browser-pane `file://` tabs auto-reload when the underlying file mutates. chokidar watcher per file:// tab (250ms debounce); idempotent across nav-in-page; cleaned up on tab close. Parity gap with canvas mode closed; matters more after ENH-156 routed `duo open <html>` to browser by default.
- **`duo author [<name>]`** CLI verb — read or set the human author identity used to stamp CriticMarkup marks. Defaults to `$USER` on a fresh install. Agents use `DUO_AUTHOR` env var on per-op verbs (Phase 3).
- **Follow-ups (walk-1 owner asks):**
  - Suggest toolbar icon is a Lucide pencil-line with an accent fill-dot at the tip when ON (replaces wide "✎ Suggest" text label that broke the toolbar's fixed-width-button rhythm).
  - Track Changes rail is collapsible via the chevron header.
  - Git ribbon icon matches the per-folder repo chip's Lucide git-branch SVG (was unicode `⎇`).
  - Design-options playground at [`docs/research/frontmatter-panel-design.html`](docs/research/frontmatter-panel-design.html) — 5 decision cards for v1.1 refinements.

### Changed

- **BUG-135** — Git ribbon suppresses when the climb from cwd up to the matched repo root crosses an intermediate folder containing ≥2 peer-repo children. Aligns the ribbon's strictness with the per-folder chip's. Closes the false-positive where `~/Documents/GitHub/stoop` falsely claimed it was inside `~/Documents`'s repo. Same suppression applies to right-click "Open on GitHub" / "Copy GitHub URL" + per-file dirty dots.
- **BUG-141** — Settings.json banner wording reworded to make the upgrade-cycle semantic explicit: "Duo only replaces its own entry — it does not re-add or duplicate." Install behavior was already correct; the message read like Duo polluted the file on every version update.
- **BUG-139 design decisions locked (walk-1 gate):** 4 of 5 picks captured for v1.1. Q1 (row density) deferred; Q2=A (uniform mono values, no type styling), Q3=C (raw-YAML-only editing, no per-row inline edit), Q4=B (default collapsed on first open), Q5=B (click-to-expand long values inline).
- **Editor toolbar `flex-nowrap` + per-Btn `shrink-0`** so narrow-canvas widths scroll the toolbar horizontally rather than wrapping or compressing buttons.

### Fixed

- **BUG-136** — Clone modal's false "gh not authenticated" banner. Root cause: Electron's `execGit` PATH didn't include `/opt/homebrew/bin` so `gh` wasn't findable. `WELL_KNOWN_BIN_DIRS` now prepended to PATH for all execGit calls.
- **BUG-137** — Markdown link editing. Three walks of fixes in v0.7.1:
  - **walk-1:** replaced `markInputRule` with custom `InputRule` so `[text](url)` becomes just `text` (the bracketed label) instead of the URL.
  - **walk-2:** removed sentinel `return null` from the InputRule handler — TipTap's plugin treats null as "abort this rule" and was discarding the built transaction silently.
  - **walk-3:** built `LinkPromptModal` (portal-based React modal) to replace `window.prompt`. Electron renderers throw `prompt() is and will not be supported` on every call; both the toolbar link button and ⌘K were silently no-ops. Modal saves on Enter, cancels on Esc, includes a "Remove link" action. Plus: every link now renders its href as a native `title` tooltip on hover; `extendMarkRange('link')` before `setLink` so in-place edits update the whole span (not split it).
- **BUG-138 Phase 4c walk-3** — `Transaction.setSelection` throwing `RangeError: Selection passed to setSelection must point at the current document`. Root cause: my code built the Selection by resolving against `state.doc` (pre-`addMark`); the TR holds a new doc after addMark. Fix: split the chain — build `tr` first, then `tr.setSelection(Selection.near(tr.doc.resolve(...)))`.
- **BUG-138 Phase 4b walk-1** — typed text wrapped as one CM token PER CHARACTER (`{++a++}{++b++}{++c++}`). Root cause: `appendTransaction` stamped a fresh `ts` per TR; PM compares marks by attrs deep-equality so per-char ts → distinct marks → no text-node merging. Fix: drop `ts` from auto-stamped non-comment marks (standard CM tokens don't carry metadata anyway).
- **ENH-164** — Closed as already-shipped via `duo new-tab --claude --cwd <path>` (Stage 19c D27, 2026-04-26). The verb existed; the gap was discoverability. Memory rule updated to cite the canonical verb instead of the brittle `duo send "claude\n"` workaround.

### Internal / Architecture

- New `core/markdown/criticmarkup.ts` — pure parser/serializer for all 5 CM ops + Duo's pipe-delimited comment-body extension.
- New `core/markdown/docEdit.ts` — pure helpers for the agent CLI verbs. Stripped-CM-view position mapping + range-overlap detection.
- New `core/markdown/frontmatter.ts` — split/join helpers in `core/` so socket-server's doc-edit case doesn't need to import from `renderer/`.
- New `renderer/components/editor/extensions/SuggestingMode.ts` — TipTap extension with `props.handleKeyDown` (priority 1000) for the Backspace/Delete intercept + `appendTransaction` for the typed-text auto-wrap.
- New `renderer/components/editor/LinkPromptModal.tsx` — portal-based replacement for window.prompt; `requestLinkPrompt(currentHref): Promise<string | null>`.
- New `renderer/components/editor/TrackedChangesRail.tsx` + `trackedChanges.ts` — per-suggestion rail with kind/author/excerpt cards + filter chips + collapsible header.
- New `renderer/components/editor/FrontmatterPanel.tsx` + `frontmatterParser.ts` — Properties panel + defensive YAML parser.
- New memory rule: [`feedback_use_computer_use_for_keystroke_tests.md`](.claude/projects/-Users-geoffreydudgeon-Documents-GitHub-duo/memory/feedback_use_computer_use_for_keystroke_tests.md) — when a smoke-walk item needs real keystrokes, request computer-use access (apps: `["Electron"]`) and verify live BEFORE handoff.

## [0.7.0] — 2026-05-18

Sprint 17 — GitHub-integration cluster + multi-pane Send → agent
polish. Navigator becomes Git-and-GitHub-aware (status overlays,
clone modal, per-folder peer-repo affordances, right-click "Open
on GitHub"). Browser-pane "Send → Duo" pill becomes "Send → agent"
and the multi-pane gate + click bugs that made the CDP-injected
pill a second-class citizen are closed.

### Added

- ENH-156 — HTML verb-split. `duo open <html>` lands in browser, `duo edit <html>` lands in canvas. Replaces `<meta duo-open-in>` as the routing source of truth.
- ENH-158 — Boot-time self-healing CLI shim; `SHIM_DIR/duo` is the sole canonical install location and gets rebuilt automatically (PR #52).
- ENH-159 — Browser send-to-Claude carries DOM context + inspect mode (⌘⇧C / `duo inspect`). Three-state freeze machine with anchored pill; ⌘D ships and exits (PR #51).
- ENH-160 — `scripts/build-pkg.sh` Path-1 `.pkg` installer wrapper for distro packs (PR #50, closes Stage 21d-ii deferral).
- ENH-151 / ENH-152a — CLI surface for git status + clone + `gh auth` probe. New verbs: `duo git status`, `duo git clone`, `duo gh-auth`.
- ENH-152a v2 — Navigator shows a `⎇` Lucide git-branch icon on every repo-root folder row; hover reveals a chip popover (branch + dirty/ahead/behind). Five implementation rounds locked the final shape.
- ENH-152b — Per-file dirty dot in Navigator with STATUS-DIFF tooltip.
- ENH-152c — fsevents-driven Navigator git status invalidation (bounded depth, ignored caches).
- ENH-155 — Right-click "Open on GitHub" + "Copy GitHub URL" in Navigator + Git ribbon. Supports `github.com` + Enterprise `github.<company>.com`.
- ENH-146 — `skill/references/duo-atelier.css` kernel + class library doc. Closes the ~200-line CSS authoring tax per playground.
- ENH-147 v1 — Navigator multi-select. ⌘-click toggles non-contiguous; right-click → "Move N items to Trash…".
- FOLLOWUP-020 — `duo close-tab` CLI parity for the active working/terminal tab.
- FOLLOWUP-025 + v2 — File → "Clone from GitHub…" modal. Right-click "Clone GitHub repo here…". Atelier tokens; default-cwd from Navigator; in-progress + success panels; WCV-park on modal-open.
- ENH-162 — Clone modal pre-flight destination-collision check. Amber warning above the inputs + "Reveal existing folder in Finder" button. Clone button disabled until the collision resolves. Friendlier error when the clone still hits a collision.
- ENH-163 — "Send → Duo" pill renamed to **Send → agent** across all three implementations (React component + 2 CDP-injected IIFEs). Trailing `↗` removed.

### Changed

- ENH-144 — Close-tab focus shifts to the LEFT-neighbor file tab (Chrome / VS Code parity), right-neighbor fallback when leftmost was closed.
- FOLLOWUP-026 — Internal rename `files.openExternal` → `files.openPath`. The old name suggested URL opening but actually wrapped `shell.openPath` (local files). New `files.openExternalUrl` exposes the actual `shell.openExternal` for URLs.

### Fixed

- BUG-123 — Table-cell CellSelection now paints (Duo never imported `prosemirror-tables/style/tables.css`); 9-line CSS fix with Atelier accent overlay.
- BUG-124 — `~/.claude/duo/logs/` mkdir-p at boot to silence `writeConflictLog` ENOENT flood.
- BUG-125 — Symlink-resolved watcher path remap; canvas skill guidance + escape-hatch (PR #49).
- BUG-125 v2 — New `core/html/duo-normalize.ts` strips `data-duo-*` attrs + `[data-duo-style]` elements + re-serializes via outerHTML. Canvas reload on external write stays silent when the buffer is clean.
- BUG-126 — Canvas `⌘F` find stopped narrowing after the first character; rewrote via `findMatchesInDoc` + CSS Custom Highlight API; auto-scrolls current match.
- BUG-127 — Markdown paste landed in a code block instead of rendering; two rounds (force-close inline slice + `transformPastedHTML` for wrapped-markdown HTML).
- BUG-129 — `duo open <missing-file>` previously rendered a blank tab; now returns `{ok:false, error:"File not found: <path>"}` and no tab is opened.
- BUG-131 — ⌘A is now a real select-all in both (a) renderer modal inputs (Clone modal URL/parent) AND (b) browser-pane textareas (smoke walk pages, any playground form). Two-layer fix: capture-phase fallback in `useKeyboardShortcuts.ts` + un-broaden `KeyA` shortcut interception in `browser-manager.ts` to require `Shift`.
- BUG-132 + rev2 — Navigator right-click "Open on GitHub" was a no-op. Root cause: `files.openExternal` was `shell.openPath` (local files only), not URL-aware. New `FILES_OPEN_EXTERNAL_URL` IPC. Rev2 handled the peer-repo case where the parent dir is itself an unrelated repo — handler now prefers `childRepoMap[target]` over outer `gitSnap`.
- BUG-133 — `__duoClaudeLive` page-side gate was stale on browser tabs that weren't the active CDP target. New `BrowserManager.broadcastClaudeLive(live)` iterates all browser tabs via `webContents.executeJavaScript` (no CDP required). Round-2: payload also force-hides any visible pill DOM node when live flips false.
- BUG-134 — Send → agent pill click no-op on non-CDP-attached tabs. `CdpBridge.attach` no longer detaches the previous WC; all browser tabs' debuggers stay attached with their listeners + bindings live. `BrowserManager.addTab` also attaches CDP on every new tab.

### Filed (not yet shipped)

- BUG-130 — Browser pane `file://` tabs don't auto-reload when the underlying file is mutated via CLI. Elevated to architectural; on roadmap.
- ENH-164 — `duo terminal new --kind claude` CLI verb (post-cut).

## [0.6.15] — 2026-05-11

Sprint 16 close-out. A+B combined theme: install/upgrade chapter
end-cap + stability sweep. Plus a same-sprint user-toggle pivot for
the Claude Return-key behavior introduced in v0.6.13.

### Added

- **`duo claude-return [submit|newline]`** and **`duo shift-return
  [submit|newline]`** — toggle Claude-tab Enter key behavior per user
  preference. Both prefs persist in localStorage; bridged via the
  same theme-style IPC pattern (renderer source of truth, main
  caches, CLI overrides re-broadcast). ENH-142.
- **`duo doc conflict-log`** — print the most recent save-conflict
  diagnostic JSON at `~/.claude/duo/logs/last-conflict.log`. One
  keystroke beats opening DevTools. BUG-122.
- **Production-readable save-conflict diagnostic log.** Markdown
  editor + HTML canvas now write `~/.claude/duo/logs/last-conflict.log`
  on every "file changed on disk" banner. JSON payload: timestamp,
  path, trigger (watcher-dirty / save-pre-reconcile), surface
  (markdown / canvas), lengths, head/tail 80-char excerpts (post-
  normalize), `firstDiffOffset`, app version. Best-effort write;
  never blocks the banner.

### Changed

- **Default Claude-tab Return behavior: now `submit` (was `newline`).**
  ENH-127 v2 (v0.6.13) made plain Return insert a multi-line newline
  in Claude tabs with ⌘Return as the explicit submit. Owner feedback:
  surprising relative to every other terminal in the world. v0.6.15
  flips the default; the override capability stays behind the new
  `duo claude-return newline` toggle. Shift+Return → newline is
  unchanged (ENH-133 default).
- **Echo normalization for "file changed on disk" detection widened.**
  Was trailing whitespace only (BUG-107 v0.6.9). Now also catches BOM
  prefixes, CRLF→LF line endings, per-line trailing whitespace. Both
  the markdown editor's `recentlyWrittenBodiesRef` and the HTML
  canvas's `recentlyWrittenHtmlRef` got a TTL bump 2s → 5s on top
  (the original 2s could be undershot on slower machines). BUG-122.
- **`install-service` op #8 — pins.json bootstrap now iterates each
  pack's `PACK.json § defaults[].pin: true`** instead of the
  hardcoded WDD URL literal Sprint 15 left as transitional. Each
  pin's title is extracted from the canvas's `<title>` element so
  the display string survives without a hardcoded literal.

### Fixed

- **BUG-119 — fsevents SIGABRT crash on every Cmd-Q.** Disposes
  (`ptyManager.dispose() + filesService.dispose()` + flushes) moved
  from `window-all-closed` into `before-quit` so chokidar releases
  its native threadsafe function while the mutex is still alive. On
  darwin `window-all-closed` doesn't fire on Cmd-Q, so the prior
  shape leaked watchers into Node env teardown and SIGABRTed. macOS
  crash dialog no longer appears on quit.
- **FOLLOWUP-019 — HTML canvas now reconciles external file writes
  like the markdown editor has since v0.6.7.** All three layers of
  BUG-085 + BUG-099's fix mirrored from `MarkdownEditor.tsx` into
  `PageTab.tsx`: file watcher with clean/dirty branching, pre-save
  reconciliation read-disk before write, and `recentlyWrittenHtmlRef`
  echo guard. Closes the canvas-side silent-edit-loss class that the
  original Sprint 6 work left as deferred parity.
- **ENH-140 — install-service auto-cleanup of orphan files on
  upgrade.** Files retired by the current bundle are deleted on next
  install if their on-disk SHA still matches the prior recorded SHA
  (i.e. user hasn't customized). Customized files are preserved in
  place + logged. Empty parent directories swept up after.
- **Pin URL auto-migration on upgrade.** `pins.json` entries pointing
  at v(N-1) paths (e.g. `~/.claude/duo/help/what-duo-does.html`) get
  rewritten to v(N) successors (the pack-mirrored location). Closes
  the v0.6.13 "two WDD tabs on upgrade" known issue. Entries pointing
  at retired-no-successor paths (FAQ) get dropped. Idempotent;
  conservative — only acts on known PIN_RENAMES entries.

### Internal

- Filed FOLLOWUP-019 as the named follow-up that BUG-085's note (c)
  had left as an unnamed placeholder ("FOLLOWUP-NN: PageTab mirror").
- Audit corrected stale task statuses: BUG-085 (✅ Sprint 6 — entry
  was stuck at 🔴 IMMEDIATE for three sprints), BUG-103 (✅ v0.6.12).

### Known issues — carry-forward to v0.6.16

- **BUG-093** (Right-click tab → Move to Split View can crash the
  renderer) — instrumentation in place; CLI repro attempted this
  cut, did not trigger crash. Awaiting a user-triggered reproduction
  for the `[BUG-093]` trace + `[ErrorBoundary:WorkingPane]` stack
  combination the fix needs.
- **ENH-084** (aux pane focus glow) — v4 declined this cut. The task
  entry explicitly warns the next attempt should start with a live-
  click event-stream capture pass before any code change; mistimed
  for end-of-sprint.
- **BUG-079** (⌃⇧\` tab-cycle latency) — bumped to v0.6.16 to make
  room for BUG-122 swap-in.
- **BUG-122 deeper fix** — gated on the next production repro's
  `~/.claude/duo/logs/last-conflict.log` contents. The v0.6.15
  hardening (TTL + normalize + diagnostic log) should narrow the
  hypothesis space; the `firstDiffOffset` + head/tail excerpts in
  the log file name the root cause deterministically.
- **ENH-141 enterprise smoke** — owner-side validation owed on the
  work machine that surfaced the original install-path-hardening
  report (deferred SKIPs from the v0.6.14 walk).

## [0.6.14] — 2026-05-10

Sprint 16 commits 1 + 2 — two P0 hotfixes from the same enterprise-
machine session. Install-path hardening so `duo` works inside Duo
PTYs and Claude Code sandboxes without `.zshrc` edits; close-last-
browser-tab loop fix.

### Fixed
- **ENH-141** — `duo` CLI is now reachable by name inside Duo PTYs
  and Claude Code sandboxes. Pre-fix, both install paths landed at
  directories that aren't on PTY `$PATH` (`~/.claude/bin/duo` for
  `duo install`, `~/.local/bin/duo` for the Electron FirstLaunchBanner).
  Inside a sandboxed Claude Code session that blocks `.zshrc` writes,
  the CLI was only reachable by absolute path. The fix drops the
  binary at `~/.claude/duo/bin/duo` (SHIM_DIR) — the dir
  `core/pty-manager.ts` prepends to PATH at every PTY spawn for the
  `claude` shim — so `duo` works immediately inside Duo with no
  shell-rc edit. Reported by an enterprise user running Duo v0.6.13
  inside a managed Claude Code install.
- **BUG-121** — closing the last browser tab (or the only main-strip
  tab when an aux tab was pinned) no longer respawns a fresh
  about:blank in a loop. The BUG-020 + BUG-096 spawn-replacement
  guards retired alongside their motivation (the boot-time FAQ tab
  that retired in v0.6.13 ENH-135). `tabs.length === 0` is now a
  supported empty state — address bar empty, main slot collapsed,
  typing a URL self-heals back to a populated tab.

### Changed
- **ENH-141 companion** — FirstLaunchBanner's [Install] action also
  auto-appends a fenced `export PATH="$HOME/.local/bin:$PATH"` block
  to your shell rc (zsh / bash / fish) so the CLI works from external
  Terminal / iTerm too. Was previously a separate dismissible
  "Add to PATH" button row that users skipped. The banner success
  state surfaces the wire-up result inline (rc file written, already
  present, or manual fallback).
- **`duo install` tier-1 target** changed from `~/.claude/bin/duo`
  to `~/.claude/duo/bin/duo`. `duo doctor`'s known-targets list now
  shows both old and new paths so stale pre-ENH-141 symlinks are
  visible.

### Known issues
- Pre-ENH-141 stale `~/.claude/bin/duo` symlinks are not auto-cleaned
  on upgrade (FOLLOWUP-013). They're harmless — just unused files.
  Manually `rm` if you want a clean tree.
- BUG-119 (fsevents shutdown race producing SIGABRT every Duo quit)
  surfaced at Sprint 15 close-out is still open — visible in
  Console but doesn't affect normal usage.

## [0.6.13] — 2026-05-10

Sprint 15 — install-pipeline boundary reshape. FTUX content moves
into a new built-in pack (`packs/duo-default/`); install-service
stays hand-rolled for plumbing only. FAQ retired from default
install; boot-default browser tab logic deleted; pack-canvas /
pinned-tab idempotency contract documented as an ADR. Two
install-pipeline bug fixes from the v0.6.12 close-out tail.

### Added
- **ENH-138** — `packs/duo-default/` built-in pack ships default
  FTUX content (`what-duo-does.html` today; future Beginner's
  Guide will land here per ENH-137). New `PackManifest.builtIn`
  schema flag marks built-in packs (declarative forward-compat
  flag for any future Stage 28 uninstall tooling — today's
  `duo pack uninstall` operates on Stage 21d distro packs at
  `extra-packs/`, not Stage 28 lesson packs at `packs/`, so the
  flag is informational-only).
- **ADR** — `docs/DECISIONS.md § "Pack canvas / pinned tab
  idempotency contract"`. Establishes how the pack first-launch
  hook cooperates with pin-restore (BUG-057). Full cooperation
  matrix across 5 boot scenarios + trade-offs + alternatives
  considered.
- **`examples/lesson-pack-template/`** — ENH-136 retired
  `packs/claude-code-basics/` from the default install; the pack
  becomes a copy-and-customize template for pack authors.
  Includes `PACK.json` (renamed `name: "lesson-pack-template"`),
  internal `claude-code-basics` references bulk-renamed, plus a
  new `README.md` walking the copy-customize flow.

### Changed
- **ENH-138** — install-service op #8 (`electron/install-service.ts:509`)
  pivoted: drops FAQ pin entirely, seeds `pins.json` with WDD only
  (pointing at the new pack canvas location).
- **ENH-135** — `defaultLandingUrl()` + `helpUrl()` deleted from
  `electron/browser-manager.ts`; `addTab()` default param flipped
  to `'about:blank'` (via `newTabUrl()`); `bootDefaultTab`
  constructor option dropped from `BrowserManager`. Cold-start
  with no persisted session = empty browser pane (WDD opens
  pinned via BUG-057 pin-restore, NOT via a "boot tab").
- **ENH-138** — first-launch hook in `electron/main.ts` gains
  pin-set idempotency check. Pack canvases already pinned in
  `pins.json` don't double-open with NAV_EDIT; new pack canvases
  (URL not in pins) fire NAV_EDIT and open as fresh tabs.
  Pack-version bumps re-fire for everyone; idempotency check
  still applies.
- **BUG-118** — `cut-version` skill adds post-build
  `git diff --quiet cli/duo` guard at Step 4. Failed cuts no
  longer silently ship stale binaries.
- **BUG-116** — `scripts/dist-signed.sh` passes explicit
  version-pinned DMG path to `validate-dmg-launch.sh` (was: relied
  on alphabetical glob, silently validated v0.6.8 instead of
  v0.6.12 during the previous cut).

### Removed
- **ENH-135** — `help/faq.html` retired to `docs/legacy/faq.html`.
  Default install no longer ships FAQ.
  `fork.config.default.json § helpPinnedFiles` drops `"faq.html"`.
- **ENH-136** — `packs/claude-code-basics/` removed from default
  install. Moved to `examples/lesson-pack-template/`. Existing
  v0.6.12 users keep their `~/.claude/duo/packs/claude-code-basics/`
  folder (install-service mirror doesn't delete) until they
  manually clean up.

### Fixed
- **ENH-138 upgrade-path** — existing v0.6.12 users now see the
  new WDD content on first launch via the idempotent first-launch
  hook (NAV_EDITs the new pack URL when not already pinned).
  Closes the gap owner raised at Sprint 15 smoke walk: "stale
  Duos on upgrade won't see the new WDD."
- **BUG-117** (shipped 2026-05-10 in this branch, before the
  Sprint 15 work) — `installSessionStartHook()` wrapped in
  try/catch; enterprise-locked `~/.claude/settings.json` no
  longer aborts the install (PATH shim remains the load-bearing
  priming path; SessionStart hook is the redundant safety net).

### Known issues
- **Upgrade users see two WDD tabs** on first launch after
  upgrading from v0.6.12: their stale pinned WDD (pointing at the
  v0.6.12 `~/.claude/duo/help/` copy that install-service didn't
  delete) + the fresh new pack-located WDD (auto-opened via the
  first-launch hook). One-time friction — close the stale tab,
  optionally re-pin the new. Smoother upgrade migration (auto-
  rewrite stale pins.json URLs) filed in
  `docs/dev/active-sprint.md § Sprint 15 carry-over` for a
  future enhancement.

## [0.6.12] — 2026-05-10

Sprint 14 — JSON/YAML viewer-editor (pulled forward from v0.6.13) +
visibility-tooling cluster + view-source panel-fill + image-handling
close-out + per-Claude-tab Return semantics finally working.

### Added
- **ENH-110 — JSON / YAML viewer-editor as a new `kind: 'json'` tab** —
  Tier 3 collapsible tree (`@uiw/react-json-view/editor` with click-to-edit
  values) + raw-text source toggle (CodeMirror with JSON / YAML language
  extensions + `@codemirror/lint` inline error markers). Single tab kind
  for both formats; format implicit from path extension (`.json` / `.jsonl`
  / `.har` / `.webmanifest` → JSON; `.yml` / `.yaml` → YAML). Source-mode
  save runs `parseSource()` first and refuses to save invalid input;
  failures show a three-layer error banner (friendly summary → pattern-
  matched hint → raw V8 / js-yaml message). Revert button restores the
  last-saved buffer. Files >1 MB drop to a read-only source-only view
  (tree render cost is prohibitive at scale). Autosave on debounce
  (800ms) matching MarkdownEditor / PageTab.
- **ENH-122 — `duo dom <selector>` queries the main renderer's DOM** —
  selector / `--attr` / `--text` / `--computed <props>` / `--all` modes;
  `--js "<expr>"` evaluates an arbitrary expression in the renderer
  scope. Routes through a new `queryRendererDom` NavBridge method using
  `webContents.executeJavaScript`. Bare `duo dom` keeps the legacy
  browser-pane HTML dump (CDP) — disambiguation key is "any args at all
  → renderer." Closes the renderer-DOM blind spot that ate 30+ min of
  hypothesis-test cycles in Sprint 12.
- **ENH-117 v2 / FOLLOWUP-015 — view-source replaces the prose / canvas
  area in-place (was a centered modal in v1)** — same `'duo-view-source'`
  window-event funnel; three triggers (`⌘⌥V` chord, View menu entry,
  tab right-click). Read-only per owner entry-gate pick on scope.
  Toggle UX: same chord re-closes; Done / Esc dismiss.
- **ENH-119 — selection tint covers images** — both surfaces. Markdown:
  ProseMirror plugin in `DuoImage.ts` decorates images in the selection
  range via `Decoration.node`. Canvas: helper at `imageSelectionTint.ts`
  toggles a `data-duo-image-in-range` attribute on `<img>` based on
  `range.intersectsNode`. Runtime attribute stripped on save.
- **ENH-127 v2 — per-Claude-tab Return = newline; ⌘Return = submit**
  (the v1 reverted in v0.6.11 — this one works). Key discovery:
  Option+Enter sends `\x1b\r` (ESC+CR) which Claude reads as "literal
  newline within input"; plain `\n` and `\r` both submit. v2 writes
  `\x1b\r` on plain Enter and `\r` on `⌘Enter`. Returns `false` on all
  event types (keydown / keypress / keyup) to suppress xterm's default
  `\r` write; only writes the byte on keydown to avoid duplicates.
- **ENH-128 — HEIC / HEIF / RAW paste + drop convert via `sips`
  fallback** (closes walk-3 FAIL on the v1 attempt). Layered: `nativeImage.
  createFromBuffer` → if empty AND macOS AND HEIC/HEIF/RAW MIME →
  spawn `sips -s format jpeg <in> --out <out>`; clean up temps in
  finally. Walk-4 verified the same iPhone HEIC source that failed
  walk-3 now transcodes successfully.
- **ENH-129 — PDF drop inserts at the drop point** — extracted drop
  coordinates via ProseMirror's `view.posAtCoords` and threaded the
  position into `handleAssetPaste` as a new `insertPos` param. Same
  fix benefits image drops too. Original filename preserved as the
  link label (`<safe-original-base>-<stamp>-<hash>.pdf`).
- **ENH-130 — `duo edit / open / view --reveal` auto-expands the working
  pane + focuses main** when creating an artifact for the user. Without
  it agent-created files can land in a hidden / collapsed canvas and
  the user has to hunt for them. Idempotent — already-revealed pane
  stays put, only re-focuses.
- **ENH-131 — Tab right-click → "Open in browser"** — inverse of
  ENH-097's "Edit in canvas." Right-click on a `kind: 'page'` tab
  backed by an HTML file → close the canvas tab + re-open as a browser
  tab so scripts run / buttons fire. Mirrors the existing canvas-from-
  browser flow.
- **ENH-132 — ARIA tab roles** — `role="tablist"` + `aria-label` on each
  tab strip parent; `role="tab"` + `aria-selected` on each per-tab
  button. Three strips covered: WorkingTabStrip (working + browser),
  TabBar (terminal). Screen readers now announce "Smoke walk, tab 6 of
  12, selected" instead of "Smoke walk, button."
- **ENH-133 — Shift+Enter in Claude tabs writes a soft newline** (matches
  Slack / Discord / GitHub / gmail / claude.ai web muscle memory).
  Relaxed the ENH-127 v2 entry condition to admit `Shift+Enter`; the
  existing `e.metaKey ? '\r' : '\x1b\r'` byte logic routes Shift+Enter
  to newline (no metaKey) and `⌘⇧Enter` to submit (matches "Cmd held =
  submit").

### Changed
- **ENH-118 — image-handling decisions captured.** Owner-walked the four
  open questions: GIFs animate by default (no code), SVG inert via
  `<img>` (no code), HEIC convert (filed as ENH-128 above), PDF →
  link insert (filed as ENH-129 above). Two doc-only picks live in
  `skill/SKILL.md`; the other two shipped as features.

### Fixed
- **BUG-115 — closed as fixture-write race (NOT a BUG-107 regression).**
  Diagnosis: `MarkdownEditor.tsx`'s BUG-107 normalize() is intact at
  both watcher and save-pre-conflict paths; the 3-byte content delta
  was non-trailing-whitespace (so normalize couldn't elide it); fixture
  file mtime confirmed it was rewritten while the editor held the
  prior baseline. The dialog fired correctly. Resolution: agent-
  behavior rule (CLAUDE.md § 7d + memory) — never rewrite a fixture
  file the editor has open in the running dev session; either close
  the tab first or use a unique path per walk-rev.

## [0.6.11] — 2026-05-09

Sprint 13 — paste-image v2 (closes the v0.6.10 blob-URL-in-source trade-off) + auto-redistribute panes on aux-open + on-demand 3-way chord pairing + read-only view-source overlay + several race-class fixes that surfaced during the cut walks.

### Added
- **ENH-126 — auto-redistribute panes on split-open** — opening a file in split view auto-snaps the column ratios to the canonical even shape: terminal-visible → 33/33/33; terminal-collapsed → main+split 50/50. Both code paths (`splitViewMoveTabByPath` for files, `splitViewMoveBrowserTab` for browser tabs) trigger it. Owner-directed pull-in mid-sprint.
- **ENH-099 — `⌘⌥4` 33/33/33 chord** — on-demand sibling of ENH-126. Three trigger surfaces: `⌘⌥4` keyboard chord, View → Pane size → "3-way even (33/33/33)" menu entry, `duo split 3way` CLI verb (also accepts `3-way` and `even-3way` aliases). Same canonical layout helper. Walk-3 surfaced + walk-4 fixed: chord now resets BOTH file-aux AND browser-aux inner divider (pre-fix only touched file-aux's splitPct).
- **ENH-125 — `duo image insert <path>` works against canvas** — closes the v0.6.10 explicit `(c)-Deferred` parity disposition. PageTab subscribes to the same `EDITOR_IMAGE_INSERT` IPC; canvas tab now responds when active. CLI verb takes the same args; either surface wins.
- **ENH-117 v1 — `⌘⌥V` view-source modal (read-only)** — centered modal showing the active surface's raw source (markdown body+frontmatter for editors; pretty-printed HTML for canvases). Both surfaces gated on `isActive` (one overlay across the app at a time). Copy / Esc / backdrop-click dismiss. Atelier-styled. v2 panel-fill + menu/tab-context entry filed as **FOLLOWUP-015** for a future cut.

### Changed
- **FOLLOWUP-014 — paste-image v2 closes the v0.6.10 blob-URL-in-source trade-off.** Markdown source now carries `![](image-<stamp>.png)` (relative); custom `DuoImage` NodeView resolves via `files.read` at mount + hydrates a per-tab blob URL into the rendered `<img>`. Canvas surface mirrored via `imageHydrate.ts` (MutationObserver) + `serialize.ts` swap (src ↔ data-duo-original-src at save time). 4 vitest fixtures green for the serializer swap. Files survive reload, git commit, `cp` to another machine.
- **ENH-116 — smoke-walk SKILL.md trim** — 604 → 241 lines (60% reduction); detail moved to four reference docs at `.claude/skills/smoke-walk/references/` (`restart-and-preflight.md`, `clean-state-checks.md`, `result-format-and-parsing.md`, `manifest-authoring.md`). No content lost. Closes the runtime-truncation problem where HARD RULES near the bottom of the file silently dropped from Claude's working context.

### Fixed
- **BUG-101 v2 — `duo edit <path>` auto-focuses the new tab.** Sprint 9's "scratchpad ref" pattern relied on a wrong React semantics assumption: `setState` updaters DON'T run synchronously during dispatch — they run at commit time. So when the post-`setFileTabs` `if (pendingActivationRef.current)` check ran, the ref was still null and `setActiveWorking` never fired. v2 reads the latest committed `fileTabs` via `fileTabsRef` and decides activation outside the updater.
- **BUG-112 — `duo doc read` (no path) returns the active editor's content.** Pre-fix every mounted MarkdownEditor responded to the IPC; first reply won; `duo doc read` returned an arbitrary tab's content. Same `isActive` gate pattern as ENH-125's image-insert race fix. Per-tab `isActive` prop threaded from WorkingPane § renderFileTab.
- **FOLLOWUP-014 walk-2 sub-fixes** — two latent bugs surfaced during walk-1 canvas verification:
  - PageTab's `lastSavedRef` re-baseline was firing on every wire-effect re-fire (deps include `handleShortcut → save → dirty`). Inserting any content captured the post-insert DOM as the dirty-detection baseline → save saw `htmlChanged=false` → silent autosave no-op. Gated re-baseline behind `baselinedRef` — fires once per path-mount only.
  - PageTab + MarkdownEditor's `onImageInsert` IPC subscription raced across all mounted instances; first reply won; image landed in the wrong file when older session-restored tabs were present. Fixed by threading `isActive` through WorkingPane § renderFileTab + ref-gating both handlers.

### Reverted
- **ENH-127 — per-Claude-tab Return → newline.** Implemented + reverted same day after walk-3 live-test confirmed Claude Code's input loop treats `\n` and `\r` identically at the line-discipline level. Renderer-side intercept can't deliver the desired UX without Claude Code itself differentiating. tasks.md entry documents four future paths if the problem gets re-prioritized (Claude Code adds raw-newline mode, Duo-side composer window, anti-accidental-submit heuristic, etc.).

## [0.6.10] — 2026-05-09

Three sprints in one cut. Sprint 10 (SaveControl pill + autosave toggle) and Sprint 11 (Obsidian autocomplete cluster + BUG-104/107 root-cause) accumulated since v0.6.9; Sprint 12 was course-corrected mid-flight when the prior cloud agent shipped image VIEWER chrome (ENH-111) instead of paste-image (ENH-108, the actual ask) — local Claude shipped ENH-108 alongside before the cut fired. Both ship together.

### Added — Image handling (Sprint 12)
- **Image viewer v2** (ENH-111) — toolbar over the image area: zoom in/out (+/−, ⌘/⌃-wheel), click-toggle fit/manual, fit-to-window, 1:1 actual size, copy-image, dimensions + file-size readout (e.g. "1440 × 900 · 312 KB"). Right-click → native context menu (Copy image / Copy path / Open in default app / Reveal in Finder / Fit / 1:1). Drag-pan when zoomed past container.
- **Paste-image into markdown editor** (ENH-108) — ⌘V or drag-drop an image into the editor saves it alongside the active doc as `image-<YYYYMMDD-HHMMSS>-<hash>.<ext>` and inserts inline. Supported: png, jpg, jpeg, gif, webp, svg, bmp, tiff. Untitled buffers warn-and-decline.
- **Paste-image into canvas** (ENH-108 mirror) — same flow on the HTML canvas surface (PageTab). Editor-canvas parity per CLAUDE.md § 4.
- **`duo image insert <path> [--alt "…"]`** (ENH-108 CLI) — agent-driven image insertion: source bytes copied alongside the active doc, inserted at caret. Full plumbing landed (types / preload / main dispatch / socket-server / CLI verb / agents/skill cheat-sheets / CLI-COVERAGE). v1 markdown-editor target only — canvas CLI parity deferred to ENH-125.

### Added — Sprint 12 polish
- **Terminal-tab right-click → Reveal in navigator** (ENH-115) — context-menu entry on terminal tabs jumps the file tree to that tab's CWD and surfaces the reveal chip. Reuses the existing `duo reveal` flow (no new IPC).
- **Renderer console forwarder** (ENH-121) — in dev mode, every `console.log/warn/error` from the renderer prints to dev stdout prefixed `[renderer:level] (file:line)`. Filters Vite + Electron-security noise. Dev-only (`!app.isPackaged`). Single highest-leverage observability addition; would have saved ~90 min on Sprint 12 walk-rev3 image-render diagnosis.

### Fixed — Sprint 12
- **Markdown table-cell copy yields the cell text, not `[table]`** (BUG-108) — new `TableCellCopy` extension at priority 1000 intercepts clipboard text serialization for slices that begin with a table node, returning plain text via `Fragment.textBetween('\n', '\t')`. Whole-table selections fall through to tiptap-markdown's existing markdown-table serializer. Pre-fix: ProseMirror's `Selection.content()` wraps intra-cell text in `<table><tr><td>`; tiptap-markdown's table serializer rejected the wrapped slice; fallback wrote the literal `[table]` placeholder.
- **Image rendering in the renderer** (ENH-111 + ENH-108 walk-rev3 fix) — three layered fixes after walk-rev2/3 broken-icon symptoms: (1) registered `duo-asset://` custom protocol on default + `persist:duo-browser` sessions for `file://` cross-origin loads, (2) updated CSP `img-src` to allow `blob: data: file: duo-asset:`, (3) ImageView + paste-image insert switched to blob URLs via `files.read` (sidesteps custom-scheme cross-origin block for images). Final root cause was actually a layout misread (split-view squished image-viewer pane); infrastructure fixes landed regardless as insurance.
- **Smoke-walk localStorage key collides across walks of the same version** (BUG-110) — `.claude/skills/smoke-walk/generate.mjs` now keys by manifest filename (`basename`) instead of bare version. Sprint 11's wikilink walk + Sprint 12's image-viewer walk no longer fight for `worksheet:smoke-walk-v0.6.10`; user's typed walk notes no longer silently overwritten by stale state from a prior walk on the same version base.
- **Wrong feature shipped catch** (BUG-111) — closed by shipping ENH-108 paste-image (the actual ask) alongside the already-shipped ENH-111 image viewer (the misread). Owner-flagged mid-sprint; corrected before cut.

### Added — Save UX (Sprint 10 anchor)
- **SaveControl pill** (ENH-103 + ENH-104) — replaces the prior "Saved/Saving…" text + Save button with a single four-state pill (Saved · Save · Saving… · Failed-retry). Both editor and canvas surfaces. Hover-reveal autosave on/off toggle adjacent to the pill. Per-app localStorage preference, cross-tab sync via `duo:autosave-changed` CustomEvent.

### Added — Obsidian autocomplete (Sprint 11 anchor)
- **`[[` wikilink autocomplete** (ENH-096 B.2) — type `[[` in a vault file, popup shows fuzzy matches against vault files; ↑↓/Tab/Enter to insert as `[[Basename]]`. Custom `findWikilinkMatch` rejects mid-existing-`[[Foo]]` text to prevent false-positive triggers on caret moves.
- **`@` filename autocomplete** (ENH-105) — same vault index source; inserts canonical `[[wikilink]]` form so vault round-trip is unified across triggers. Custom `findAtMentionMatch` rejects mid-word `@` (email-address protection).
- **`⌘O` vault quick switcher** (ENH-096 B.4) — centered overlay sourcing the same vault index. Distinct from `⌘⇧A` (open-tabs only).
- **`.obsidian/` directory visible** in the navigator (ENH-109) — always-visible dotdir, sibling to `.claude`.
- **`[[Does Not Exist]]` cmd+click creates the file** (ENH-114) — Obsidian-parity. Path-bearing forms (`[[notes/Foo]]`) auto-mkdir the parent. 17 unit tests pin the create-path contract.

### Fixed
- **`duo open <https-url>` reliably surfaces the new browser tab** (BUG-101 browser half) — defensive `browser:focus-gained` push from socket-server now sends the proper `{tabId, slot}` payload (was `null` pre-fix, which the renderer's Phase-3c-shape handler dereferenced and threw on).
- **`duo edit <non-existent-path>` mounts an empty editor** (BUG-106) — pre-flight existence check pre-creates the file with `files.write`'s mkdir-p semantics. Symmetric with `⌘N` flow.
- **Right-click → Copy path actually fires** (BUG-105) — clipboard write routed through new `clipboard:write-text` main-process IPC. `navigator.clipboard.writeText` silently rejects inside native NSMenu callbacks; this works around it. Also added Copy URL / Copy path entry on the aux-browser slot's right-click menu (was missing entirely).
- **"File changed on disk" false-positive on first edit** (BUG-104 + BUG-107) — root-caused: tiptap-markdown's serializer normalizes trailing whitespace on round-trip; `# Index\n\n` from disk parses then re-serializes as `# Index\n`. Pre-fix, save's pre-save reconciliation check compared raw strings and false-positived for any file with a trailing blank line. Fixed in BOTH save (line 681) AND watcher reconciliation (line 580) paths via trailing-whitespace normalization. Real conflicts (substantive content drift) still surface the banner.
- **Right-click → Move to Split View** entry now reliably appears on tab right-click (BUG-091) — silently resolved by Phase 3c plumbing; verified Sprint 11.
- **`useAutosavePreference` no longer triggers React "set during render" warning** when toggling autosave with multiple editors mounted — read current value through ref + write outside the setState updater.
- **Aux-browser tab right-click** now shows Copy URL / Copy path / Move back to main (was no menu at all pre-fix).

### Changed
- **Skill procedure docs** — CLAUDE.md § 7c + smoke-walk skill § 5b: agent must verify clean app state (no error overlay) before every smoke-walk handoff. Encoded after a walk-1 violation where a PluginKey collision crashed the editor under an otherwise-healthy smoke-walk page.
- **`findVaultRoot` + `resolveWikilinkInVault` extracted** from `App.tsx` to `renderer/components/editor/wikilinkResolver.ts` so the autocomplete features share the vault detection. Plus a new `walkVaultFiles` bulk-collect helper for the autocomplete UI's ranking source.

### Known issues / v1 trade-offs
- **Paste-image markdown source carries `![](blob:...)` URLs** (FOLLOWUP-014) — non-portable across reload. v1 ships unblock; v2 plan: custom Image NodeView storing relative paths and resolving via `files.read` at mount time.
- **Canvas paste-image markdown source same blob-URL trade-off** — same v2 plan applies.
- **`duo edit` doesn't auto-focus the opened tab** (BUG-101) — workaround: click the tab manually after open, or use the file navigator. Fix queued.
- **Escape on `[[` / `@` autocomplete popover** has a portal-cleanup race. Workaround: type any char, click outside, or just Enter to insert.
- **BUG-100** Send→Duo pill in aux browser pane — deferred (CdpBridge multi-attach refactor needed).
- **BUG-093** split-view crash — still owner-blocked (needs live repro + console traces).

### Deferred to Sprint 13+
- **Canvas `duo image insert` CLI parity** (ENH-125) — v0.6.10 markdown-only; canvas surface uses paste / drop today.
- **Image-handling cluster polish** — image-in-selection tint (ENH-119), copy-paste-out preserves image bytes (ENH-120), image-type discussion (ENH-118).
- **View-source for markdown / HTML** (ENH-117).
- **Renderer DevTools tooling** — `duo dom <selector>` (ENH-122), `duo devtools` (ENH-123), `duo layout` (ENH-124). Filed after Sprint 12 walk-rev3 retro exposed the renderer-debugging blind spot.
- **`.claude/skills/smoke-walk/SKILL.md` trim** (ENH-116) — file is 600+ lines, runtime truncation risk.
- **JSON viewer** (ENH-110) — research doc at `docs/research/data-primitives-canvas.html`.
- **CSV / TSV** (ENH-111 cluster — separate from the now-shipped image viewer).

## [0.6.9] — 2026-05-07

Sprint 9 — wikilinks cmd+click closure (the v0.6.8 P0 carry-over) + pane-jump chord set + `duo edit` reliability + ⌘⇧⌫ delete file + new browser tab caret fix + Distro Pack Builder Workshop substrate + automated regression coverage for BUG-056.

### Added

- **ENH-098 — Pane-jump chord set + `duo focus-pane` CLI verb.** New chords that JUMP focus directly to a named pane (vs. ⌘\` which CYCLES): ⌘⇧L → terminal, ⌘⇧; → main working pane, ⌘⇧' → split-view aux. CLI parity via `duo focus-pane <terminal|main|aux>`. Chord originally specced as ⌘⌥L/;/' but re-picked at walk-1 — system-level window managers (Raycast / similar) intercept meta+alt before the renderer sees it. Aux-with-browser-tab is no-op'd with a console hint pending a future browser-pane focus IPC.
- **ENH-102 — `⌘⇧⌫` deletes the active file (with confirm).** Mirrors the right-click → Move to Trash flow on a working-pane file tab. Browser tabs and terminal tabs explicitly out of scope (`⌘W` already handles tab close). Soft-success on ENOENT — file's gone, user's intent is still "close this tab."
- **ENH-112 — Distro Pack Builder Workshop.** New repo-only `distro-pack-builder/` folder ships a guided tutorial for first-time pack builders: scoped CLAUDE.md, README, 11-step playground.md walking scaffold→customize→validate→build→smoke→distribute, project-scoped assistant skill at `.claude/skills/pack-builder-workshop/`. Defers to the canonical global `/pack-builder` skill for mechanical work (validate / build-zip / build-pkg / build-bundled-fork). The workshop skill is repo-resident only (NOT synced to `~/.claude/`) so it activates only for people working IN the repo, not every Duo user.
- **`files.dirExists` IPC + `host-api.ts` type** — directory-aware sibling to `files.exists`. Added because the wikilink vault-root walker (ENH-096) needed to detect `.obsidian/` directories; `files.exists` strictly returns true only for regular files (BUG-039 semantic preserved for session-restore).
- **`data-duo-workingpane-aux` marker** on the aux container in `WorkingPane.tsx` — disambiguates aux from main when both have editors mounted (split view).
- **`findVisibleWorkingPaneCE(scope)` helper** in App.tsx — visibility-aware editor finder. Filters by `offsetParent !== null` so focus calls land on the VISIBLE editor, not whichever display-toggled invisible tab won the DOM-order race. Backs both ENH-098 chord set AND `openFile`'s post-rAF .focus().

### Fixed

- **ENH-096 walk-2 / wikilinks cmd+click.** Two-phase fix closes the v0.6.8 P0 carry-over. Walk-0: extracted `resolveWikilinkTargetAtClick` helper that handles Text-node targets via `parentElement` + falls back to a pos-based decoration lookup using `PLUGIN_KEY.getState(view.state).find(pos, pos)`. Walk-1: `findVaultRoot` was using `files.exists` which strictly returns true only for regular files — `.obsidian/` is a directory → walker climbed past every real vault root. Switched to the new `files.dirExists`. cmd+click now opens the resolved target reliably.
- **BUG-101 walk-2 / `duo edit` editor-routed half.** Three layers of bug. (1) React anti-pattern: `setActiveWorking` was nested inside the `setFileTabs` updater, allowing React 18+'s automatic batching to land the inner setter in a different render than the tab addition. Lifted to `pendingActivationRef` + post-updater flush. (2) DOM-level focus on the editor's contentEditable wasn't firing — added a two-rAF `.focus()` chain mirroring `newBrowserTab`'s address-bar dance. (3) The query selector hit invisible tabs because BUG-046 keeps every file-tab renderer mounted (display-toggled). Routed through `findVisibleWorkingPaneCE('main')` which filters by visibility. Tab now reliably surfaces AND caret lands in the editor; first keystroke writes into the new file.
- **BUG-109 / `⌘T` new browser tab caret in URL bar.** Owner walk-1 diagnostic was the smoking gun: `document.activeElement.tagName === 'INPUT'`, `dataset.duoAddressbar === 'true'` — DOM focus was correct on the address bar input, but the input's caret rendered grey/inactive, meaning OS-level keyboard focus stayed on the new browser tab's WCV (renderer didn't own OS focus). Fix: call `keyboard.reclaimFocus()` BEFORE the rAF chain in newBrowserTab so by the time `.focus()` fires, the renderer owns OS focus and the URL input's caret renders blue/active.

### Changed

- **BUG-056 — pill gating regression now AUTOMATED.** Owner-flagged at walk-2: *"WHY AM I SEEING THIS IF YOU TEST IT AND IT PASSES DON'T SHOW ME THIS."* Added `electron/cdp-bridge.test.ts` with three tests asserting on the IIFE source string: (1) the literal `if (!window.__duoClaudeLive)` guard is present, (2) it sits BEFORE `ensurePill()` so the pill never even mounts before the gate fires, (3) exactly one active code-site reads the flag (excluding documentation comments). Removed BUG-056 from the smoke-walk skill's "Mandatory regression items" section. CI catches future refactor breaks before they ship; manual walk no longer required.
- **`SELECTION_OBSERVER_IIFE` exported** from `electron/cdp-bridge.ts` for unit-test access. The CDP-injected IIFE strings can't be unit-tested by execution (they run in the page context), so we test invariants on the source.
- **`smoke-walk` skill — removed BUG-056 mandatory-item entry + added a hard rule** against re-listing items that have automated coverage. Keeps the manual walk to things CI can't verify.

### Deprecated / Deferred

- **ENH-091 caret seed for fresh canvases.** Deferred indefinitely per owner directive (walk-2): *"this is a low priority bug and we should not revisit for a LONG time unless the console provides a smoking gun and obvious fix."* Walk traces showed the seed APPLIES correctly AND sticks across the next animation frame (`stillInSeededP: true`) — but typing still lands in the H1 title. The override fires AFTER rAF, after Chromium's internal layout pass, which is unfixable without a different architectural approach. Diagnostic instrumentation stays in code (cheap to keep, helps a future investigator).

### Known issues / Sprint 10 carry-overs

- **BUG-101 browser-routed half** — `duo open <url>` sometimes returns ok with the tab present in BrowserManager state but the renderer's working pane doesn't flip to browser-kind, so `duo url` returns about:blank from a stale CDP attach point. The editor-routed half is fixed (above); the browser side is the same shape but a different code path.
- **BUG-100** — Send → Duo pill missing on text selections inside the split-view (aux) browser pane.
- **BUG-102** — split view goes blank while ⌘⇧A palette is open (aux WCV mute too aggressive in narrow-split layouts; owner-flagged "non urgent").
- **BUG-104** — `⌘⇧;` chord triggered the file-changed-on-disk reload dialog during walk-3 (low — possible chokidar reconciliation race).
- **BUG-105** — right-click → Copy path on a tab is a no-op (menu entry exists; action doesn't fire).
- **BUG-106** — `duo edit <non-existent-path>` opens the tab but the editor errors with ENOENT on initial read. Recommend: mount empty buffer + flag as new-file (symmetric with `⌘N` flow).
- **ENH-114** — cmd+click on `[[Does Not Exist]]` wikilink should create the file at the vault root (Obsidian parity, owner-requested).
- **FOLLOWUP-013** — BUG-093 right-click → Move to Split View renderer crash; instrumentation landed v0.6.7, awaits a clean repro.

## [0.6.8] — 2026-05-06

Sprint 8 close-out — Stage 21d cohort distribution lands as the v0.6.8 anchor. Plus the ⌘⇧A tab-search palette, Obsidian-vault-friendly editor (wikilinks + sidecar convention), playground/canvas modality lock, three Phase-0 polish items, and walk-1 root-cause fixes for the autosave race + the surfaced-during-pre-walk distro-pack uninstall bugs.

### Added — Stage 21d: distro packs (the cohort distribution anchor)

- **Distro pack discovery + atomic install pipeline** (Stage 21d-i). Auto-scans `~/.claude/duo/extra-packs/` on launch; validates plugin manifest + `requiresDuoVersion` hard-block; decomposes plugin source into standalone destinations under `~/.claude/skills/<distro>-<name>/` and `~/.claude/agents/<distro>-<name>.md` (auto-discoverable by every Claude Code session). Atomic-replace via per-pack provenance manifest. CLAUDE.md merge between distro-managed markers (coexists with Duo's own ENH-088 block + other distros).
- **`duo pack list` / `duo pack uninstall <name>` CLI verbs** (Stage 21d-iii). Uninstall reads the provenance manifest and atomically removes every tracked file + the CLAUDE.md block + the manifest itself; source pack folder preserved.
- **`pack-builder` skill** (Stage 21d-ii). Canonical authoring path. Walks scaffold → validate → build-zip / build-pkg / build-bundled-fork → bump-version. Schema reference at `skill/references/distro-v1-schema.json`. Ships via `npm run sync:claude`.
- **`examples/distro-pack-template/`** (Stage 21d-iv). Working copy-and-customize starting point. `.claude-plugin/plugin.json` + `duo-extras/DISTRO.json` + claude-md-snippet + example-skill + example-agent + README.
- **`docs/HOW-TO-FORK.md` Layer 2.5** — distro packs slot between Layer 2 (drop-in) and Layer 3 (build-time partial fork). Three distribution paths: `.pkg` installer, drop-in zip, fork+compile.

### Added — Sprint 8: feature surfaces

- **⌘⇧A tab-search palette** (ENH-080). Quick-switcher modal across file tabs (markdown editor, canvas, image, pdf) + browser tabs (main + aux). Type to filter; arrow keys navigate; Enter switches; Esc dismisses. Aux tabs render with a "Split" badge and route to the aux pane on pick (no main-pane promotion). VS Code / Slack muscle memory.
- **Obsidian-vault-friendly editor — Tier A + B1** (ENH-096 partial). `[[Wikilinks]]` render as Atelier-styled clickable spans via ProseMirror Decoration plugin (no schema change; markdown source verbatim through tiptap-markdown). `findVaultRoot()` walks up to `.obsidian/` ancestor; `resolveWikilinkInVault()` BFS searches with case-insensitive + space/hyphen normalized name match. `.obsidian/` / `.git/` / `node_modules/` ignored at the file watcher level. Two new FAQ entries documenting sidecar convention + vault compatibility. **Cmd+click navigation deferred** — see Known issues.
- **`duo edit --canvas` modality override** (ENH-097). Forces canvas-mode mount even when `<meta name="duo-open-in" content="browser">` declares browser-default. Right-click "Edit in canvas" entry on file:// browser tabs surfaces the same override via UI. Codifies the playground/canvas mental model — playground = browser pane (scripts run, buttons fire), canvas = inert edit surface (scripts blocked, clicks place cursor).

### Added — Phase 0 polish

- **Tailwind `<alpha-value>` migration** (FOLLOWUP-008). `--duo-accent-rgb: 198 106 46` (RGB triplet) replaces the hex literal so Tailwind opacity modifiers (`bg-accent/30`, `bg-accent/85`) actually compose. Soft + ink variants migrated for both light + dark mode. Solid `bg-accent` uses unchanged.

### Changed

- **CLAUDE.md §7a — "Claude restarts Duo, never the user"** hard rule + 5-step kill→spawn→poll procedure. Codified after multiple sessions where Claude wrote "once you restart the dev environment..." and offloaded the work onto the owner.

### Fixed

- **BUG-099 — autosave race no longer surfaces spurious conflict banner during typing.** BUG-085's echo-check compared just-read disk body against a single `lastSavedBodyRef.current`; rapid consecutive saves race the post-write baseline assignment. Fix: `recentlyWrittenBodiesRef: Map<string, number>` with 2s TTL — every body added BEFORE the IPC, secondary echo-check consults the set so superseded events are still recognized as ours.
- **BUG-097 — markdown placeholder renders horizontal on fresh-empty load.** `white-space: nowrap + word-break: normal` on `.is-editor-empty:first-child::before` defends against Tailwind Typography's first-child rules that squeezed the placeholder into a 3-char column. Walk-1 follow-up: dropped `overflow: hidden + text-overflow: ellipsis` that clipped the 0-height float entirely.
- **Stage 21d uninstall — CLAUDE.md block + provenance manifest now correctly cleaned.** Surfaced + fixed during pre-walk: install path never round-tripped `claudeMdManaged: true` into the manifest, and uninstall left the `.installed-files.json` file in place after removing tracked files. Both fixed; uninstall also strips CLAUDE.md unconditionally as belt-and-suspenders for legacy installs.

### Tests

- **+9 vitest fixtures.** caretSeed: 12 (was 11; added BR-placeholder case). markdownComments: 12 + idInjector: 14 (FOLLOWUP-009 regression coverage for BUG-088 duplicate-id + comment re-anchor). wikilinkResolver: 8 new (case + space/hyphen normalization). Distro-pack-service: 17 unit tests for discovery + install + uninstall paths. Full suite: 274/274 green.

### Known issues

- **ENH-091 — caret seed on fresh canvas (partial fix).** Detector + helper land but live iframe still positions the caret on the H1's title line. Two fix attempts in v0.6.8 didn't move the live behavior; investigation deferred with diagnostic plan in tasks.md.
- **ENH-096-WIKILINKS — cmd+click navigation no-op.** Visual decoration renders correctly; resolver normalization fix lands. But cmd+click is still no-op at the click-handler level. **Sprint 9 P0** per owner: visual decoration without working navigation is a confusing half-feature; Sprint 9 closes it OR strips the decoration. 30-second console.debug diagnosis queued.
- **BUG-100** — Send→Duo pill missing in split-view aux browser pane.
- **BUG-101** — `duo open` / `duo edit` sometimes return `{ok: true}` without producing a visible tab.
- **BUG-102** — Split view blanks during ⌘⇧A search overlay.

## [0.6.7] — 2026-05-05

Sprint 6 + Sprint 7 close-out — comments are real and visible on both surfaces, browser tabs live in Split View, terminal paste behaves like Terminal.app, and Duo ships arm64-only.

### Added — Sprint 6: comments on both surfaces

- **Markdown editor comments — full data plane** (MISSING-001 / Stage 14a). New `CommentMark` TipTap extension with `commentId` attribute, `<file>.md.duo.json` sidecar persistence (excerpt + contextBefore + contextAfter), re-anchor on file load via excerpt + context match. Three affordances on parity with canvas: ⌘⌥M, right-click "Comment", toolbar 💬. Closing + reopening the file rebuilds the rail with all comments + decorations re-applied.
- **Three discoverable Comment affordances on canvas** (BUG-081). Replaced the hover Comment pill with: ⌘⌥M kb shortcut (Google Docs parity), right-click "Comment" entry on canvas iframes, toolbar 💬 button. Hover pill removed entirely. Send → Duo pill kept.
- **Anchor decoration + bidirectional click-to-focus on canvas** (BUG-083). Commented elements stamp `data-duo-has-comment`; rail-click + body-click both fire `setActiveThreadId`; the active anchor strengthens to `data-duo-comment-active`. Resolved threads strip the body decoration. New `installCommentAnchorStyles` injects iframe-side styles (parent `globals.css` doesn't reach `srcdoc` — also fixed: badge styles never reached the iframe before this cut).
- **Comment rail restores on canvas reopen** (BUG-082). `builtThreads` useMemo's tick now bumps from BOTH async paths (sidecar load + iframe ready) so a fresh open of a file with existing comments rebuilds the rail without the user having to add a new comment to wake it up.

### Added — Sprint 7: browser tabs in Split View + paste fix

- **Browser tabs in Split View aux** (BUG-092 / Phase 3c). Worksheets, smoke walks, dashboards, and any other scripted page can now live natively in the Split View aux slot — pages stay in a real Chromium tab (scripts run, Copy buttons work) instead of being promoted to a script-blocked canvas. New `BrowserManager.auxTabId` + `auxBounds` tracking + `moveTabToAux` / `releaseAuxTab` methods. New `<AuxBrowserSlot>` component mirrors `BrowserRenderer`'s bounds-push pattern. Right-click a browser tab → "Move to Split View" routes through the new path. CLI parity: `duo split-view open-browser <id>`.
- **Single ✕ button on the aux header** (ENH-095, post-rev6 follow-up). Dropped the redundant ⇤ button — the ✕ now closes the split AND promotes the aux'd content back to the main strip in one click. Tooltip / aria-label is "Move back to main." File-aux header keeps the right-click "Move back to main" menu entry as a synonym.
- **⌘R reloads the active browser tab** (BUG-084 follow-up). New `'reloadBrowserTab'` ShortcutId; gated on `activeWorking.kind === 'browser'` so editor / canvas / terminal panes still no-op. The `'r'` keystroke is forwarded from the WebContentsView's `before-input-event` handler so ⌘R reaches the matcher even from inside a browser tab.

### Changed

- **arm64-only macOS builds.** Sprint 7 dropped Intel/x64 from `electron-builder.yml`'s `mac.target.arch`. Apple Silicon is the only published architecture; ~2.6 GB of Intel artifacts cleaned from the project + 1.85 GB freed on GitHub Releases (17 prior releases stripped of x64 DMG + blockmap assets). Cut time drops ~50% (one notarization round-trip instead of two).
- **Terminal paste no longer auto-executes commands** (BUG-094). Capture-phase paste listener on the xterm host strips trailing newlines from the clipboard payload (matches Terminal.app default). Internal newlines preserved so legitimate multi-line paste — Claude Code prompts, heredocs, REPL blocks, scripts — still works.

### Fixed

- **Bullet anchor decoration + thread distinctness** (BUG-088 / BUG-090 / BUG-087, post-rev6 root-cause fix). When the user pressed Enter to make a second / third bullet, contentEditable cloned the source `<li>` and the new sibling kept the parent's `data-duo-id` — three bullets sharing one id meant comments on different bullets all anchored to the same element. `installAutoStampIds` now detects duplicates: if any other element in the body already owns the id, the new element is a clone and gets a fresh ULID. First-in-document keeps its id (so existing comments still resolve); later siblings get unique ids. Also fixes BUG-087: with each anchor truly unique, rail-click activates exactly one element (not "first and third bullets" via duplicate-id selector match).
- **Move to Trash on a missing file silently closes the tab** (BUG-098, post-rev6). `App.tsx`'s `onTrashTabFile` catches `doesn't exist` / `ENOENT` / `no such file` (handles both ASCII `'` and Apple's curly `'`) and proceeds to the close path. Other error classes still alert.
- **Aux tab focus no longer steals main pane focus** (BUG-095). `BROWSER_FOCUS_GAINED` payload now carries `{ tabId, slot }`; renderer only flips `activeWorking` to `'browser'` when `slot === 'main'`. Aux clicks still flip `focusedColumn` so the focus glow tracks correctly.
- **Closing the last main-strip browser tab no longer blanks aux** (BUG-096). `closeTab`'s next-active picker walks past the aux tab; spawns a fresh `about:blank` if only the aux tab would remain (mirrors the BUG-020 last-tab pattern).
- **Markdown editor reconciles external file writes** (BUG-085). New file-watcher subscription via `files.watch`. Clean buffer → silent reload + advance baseline; dirty buffer → amber conflict banner with Reload-from-disk / Keep-mine. Pre-save guard reads disk just before write so the autosave-vs-watcher race can't silently overwrite agent edits. Skill (`SKILL.md` + `agents/duo.md`) updated to direct agents toward `duo doc write` over raw `Write` for active-editor mutations.
- **⌘R no longer kills the entire app** (BUG-084). Removed `{ role: 'reload' }` and `{ role: 'forceReload' }` from the View menu — they were silently bound to ⌘R / ⇧⌘R and called `webContents.reload()` against the main BrowserWindow, destroying every terminal session, every working tab, every iframe canvas in one keystroke. Reload is now scoped to active browser tabs only.
- **Canvas anchor decoration no longer flickers while typing** (BUG-089). Removed the 100ms CSS transition on `[data-duo-has-comment]` that restarted on every contentEditable repaint. Static colors only.
- **Worksheet / smoke-walk pages stay read-only in canvas** (BUG-091 + worksheet-promotion). `<meta name="duo-editable" content="false">` added to the worksheet template; smoke-walk wrapper honors `manifest.title` (was hardcoding from base version). Combined with Phase 3c, the rev3-walk procedural blocker (worksheet usable in split view) is fully resolved.
- **Right-click "Move to Split View" works on browser tabs** (BUG-091 follow-up). `WorkingTabStrip § buildContextMenu` no longer excludes `tab.type === 'browser'` from the menu entry; routing branches on tab kind to the right callback (`splitViewMoveBrowserTab` for browser, `splitViewMoveTabByPath` for files).

### Added — Instrumentation

- **`<ErrorBoundary>` extended with `inline` + `label` + Try-again retry** (BUG-093 instrumentation). Wrapped `<WorkingPane>` with an inline boundary; structured `[BUG-093]` console traces in `splitViewMoveTabByPath`. The crash that surfaced in rev3 is now scoped — a render error inside WorkingPane no longer drops the entire renderer to the app-level error page; terminal column / file tree / banners stay alive. Awaits a clean repro against the armed build.

### Known issues

- **BUG-097 — Markdown editor empty-doc placeholder wraps narrow on first load.** Visual ugliness (placeholder column at ~3-4 chars per line on first open of an empty `.md`); typing any character clears it. Filed; investigation deferred. Not blocking.
- **BUG-093 — Right-click tab → Move to Split View can crash the renderer.** Now scoped to a localized error panel (not app-wide); awaits a clean repro against the instrumented build.

## [0.6.6] — 2026-05-04

Sprint 5 close-out plus Stage 19e closure. Two coherent chapters folded into one cut: a framework-overreach reframe that ended at "ship the one missing piece" (browser-pane playground actions), and the user-context onboarding hardening that finally gives Claude awareness of Duo from non-`DUO_SESSION` sessions and managed enterprise installs.

### Added — Sprint 5: playground reach to browser pane

- **Browser-pane playground actions** (ENH-094). The 9-verb `data-duo-action` runtime now reaches browser-pane pages via CDP injection (`PLAYGROUND_RUNTIME_IIFE`, parallel to existing Send→Duo + path-link patterns). Pages emit events Claude sees live via `duo events --follow` instead of relying on copy/paste. Trust posture: page-side `file://` gate only — matches existing path-link forwarder; threat model is local-first per owner direction.
- **`window.duoPlaygroundAction(jsonBundle)` escape hatch** (ENH-094). Inline JS in browser-pane pages can fire structured actions directly without going through a click — the right shape for `change` / `input` / `blur` events.
- **Worksheet emits live events** (ENH-043). `worksheet/generate.mjs` adds ~10 lines of inline JS firing a `<manifest.kind>:item-changed` event on each radio change. Smoke walks now talk to Claude live via `duo events --follow`; copy/paste stays as the offline fallback.
- **Browser-pane authoring section in `make-playground.md`** documents the canvas-vs-browser-pane choice + when to reach for the `window.duoPlaygroundAction` escape hatch.

### Added — Stage 19e: user-context onboarding hardening (closes the stage)

- **Managed Duo block in `~/.claude/CLAUDE.md`** (ENH-088). Hook-independent. Installer writes a versioned block (`<!-- duo:managed-vX.Y.Z -->`) on first launch and version-aware-replaces on upgrades. Reaches every Claude Code session — non-`DUO_SESSION` terminals (Terminal.app, iTerm, VS Code, agent worktrees) and enterprise installs where hooks are policy-disabled. Sticky `claudeMdManaged` flag in `installed.json` so future installs respect user removal of the block.
- **Shipped vocabulary reference** (ENH-089). New `skill/references/vocabulary.md` is the canonical user-facing doc for page / playground / lesson / canvas terms. Closes the broken `see CLAUDE.md § Glossary` pointer in `make-page.md` + `make-playground.md`.
- **Enterprise-deployments reference** (ENH-090). New `skill/references/enterprise-deployments.md` — mechanism dependency map, common policy restrictions, what works hook-free, reporting checklist. ENH-088's managed block links here for users hitting policy issues.

### Changed

- **Playground action parser extracted to `shared/playground-actions.ts`** so main + renderer share one implementation. Pure refactor — `parseActionFromAttrs(getAttr)` accepts an attribute-getter abstraction so it works against either an `HTMLElement` (canvas runtime) or a JSON bundle (browser-pane host).
- **Project `CLAUDE.md § Glossary` trimmed** to a contributor-facing internal-name table; user-facing vocabulary lifted to the shipped reference.
- **ENH-094 trust posture differs from canvas-iframe gate** (deliberately). Page-side `file://` gate only on browser-pane runtime; canvas-iframe `~/.claude/duo/`-only gate unchanged. Separate decisions for separate threat models.

### Fixed

- **Bold text in markdown editor unreadable in dark mode** (BUG-080). Tailwind typography's `prose` default styled `<strong>` near-black; on dark paper that was invisible. Explicit `.duo-editor-prose :where(strong, b) { color: var(--duo-ink) }` rule added so bold inherits the same theme-aware ink color as body text.

### Closed (won't-do)

- **ENH-075** — canvas glyph alternative options. Owner walked the alternatives worksheet; none improved on the current glyph.
- **ENH-092 + ENH-093** — playground state / DOM-reactivity / composition primitives. Owner pushback: pre-chews future-Claude's meal; primitives that prove restrictive get bypassed when the ceiling is too low. Future-Claude is a capable coder; inline JS for state/tally/composition is appropriate page-specific code, not primitive material.

### Tests

- Added `jsdom@^24` for DOM-environment tests via per-file `// @vitest-environment jsdom` directive.
- 51 worksheet primitive characterization tests + 4 live-event tests + 13 ENH-088 merge-logic tests. **189 → 202 tests passing.**

## [0.6.5] — 2026-05-04

Sprint 4 close-out. Absorbs both the never-cut v0.6.3 chapter (Stage 17/canvas authoring polish) AND the never-cut v0.6.4 chapter (Split View v1 + idle-thoughts sweep + Vitest framework) along with Sprint 4's own arc (canvas → page rename + navigator close-out + Split View Phase 3 close-out + tab cycling + markdown trigger family + FAQ-on-launch fix). v0.6.4 walk surfaced two cut blockers (BUG-074 light-mode contrast, BUG-075 Split View chord regression); both fixed in this cut. Ships also a strategic refile: ROADMAP.md retired in favor of canonical `docs/roadmap.html`, with unique history extracted to `docs/dev/roadmap-history.md`.

### Added — v0.6.5 sprint additions

- **Canvas → page/playground/lesson rename** (ENH-052). Internal mechanical rename of the canvas-authoring identifiers — `WorkingTab.kind === 'page'` (was `'html-canvas'`), `renderer/components/Page/`, `PlaygroundAction`, `IPC.PAGE_*`, `PageSelectionSnapshot`. 177 edits / 32 files / zero behavior change. Pack subdir paths (`packs/<name>/canvases/`) and skill examples (`canvas-templates/`) intentionally deferred — they're external API surfaces with backwards-compat implications.
- **Bullet marker passthrough** (BUG-061 + BUG-073 combined). `-` / `*` / `+` typed at line-start now stamp `data-list-marker="dash" | "asterisk" | "plus"` on the generated `<ul>`. CSS in the boilerplate emits an en-dash for `dash`, a plus marker for `plus`, and the default disc for `asterisk`.
- **Blockquote double-Enter exit** (BUG-072 v3). Pressing Enter on an empty trailing line inside a blockquote lifts the line out of the blockquote — parity with the bullet/ordered-list double-Enter convention. Took three iterations: v1 wrong shape, v2 Chromium caret-snap quirk, v3 `<br>` filler in inner `<p>` (the standard contentEditable trick).
- **Split View aux header right-click menu** (ENH-085). Right-click the aux pane's tab header → "Reveal in navigator" / "Rename" / "Copy path" / "Move back to main" / "Move to Trash." Parity with the main canvas tab strip.
- **Open-file dot glyph in navigator** (ENH-087). Distinguishes "this file is open in a tab" (small dot) from "this file is the active tab" (bold + accent text).
- **Stage 19e PRD landed** for v0.6.6+ — ENH-088 (managed Duo block in `~/.claude/CLAUDE.md`), ENH-089 (vocabulary glossary lift to `skill/references/vocabulary.md`), ENH-090 (enterprise-deployments reference). Hook-independent design property preserved as load-bearing.
- **ENH-080 research doc** at `docs/prd/canvas-tab-search-research.md` — 4 architecture options for the `⌘⇧A` open-tab search palette vs. the WCV-occlusion class. Recommended Option A (native child window with pre-creation at boot); fast-fallback Option B (WCV mute pattern). Sprint-entry gate for v0.6.6 implementation.
- **24 new regression tests** in `renderer/components/Page/blockOps.test.ts` — locks the BUG-072 root-cause fix (MAIN/ARTICLE/SECTION in BLOCK_TAGS). Total 134/134 vitest green (was 110).
- **`docs/dev/roadmap-history.md`** — new home for Number history (2026-04-26 renumber), Layout commitment (three-column ADR), and Open issue → stage mapping. Extracted when ROADMAP.md was retired.

### Changed — v0.6.5

- **Navigator selection style** (BUG-074 v3 final). Solid `bg-accent text-white font-medium` Finder-style fill, square corners. Three v1/v2/v3 attempts + a v4 polish revert before it stuck (`bg-accent/85` opacity modifier silently failed because the accent token isn't an alpha-aware Tailwind color — FOLLOWUP-008 filed for the migration).
- **User-claude pane reordered to bottom of left column** (ENH-086 v2). Now sits below the file tree with `border-t-2 border-paper-rule bg-paper-edge` separation. Earlier "two-pane stack" framing pushed the user-claude pane up; owner walk made the file-tree-as-primary intent explicit.
- **Split View collapse rail + new-tab/globe/collapse-canvas cluster** (ENH-083). Collapse-canvas button moved INTO the existing tab-strip cluster (was on the titlebar). New cluster: new-file / globe (web tab) / collapse-canvas, separated by hairline rules.
- **`BrowserManager.switchTab()` now calls `view.webContents.focus()`** (BUG-076 fix). After activating the new view's bounds + emitting state. Fixes ⌃Tab cycle continuation after `duo open` had drifted OS-level focus to a 1×1-shrunk previous view.
- **Canvas init sets `defaultParagraphSeparator='p'`** (BUG-072 root cause #2). `PageTab.tsx § handleReady` runs `doc.execCommand('defaultParagraphSeparator', false, 'p')` so Enter wraps new content in `<p>` instead of Chromium's default `<div>` (which, when caret was outside the boilerplate's `<p>`, was creating new `<main>` siblings — the source of the "huge paragraph spacing started halfway through the test" report).
- **`MAIN`/`ARTICLE`/`SECTION` added to `BLOCK_TAGS`** in `blockOps.ts` (BUG-072 root cause #1). `findBlockAncestor` now stops at section roots instead of falling through to `<body>` — fixes silent-drop trigger detection when content sits in a span-in-main without a `<p>` wrapper.
- **Smoke-walk skill hardened** with two HARD RULES + a socket-cleanup gotcha note: pre-flight Electron probe before any `npm run dev` (never spawn a duplicate); focus verification (`duo url` + `duo title`) after every `duo open` before owner handoff.
- **ROADMAP.md retired**; `docs/roadmap.html` is now the single source of truth. 25 file references rewritten to point at the canonical HTML or the new history doc. CLAUDE.md "Where to look" updated.
- **Roadmap stage-class corrections.** Stages 11 / 12 / 15 / 17a-polish were stale `inprog`/`pending` while their own status-lines said ✅ shipped. All flipped to `done` in the roadmap HTML.

### Fixed — v0.6.5

- **BUG-072 — blockquote double-Enter exits** (v3 `<br>` filler — see "Added" entry above).
- **BUG-074 — navigator selection prominence in light mode** (v3 final). White text on light paper is now legible because the accent fill is solid + opaque.
- **BUG-075 — Split View chord regression** (Phase 3b). Original `⌘\` chord was eaten by 1Password's system-level autofill grab. Re-picked as `⌘/` + `⌘⇧/` using `e.code === 'Slash'` (modifier-independent) in BOTH the matcher and the browser-pane forwarder. Locked with 6 regression tests including a negative test that `⌘\` no longer matches.
- **BUG-076 — ⌃Tab cycle drifts** after `duo open` switches focus to a new browser tab. `BrowserManager.switchTab()` now calls `webContents.focus()` on activation.
- **BUG-078 — FAQ tab opens on every app launch** despite being closed last session. Two mechanisms re-introduced the FAQ: the `BrowserManager` constructor's unconditional `addTab()` AND BUG-057's default-pin restore loop (FAQ is default-pinned per ENH-003). Both now gated on `!hasPersistedSession` peeked at boot via `sessionStateService.load()` BEFORE BrowserManager construction. Owner-stated rule: *"boot load only on fresh app; skip if prev tabs persisted."*

### Deferred / queued for v0.6.6

- **ENH-084** (aux pane focus indicator — orange glow when active in side pane) — three v0.6.5 attempts all failed; deferred with full v1/v2/v3 defect log in `tasks.md`. Owner direction: *"please log the defect, incl failed attempts to fix it, then move on; this has wasted too much time this sprint."*
- **ENH-091** (caret placement on new canvas) — surfaced in BUG-072 v3 re-walk owner ask: *"when I duo html new ..., the cursor is at the beginning of the empty doc; it would be nice if it was at the end."*
- **BUG-079** (`⌃⇧\`` cycle multi-second latency) — recurring tab-cycle class; deferred with hypothesis list.
- **FOLLOWUP-008** (accent token RGB-triplet migration) — unblocks `bg-accent/N` opacity modifiers that silently fail today.
- **FOLLOWUP-007** (`window.duoSendResult` CDP binding) — pre-req for ENH-093's `host:send-to-claude` verb.
- **Phase 7 carry-overs**: FOLLOWUP-003 (perf re-measure), FOLLOWUP-004 (visual smoke via computer-use).

### Filed for v0.6.6 (architecture initiative)

The big one — **playground architecture decomposition**. Owner direction post-Phase-5: *"if the smoke walk using playground primitives is not possible, then our playground implementation is fucked and we need to fix it."* Today the worksheet generator (powering smoke-walk + sprint-plan) emits 958 lines of custom inline JS — zero playground primitives — because the vocabulary doesn't cover state, DOM reactivity, composition, or clipboard, AND the runtime is canvas-iframe-only (doesn't reach browser-pane pages). Decomposed into:

- **ENH-092** — Playground state + DOM-reactivity primitives (`state:save/restore/set/get/wipe`, `data-bind-class`, `data-bind-text`, `data-bulk-set`).
- **ENH-093** — Playground composition + clipboard (`compose:result`, `compose:json`, `clipboard:copy`, `host:send-to-claude`).
- **ENH-094** — Inject the playground runtime into browser-pane pages via CDP (`PLAYGROUND_RUNTIME_IIFE`, parallel to existing Send→Duo + path-link injections).
- **ENH-043** (reframed as meta-tracker) — refactor `worksheet/generate.mjs` to emit pure declarative HTML using the new vocabulary. Closes when 092+093+094 land.

Likely 2–3 sprints; may warrant a dedicated Sprint 5 = playground primitives.

---

## [0.6.4] — 2026-05-04 *(never cut as a separate release; absorbed into 0.6.5)*

The Sprint 3 chapter — Split View v1 + idle-thoughts sweep + first regression-test framework. Cut blocked on BUG-074 + BUG-075 from the walk-1 results; both shipped in v0.6.5 above.

### Added

- **Split View** (ENH-041) — the canvas (right pane) can host two files side-by-side. Open via `duo split-view open <path>`, the right-click "Move to Split View" / "Open in Split View" entries on tabs/FileTree/PinnedNav, the `⌘\` chord (move active main tab → aux), or the per-page `<meta name="duo-path-target" content="split">` opt-in for path links in browser-pane pages. Close with `⌘⇧\` or the aux header's ✕. Promote aux → main with the ⇤ button. Drag the divider to resize (clamped 20-80%); double-click to reset to 50/50. State persists across launch (paths + activeIndex + splitPct survive a restart).
- **`⌘[` / `⌘]` indent / outdent in HTML canvas** (ENH-076) — parity with the markdown editor's ListIndentShortcuts.
- **Navigator selection more prominent + click-to-deselect** (ENH-078) — heavier accent fill + font-medium reads like Finder. Three deselect paths: re-click selected row, click whitespace below rows, Escape.
- **Collapsed Navigator label** (ENH-079) — vertical "Navigator: {project_name}" italic label mirroring the terminal/canvas collapse rails.
- **macOS Open With for `.md` and `.html`** (ENH-081) — Duo registers as a Finder Open-With candidate. Production-only (verifies post-DMG).
- **Dev-only FAQ symlink** (ENH-070) — `~/.claude/duo/help/*.html` becomes a symlink to the source repo's `help/` files in dev mode (no drift). Production unchanged.
- **Vitest regression-test framework** — `npm run test` (watch) / `npm run test:run` (one-shot). 41 tests covering BUG-061 markdown-trigger regex (incl. Chromium nbsp-conversion edge cases) + BUG-067/ENH-039 tilde expansion. Closes the "recurring regressions need durable test coverage" memory feedback.
- **Native NSMenu + system sheet dialogs** (ENH-050) — right-click context menus on tabs, file tree rows, and pinned-nav rows now pop a native macOS NSMenu via `Menu.popup()`. Trash + pinned-close + ⌘W-unsaved confirms now drop as native sheets via `dialog.showMessageBox`. Retires the in-renderer `<ContextMenu>` + `<PinnedCloseConfirm>` components and the WCV-mute pattern that came with them — native composition handles WebContentsView occlusion correctly at the window-server level. Decision locked in `docs/DECISIONS.md § WCV-occlusion remediation`.
- **Collapse-pane buttons + vertical rails** (ENH-040 + ENH-066). Two titlebar buttons hide the terminal or the canvas all the way; the collapsed slot becomes a 36px clickable rail with glyph + serif-italic label. Click restores to `prevSplitPct` (the last drag-set value).
- **Tab reordering** (ENH-042). Drag tabs horizontally to reposition; right-click → "Move tab left" / "Move tab right". Pinned-leftmost preserved; cross-zone drags silently rejected; zone-edge gating hides irrelevant menu items.
- **Toggleable line numbers in markdown editor** (ENH-069). Sticky `#` button in bottom-left of the editor; CSS-counter gutter on top-level block children. Persists per-user via localStorage. v1 counts BLOCKS, not visual wrapped lines (v2 PM plugin queued if needed).
- **Smart `duo open` for local files** (BUG-067). `.md` files now open in the editor instead of the browser pane; HTML respects `<meta duo-open-in="browser">`; http(s) URLs unchanged. CLI response carries accurate `routedTo` label.
- **Smoke-walk page persists in-flight state** (ENH-038) — Pass/Fail + notes restore on reload. New "Clear saved walk" button wipes after copy-back.
- **Collapsible "Project Claude Context"** (ENH-045a) — navigator section is now collapsible (default collapsed); auto-titled with `package.json` `name` or folder name.
- **Clickable smoke-walk path links** (ENH-039) — `~/...` and absolute paths in walk-step text become clickable; `[data-duo-path]` clicks route through a CDP-injected forwarder gated on `location.protocol === 'file:'`.

### Changed

- **Editor / canvas convergence — Path A locked** (Phase 2 ADR, `docs/DECISIONS.md § Editor / canvas convergence`). The markdown editor (TipTap) and HTML canvas (raw contentEditable iframe) stay parallel codebases. Every editor PR must declare its disposition for the OTHER surface — (a) Mirrored / (b) Skipped surface-specific / (c) Deferred. CLAUDE.md plumbing checklist updated.
- **`duo open <url>` brings the new browser tab into view** (ENH-036) — BROWSER_FOCUS_GAINED handler now also flips `activeWorking` so the working pane shows the new tab immediately, not just adds it to the strip.
- **`duo/` shows in "Your Claude settings" navigator** (ENH-067) alongside CLAUDE.md / skills / agents.
- **Browser-tab `>` chevron → globe glyph** (ENH-068) on the new-browser-tab button. Reads as "browser" by every macOS user's prior expectation.
- **Tab right-click menu adds "Copy path"** (ENH-074) — mirrors the FileTree menu entry.
- **Visible separator between tab strip and new-tab cluster** (ENH-073) on both terminal + working strips.
- **Larger collapse-rail label + `#` line-numbers toggle text** (ENH-071 + ENH-072).
- **Copy buttons on `<pre>` documented for canvas authors** (ENH-046) in `skill/make-page.md`.

### Fixed

- **BUG-070 — cursor lands in a fresh HTML canvas on first click** (no tab-away workaround). srcdoc iframes pass through an `about:blank` doc phase before the parser swaps in the real srcdoc body; the v3 fix bails in `wire()` when `doc.URL === 'about:blank'` so the RAF poll keeps retrying until the real body arrives. Locked in by Vitest tests.
- **BUG-061 — markdown triggers fire reliably** in the HTML canvas. v3 fix: regex matches `\s` (covers both U+0020 literal space AND U+00A0 nbsp that Chromium auto-converts trailing literal spaces to in contentEditable). Applied to heading / unordered-list / ordered-list / blockquote triggers. 33 Vitest tests lock the v3 shape.
- **BUG-071 — `⌃Tab` is responsive immediately after a path-link click** (no canvas-body re-click required). One-line `mainWindow.webContents.focus()` after `sendEdit` in the cdpBridge handler — inverse of BUG-042's wireKeyForwarding pattern.
- **BUG-058 (originally WCV-muted) properly retired** by the ENH-050 migration. Native menus composite above the WebContentsView without any mute call.
- **BUG-059 — local files de-duplicate** in both renderer-side `openFileSmart` (rev1) and CLI-side `BrowserManager.openTab` (rev2). file:// URLs only; web URLs stay duplicate-allowed.
- **BUG-060 — fenced code blocks materialize on Enter** in markdown editor (was: only on trailing space). New `FencedCodeBlockEnter` extension.
- **BUG-064 — trash + pinned-close confirm modal occlusion** retired via ENH-050's system-sheet migration.
- **BUG-065 — ⌘⇧G blanks the entire app** (Rules-of-Hooks violation in Breadcrumb.tsx; latent since v0.5.4). Lifted two hooks above an early return. **Plus**: new `ErrorBoundary` at the React root surfaces future render errors as a fallback panel + Reload button instead of blank-window.
- **BUG-066 — clawd glyph clipped + fixed-orange** corrected viewBox + switched to `currentColor`.
- **BUG-068 — new-tab cluster scrolls off-screen** under heavy panning. Restructured WorkingTabStrip to mirror TabBar's sticky pattern (cluster sibling outside the overflow scroller).
- **`duo open <path.md>`'s `routedTo` label is accurate** when the file actually lands in the browser via `<meta duo-open-in>`.

### Removed

- **Stage 4 dead code** — `SkillsPanel`, `useSkillsContext`, `scanSkills`, plus `SkillEntry` interface and `SKILLS_SCAN`/`SKILLS_RESULT` IPC channel constants. The Skills panel was explicitly excluded per CLAUDE.md ("Brainstem / MCP — Not included") but the orphaned code stayed in the tree. ~146 lines.
- **Orphaned `@deprecated EditorSelectionTagged` alias** — migration to `MarkdownSelectionSnapshot` completed; no remaining importers.

### Filed for v0.6.5 (no code yet)

ENH-080 (`⌘⇧A` open-tab search palette), MISSING-001 (markdown editor CommentRail binding — Stage 14a), ENH-052 (mechanical `'html-canvas'` → `'page'`/`playground` rename, deferred until other v0.6.x work settles), ENH-075 (canvas glyph design exploration), ENH-077 (system dialog icon — DMG-verify owed), Phase 3c-iii (Split View dirty-replace dialog — needs aux dirty-by-path registry refactor), Phase 3c-iv (browser-in-aux — needs BrowserManager bounds tracking for two WebContentsViews), `claude-code-basics` curriculum-template refactor.

## [0.6.2] — 2026-05-02

The lesson-template ecosystem completes. Curriculum template (sibling of lesson-template) ships for multi-canvas packs; lesson fly-through harness lets agents validate any lesson without manual clicking; new `duo html click` CLI verb makes button presses a primitive of the canvas action vocabulary. Plus walk-3 cleanup (banner copy + smoke-walk inline literals) and the clawd glyph for the new-Claude split-button.

### Added

- **`duo html click --id <id> | --selector <css>`** (ENH-055). Programmatically dispatch a click on a canvas element. Used by the fly-through harness to walk lessons without manual interaction. Read-only op — doesn't generate a `recentEdits` entry.
- **Lesson fly-through harness** at `~/.claude/skills/duo/lesson-flythrough.md` (ENH-055). Auto-loads on natural-language prompts: "fly through this lesson", "test my new lesson", "preview the lesson", "validate the lesson runs", "smoke-test this playground". Pairs `duo events --follow --since` (cursor resume) with `duo html click` to walk every step of any lesson built on the canonical lesson template.
- **Curriculum template** at `~/.claude/skills/duo/examples/curriculum-template/` (ENH-056). Multi-canvas sibling of the linear lesson-template: `canvases/orientation.html` (launcher with module cards), `canvases/module-template.html` (copy-once-per-module skeleton), `lesson-skill/SKILL.md` (orchestrator skill skeleton), README. Canonical events: `lesson:module-<id>-launch`, `lesson:module-<id>-done`, `lesson:module-<id>-abandon`.
- **Clawd glyph for the new-Claude split-button** (ENH-044). Owner-authored Inkscape mascot replaces the generic `+` plus glyph in TabBar.tsx's new-Claude half. Color `#c15f3c` (Atelier accent family) reads as "Claude" in both themes. Source SVG tracked at `renderer/assets/icons/clawd.svg`.

### Fixed

- **Update banner copy clarifies which version is which** (BUG-062, walk-3). Old wording "(currently from v{X})" read as "Duo itself is at v{X}." New copy: "Agent files in `~/.claude/` are from Duo v{installedVersion}. You're running v{appVersion}. Refresh to update." Both versions visible in the same sentence.
- **Smoke-walk mid-sentence backtick literals stay inline** (BUG-063, walk-3). The `<pre>` Copy-block pull-out now only fires for end-of-sentence cmds; mid-sentence literals like `<meta name="duo-default-editable" content="false">` stay inline as `<code>`. New `isTrailingCmd()` helper in `.claude/skills/smoke-walk/generate.mjs § renderStepHtml`.

## [0.6.1] — 2026-05-02

The "make Duo's canvas authoring usable by anyone" cut. Five intertwined improvements: a fixed `claude:spawn` semantic so lesson buttons actually work, a fork-config toggle so enterprise distros can pick which packs ship, a locked terminology hierarchy (canvas / page / playground / lesson), a canonical lesson template + runtime helper skill, and a skill split (make-page / make-playground / playground-interaction / lesson-runtime) tuned so Claude reaches for the right skill on natural-language prompts. The two existing packs (intro-to-duo, claude-code-basics) adopt the canonical event-name convention.

### Fixed

- **`claude:spawn` `data-cmd` lands as Claude's first user message, not a shell command** (ENH-049). Pre-fix, the runtime sent the cmd directly to the PTY when claude:spawn included `data-cmd`, so prose like "Read X and walk me through it" got typed into zsh and errored. Fix: the runtime now sends `claude\n${cmd}\n` — the shell launches Claude, then Claude reads the cmd as its first user message via the queued PTY input. Same fix benefits `duo new-tab --claude --cmd "<msg>"` from the CLI.

### Added

- **Canonical lesson template** at `~/.claude/skills/duo/examples/lesson-template/` (ENH-053). Copy-and-customize entry point for new lessons: `canvases/playground.html` with three stable paint regions (`step-counter` / `step-body` / `step-controls`), `lesson-skill/SKILL.md` with the canonical step-state outline, README explaining how to use it. Replaces "every lesson author invents their own structure" with a shared shape that buys cross-pack consistency, mid-lesson resume, and (when ENH-055 ships) automated fly-through validation.
- **Lesson runtime skill** at `~/.claude/skills/duo/lesson-runtime.md` (ENH-053). Documents the canonical event-loop pattern: the playground↔skill conversation contract, canonical event names (`lesson:step-N-done`, `lesson:done`, `lesson:restart`), sidecar state schema at `~/.claude/duo/lesson-state/<pack-name>.json` with cursor for resume, foreground-polling vs. subagent-watch implementation patterns.
- **Skill split: `make-page` (basic HTML in canvas) + `make-playground` (page + interactivity)**. Replaces the overloaded `playground-authoring.md`. Frontmatter descriptions tuned so Claude's harness auto-loads `make-playground` on natural-language prompts: "build a training", "make a guide", "create a lesson", "tutorial for X", "interactive demo", "dashboard with action buttons", "page that does things" — any hint of "user clicks, Duo reacts" fires it.
- **`fork.config.json` `packs.disabled` toggle** (ENH-051). Per-fork, gitignored list of pack directory names this distro opts out of. PackLoader filters at boot; install-service skips at copy time. Enterprise distros with their own onboarding suppress `intro-to-duo` without forking the pack itself.

### Changed

- **Terminology locked.** "Canvas" used to mean both the right pane (slot) AND the interactive HTML thing inside (Stage 17). The new hierarchy (per CLAUDE.md § Glossary): **canvas** = the right pane (slot, type-agnostic) · **page** = a basic HTML tab inside the canvas · **playground** = a page with interactivity · **lesson** = a playground paired with a guide skill · **start tab** = a playground that auto-opens on first launch. Skill files renamed (`canvas-authoring.md` → `make-playground.md` after the intermediate `playground-authoring.md`); internal code names (`WorkingTab.kind === 'html-canvas'`) lag the external vocabulary and are queued for ENH-052's mechanical rename.
- **Existing lesson packs adopt canonical event names + paint regions.** `intro-to-duo` welcome.html: `data-duo-pane="lesson-body"` → `"step-body"`, new `data-duo-pane="step-controls"` wrapper, events use `lesson:` prefix (`lesson-step-1-done` → `lesson:step-1-done`). `claude-code-basics` (multi-canvas curriculum): events renamed with `lesson:` prefix (`curriculum-skip` → `lesson:curriculum-skip`, `family-A-done` → `lesson:family-A-done`, etc.). The structures aren't mass-renamed (filenames and curriculum-vs-linear topology stay); ENH-056 filed for the multi-canvas curriculum template that claude-code-basics will eventually migrate to.

### Resolved (no code; clarification entries)

- **ENH-054** ("user entry point for 'I want to make a training/guide'"). Owner pushback on the proposed `duo lesson new` CLI verb: "A cli verb for lesson seems like overkill" — and the FTUX user (the meta-goal target) doesn't yet know `duo` is a CLI. The right primitive is **skill recognition**: when a user says "build me a training" / etc., Claude's harness auto-loads `make-playground.md` from its YAML frontmatter description matcher. The skill walks the agent through copying the lesson template. No new CLI verb; resolved via the v0.6.1 skill-description tuning.

### Deferred / queued

- **ENH-055** (lesson preview / fly-through harness) deferred to v0.6.2. The canonical packs now give a stable contract to assert against; harness implementation is ~2-3 hours of focused coding that's not blocking this cut.
- **ENH-052** (mechanical internal rename `'html-canvas'` → `'page'` etc.) still queued. Touches 50+ files; do as one focused PR. UX-neutral; no urgency.
- **ENH-056** (multi-canvas curriculum template, sibling of lesson-template) filed. Needed when the next multi-canvas pack lands; for now, claude-code-basics' shape is a one-off.

## [0.6.0] — 2026-05-02

The cut that v0.5.6 deferred. All 7 walk-2 release-blockers (BUG-052..058) now have shipped fixes; the BUG-053 v2 fix routes nav:reveal to the correct navigator pane (project vs. user-claude). **Stages 27 / 18b / 28 graduate from "internal preview" to ✅ shipped** — the canvas-authoring vocabulary, distro skill packs, and lesson packs are now officially supported.

### Added

- **Stage 27 — Canvas authoring vocabulary + skill** (full release; was internal-preview in v0.5.6).
  - **Six new canvas-action verbs**: `editor:open` (opens an arbitrary file in the surface that fits, honoring `<meta name="duo-open-in">`; `data-mode` overrides), `nav:reveal` (atomic file-tree reveal — switches cwd + selects + scrolls into view, routed to the correct navigator pane based on path), `selection:set` (find/scroll/anchor an editor or canvas), `theme:set` (light / dark / system), `terminal:focus` (now actually puts cursor in the xterm — see Fixed below), `duo:event` (emits a named event into the agent event stream).
  - **`duo events --follow`** streaming CLI verb (closes [issue #19](https://github.com/dudgeon/duo/issues/19)) — streams JSON-line events from the EventBus to a subscriber. Cursor format `<unix-ms>-<seq>`; `--since <cursor>` resumes from a snapshot point.
  - **`data-payload-from`** form-input binding — `<button data-action="duo:event" data-event="step-done" data-payload-from="#name-input">` reads the input's value into the event payload (now cross-realm safe — works inside iframe canvases).
  - **`<meta name="duo-default-editable">`** routing convention — `false` mounts the canvas read-only with a toggleable Edit strip; `true` (default) mounts editable. Distinct from the older `duo-editable` hard lock which now renders a "Read-only · locked" indicator.
  - **Canvas authoring skill split** into `canvas-authoring.md` + `canvas-interaction.md` (single-responsibility per Anthropic skill best practices).
  - **Five reference templates** at `~/.claude/skills/duo/examples/canvas-templates/` — `button-card.html`, `paint-target.html`, `form-input.html`, `lesson-scaffold.html`, `dashboard.html`. Self-contained Atelier palette with prefers-color-scheme dark fallback.
- **Stage 18b — Distro skill packs** (full release; was internal-preview in v0.5.6). Pack format spec, `PackLoader` boot scan, `~/.claude/duo/installed-packs.json` per-pack-version flag, first-launch defaults hook (`PACK.json § defaults[].openOnFirstLaunch`), `duo packs` CLI verb (returns parsed manifests + per-pack errors).
- **Stage 28 — Lesson packs** (full release; was internal-preview in v0.5.6). Two FTUX skill packs that ship via the install bundle: **`intro-to-duo`** (single-canvas FTUX with a "Start lesson" button that uses `claude:spawn` to open a fresh Claude tab with a lesson skill auto-invoked) and **`claude-code-basics`** (multi-canvas pack — orientation + 7 family canvases — derived from a generic Claude Code curriculum, sanitized of all employer-specific references). Both packs auto-open as canvas tabs on first launch.

### Fixed

- **`editor:open data-mode='canvas'` on hard-locked files now shows a "Read-only · locked" indicator** (BUG-052, walk-2). Locked-read-only canvases (those with `<meta name="duo-editable" content="false">`) previously rendered with NO chrome at all — no toolbar, no read-only/edit strip — leaving the user unsure canvas mode was even active. New minimal indicator distinguishes locked from toggleable read-only.
- **`nav:reveal` highlights the target file in the right pane** (BUG-053, walk-2 + walk-3). Two-part fix: v1 added an atomic `revealAndSelect(filePath)` action so cwd + selected update in a single render (was a two-call race); v2 prefix-matches against `~/.claude/` to dispatch to the user-claude navigator pane vs. the project pane. Walk-3 W3-V1 surfaced that v1 was setting selected on the wrong navigator instance for paths under `~/.claude/`.
- **`terminal:focus` actually puts the cursor in the xterm** (BUG-054, walk-2). Was only flipping the React focus indicator; now dispatches a `duo-terminal-focus` CustomEvent that the active TerminalPane catches and uses to call `term.focus()`. Matches the find-open / find-next CustomEvent pattern.
- **Clicking inside a read-only canvas focuses the working pane** (BUG-055, walk-2). The BUG-037 mousedown forwarder lived inside `if (!readOnly)` so canvases mounted with `<meta duo-default-editable="false">` (welcome.html, lesson packs, smoke-walk page in canvas mode) didn't get the listener. Moved out of the readOnly gate; it now fires unconditionally.
- **Send → Duo pill suppressed on browser pane when no Claude session is live** (BUG-056, walk-2 — recurring; mandatory regression check now). The renderer-side click handler already gated on `onSendToDuo` being null, but the in-page pill DOM was injected via CDP regardless, so the user saw a pill with no destination. Page-side `showPillFor` now reads `window.__duoClaudeLive` (set by main via `Runtime.evaluate` whenever claude-presence flips) and bails out when false.
- **Pinned tabs auto-open on boot** (BUG-057, walk-2). pins.json is now AUTHORITATIVE for "always reopen these tabs"; main iterates browser pins after `restoreFromSession`, opens any whose URL isn't in restored session-state. Renderer does the same for file pins after `sessionHydrated`. Matches Chrome / Safari pinned-tab convention.
- **Browser pane (WCV) no longer occludes the WorkingTabStrip context menu** (BUG-058, walk-2). The BUG-047 mute fix only fired when the user right-clicked a browser tab; the occlusion is about what's currently visible in the working pane, not what was right-clicked. Now mutes whenever ANY tab in the strip is active AND of kind 'browser'. Owner walk-3 noted the mute is jarring (the browser pane visibly disappears for the menu lifetime); a smoother capturePage-overlay fix is filed as ENH-050.

### Internal preview (gone — promoted to fully shipped)

The "Internal preview" caveat from v0.5.6 lifts entirely with this cut. Stages 27 + 18b + 28 are officially shipped, and the lesson packs are recommended FTUX defaults.

### Known issues

- **BUG-062** — Update banner reads "currently from v0.6.0" while the dev build is v0.5.7 (post-cut bump from the v0.5.6 cut). Install-receipt vs. `app.getVersion` mismatch. Visible only in the dev environment.
- **BUG-063** — Smoke-walk manifest mid-sentence backtick literals (e.g. ``` `<meta ...>` ```) get pulled out into separate Copy blocks, leaving a gap in the prose. Fix: only pull out end-of-sentence cmds.
- **ENH-050** — Smoother WCV mute/restore on context-menu open (capturePage snapshot overlay) — UX polish on the BUG-058 fix.

## [0.5.6] — 2026-05-02

A focused stability cut: the carry-over fixes from the v0.5.5 sprint (Send → Duo pill on the browser pane, trash dialog wording, context-menu portal-stacking, terminal-locale FAQ) + the read-only canvas toggle that ratcheted the wrong way + the ⌘W data-loss bug + smoke-walk page Copy buttons. **Stages 27 / 18b / 28 (canvas-authoring vocabulary, distro skill packs, lesson packs) are present in the binary as initial preview but stay 🔄 In progress on the roadmap — full validation lands in v0.6.0.**

### Fixed

- **Send → Duo pill on the browser pane is now visible AND clickable** (BUG-006). The renderer-DOM portal pill was occluded by the WebContentsView at the macOS compositor level (z-index can't beat a native subview). Pill now renders INSIDE the page DOM via the existing CDP selection-observer IIFE; clicks route via a new `duoSendToDuoClick` binding → IPC → `handleSendToDuoClick`. Snapshot is captured synchronously at mousedown so the click round-trip doesn't race with selectionchange clearing the renderer's cache.
- **"Move to Trash" confirm dialog reads coherently** (BUG-049). `PinnedCloseConfirm` parameterized with explicit title/body/confirmLabel; trash branch passes its own copy ("Move to Trash?" / "<file> will be moved to the Trash. The tab will close.").
- **Right-click on a markdown editor tab shows the full context menu** (BUG-050). `ContextMenu` portaled to `document.body` with z-index:1000 (was inheriting the strip's overflow-x-auto stacking context). BUG-047 class closed for renderer-DOM cases.
- **Read-only canvas toggle now actually reverts** (BUG-051). Off → on → off was leaving body `contenteditable="true"` because the wiring effect's `wire()` only ADDED edit-mode body attributes; never removed them on flip-back. Explicit `else` branch in `RenderedCanvas § wire()` clears `contenteditable` / `spellcheck` / `data-duo-canvas-runtime` and blurs active element on re-mount under `readOnly: true`.
- **⌘W only closes tabs — never the parent window** (ENH-037). Window menu's `{role: 'close'}` had its default ⌘W accelerator overridden to ⌘⇧W (Chrome convention). Owner lost ~20 minutes of smoke-walk notes to a stray ⌘W; this prevents the recurrence permanently.

### Added

- **`duo doctor` locale section + FAQ entry** (ENH-032). Probes `$LC_ALL` / `$LC_CTYPE` / `$LANG`; flags non-UTF-8 values with the conda `(base)` `LC_ALL=C` fix recipe inline.
- **`shared/feature-flags.ts`** — kill-switch module for opt-in / kill-switch gating of features. First user: `FEATURE_AUTO_INJECT_IDS = false` (HTML canvas no longer auto-prompts to inject `data-duo-id` attributes; was firing on every fresh canvas open, surfacing on local HTML files that didn't need anchors).
- **Smoke-walk page Copy buttons** (ENH-046). Any backtick-wrapped command in a step's prose now renders as a `<pre>` block with a Copy-to-clipboard button alongside. Single-click clipboard write replaces triple-click + careful selection.
- **Smoke-walk skill — restart-warning** (Step 4). Loud "**never restart Duo while a walk is in progress**" guard with a 3-option escape hatch when a main-process change MUST land mid-walk. Owner lost 20 min of typed walk notes to this; convention prevents the next instance.
- **Smoke-walk generator emits `<meta name="duo-open-in" content="browser">`**. Walk pages route to the browser pane regardless of how they're opened (canvas mode would put the body in contenteditable, trapping Copy-button clicks as cursor placements).

### Changed

- **HTML canvas no longer auto-prompts to inject `data-duo-id` attributes** (gated behind `FEATURE_AUTO_INJECT_IDS`; default off). Existing files with IDs continue to work; agents can call `duo html stamp-ids` manually when a session needs anchors.
- **`canvas-authoring.md` skill split** into `canvas-authoring.md` + `canvas-interaction.md` (single-responsibility per Anthropic skill best practices). Authoring covers building canvases; interaction covers driving them via `duo html *` from a Claude session.

### Internal preview — present but not yet validated

The following Stage 27 + 18b + 28 work is included in this release as code, but **smoke walk-2 surfaced 7 regressions** that are still open. These features may behave unexpectedly; full validation + fixes land in v0.6.0.

- **Stage 27 (canvas-authoring vocabulary)** — six new canvas-action verbs (`editor:open`, `nav:reveal`, `selection:set`, `theme:set`, `terminal:focus`, `duo:event`); `duo events --follow` streaming CLI; `data-payload-from` form-input binding; `<meta name="duo-default-editable">` routing; canvas-authoring + canvas-interaction skills; five reference templates. **Known issues:** BUG-052 (`editor:open data-mode='canvas'` — toolbar/strip missing), BUG-053 (`nav:reveal` — file not highlighted), BUG-054 (`terminal:focus` — visual flips but cursor not active), BUG-055 (canvas click should focus working pane).
- **Stage 18b (distro skill packs)** — pack format, PackLoader, `installed-packs.json`, first-launch hook, `duo packs` CLI. CLI walk passes.
- **Stage 28 (lesson packs)** — `intro-to-duo` and `claude-code-basics` packs. Both render; "Start lesson" spawn behavior in `intro-to-duo` needs gating (ENH-049).

### Known issues (separate from internal-preview Stage 27/18b/28)

- **BUG-056** — Send → Duo pill on browser pane fires without an active Claude session. Recurring; needs gating + regression test. Targeted for v0.6.0.
- **BUG-057** — Pinned working-pane tabs lost across sessions / app upgrades. Targeted for v0.6.0.
- **BUG-058** — Browser pane (WCV) still occludes the WorkingTabStrip context menu (BUG-050 partial fix; needs WCV-mute pattern). Targeted for v0.6.0.

## [0.5.4] — 2026-05-01

A tight follow-up sprint to v0.5.3: every right-click in Duo now does what users expect, ⌘\` after `duo open` finally toggles cleanly, the browser pane gets ⌘F find-in-page, breadcrumbs show the active folder by default, markdown tab cycling is instant, and a build-version badge in the titlebar prevents "am I walking the right build?" confusion at smoke-walk time.

### Added

- **Right-click context menus everywhere** (ENH-031). Cut / Copy / Paste / Select All / Look Up / Spell-check / Inspect (dev only) in the markdown editor, HTML canvas, and browser pane. Previously a no-op. Wired via `electron-context-menu` v4 (ESM, dynamic-imported) per webContents — catches every WCV (browser tabs) AND the main BrowserWindow (canvas iframes ride on it).
- **Copy as Plain Text** (ENH-030). New entry at the top of the right-click menu when text is selected; ⌘⌥C in the Edit menu. Strips formatting marks; pastes cleanly into terminals and other plain-text targets.
- **⌘F find-in-page in the browser pane** (ENH-028). Parity with the markdown editor's find — find bar above the address row, ⌘G / ⌘⇧F navigate matches, ⎋ closes, match counts stream live via Electron's `webContents.findInPage` + `found-in-page` event.
- **Build-version badge in the titlebar** (ENH-033). `0.5.4 ·dev` (or just `0.5.4` when packaged), left of the theme toggle. Glanceable confirmation of which build is live before walking a smoke.
- **Smoke-walk skill** now refuses to generate a walk page whose manifest version doesn't match `package.json`, with a clear error explaining both fix paths. Three layers of defense (cut-version § Step 7 + smoke-walk § Step 2 precondition + `generate.mjs` runtime guard).

### Changed

- **`duo open` shifts focus to the new browser tab.** Explicit `webContents.focus()` after `switchTab` plus a `BROWSER_FOCUS_GAINED` IPC push from the open handler so the renderer's `focusedColumn` aligns with user intent independent of OS-focus mechanics.
- **Navigator breadcrumb pans to the right** on every cwd change (ENH-029). Active (rightmost) segment renders bolder + brighter; earlier segments stay reachable via the user's pan gesture.
- **Cycling between markdown tabs is now instant** (BUG-046). `WorkingPane` keeps every file-tab renderer mounted (display-toggled), mirroring TerminalPane. No more 1–2s TipTap rebuild per switch.
- **Skill — `duo: command not found` troubleshooting added** (SKILL-001). Explicit install-location checklist (`~/.claude/bin/duo`, `~/.local/bin/duo`, `/usr/local/bin/duo`), env-var probes, and a "don't fall back to native `open`, don't ask the user to do it for you" rule. Plus a behavior rule: invoke `duo` directly via Bash for one-shot ops; reserve the subagent for multi-step browser workflows.
- **Cut-version skill** codifies "bump `package.json` to next MINOR immediately after cut" as Step 7. Without it, the dev-build version badge and smoke-walk filenames diverge mid-sprint, which was confusing during a v0.5.4 re-walk.
- **Browser-pane ⌘F / ⌘G / ⌘⇧F now reach the renderer.** Added `f` and `g` to the `wireKeyForwarding` allowlist so they work even when the WCV has OS focus; `f` gets the BUG-002 focus-reclaim treatment so the find input takes focus correctly.

### Fixed

- **⌘\` toggles back to terminal cleanly after `duo open`** (BUG-048 v3, the real fix). Root cause was the menu accelerator's pre-IPC focus reclaim firing the xterm helper-textarea's `focus` event in the renderer BEFORE `togglePaneFocus` read its `prev` — the listener flipped `focusedColumn` to 'terminal' as a side effect, poisoning the toggle direction. Fix: main no longer reclaims on ⌘\`; renderer reads its own state via a `focusedColumnRef` that's bypassed by the xterm focus listener (`setFocusedColumnSilent`), decides direction, then asks main to reclaim via the new `PANE_FOCUS_RECLAIM` IPC.

### Known issues

- **`duo doc goto --heading "X"`** still scrolls to a wrong-but-numerically-near heading on `tasks.md` (rev3 walk: target BUG-038 → landed on BUG-034). Deferred per owner: do not block future releases. v4 disk-reload + v5 instrumentation are in the codebase for the next debugging pass; no further work scheduled. (ENH-022)
- **Multi-byte UTF-8 paste into terminals with non-UTF-8 locale** (e.g. conda's `(base)` activator setting `LC_ALL=C`) renders bytes individually rather than as proper Unicode chars. Not a Duo bug — the clipboard write is correct (TextEdit confirms round-trip). Filed as ENH-032 to add install-time documentation. Workaround: `export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` in your shell rc-file after conda init.

## [0.5.3] — 2026-05-01

Two stages closed (Atelier whisper-presence + Send → Duo polish), a broad polish sweep across the navigator/editor/tab strips, three new agent-driven CLI verbs (`duo doc goto` / `duo doc find` / `duo reload`), and the new **smoke-walk** skill that turns sprint-end verification into a structured user walk-through.

### Added

- **Stage 12 close — whisper-level agent presence** (titlebar dot + pane-level selection glow). Small accent dot in the chrome strip softly breathes when the front terminal has a live Claude session (commit `26e69d9`); working pane briefly flashes a soft accent halo when the agent calls `duo selection`. Selection-anchored CHR-driven glow stays as future polish per `globals.css`.
- **Stage 15 close (15.3) — Send → Duo polish trio** (commit `6340832`). ⌘D global chord routes via `duo-send-to-duo` CustomEvent to whichever surface has a cached selection. 5000-char length cap with `… [truncated; N total — call \`duo selection\` for the full text]` marker. Canvas image-flatten replaces `<img>` with `[image: alt-or-filename]` placeholders.
- `duo reload` CLI verb (commit `11b0bf2`) — reload the active browser tab in place; pair for `duo navigate` that doesn't require a URL. Stage 20 partial (1 of 6 remaining items closed).
- `duo doc goto [<path>] --heading X | --line N | --anchor Y` (commit `bc5e520` + earlier `84f5a35`) — agent-driven editor scroll via headings, line numbers, or GitHub-slug anchors (ENH-022). Response shape includes `matched_heading` for diagnostic visibility into the precedence chain.
- `duo doc find <query> [<path>] [--case-sensitive]` (earlier `c3c7745`) — read-only buffer search (ENH-023).
- ⌘F find-in-document for the markdown editor — find bar with match counter, ↓/↑ + ▼/▲ navigation, smooth scroll-to-match (commits `c3c7745` + `1645e9a` + `9dc7ac4`).
- ⌘[ / ⌘] outdent / indent in markdown bullet / ordered / task lists (`1645e9a`).
- Bullet-marker round-trip — typing `*`, `-`, or `+ ` preserves the marker through save/load (`e4dd809`).
- Right-click context menu on FileTree whitespace → New file / New folder / Open terminal here / Reveal in Finder, anchored to project root (`d14fd82`).
- Right-click context menu on WorkingPane tabs (file tabs and `file://` browser tabs) → Reveal in navigator / Rename… / Pin tab / Move to Trash… (`d14fd82` + `ba0af8a` + `2a9e59f`).
- Tab strip pans to keep the active tab visible when overflowing (`d14fd82`).
- Editable breadcrumb at the navigator top — ⌘⇧G flips it into a path input (`ff3e7c3`).
- CWD highlight + section dividers + focus stripe in the navigator (`cc11912`).
- Open / active file visual distinction in the navigator (`7a2e9ca`).
- New **smoke-walk** skill (`1b51c8a` + `4660f26` + `6cf14bb`) — generates an interactive HTML walk page from a JSON manifest, opens it in Duo's browser pane; user clicks pass/fail toggles + notes, hits Copy, pastes the structured block back into chat for parse + status flips.

### Changed

- BUG-038 (4th + 5th instance) — ⌃Tab cycle now reaches all working-pane tabs. v3 added an `activePaneRef` to mirror `opts.activePaneFocus` (closes the closure-staleness flavor; commit `f8527a3`); v4 dispatches `duo-cycle-working-tab` so WorkingPane iterates the merged file+browser tab list (closes the structural flavor where file tabs were invisible to the cycle; commit `d4f40cd`). Cycle math extracted into a pure `cycleNext()` helper at `renderer/keyboard/tabCycle.ts` for future PROCESS-001 unit tests.
- BUG-042 — browser-pane click-to-focus (`ad839d8`). `webContents.on('focus')` pushes `BROWSER_FOCUS_GAINED` so the renderer flips `focusedColumn = 'working'`. Symmetric to the canvas mousedown forwarder (BUG-037).
- BUG-040 + ENH-021 — off-host blocklist routing on user-driven navigation (`40ab246` + `d8c248c` + `4435fd9`). `BrowserManager` intercepts `will-navigate` / `will-redirect` / popups and routes `external-domains.json` matches to the system browser. Self-heals an empty domains file at boot.
- BUG-039 — session-restore drops files that no longer exist (`5195320`).
- BUG-044 — find-input contrast in dark mode (`9dc7ac4`). Added a `paper` color family to `tailwind.config.mjs` (was silently inert across multiple components); dropped FindBar's `focus:bg-white` so the input keeps its theme-aware paper bg on focus.
- BUG-045 v2 — file:// browser tab right-click menu was visually occluded by the WebContentsView (`2a9e59f`). New `BrowserManager.setOverlayMuted(boolean)` collapses the WCV to 1×1 while a renderer-DOM overlay is open; restores on close. macOS composites WCV above renderer DOM regardless of z-index, so this mute-and-restore is the structurally simplest path. Filed as **BUG-047** (class-summary primitive); BUG-006 (Send → Duo pill) and ENH-028 (browser pane find bar) still need their own integrations of the same API.
- BUG-043 — find scroll-to-match (`1645e9a`). ProseMirror's `scrollIntoView` couldn't find the right scroll container; replaced with native `scrollIntoView({block:'center'})` on the decoration node. Plus ArrowDown/ArrowUp navigation in the find input.
- ENH-015 — Files-pane collapse button is now visible at rest (`70d6ffc`). Was barely-visible `text-zinc-600` on cream paper; bumped to `text-ink-mute` and swapped to a Finder/VS-Code-style sidebar-toggle glyph.
- ENH-019 — tab-strip scrollbars suppressed (`5195320`).

### Fixed

- BUG-036 + BUG-037 — pane-aware ⌘T + canvas focus mousedown forwarder (`ca3b3a3`).
- ENH-016 — context-menu New file / New folder hotfix (`3eee115`). `window.prompt()` is silently disabled in Electron renderers; replaced with a create-default-name (`untitled.md` / `untitled-folder`) + auto-rename pattern.
- ENH-022 v2 — chained editor commands into one transaction + DOM-level `scrollIntoView` fallback so the editor visibly scrolls (`a58a58f`).
- ENH-022 v3 — heading-match precedence chain (exact > starts-with > word-boundary > substring) + `matched_heading` field in the response (`2a9e59f`). Partial fix; see Known issues.

### Known issues

- **ENH-022 v3 — `duo doc goto --heading X` still picks the wrong heading on tasks.md.** v2 fixed the scroll plumbing; v3 tightened match precedence but a wrong heading still wins on the smoke walk (rev2: BUG-032; rev3: BUG-034). Likely buffer-staleness (Stage 16 external-write reconciliation is ⬜) or word-boundary regex permissive in TipTap textContent. Released as-is per owner's call; the response shape already exposes a `matched_heading` field so v4 debugging is self-diagnosing.
- **ENH-031 — right-click in markdown editor / canvas / browser pane shows no context menu** (no Cut / Copy / Paste / Spell-check / Inspect). Pre-existing Electron-renderer gap; never had `electron-context-menu` wired. Filed at v0.5.3 cut from a smoke-walk observation; recommend Path A (electron-context-menu npm package) for a v1 follow-up.
- **BUG-046** — visible 1–2s render delay between two markdown editor tabs on ⌃Tab. Root cause: TipTap instance gets re-mounted per tab switch (key={path}). v1 fix is to keep inactive editors mounted under display:none (mirror TerminalPane).
- **BUG-048** — ⌘\` (pane focus toggle) broken after `duo open` shifts focus to a new browser tab. Diagnosis path filed.
- **BUG-038 carry-over** — render-catchup delay between markdown tabs (BUG-046 above) is the visible artifact of the otherwise-functional v4 fix.

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

- `docs/roadmap.html` + `docs/roadmap.html` snapshot bar updated to "post-v0.4.1, post-Stage-21" with v0.4.1 sandbox-resilience headline; Stage 21 status section flipped from "remaining work is mechanical" to "✅ shipped 2026-04-27" with the iCloud File Provider root cause documented inline.

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

[Unreleased]: https://github.com/dudgeon/duo/compare/v0.7.3...HEAD
[0.7.3]: https://github.com/dudgeon/duo/releases/tag/v0.7.3
[0.7.2]: https://github.com/dudgeon/duo/releases/tag/v0.7.2
[0.7.1]: https://github.com/dudgeon/duo/releases/tag/v0.7.1
[0.7.0]: https://github.com/dudgeon/duo/releases/tag/v0.7.0
[0.6.15]: https://github.com/dudgeon/duo/releases/tag/v0.6.15
[0.6.14]: https://github.com/dudgeon/duo/releases/tag/v0.6.14
[0.6.1]: https://github.com/dudgeon/duo/releases/tag/v0.6.1
[0.6.0]: https://github.com/dudgeon/duo/releases/tag/v0.6.0
[0.5.6]: https://github.com/dudgeon/duo/releases/tag/v0.5.6
[0.5.4]: https://github.com/dudgeon/duo/releases/tag/v0.5.4
[0.5.3]: https://github.com/dudgeon/duo/releases/tag/v0.5.3
[0.5.2]: https://github.com/dudgeon/duo/releases/tag/v0.5.2
[0.5.1]: https://github.com/dudgeon/duo/releases/tag/v0.5.1
[0.5.0]: https://github.com/dudgeon/duo/releases/tag/v0.5.0
[0.4.5]: https://github.com/dudgeon/duo/releases/tag/v0.4.5
[0.4.4]: https://github.com/dudgeon/duo/releases/tag/v0.4.4
[0.4.3]: https://github.com/dudgeon/duo/releases/tag/v0.4.3
[0.4.2]: https://github.com/dudgeon/duo/releases/tag/v0.4.2
[0.4.1]: https://github.com/dudgeon/duo/releases/tag/v0.4.1
[0.2.0]: https://github.com/dudgeon/duo/releases/tag/v0.2.0
[0.1.0]: https://github.com/dudgeon/duo/releases/tag/v0.1.0
