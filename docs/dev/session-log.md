# Session log — Duo

> Historical "what shipped when" detail moved here 2026-04-26 to keep
> CLAUDE.md slim per Claude Code best practices ("Bloated CLAUDE.md
> files cause Claude to ignore your actual instructions"). The
> roadmap (`docs/roadmap.html` canonical, `ROADMAP.md` synced view)
> is the authoritative source for stage status; this file is the
> running session-by-session prose log of what landed, why, and
> what's owed.
>
> **For the current state, read the top of this file** (most recent
> session at the top). For stage status, read `docs/roadmap.html`.
> For the still-open process / intent threads, see
> `docs/dev/intent-pause.md` if it exists.
>
> Older sessions can be pruned freely once the lessons make it into
> ROADMAP / DECISIONS / smoke-checklist.

---

## 2026-04-30 (late evening) — v0.5.4 sprint: carry-over closeout from v0.5.3 walk

Picked up after compaction, in auto mode, to clear the seven carry-over
items from the v0.5.3 smoke walk. One new bug (BUG-043) surfaced
mid-flight from user feedback on the ⌘F find bar. All 7 + the new
one shipped clean in a single working pass.

### What landed (one commit-scoped sprint)

1. **ENH-022** (CLI surface fix) — lifted `flagValue(args, name)` to
   module scope in `cli/duo.ts`, renamed the local one-arg shim in
   `case 'html'` to `flag`. `node cli/duo doc goto --heading "BUG-040"`
   now returns `{ ok: true, anchor: "bug-040-..." }` against the live
   app. Rebuilt the binary.
2. **BUG-038 v3 (4th instance — finally root-caused)** — added
   `activePaneRef` mirror in `useKeyboardShortcuts.ts`. Same ref
   pattern as BUG-021's `tabsRef`, applied to `opts.activePaneFocus`.
   Closes the closure-staleness window where the dispatcher reads
   the stale pane from a not-yet-rebound effect closure when the
   user clicks a terminal tab and immediately presses ⌃Tab. User
   was hitting it because the cycle was taking the BROWSER branch
   (3 tabs visible) instead of the terminal branch (10 tabs). Also
   extracted the cycle math into a pure `cycleNext(tabs, currentId,
   delta)` helper at `renderer/keyboard/tabCycle.ts` so PROCESS-001
   Phase 2 can pin the contract via unit tests.
3. **BUG-042** — subscribed `webContents.on('focus', ...)` in
   `BrowserManager.wireKeyForwarding`; new IPC channel
   `BROWSER_FOCUS_GAINED` flows through preload + `host-api.ts`
   (`onBrowserFocusGained`) into App.tsx, which flips `focusedColumn
   = 'working'`. Symmetric to the BUG-037 canvas mousedown forwarder.
   Combined with BUG-038 v3 this closes the wrong-pane-shortcut
   failure family.
4. **BUG-041** — wrapper-level `onContextMenu` on the FileTree
   container; `e.target === e.currentTarget` gate prevents double-fire
   from row clicks. Synthesized "root" target uses `state.cwd`. New
   `whitespaceMode` flag on `buildMenuItems` trims the menu to
   New file / New folder / Open terminal here / Reveal in Finder.
5. **ENH-024** — both tab strips ref the active button and call
   `scrollIntoView({ inline: 'nearest', block: 'nearest', behavior:
   'smooth' })` on active-id change. `inline: 'nearest'` is the
   right primitive: visible tabs no-op, off-screen tabs pan into
   view smoothly. React 19 ref typing required `Ref<>` not
   `RefObject<>` on the prop.
6. **ENH-025** — new `ListIndentShortcuts` TipTap extension binds
   `Mod-]` → `sinkListItem` and `Mod-[` → `liftListItem`. Tries
   `taskItem` first (TaskList) then `listItem`. Outside a list,
   returns false → keystroke bubbles harmlessly (plain `⌘[` / `⌘]`
   aren't claimed globally; only `⌘⇧[` / `⌘⇧]` are).
7. **ENH-026** — `WorkingTabStrip` extended with
   `buildTabContextMenuItems`. File tabs get **Reveal in navigator**,
   **Rename…**, **Move to Trash…**. Browser tabs only see
   Pin/Unpin (existing). Trash uses a dedicated `confirmTrash`
   dialog separate from the pinned-close confirm. Rename uses a
   `duo-tree-start-rename` CustomEvent so FileTree picks it up
   without lifting `renamingPath` state.
8. **BUG-043 (in-flight, surfaced from user feedback)** — ⌘F find
   was counting matches but not scrolling to them; arrow keys did
   nothing. Two distinct bugs: (a) `scrollBy` on `view.dom.parentElement`
   silently failed because the actual scroll container is 2-3
   ancestors up — replaced with `el.scrollIntoView({ block: 'center'
   })` on the `.duo-find-match-current` decoration node directly,
   plus a closure-scoped (lastScrolledIndex, lastScrolledQuery)
   dedupe to fire smooth-scroll exactly once per next/prev. (b)
   ArrowDown / ArrowUp not bound — added handlers in `FindBar.tsx`.

### Pre-cut owed

Smoke-walk this sprint via computer-use OR ask the user to verify
before proposing v0.5.4. Specifically:
- BUG-038 v3: open ≥10 mixed terminal tabs, click rightmost, ⌃Tab
  forward, confirm cycle visits all 10 in order. Then click a
  browser tab, confirm ⌃Tab routes to browser cycle (immediately —
  no first-keystroke staleness).
- BUG-042: with terminal focused, click into the browser pane, press
  ⌃Tab — should cycle browser tabs. Without the fix this would have
  cycled terminal tabs because focusedColumn never flipped.
- BUG-043: ⌘F → search a string with many matches → press ↓/↑ and
  ▼/▲ buttons → smooth scroll lands the current match in viewport.
- ENH-024: open enough tabs to overflow the strip, ⌘1 → ⌘9 → confirm
  the active tab pans into view each time.
- ENH-025: in a markdown bullet list, `⌘]` indents nested, `⌘[`
  outdents. In TaskList items the same. Outside a list, both no-op.
- ENH-026: right-click any file tab → see Reveal/Rename/Trash;
  Reveal lights up the tree row; Rename puts the row in inline rename;
  Trash confirms then closes the tab.

### Carry-over from this sprint

None on the engineering side. Pre-cut-decision items:
- Whether to bundle BUG-038 v3 into a v0.5.4 cut alongside the rest
  or hold for a one-day soak. The v3 fix is structurally sound (same
  pattern as BUG-021 which has been stable for months) but this is
  the 4th instance of "⌃Tab cycle skips tabs" so caution is
  warranted. Recommend cut + monitor; PROCESS-001 Phase 2 unit tests
  will pin the contract once the framework lands.
- Whether to add a smoke-checklist row for BUG-043 (find scroll +
  arrows). Arguably overlaps with row 14 (⌘F find bar) — could
  expand row 14 in place. Did not modify smoke-checklist this
  sprint.

### Smoke walk results (2026-04-30, post-build)

First user-driven smoke walk via the new `smoke-walk` skill.
8 items, **5 PASS / 3 FAIL / 0 SKIP**. v0.5.4 cut on hold pending
fixes. Results:

- ✅ BUG-042 — Browser pane click → focus.
- ✅ BUG-041 — FileTree whitespace right-click context menu.
- ✅ ENH-024 — Tab strip pan-to-active.
- ✅ ENH-025 — ⌘[ / ⌘] outdent / indent.
- ✅ BUG-043 — Find scroll + arrows. **Note:** dark-mode find-input
  contrast is unreadable (light brown on white). Filed as **BUG-044**.

- ❌ **BUG-038 (5th instance)** — v3 closure-staleness fix didn't
  cover the working-pane flavor. Cycle handler's else-branch calls
  `browser.getTabs()` + `browser.switchTab()`, which only knows
  browser tabs — file tabs (markdown editor, HTML canvases) are
  invisible to the cycle. User repro: ⌘N spawns a markdown file at
  far-left of working strip; ⌃Tab visits the right-side browser
  tabs but skips the markdown tab entirely. v4 fix sketch + class
  summary in `tasks.md § BUG-038`. The pure-helper extraction
  (`renderer/keyboard/tabCycle.ts`) IS the right shape — v4 just
  needs to feed it the merged tab list, not browsers-only.

- ❌ **ENH-022** — CLI succeeds, renderer doesn't scroll. The CLI
  scope-fix (commit `bc5e520`) is correct; user pasted a clean
  ok:true response with the right path / line / anchor. The bug is
  downstream in `MarkdownEditor.tsx`'s scroll-to-position handler —
  most likely the same scroll-container-mismatch class as BUG-043
  (`scrollBy` on the wrong element). Diagnosis carry-over.

- ❌ **ENH-026** — Menu fires on markdown editor tabs but not on
  HTML canvas tabs. Browser tabs correctly show Pin/Unpin only.
  Diagnosis carry-over: trace `tab.path` for canvas tabs — likely
  dropped somewhere in `WorkingPane.tsx § mergedTabs` projection,
  or canvas tab's `FileTab` type is missing `path`, or
  `CanvasTab.tsx` is intercepting right-click.

### Pre-cut-decision update

**v0.5.4 cut on hold.** Three substantive failures (one of them a
recurring-class bug now in its 5th instance). Recommend a v0.5.4
sub-sprint to fix all three carry-overs + BUG-044, re-walk, then
cut. Estimated scope: BUG-038 v4 wiring (medium — touches App.tsx
+ useKeyboardShortcuts), ENH-022 v2 (small — tracing a
ProseMirror scroll), ENH-026 v2 (small — tracing path
propagation), BUG-044 (small — CSS).

The smoke-walk skill itself worked well — first run captured the
right level of structured detail to act on. One template tweak
landed mid-flight (commit `4660f26`): added a free-form "Other
notes" field for paper cuts that don't fit a specific item, with
SKILL.md format spec + parser instructions.

---

## 2026-04-30 (evening) — v0.5.3 sprint: post-v0.5.2 papercut sweep + smoke walk

A long autonomous session on `main`. Filed 14 items from
`20260430-improvement-notes.md` + 2 sprint-add ENHs (`duo doc goto`,
⌘F find-in-document), shipped them across 14 commits, then
smoke-walked via computer-use against a freshly-packed unsigned
`.app`. Walk surfaced 4 bugs in the just-shipped code that landed
as in-walk hotfixes; user follow-up surfaced 4 more known-issues
that carry into the next sprint.

### What landed (14 commits)

1. `40ab246` **BUG-040 + ENH-021 v1** — off-host blocklist routing
   for user-driven navigation. New `core/external-domains-service.ts`
   loads + watches `~/.claude/duo/external-domains.json`; BrowserManager
   gains `will-navigate` + `will-redirect` interceptors and a
   `setWindowOpenHandler` check.
2. `ca3b3a3` **BUG-036/037/038 (W1)** — pane-aware ⌘T (terminal →
   shell tab in CWD; ⌘⇧T → claude tab in CWD), canvas iframe
   mousedown forwarder for focus, xterm-focus listener flipping
   `focusedColumn` on non-click focus paths.
3. `5195320` **BUG-039 + ENH-019** — session-restore guards against
   deleted files via new `files.exists` IPC; tab-strip scrollbar
   suppression (the `scrollbar-none` Tailwind class was referenced
   but the underlying CSS rule was never defined).
4. `e4dd809` **ENH-018 v1** — bullet marker round-trip (`*` / `-` /
   `+`). New `BulletListWithMarker` extension; markdown-it parse
   hook copies `token.markup` to `data-marker`; serializer override
   per list.
5. `cc11912` **Stage 26 PR 3 items 2 + 10 + 11** — active-CWD dot
   on folder rows, stronger Claude-settings ↔ project-tree divider,
   2px left-edge accent stripe on the files column when focused.
6. `7a2e9ca` **Stage 26 PR 3 item 3** — open / active file
   distinction. Brighter text for open files; accent dot for the
   active one.
7. `59769da` **ENH-016 v1** (since superseded by hotfix) — "New
   file" / "New folder" context-menu entries via `window.prompt`.
8. `ff3e7c3` **Stage 26 PR 3 item 8** — editable breadcrumb (⌘⇧G).
   New `files.kind(path)` IPC for the file-vs-folder branch.
9. `84f5a35` **ENH-022** — `duo doc goto [<path>] --heading | --line
   | --anchor`. Markdown editor handles all three; canvas handles
   anchor + line. **CLI side has a lexical-scope bug (carry-over).**
10. `c3c7745` **ENH-023** — ⌘F find-in-document for the markdown
    editor. New `FindHighlight` ProseMirror plugin (decoration-only).
    FindBar React component with Aa toggle, prev/next, counter.
    CLI counterpart `duo doc find`.
11. `4435fd9` **BUG-040 hole-fix** (in-walk) — smoke walk found two
    more `loadURL` paths that bypassed `will-navigate`:
    `BrowserManager.navigate()` (address-bar IPC) and
    `restoreFromSession()`'s firstTab repurpose.
12. `d8c248c` **ENH-021 v2** (in-walk) — runtime self-heals empty
    `external-domains.json` at every boot. Walk found a real
    machine where the file was `{"domains":[]}`; install-service's
    bootstrap+merge only fires on user-clicked install.
13. `3eee115` **ENH-016 + ENH-018 hotfixes** (in-walk).
    ENH-016 replaced `window.prompt` (silently null in renderer)
    with create-default-name + auto-rename pattern. ENH-018
    replaced `list-style-type: 'X  '` string literals (rendered
    indistinguishably in Chromium) with `::before` pseudo-elements.

### What I verified live via computer-use

Built unsigned `.app` (signing failed at codesign GPU-helper xattr
quirk; bypassed with `CSC_IDENTITY_AUTO_DISCOVERY=false`). Drove
Duo via `mcp__computer-use__*`:

- ✅ ENH-023 find bar (`smoke` query → 6 matches → counter `1/6` →
  ⌘G cycled to `2/6` → Aa toggle filtered to `1/3`).
- ✅ Stage 26 PR 3 item 8 (⌘⇧G opens editable breadcrumb;
  navigates + opens tasks.md).
- ✅ Stage 26 PR 3 item 10 (clear 2px accent rule between
  Claude-settings and project tree).
- ✅ BUG-040 (after the hole-fix + populating
  `external-domains.json`: `capitalone.com` → tab stayed at
  `about:blank`, Chrome opened externally).

### User-verified post-walk

- ✅ ENH-019 (scrollbar suppression, on the running build)
- ✅ ENH-018 (bullets render distinctly post-hotfix)
- ⚠️ ENH-016 (works on row right-click; misses whitespace below
  tree → BUG-041)
- ⚠️ BUG-037 (canvas works; browser pane sibling open → BUG-042)
- 🟡 BUG-038 (re-opened — left 7 tabs unreachable; this is now
  the FOURTH ⌃Tab cycle bug)
- 🟡 ENH-022 (CLI lexical-scope bug — `flagValue is not defined`)

### Carry-over into next sprint (all filed in tasks.md)

- 🟡 **BUG-038** — fourth instance; cycle list still partitioning.
  Next round MUST land with regression test.
- 🟡 **ENH-022** — one-line fix (lift `flagValue` to module
  scope) + binary rebuild.
- 🆕 **BUG-041** — context menu missing on FileTree whitespace.
- 🆕 **BUG-042** — browser-pane click → focus (BUG-037 sibling
  for `WebContentsView`; main-side forwarder).
- 🆕 **ENH-024** — tab strip pan-to-active when overflow
  (`scrollIntoView` on active-tab change).
- 🆕 **ENH-025** — `⌘[` / `⌘]` outdent / indent in markdown
  editor.
- 🆕 **ENH-026** — right-click on tab → rename / delete /
  reveal in navigator.

### Open questions for the planning round

- BUG-042's main-side forwarder may overlap with BUG-038's fix.
  Sequence BUG-042 first if they're related.
- The blocklist self-heal (ENH-021 v2) overwrites a malformed
  file; the install-service path explicitly preserves it. Worth a
  short DECISIONS.md ADR on which contract wins where.

### Owed before the v0.5.3 cut

1. Fix ENH-022 CLI scope bug (~5 minutes).
2. Re-fix BUG-038 + add the regression test (recurring-class rule
   from CLAUDE.md).
3. Decide whether BUG-041 (whitespace context menu) ships with
   v0.5.3 or rolls into v0.5.4 — recommend bundling with v0.5.3
   to make ENH-016 feel complete.
4. The remaining carry-over items (BUG-042, ENH-024/025/026) are
   their own sprint.

---

## 2026-04-30 (afternoon) — Chrome-extension exploration: phases 4–6.5 shipped, distribution decided

A long autonomous session on the `duo-chrome-extension-exploration`
branch. The exploration's load-bearing question — *can Duo ship as
a Chrome extension?* — is answered yes. Architecture proven through
six MVP phases (most still pending Geoff's tonight verification);
strategic shape decided (both shapes ship, no deprecation); Phase 7
file-level plan ready for next session.

**What landed on the exploration branch (chronological):**

- **Phase 4a (✅ verified)** — file r/w through the Native Messaging
  helper (`files:read` / `files:write`); plain textarea editor in
  the canvas tab, end-to-end save round-trip working. Validated the
  wire path before introducing the React toolchain.
- **Phase 4b (✅ verified)** — esbuild bundle + React + TipTap
  markdown editor in the canvas tab. 1.9 MB dev bundle (613 KB
  minified prod). Reuses existing root deps (`react`, `tiptap-markdown`,
  `@tiptap/starter-kit`, `esbuild`, `typescript`); chose esbuild
  over Vite to avoid a `dist/` reorg.
- **Phase 5 (🟡)** — agent verbs over `chrome.tabs` /
  `chrome.scripting`. Two new rail buttons in the side panel
  (`agent:tabs:list`, `agent:scripting:title`). Manifest gained
  `tabs`, `scripting`, `host_permissions: <all_urls>`.
- **Phase 6 (🟡)** — `chrome.debugger` CDP path with `agent:cdp:eval`.
  Attach / Runtime.evaluate / detach with `finally`-guarded cleanup
  so the yellow "Duo started debugging" bar can't get stuck.
- **Phase 6.5 (🟡)** — CLI bridge. Helper exposes both a Unix socket
  AND a TCP listener (32-byte hex auth token gates TCP); `duo-ext`
  CLI binary tries Unix first, falls back to TCP on the sandbox
  failure modes (`EPERM`/`ECONNREFUSED`/timeout). Empirically
  verified TCP localhost passes Claude Code's bash sandbox in the
  same session that wrote the code. Pattern mirrors the Stage 20
  ADR for the Electron-app `cli/duo` (transport-agnostic).
- **`install.sh` Sequoia fix.** macOS Sequoia gates Chrome's NM-host
  spawn from `~/Documents/`. The original install.sh pointed the
  manifest at the worktree path inside `~/Documents/`; Chrome
  silently failed to spawn the helper. Fix: install.sh now copies
  the helper into `~/Library/Application Support/Duo/` (in user
  space, outside the gate). Symlinks `duo-ext` into `~/.claude/bin/`
  so it's on PATH from any terminal (Claude Code's sandbox writes
  through `~/.claude/`).

**Distribution strategy (PR [#39](https://github.com/dudgeon/duo/pull/39))** — Initial
sketch was extension-as-primary with Electron sunset; Geoff pushed
back. Revised landing: **both shapes ship indefinitely as
complementary peer products**. The Electron app is the foundation
and serves as the Native Messaging host (`Duo.app --nm-shim` mode);
no separate helper PKG. Auto-launch Duo.app on extension's first NM
connect. Explicit `chrome:` / `embedded:` CLI verb prefixes
disambiguate the two browser surfaces; default targets the surface
adjacent to the calling terminal. Doc:
[`docs/research/duo-as-chrome-extension/distribution-strategy.md`](../research/duo-as-chrome-extension/distribution-strategy.md).

**Phase 7 implementation plan** (on exploration branch):
file-level cutover spec at
`docs/research/duo-as-chrome-extension/phase7-implementation-plan.md`.
Net **-470 LOC** — most of `phase0/helper/` collapses into a 50-line
`--nm-shim` mode in `electron/main.ts`; `phase0/cli/duo-ext` folds
into the unified `cli/duo` with `chrome:` / `embedded:` prefix
routing. Six-row test matrix for the cutover. Effort ~2 working
days; Web Store review takes 3-5 days separately.

**Web Store listing prep** (on exploration branch): pre-baked
content at `docs/research/duo-as-chrome-extension/web-store-listing.md`
covering listing copy, single-purpose statement, per-permission
justifications, icon/screenshot plan, privacy policy stub, and a
submission checklist. Copy-paste exercise when Phase 7 reaches the
upload step.

**Lessons / forward-looking notes:**

1. **Stage A is now strategically load-bearing.** It was always a
   no-regrets refactor; with the dual-target distribution committed,
   `core/` is the foundation both shapes import from. Smoke-walk +
   PR-to-main is the next blocking step before any Phase 7 code
   lands.
2. **The Electron app's existing socket-server.ts already has the
   protocol the extension needs** (Stage 20 TCP fallback, auth
   tokens, NDJSON framing). Phase 7 is mostly *additive* — adding
   `agent:*` verbs and `cli:request` to the existing dispatcher,
   not building a parallel transport.
3. **Sequoia's `~/Documents/` gate is a reusable lesson.** Anything
   Chrome / Native Messaging needs to spawn must live outside
   `~/Documents`, `~/Downloads`, `~/Desktop`. `~/Library/Application
   Support/` is the canonical home; `~/.claude/` is sandbox-writable
   for CLI binaries.
4. **The chrome-cdp skill's pattern** (used elsewhere by the user)
   demonstrates that **TCP localhost passes Claude Code's bash
   sandbox** even when Unix sockets don't. Both transports are
   live in the helper to support both contexts; the CLI's fallback
   logic is what makes "works inside Claude Code" the default.

**Evening update (post-verification + Stage A landed):**

After Geoff got home: walked the verification checklist
(`phase0/VERIFICATION-CHECKLIST.md`) end-to-end. All ✅:
- **Phase 5** rail buttons: `tabs:list` returned "232 tabs — active:
  Orders - Etsy"; `scripting:title` returned active tab title.
- **Phase 6** CDP gear button: yellow "Duo started debugging" bar
  flashed and auto-detached; banner showed "✓ tab #N CDP eval →
  number 2".
- **Phase 6.5** from a regular terminal: doctor (sock + tcp OK),
  tabs (232-element JSON), title, eval — all clean. From inside a
  sandboxed Claude Code session: same commands worked. Interesting
  finding — Geoff's specific Claude-Code sandbox didn't block the
  Unix socket on this run, but the TCP fallback is still load-
  bearing for sandbox configs that do (per CLAUDE.md's documented
  failure mode). Belt-and-suspenders earns its keep.

Build-roadmap rows 5/6/6.5 flipped 🟡 → ✅.

Then drove **Stage A → main via PR #42** with computer-use:
quit production Duo, ran `npm run dev` from the worktree, walked
the smoke checklist's load-bearing sections via screenshots:
- App boot: three columns rendered, no mount crashes
- PTY echo: typed `echo "stage-a-smoke: $(date +%s)"` — output
  echoed back; multi-tab isolation verified (separate scrollbacks)
- Socket-server: `duo url`, `duo doctor`, `duo title`, `duo open
  https://example.com` — all round-tripped through the new
  `core/socket-server.ts` import path
- Browser-manager: `duo open` created tab #2 active at example.com
- Update-checker: dev log line confirms `new UpdateChecker(app.getVersion())`
  constructed cleanly with the new constructor signature

PR #42 merged. **`core/`, `EventSink`, and `shared/host-api.ts` are
now on main.** Phase 7's NM-shim refactor can build directly
against them.

**Five PRs merged to main today:**
- [#38](https://github.com/dudgeon/duo/pull/38) — research bundle (README, mvp-plan, refactor-analysis, build-roadmap)
- [#39](https://github.com/dudgeon/duo/pull/39) — distribution strategy (both shapes ship; Electron-as-NM-host)
- [#40](https://github.com/dudgeon/duo/pull/40) — session-log entry (this entry, originally)
- [#41](https://github.com/dudgeon/duo/pull/41) — `docs/PRIVACY.md`
- [#42](https://github.com/dudgeon/duo/pull/42) — Stage A refactor (services → core/, host-api split)

Plus this commit: docs cleanup that brings the build-roadmap status
flips, the Phase 7 implementation plan, and the Web Store listing
pre-bake to main.

**What's owed (in priority order, post-verification):**

- ✅ ~~Phases 5/6/6.5 verification~~ — done
- ✅ ~~Stage A merge to main~~ — landed via PR #42
- ⬜ **Phase 7 execution.** File-by-file work per
  [`docs/research/duo-as-chrome-extension/phase7-implementation-plan.md`](../research/duo-as-chrome-extension/phase7-implementation-plan.md).
  ~2 working days. The exploration branch's `phase0/` directory
  becomes the basis for the cutover but doesn't merge to main as-is —
  the helper logic collapses into a `--nm-shim` mode in
  `electron/main.ts`, the extension surface lands at top-level
  `extension/` (renamed from `phase0/extension/`).
- ⬜ **Web Store unlisted upload + Trailblazers cohort dogfood.**
  Phase 7 milestone; runs ≥30 days before public promotion.
  Listing copy + permission justifications + privacy policy
  pre-baked at [`docs/research/duo-as-chrome-extension/web-store-listing.md`](../research/duo-as-chrome-extension/web-store-listing.md).
- ⬜ **Public Web Store promotion + background-mode menu bar.**
  Phase 8.

**Branch state at session end:**
- `main` has all docs + Stage A. Five PRs merged today.
- `duo-chrome-extension-exploration` retains the `phase0/` prototype
  for the Phase 7 cutover. 21 commits ahead of `main`; nothing in
  that delta needs to merge as-is — Phase 7's refactor will replace
  the relevant pieces.
- The local worktree at `.claude/worktrees/elegant-sanderson-05aa7a`
  was deleted at session end. Next pickup happens on the origin
  repo at `~/Documents/GitHub/duo`.

---

## 2026-04-29 — v0.5.2 cut: bug-smashing sprint

Six PRs in one day across the Stage 17 canvas + Stage 18 install surfaces — pure quality-of-life on the surfaces real users hit in normal flow. No new headline capability beyond preset pane sizes (ENH-014); the rest are five bug fixes + one small ergonomics addition.

**What landed (chronological, six PRs merged before tag):**

- **PR 1 — BUG-031 (split-divider drag overlay) + ENH-014 (preset pane sizes).** Bundled because the divider had to actually move both ways before the menu shortcut would matter. BUG-031: transparent `fixed inset-0 z-50 cursor-col-resize` overlay mounts during drag so mousemove keeps reaching the parent window listener instead of being trapped inside the canvas iframe's contentDocument. ENH-014: View → Pane size submenu + ⌘⌥1/2/3/0/9 + `duo split <pct|preset>` CLI. ⌘⌥ instead of bare ⌘ because ⌘1–⌘9 stay bound to `jumpTerminalTab` (escalating modifier kept the slot orthogonal). Browser-pane WebContentsView NOT covered by BUG-031 — z-index can't push DOM above an Electron native view; flagged as follow-up.
- **PR 2 — BUG-034 (canvas onboarding overlay disabled).** Per the user's verbatim ask ("remove it and add a TODO to revisit"). The "TYPE / SOON / SOON / SOON" card was mounting on every canvas open and dismissing only on first mutation (which never fires on read-only viewing). Disabled entirely; module preserved with a TODO for the Stage 17a.5 rebuild that gates on `isJustBoilerplate(doc)` at install time.
- **PR 3 — BUG-035 (false-positive "Couldn't find Claude Code" banner).** Filed mid-sprint as a high-priority insertion when the user reported the banner accusing him of not having Claude Code installed when he did. Root cause: `zsh -l -i -c 'command -v claude'` measured **5236ms** on the user's machine (NVM/conda/asdf/oh-my-zsh stack) — the resolver's 5000ms timeout was below the realistic floor. Fix: walk well-known absolute install dirs (`~/.local/bin`, `~/.npm-global/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, `~/.volta/bin`, `~/.bun/bin`, `~/bin`) + `process.env.PATH` with `fs.access(..., X_OK)` BEFORE attempting any shell. Standalone smoke verified: 0.8ms hit on the affected machine (~6500x speedup). Shell fallback still exists with timeout bumped 5s → 15s and flag-sets reordered fastest-first.
- **PR 4 — BUG-032 (canvas focus theft).** `RenderedCanvas` accepts a new `shouldStealFocus` prop, read through a ref so the gate toggles without tearing down the iframe effect. CanvasTab threads `focused` from `WorkingPane.focused` (which is `focusedColumn === 'working'` at App.tsx). BUG-022's "first keystroke after canvas open lands as content" ergonomic preserved; iframe re-mounts under terminal focus no longer yank the cursor.
- **PR 5 — BUG-033 v1 (autosave race during pending agent-write banner).** Both editors add a `blockAutosaveRef` synced from the pending state via `useEffect`. Change handler skips arming new timers while blocked; the effect also clears any timer about to fire. Save resumes naturally on accept/decline. Markdown's replace-all banner copy sharpened: "Replace the whole document (your unsaved edits will be lost)". Canvas ops are already granular (`replace`/`set`/`append` target one anchor) so the canvas banner copy stayed. v2 (OT-style merge for `replace-selection` on dirty buffer) deferred to Stage 16.
- **PR 6 — ENH-017 ("Add to PATH" button).** v0.4.5 had dropped a passive "add this line" hint as too confusing for non-technical users; this PR brings the affordance back as an action button. `installService.addToShellPath()` detects `$SHELL` (zsh / bash / fish), picks the right rc file (`~/.zshrc`, `~/.bash_profile`, `~/.config/fish/config.fish`), appends a fenced `# >>> duo PATH ... # <<< duo PATH <<<` block. Idempotent — re-runs detect the fence and return `{alreadyPresent: true}` without rewriting. New `showAddToPathNote` row in `FirstLaunchBanner` gated on `cli.installed && !cli.onPath`.

**Workflow notes for future cuts:**

- All 6 PRs branched off main locally and were verified in an integration branch before any merge to main. Six branches, no merge conflicts (file overlaps in CanvasTab.tsx between PRs 2/4/5 composed cleanly via three-way merge).
- The mid-sprint priority insertion (BUG-035) demonstrated the value of a shared base commit (b2c3a82) — pushing it to origin/main first kept each PR's diff clean against origin/main when the merges finally landed.
- Verification gaps to flag: BUG-032 + BUG-033 + ENH-017 visual-cursor-drag scenarios were not directly walked at merge time (typecheck + boot smoke only). State-machine changes are low-risk; if regressions surface, they'll be specific and reproducible.

**Deferred from v0.5.2:** ENH-015 (collapse-button discoverability) and ENH-016 (FileTree new-file/folder context menu) — backlog for v0.5.3. BUG-033 v2 (OT-style merge) lives at Stage 16.

---

## 2026-04-28 — v0.5.1 cut: polish + the gating you asked for

Single-session sprint follow-up to v0.5.0. Six PRs in sequence; all
verified live; one DMG cut at the end.

**What shipped:**

- **PR 1 (`a801124`) — Navigator follow-ups + Stage 21b icon + tasks reconciliation.** Closed v0.5.0's known-issue list: BUG-007 (deleted files linger — chokidar watcher hardening on sub-resub gap), BUG-028 (Escape dismisses inline rename — `cancelledRef` + explicit `inputRef.blur()`), BUG-029 (right-click context menu flips up when overflowing viewport via `useLayoutEffect` measure), BUG-030 (CLI `duo nav pin/unpin` pushes to renderer live via new `IPC.NAV_PINS_CHANGED`). Stage 21b icon shipped as `build/icon.icns` (10 standard macOS sizes 16²..1024², generated via sips + iconutil from a 1254×1254 source). 12 stale `🆕 Filed` entries in `tasks.md` flipped to `✅ Shipped` to match shipped status from v0.3.0 / v0.4.3 / v0.5.0.
- **PR 2 (`ff77346`) — Editor polish.** BUG-026 (markdown paste lands as structure not code-block — new `MarkdownPaste` TipTap extension at priority 1000 overrides tiptap-markdown's `inline:true`-everything default with a block-aware parse). ENH-005 canvas side (hover Copy button on every `<pre>` via runtime injection; serializer strips on save). ENH-007 (CommentRail collapses to `N resolved` pill when every thread is resolved).
- **PR 2 follow-up (`f134332`) — ENH-005 markdown editor side.** Three abandoned approaches (direct appendChild, classList add, widget-only) before landing on the working pattern: `Decoration.node` adds the host class (PM-managed, survives transactions), `Decoration.widget(pos+1)` inserts the button DOM, click-handler clones the `<code>` and strips the button before reading textContent.
- **PR 3 (`525ff48`) — Browser pane + Send → Duo gating.** BUG-027 (⌘⇧T from browser focus reopens last-closed tab via new `closedTabs` stack — Chrome parity). Issue #27 / Stage 21c Phase 3 (browser history persistence at `~/.claude/duo/browser-history.json`; native `<datalist>` autocomplete). ENH-013 (Send → Duo pill gated on live `claude` descendant in front terminal's PTY tree — process-tree probe via `ps -ax` every 500ms, with 1.5s grace for `kind:'claude'` tabs that haven't yet exec'd).
- **PR 4 (`48d2b2e`) — ENH-006 split-button on WorkingPane.** `+` (file) | `>` (new browser tab); mirrors terminal-strip Stage 19c rhyme. Replaces the prior ⌥-click muscle memory.
- **PR 5 (`d3c2f4d`) — ENH-011 plain-English banner copy.** Welcome + Update banners no longer mention "skill", "subagent", "priming shim", or "SessionStart hook". User model is "agent files" / "make Claude Duo-aware".

**Three design decisions baked in (full prose in `docs/RELEASES.md § v0.5.1`):**

1. **ProseMirror decorations, not DOM mutations, for editor chrome.** Direct DOM mutations to ProseMirror's contentEditable surface get reverted on transactions; node + widget decorations are tracked separately and survive. Future "add chrome to the editor without touching the doc" patterns (Stage 14's CommentRail markers, Stage 16's external-write banner) should reach for decorations first.
2. **Process-tree probing for claude-presence, not tab-kind heuristics.** `tab.kind === 'claude'` records intent at spawn, not current state — `/exit` would leave the pill misfiring. Walking the active PTY's child-process tree via one `ps -ax` call every 500ms is cheap (~1ms/probe) and accurate. Same plumbing will eventually back FOLLOWUP-002 (agent guards).
3. **Native `<datalist>` for URL autocomplete, not a custom dropdown.** One HTML5 element + a debounced IPC call. No custom keyboard nav, no custom styling. Trade is platform-stock look — fine for a power-user surface.

**Verification flow:** all PRs verified live in dev mode via computer-use except BUG-028 (Escape via the harness doesn't reach the Electron renderer — known accessibility/OS-level limitation; manual verification owed).

**Stage flips:** Stage 21c Phase 3 ✅; Stage 21b partial (icon ✅, DMG bg deferred); Stage 26 follow-up cluster (BUG-007/028/029/030) ✅. v0.5.1 closes [issue #27](https://github.com/dudgeon/duo/issues/27).

**What's queued next:** Stage 21d (Trailblazers cohort distribution — socket auth + agent-driven-nav notifications + README). Stage 26 PR 3 (navigator ambient signals + Go-to path). Stage 14 (markdown editor's CommentRail binding via CriticMarkup). CLI `duo terminal claude-state` (ENH-013 follow-up).

---

## 2026-04-27 late-late evening — v0.5.0 cut: navigator polish + fork-friendly + foundation

First MINOR cut since v0.4.0. Owner approved the v0.5.0 sprint plan
in this session ("Production polish + the browser history you asked
for") then dialed it back to scope only what was already in flight:
Stage 26 PR 1 (row-interaction), Stage 26 PR 2 (Pinned section +
ENH-012 default-collapsed), and Stage 21e (fork-friendly
architecture). Issue #27 (browser history) + ENH-005/006/007/011
deferred to v0.5.1+ alongside the BUG-028/029/030 follow-ups
identified during this sprint's smoke testing.

Three PRs landed:

- **PR #28 — Stage 26 PR 1** (`b08ff12`) row-interaction cluster.
  Single/double-click semantics + chevron split (BUG-025) +
  right-click Rename/Trash + CLI `duo file rename/trash` + hover
  Claude sparkle button. Verified live in this session via
  computer-use before the rebase + force-push.
- **PR #29 — Stage 26 PR 2** (`d1ef59c` + `c86fa80`) Pinned section
  (ENH-010) + Your Claude settings collapsed default (ENH-012).
  New `nav-pins-service.ts` (atomic-write JSON, separate from
  Stage 24's tab pins). New `useNavPins` hook + `<PinnedNav>`
  component. CLI `duo nav pin/unpin/pins`. Smoke-tested live —
  pinned a folder + a file, verified grouping + single-click +
  double-click + persist across relaunch + collapsed-default
  behavior. Filed BUG-029 (context-menu clipping near viewport
  bottom) + BUG-030 (CLI→renderer push gap) during the smoke.
- **PR #30 — Stage 21e** fork-friendly architecture. Build-time
  fork config + dist.sh wrapper + load-fork-config.cjs + yml
  publish-block removal + Vite runtime config injection +
  provenance-aware install. Branch was 4 commits ahead of
  pre-v0.4.4 main; rebased onto post-v0.4.5 main with one
  conflict in `electron/install-service.ts` (21e-iii's
  crypto/execFile imports vs v0.4.5's swap to the shared
  `resolve-claude.ts`). Resolved: kept crypto, dropped
  execFile/promisify (v0.4.5 already moved that work).

Merge order: PR #28 → PR #29 → 21e (rebased onto Stage-26-merged
main, no conflicts). Cut process: typecheck clean, build:cli +
sync:claude, then `bash scripts/dist-signed.sh` (which now uses
fork-config + the launch-smoke validator from v0.4.4).

Process note. The owner pushed back on memory mid-sprint when I
tried to save a "use plain English" feedback note: "Memory?!?!
that does not sound like a durable idea." Right call — durable fix
lives in the product (banner copy, FAQ entries, error toasts).
Deleted the memory; kept the lesson in the v0.4.5 banner rewrite
+ ENH-011 ticket. Worth re-reading: memory is for ABOUT-the-user
context that future sessions need to act, not for design
principles that should live in source.

---

## 2026-04-27 late evening — v0.4.5 cut: claude detection + plainer install copy

Owner installed the freshly-shipped v0.4.4 DMG and immediately hit two
follow-on issues with the install banner: (1) "Claude Code not
detected on PATH" warning even though `claude` is installed at
`~/.local/bin/claude`; (2) when the user opened a new claude terminal
tab, it printed "Install Claude Code to enable agent tabs" instead of
running claude. Both root-caused to the same shell-startup model bug:
zsh login shells (`-l`) source `.zprofile` / `.zlogin` / `.zshenv`
but NOT `.zshrc`. The owner's `~/.local/bin` PATH addition lives in
`.zshrc` (line 40), they have no `.zprofile`, so login-only
invocations couldn't see `~/.local/bin`. Confirmed by simulating
Electron's PATH:
`env -i HOME=$HOME PATH=/usr/bin:/bin /bin/zsh -l -c 'command -v claude'`
returns nothing; switching to `-i -c` finds it.

The bug had two sites:
- `install-service.ts § resolveRealClaude` — used `zsh -l -c
  'command -v claude'`. Result: the priming shim never installed
  for the entire majority case.
- `main.ts § isClaudeOnPath` — used `spawnSync('which', ['claude'])`
  against Electron's inherited `process.env.PATH`. Finder-launched
  Electron has only the system-default `/usr/bin:/bin:/usr/sbin:/sbin`
  PATH. Result: every claude tab printed the install banner.

Both bugs latent since v0.2.0 (Stage 19c shipped). Surfaced now
because v0.4.4 was the first DMG that actually launched
end-to-end — earlier DMGs crashed on `node-pty` before either
check ran.

**Fix.** Extracted shared helper `electron/resolve-claude.ts` that
walks `(shell × {-l -i, -i, -l})` flag combinations until one finds
claude. `-l -i` reads everything (login files AND `.zshrc`); `-i` is
fallback; `-l` last resort. Both detection sites now route through
the helper. Drift between them is impossible going forward.

Owner also called out the install banner copy itself: too much
engineer-speak for non-technical PMs ("priming shim", "SessionStart
hook", "Add this dir to your PATH"). Made two surgical fixes for
v0.4.5: (a) collapsed the success message to "Installed. Claude
inside Duo's terminals will arrive Duo-aware." — no more PATH hint
for the duo CLI helper (which is meant to run inside Duo's terminals,
not external shells); (b) rewrote the "Claude Code not detected"
follow-up note in plain English. A broader rewrite of welcome/update
banner copy is queued as ENH-011 for a later cut to keep this hotfix
focused.

Memory note (process correction). Earlier in the session I tried to
save a "use plain English with Geoff" feedback memory after he flagged
the engineer-speak. He pushed back: "Memory?!?! that does not sound
like a durable idea." Right call — memory is too volatile and narrow
for what's really a product UX principle. The durable fix lives in
the source: install banner copy, FAQ entries, error toasts. Deleted
the memory file; the lesson is encoded in the v0.4.5 banner rewrite
(and queued for a wider sweep via ENH-011).

---

## 2026-04-27 evening — v0.4.4 cut: DMG launch fix + Stage 26 PR 1 in flight

Owner tried to launch the v0.4.3 DMG and hit `Cannot find module
'node-pty'` — uncaught exception, app crashes before reaching the
renderer. Investigation showed `electron-builder.yml § files` had
`"!node_modules/**/*"` excluding ALL production node_modules from the
bundle. The `asarUnpack: "**/node_modules/node-pty/**"` line tried to
compensate but was a no-op since node-pty wasn't in the bundle to
begin with. Confirmed by mounting the v0.4.3 DMG: app.asar contained
only `out/`, `package.json`, `help/` — no node_modules, no
app.asar.unpacked directory at all. The bug had been latent since the
original Stages 1-3 scaffold (`d1e4d84`); v0.4.0/0.4.1/0.4.2/0.4.3
all shipped with the same broken bundle. Earlier "successful" runs
were almost certainly `npm run dev` (which loads node-pty from the
repo's local node_modules) or installs that inherited node-pty on
disk from a previous, differently-built bundle.

Fix: replace the negative exclusion with a positive
`node_modules/**/*` include. electron-builder smart-filters down to
`package.json § dependencies`, so dev deps stay out and the bundle
stays lean. Verified by rebuilding unsigned to
`~/.cache/duo-build-test/`: the resulting Duo.app now has
`app.asar.unpacked/node_modules/node-pty/build/Release/pty.node`,
and smoke-launching it stays alive past 8s.

**Toolchain hardening (load-bearing).** Owner asked: "what changes
will you make to the build skill to NEVER do this again?" Answer:
new `scripts/validate-dmg-launch.sh` with two layers — (1) static
check that every module in `REQUIRED_RUNTIME_MODULES` (currently
node-pty, chokidar, electron-updater) is reachable in either the
asar or `app.asar.unpacked/`, and that native modules live
specifically in unpacked; (2) dynamic check — mount, `open` the .app,
sleep 8s, `pgrep` for the main process. Wired into both
`scripts/dist-signed.sh` (after the existing signature/notarization
validator) and the `cut-version` skill (Step 4.5, flagged
non-negotiable). Catches the entire class of "DMG builds but crashes
on launch" before the cut proceeds. Tested against both the broken
v0.4.3 DMG (validator exits 1, names node-pty/chokidar/electron-updater
as unreachable) and the fixed test build (passes both layers).

Auto-update note: v0.4.3 users won't get v0.4.4 via auto-update —
v0.4.3 crashes before electron-updater fetches `latest-mac.yml`.
Manual install required.

In parallel: Stage 26 (Navigator polish & ergonomics) was promoted
from `backlog-nav-polish` with two new items folded in (BUG-025 —
chevron-only hit target; ENH-010 — Pinned files & folders section
at navigator bottom). Stage 26 PR 1 (items 1, 1b, 6, 7 — single/
double-click semantics, chevron split, right-click delete/rename
+ CLI parity, hover-Claude button) shipped on
`worktree-stage-26-nav-row-interaction` and opened as
[duo#28](https://github.com/dudgeon/duo/pull/28). Three new bugs
filed standalone for v0.5.0+ (BUG-026 markdown paste-as-code,
BUG-027 ⌘⇧T browser pane should reopen last-closed, BUG-028
⎋ inside the rename input doesn't dismiss).

---

## 2026-04-27 mid-morning — v0.4.3 cut: owner punch-list patch

Owner installed v0.4.2 prebuilt DMG (after enterprise approval came
through — earlier "compile-from-source" path turned out unnecessary).
Walked the surfaces, came back with 11 observations: 7 bugs + 4
enhancements. Triaged into BUG-018..024 + ENH-005..008 in tasks.md.
Owner picked option B (cut v0.4.3 patch first, then v0.5.0 with
Stage 21e). Added ENH-009 mid-sprint (expand off-host default list:
Slack, Gmail + Google Workspace, Atlassian, M365).

**Three commits on the v0.4.3-punch-list branch:**

`0563045 fix(v0.4.3): BUG-018+019+020+021 — browser tab + ⌃Tab cluster`
- BUG-021: `useKeyboardShortcuts` reads tabs + activeTabId via refs
  so the cycle always sees post-session-restore state. Eliminates
  any stale-closure window between `setTabs(restoredArr)` and the
  useEffect re-running. Browser-side cycle adds defensive logging
  + a "no active tab" fallback.
- BUG-018: `electron/browser-manager.ts` grows a `newTabUrl()`
  separate from `defaultLandingUrl()`. Constructor's first-tab
  default stays at FAQ; `openTab(url = newTabUrl())` (the IPC path
  hit by ⌘T) defaults to `about:blank`.
- BUG-019: `App.tsx § newBrowserTab` and `WorkingPane § handleNew`
  swap `queueMicrotask` for two nested `requestAnimationFrame`. The
  two-RAF dance pushes the focus call past React's commit + paint
  cycle.
- BUG-020: `BrowserManager.closeTab` no longer hard-fails on the
  last tab. Opens a fresh `about:blank` first, switches to it, then
  closes the original. Mirrors Notion's "close last tab → open
  blank" pattern.

`9a1d45b fix(v0.4.3): BUG-022+023+024 + ENH-009 — canvas + pill + off-host`
- BUG-022: `RenderedCanvas` calls `doc.body.focus()` after wiring
  contentEditable + the keystroke forwarder.
- BUG-023: `shared/html-boilerplate.ts` restructures: body fills the
  viewport (with `min-height: 100vh`), content lives in a `<main>`
  child with the 720px width cap. Clicks anywhere in the iframe
  now land on body (contentEditable) and the browser places the
  cursor at the nearest text node.
- BUG-024: `CanvasTab § CommentButton` repositions — Comment button
  now stacks BELOW the selection (Send→Duo pill stays above). Falls
  back to "stack above the SendToDuoPill" when selection is at
  viewport bottom.
- ENH-009: `electron/install-service.ts` seeds a wider default off-
  host list — Slack, Gmail + full Google Workspace, Atlassian,
  Microsoft 365 — alongside the existing `*.capitalone.com`.
  Bootstrap is "only-if-absent" so existing users don't pick up the
  list automatically; documented the migration in release notes.
  `package.json sync:claude` mirrors the same default for dev parity.

`2b5be32 feat(v0.4.3): ENH-008 — navigator tooltips`
- "Your Claude settings" and "Project Claude context" headers each
  get explanatory `title` attribute tooltips. Native browser
  tooltip (no styling cost; accessible).

**Deferred to v0.5.0:** ENH-005 (copy button on code blocks),
ENH-006 (right-pane new-browser-tab button), ENH-007 (collapsed
comment rail with findable resolved). Stage 21e implementation also
v0.5.0 (i/ii/iii already on `stage-21e-fork-friendly` branch). The
auto-update path from v0.4.2 → v0.4.3 is the FIRST real-world test
of the auto-update flow shipped in v0.4.2 — owner's v0.4.2 install
will get an in-app prompt within ~30s of launch.

---

## 2026-04-27 morning — v0.4.2 cut: auto-update + session restore

After the v0.4.1 cut + Stage 21 doc refresh, owner picked C (Stage
21b/c work) for the next sprint. Multi-phase work shipped over
several hours:

**Phase 1 — `electron-updater` integration.** Lazy-loaded module at
`electron/auto-updater.ts`; dev-mode no-op; `autoDownload: true`,
`autoInstallOnAppQuit: true`. Native macOS dialog UX for v1 (no
custom banner integration; future Phase 1.5 follow-on if jarring).
`electron-builder.yml` grew a `publish: github` block so each build
emits `latest-mac.yml` (the metadata file electron-updater fetches at
runtime). `electron-updater@6.8.3` added as runtime dep. Pre-v0.4.1
unsigned installs cannot auto-update — signature verification chains
to the running cert; v0.4.0 lacks one. v0.4.0 users need ONE manual
upgrade to v0.4.1+ before auto-update works; this is a one-time tax.

**Phase 2 — Session restore on relaunch (closes issue #24).** New
`SessionState` schema in `shared/types.ts` — terminals + file tabs +
browser tabs + active selection + navigator path (last field unused;
`useNavigator` keeps its existing localStorage persistence). New
`electron/session-state-service.ts` with atomic-write-rename to
`~/.claude/duo/session-state.json`; defensive load with corrupt-file
recovery; debounced 250ms in main on top of renderer's 500ms;
`flush()` on `app.before-quit` + `window-all-closed`. New IPC
channels `SESSION_STATE_LOAD` / `SAVE`; preload surface
`electron.sessionState.{load, save}`. App.tsx: one-shot mount-time
load that replaces default tab seeds with persisted state (brief
flicker is intentional; matches macOS native restore patterns);
subscribed to `electron.browser.onTabsChange` for browser-tab tracking;
debounced save effect tracks every persisted-field change. New
`BrowserManager.restoreFromSession()` wired into `did-finish-load` so
renderer is mounted when the resulting `BROWSER_TABS` broadcast
fires.

**Smoke verification before merge.** Three tiers: Tier 1 build +
typecheck (clean). Tier 2 npm run dev → session-state.json appears
within ~5s with default 1-terminal state. Tier 3 pre-populated state
with 2 terminals (`/tmp` shell + duo-repo claude, active=1) →
relaunch → state correctly restored + re-saved with fresh timestamp.
All three pass.

**Fork-friendly architecture preview.** Owner asked mid-sprint about
supporting partial vs. full forks. New doc `docs/HOW-TO-FORK.md`
landed on main with five layered fork modes (use-as-is, per-user
customization, drop-in org pack, build-time partial fork, build-time
full fork). Stage 21e added as a sub-stage of Stage 21 (i / ii / iii
/ iv); v0.5.0 target. Implementation work in flight on
`stage-21e-fork-friendly` branch (21e-i scaffolding committed as
`86290ee` — `fork.config.default.json` + `scripts/load-fork-config.cjs`
+ `scripts/dist.sh` wrapper + yml stripped of identity fields +
dist-signed.sh updated; verified end-to-end with a simulated fork).

**Cut.** v0.4.2 = Stage 21c Phase 1+2 + HOW-TO-FORK doc. v0.5.0
target = Stage 21e (fork-friendly arch implementation) +
Phase 3 of 21c (browser history) + 18b (skill packs) +
14/16 (editor track-changes), tbd.

---

## 2026-04-27 dawn — Stage 21 ✅ shipped (signed + notarized DMG) + doc refresh

Picked up the Stage 21 work after the parallel agent's v0.4.1 cut
landed on main. Toolchain shipped end-to-end on
`stage-21-signing-toolchain` then cherry-picked to main as `4ffde29`
(toolchain) + `955f959` (cut-version + cert-procurement docs) +
`f506f36` (intent-pause archive). v0.4.1 GH release re-uploaded with
signed DMGs via `gh release upload --clobber` — same release, same
tag, same notes (with a small "Updated 2026-04-27 09:42 UTC — DMGs
re-uploaded as signed" callout above the original body).

**The actual root cause was simpler than the wip exploration commit
suggested.** `com.apple.provenance` was a red herring — every file
on Sequoia carries it (including `/tmp/`); codesign accepts those
fine. The real blocker is **iCloud File Provider** tagging
directories inside Electron helper bundles
(`Duo Helper (GPU).app`, etc.) with `com.apple.FinderInfo` /
`com.apple.fileprovider.fpfs#P` / `com.apple.fileprovider.dir#N`
xattrs whenever the build path lives under `~/Documents/` (the macOS
default with iCloud Desktop & Documents sync). The afterPack `ditto`
strip from the wip commit ran successfully but iCloud re-tagged the
bundle directories before codesign could read them. Empirical: same
fresh helper binary fails to codesign in
`~/Documents/GitHub/duo/dist/`, succeeds when copied to `/tmp/`.

**Fix** — one CLI flag.
`electron-builder -c.directories.output=$HOME/.cache/duo-build`
moves the build off iCloud-touched filesystem; `dist-signed.sh`
copies the resulting DMGs back to `dist/`. No electron-builder
upgrade (24 → 26 has known regressions with our electron-rebuild
postinstall — issues #8842, #9020, #9261), no `@electron/osx-sign`
rewrite, no afterPack hook. The yml stays env-agnostic —
`mac.identity` and `mac.notarize` remain commented; electron-builder
auto-discovers the cert + notarization from `CSC_NAME` + the
`APPLE_API_*` packet via env auto-discovery.

**Toolchain durables encoded for next time.** Cut-version skill's
Step 4.5 grew a signed / unsigned branch with the iCloud gotcha
documented inline. `docs/dev/cert-procurement.md` gained a Sequoia
compatibility appendix covering provenance, File Provider, the
FOLLOWUP-005 keychain prompt, cert renewal cadence. Resolution
artifact at `docs/dev/intent-conversations/2026-04-27-stage-21-signing.md`
preserves the original plan + adds a Resolution summary at top so
the next operator sees what shipped before reading the historical
plan body. Plus the v0.4.1 release body got a 1-line "Updated …
DMGs re-uploaded as signed" callout above the original release notes
so any reader of the published GH release sees the swap.

**Doc refresh after the ship** (this commit). `docs/roadmap.html` +
`ROADMAP.md` flipped Stage 21 to 🟡 21a ✅ (with 21b/c/d still ⬜),
flipped Stage 20 to 🟡 (sandbox-resilience cluster shipped, polish
items still pending), refreshed the snapshot bar to "post-v0.4.1,
post-Stage-21", and added a v0.4.1 cut entry to the cut history.
README.md replaced the "DMGs are unsigned, expect Gatekeeper
warnings" install instructions with "no Gatekeeper warning as of
v0.4.1", repointed the direct-download URLs to `Duo-0.4.1-*.dmg`,
rewrote the "Build a custom DMG" section to lead with
`bash scripts/dist-signed.sh` (signed default for the owner) and
relegate the `CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist` flow
to the unsigned-fallback path, added FOLLOWUP-005 keychain prompt
and iCloud File Provider gotcha as named subsections (the latter
already solved by `dist-signed.sh`'s output redirect; documented as a
"don't override `DUO_BUILD_OUTPUT` to a path inside `~/Documents/`"
warning). help/faq.html's v0.4.1 entry rewrote the "DMG remains
unsigned" closing paragraph to "Stage 21 ✅ landed alongside this
release."

**21b/c/d still ⬜** — custom app icon + DMG background,
`electron-updater` integration with GH-Releases auto-update channel,
session restore on relaunch (issue #24), browser history persistence
(issue #27), socket auth token for Trailblazers cohort distribution,
agent-driven-navigation notifications, Trailblazers README + install
guide. None blocking the v0.4.1 ship; all natural follow-ons for a
v0.4.2 cut.

---

## 2026-04-27 early — v0.4.1 cut: sandbox-resilience cluster

Owner kicked off the morning with "what's incomplete on the roadmap
and what should we build next?" The survey landed on Stage 20's
sandbox-resilience cluster as the highest-leverage next move:
every Capital One Claude Code session has been silently failing on
the Unix socket (default Seatbelt policy blocks them) and the
`docs/DECISIONS.md` ADR for sandbox-tolerant transport had been
sitting Open for four days. Owner said "use a worktree", and we
shipped the cluster on `worktree-stage-20-sandbox-transport`:

- **TCP fallback** in `electron/socket-server.ts` — a second
  listener on `127.0.0.1:0` ephemeral port, per-launch random
  token published to `~/Library/Application Support/duo/duo.port`
  (mode 0o600), token required as the first NDJSON line of every
  TCP connection. Both transports share one dispatch loop.
- **CLI fallback** in `cli/duo.ts` — try Unix first; on
  `EPERM` / `ECONNREFUSED` / `ENOENT` / connect-timeout, read the
  port file and reconnect over TCP. `DUO_TCP_ONLY=1` forces the
  fallback path for testing.
- **`duo doctor`** — new CLI verb. Probes both transports via a
  cheap `ping` cmd, reports app/CLI version match, `$DUO_SESSION`
  presence, install-path discovery, skill/agent-file presence.
  Names "Claude Code sandbox detected (Unix socket blocked) —
  using TCP fallback" when that's the failure pattern.
- **Sandbox-safe install path** — `duo install` now prefers
  `~/.claude/bin/duo` over `/usr/local/bin/duo`. `--system`
  opts back into the legacy path with sudo.
- **`duo wait --timeout` race fix** — socket cap now
  `max(explicit + 5s, default)`, so `duo wait --timeout 30000`
  stops being killed at the 10s cap.

Smoke verified live against `npm run dev`: Unix happy path, forced
TCP path, `duo doctor` output (both transports green), bad-token
TCP rejection, `duo wait --timeout 12000` waited 12.1s (not 10s),
missing-socket fallthrough, both-missing graceful die.

**Mid-cut sequencing decision.** The signing/notarization work
(Stage 21) is on a parallel branch `stage-21-signing-toolchain`
with an Electron 24→26 upgrade in scope — the larger and more
invasive change. Owner's instinct: merge sandbox-resilience first
as v0.4.1 (unsigned), then rebase signing on top. We agreed: the
asymmetric rebase cost (small file-isolated change vs.
node_modules-deep platform upgrade) makes this the cheaper
ordering, and the user-value argument is decisive (sandbox
resilience helps users today; signing helps Trailblazers next
month). Cut as proposed.

**Owed.** Real-sandbox confirmation of the TCP fallback comes from
the owner's next Capital One Claude Code session post-install (we
smoke-tested via `DUO_TCP_ONLY=1` simulation, not actual sandbox).
The rest of the Stage 20 cluster is still ⬜: tab numbers in the
unified strip, terminal selection refinements, `duo reload`,
pane-aware `⌘+/-` zoom shortcuts (issues #22 / #23), PTY-side
sandbox audit (issue #12). Stage 21 signing branch will rebase
onto this v0.4.1 base when ready.

---

## 2026-04-26 late (after v0.3.1) — v0.4.0 cut: context pedagogy

Five-feature sprint, autonomous overnight. Owner went to bed asking
two specific things: (a) is the navigator dual-pane overhaul (Stage
22) tight enough to attempt without owner intervention, (b) is the
existing "update available" flag mocked or real GH-querying. Both
got affirmative answers and rolled into the cut.

**Stage 22 (the headline).** Reorgs the file navigator into two
panes vertically: top "Your Claude settings" with curated three at
`~/.claude/` (CLAUDE.md, skills/, agents/) plus a "Show all" toggle
for the rest, bottom "This project" gaining a "Project Claude
context" group above the regular file tree. The pedagogy: visual
separation teaches "the agent reads from BOTH user-level and
project-level context buckets" without users learning dotfile
conventions.

Architecture: new `useUserClaudeNavigator` hook for the top pane
(rooted at `~/.claude/`, no `cwd`, no follow-mode, no pin). Existing
`useNavigator` stays for the bottom pane unchanged. Both feed the
now-exported `<TreeNodes>` primitive in `FileTree.tsx` for the
recursive tree rendering — adding a third pane in the future (e.g.,
Stage 18b's "Provided by AIP" badge) is mechanical. The user-claude
pane's curated root is *synthesized* (a hand-picked list of
CLAUDE.md + skills/ + agents/ constructed from the live
`~/.claude/` listing) rather than fetched separately, so the pane
stays in sync with chokidar updates automatically. The "Show all"
toggle just swaps between the curated root and
`state.listings.get(state.cwd)` — same code path, different entries.

`<ProjectClaudeContext>` checks the project's listing for
`./CLAUDE.md`, `./.claude/`, `./tasks.md`, `./AGENTS.md` and renders
only the ones that exist; if none exist, the entire group is hidden.
File-ops symmetry (rename / delete / reveal-in-Finder shared across
both panes) is explicitly deferred to the Navigator polish bundle —
Stage 22 is the visual reorg, the polish bundle is the interaction
layer.

**GitHub Releases update checker.** Owner's diagnosis confirmed:
today's "Duo update available" banner is the LOCAL re-install
reminder (compares `installed.json`'s recorded version against
`app.getVersion()`), not real upstream-availability. Built a real
one as a sibling: new `UpdateChecker` in main fetches
`api.github.com/repos/dudgeon/duo/releases/latest` once per launch
(refreshed every 6h), caches at `~/.claude/duo/update-check.json`
keyed by running version, exposes via `IPC.UPDATE_CHECK`. Renderer
mounts `<UpdateAvailableBanner>` with per-upstream-version
dismissal (skipping v0.4.0 stays quiet until v0.4.1).

**Stage 25 — post-redirect chrome banner + `*.capitalone.com`
default.** After `shell.openExternal` in `openExternalUrl` succeeds,
main resolves the URL hostname against `~/.claude/duo/external-
domains.json` (extended schema: entries can be `string` OR
`{host, reason?}`) and pushes `IPC.EXTERNAL_REDIRECTED { host,
reason? }`. Renderer mounts `<ExternalRedirectedBanner>` with
most-recent-wins replacement (back-to-back redirects don't stack)
and 6s auto-dismiss. Install bootstrap seeds the file with
`*.capitalone.com` per owner request — Cap One Trailblazers'
internal sites need the corporate-managed browser for SSO + internal
CDN certs and don't render reliably in the embedded WebContentsView.

**Edit menu Paste-and-Match-Style.** ENH-002 follow-up. The keyboard
chord `⌘⇧V` was already wired editor-locally in v0.3.1; v0.4.0 adds
the menu surface for discoverability. Click → `mainWindow.send(IPC.PASTE_PLAIN_REQUEST)`
→ both editors subscribe → whichever has focus reacts. New
`ElectronAppMenuAPI` in the preload surface to keep things tidy.

**Stage 21 prep.** Owner went to bed asking whether I have everything
to sign — yes, the cert artifacts are all in place per
`docs/dev/cert-procurement.md`. But signing autonomously while they
sleep risks the FOLLOWUP-005 keychain prompt blocking the build
forever. Compromise: prep the env-driven flow tonight, defer the
actual signed cut. New `scripts/dist-signed.sh` sources
`~/Documents/duo-private/.env` and runs `npm run dist` (without the
`CSC_IDENTITY_AUTO_DISCOVERY=false` override that today's unsigned
flow uses); `scripts/validate-signed-dmg.sh` runs `codesign --verify
--deep`, `spctl -a -t open --context context:primary-signature`,
and `xcrun stapler validate`. The yml stays env-agnostic so today's
unsigned cut still works without flag flips.

**Filed but deferred:** Stage 19d (mid-tab launch-claude banner),
BUG-006 (browser-pane Send→Duo pill behind WebContentsView — needs
design decision), MISSING-001 (markdown comments → Stage 14a),
Stage 18b (distro skill packs), Stage 21c (session restore from
pins), the actual Stage 21 signed cut.

---

## 2026-04-26 night (after v0.3.0) — v0.3.1 cut: cleanup sprint

Eight items in one cut, all small enough to review individually:

**Bugs closed:**

- **BUG-005** — `duo key End --modifiers cmd` no longer triggers Electron's About panel on macOS. CLI-side translation: `Cmd+End` → `Cmd+ArrowDown`, `Cmd+Home` → `Cmd+ArrowUp`, `Cmd+PageDown`/`Cmd+PageUp` drop the Cmd modifier. 9/9 standalone test cases pass; non-darwin unaffected. (`cli/duo.ts`)
- **BUG-007** — Deleted files no longer linger in the navigator. The chokidar `unlink`/`unlinkDir` events on the main side were already firing; the renderer just never subscribed. `useNavigator` now installs `electron.files.watch([cwd, ...expanded])` and refreshes the parent dir's listing on every event. (`renderer/hooks/useNavigator.ts`)
- **BUG-015** — Empty comment rail no longer occupies horizontal space. Gated on `railThreads.length > 0`. (`renderer/components/HtmlCanvas/CanvasTab.tsx`)
- **BUG-016** — Pasted bold text in dark mode is no longer dark-brown-on-dark-brown. New `installCanvasPasteHandlers` strips inline `style="color"` / `style="background"` and `class` from pasted HTML, so pasted nodes inherit the canvas's own ink token. (`renderer/components/HtmlCanvas/canvasPaste.ts`)
- **BUG-017** — Theme "system" mode follows macOS again. Root cause was `nativeTheme.themeSource = 'light'` hardcoded at boot bleeding into the renderer's `prefers-color-scheme` query. The renderer's existing `IPC.THEME_STATE_PUSH` now also updates `nativeTheme.themeSource` to match the user's mode. (`electron/main.ts`)

**Enhancements shipped:**

- **ENH-001 + ENH-004 (paired)** — Default new-canvas boilerplate carries `data-duo-id` ULIDs at write time AND inline Atelier-flavored CSS (cream paper, ink-soft body, serif headings, body width cap, dark-mode media query, viewport meta). The first-open ID-injection prompt is skipped for Duo-authored canvases. `ulid.ts` relocated from `renderer/components/HtmlCanvas/` to `shared/` so main can mint IDs at write time. (`shared/html-boilerplate.ts`, `shared/ulid.ts`)
- **ENH-002** — `⌘⇧V` paste-as-plain-text in both editors. Markdown editor uses TipTap's `commands.insertContent` after `navigator.clipboard.readText()`; canvas uses `document.execCommand('insertText', ...)` (composes with contentEditable's undo stack). (`renderer/components/HtmlCanvas/canvasPaste.ts`, `renderer/components/editor/MarkdownEditor.tsx`)
- **ENH-003** — Default-pinned help tabs. Install bootstraps `~/.claude/duo/pins.json` with FAQ + What Duo Does pre-pinned. `BrowserManager.defaultLandingUrl` now prefers user-installed `~/.claude/duo/help/<file>` over the bundle copy so URLs match the pin entries. (`electron/install-service.ts`, `electron/browser-manager.ts`)

**Filed but deferred to v0.4.0+:**

- MISSING-001 — Markdown editor lacks comments. → Stage 14a (CommentRail TipTap binding).
- BUG-006 — Browser-pane Send→Duo pill invisible behind WebContentsView. Three architectural options (chrome strip / CDP-injected / BrowserView mode); needs design decision before code.
- Stage 14a (markdown comments), Stage 18b (distro skill packs), Stage 21/21c (sign + notarize, session restore from pins), Stage 25 (post-redirect chrome banner), Stage 19d (mid-tab launch-claude banner).

---

## 2026-04-26 night — v0.3.0 cut: Duo-aware Claude + preventative kb-shortcut architecture

What started as "build Stage 19b (passive priming) per the v0.2.0
breadcrumb" wound up the largest single-cut surface change yet.
Three strands closed together:

**1. Stage 19b — passive priming (the priority).** PRD's
primary/secondary framing got reversed mid-build (owner: *"we
cannot rely on hooks"*) — the PATH shim at `~/.claude/duo/bin/claude`
is now load-bearing, the `SessionStart` hook is redundancy. PRD's
hypothetical `--append-system-prompt-file` flag turned out not to
exist; shim uses `"$(cat priming.md)"` command-substitution
instead, which passes the file as a single argv (no shell re-parse
on the substituted value). Real-claude path resolved via login
shell at install time and inlined into the script. PtyManager
prepends `SHIM_DIR` to PATH for every spawned PTY. Verified
end-to-end: shim wins `which claude` lookup; pass-through works
outside Duo; fake-claude argv test confirms the priming gets
injected as one argv (1522 chars) followed by user's original args.

**2. Stage 23 — canvas actions (`data-duo-action`).** Three-verb
vocabulary: `claude:spawn` / `terminal:send` / `browser:open`.
Renderer-side dispatch via a delegated capture-phase listener on
the iframe doc — Stage 17a's H4 sandbox excludes `allow-scripts`,
so `<button onclick>` would be inert anyway. Trust gate v1: path-
restricted to `~/.claude/duo/`. `duo send --enter` flag (Stage
23b) pairs with `data-enter="true"` for the bidirectional loop.
Worked example at `help/canvas-actions-demo.html`; skill reference
at `skill/examples/canvas-actions.md`.

**3. Preventative kb-shortcut architecture (the unplanned headline).**
Smoke walk surfaced BUG-012/013/014 (canvas iframe + TipTap
swallowing global shortcuts). Owner's diagnosis cut hard: *"your
fixes are detective controls, not preventative."* Detective: smoke-
checklist + plumbing checklists I'd just proposed — they catch
regressions if you remember to walk them. Preventative: invert the
default so shortcuts work in every surface unless explicitly opted
out.

Three files land the architecture:

- `renderer/keyboard/globalShortcuts.ts` — typed registry of every
  global shortcut + a `matchGlobalShortcut(e, ctx)` matcher (single
  source of truth).
- `renderer/keyboard/iframeForwarder.ts` —
  `installGlobalShortcutForwarder(doc, parentWindow)` utility that
  redispatches matched keystrokes on the parent doc.
- `renderer/hooks/useKeyboardShortcuts.ts` — refactored to install
  a *capture-phase* listener on `document` (was bubble on `window`).
  Capture-phase fires before any focused element's bubble handlers,
  so TipTap, contentEditable, and the canvas iframe can no longer
  silently swallow shortcuts.

Three escape patterns, applied uniformly:

1. **In-document surfaces** (TipTap, app controls): the document
   capture listener catches global shortcuts before they bubble.
   TipTap's `editorProps.handleKeyDown` consults the matcher.
2. **Iframe surfaces** (canvas): one call to
   `installGlobalShortcutForwarder` in the iframe load handler.
3. **Native-bridged surfaces** (xterm + WebContentsView): existing
   escape hooks consult the matcher. Hardcoded allowlists deleted.

Quadratic coverage at linear effort. Smoke matrix in
`docs/dev/smoke-checklist.md` gains a Canvas (C) column and matcher-
trace steps as defense-in-depth, not first line. CLAUDE.md plumbing
checklist for new tab types now requires picking one of the three
patterns.

**Verified end-to-end:** ⌘T from canvas focus opens new browser tab
(BUG-012); ⌃Tab cycles tabs (BUG-014); BUG-013 covered by same code
path (matcher claims ⌘T globally regardless of which surface
raised it).

**4. BUG-010 fix.** `waitForPtyReady` strips ANSI/CSI/OSC escapes
and matches a prompt-tail regex on the visible last 160 chars
instead of resolving on the first PTY data event. 14/14 standalone
test cases pass. The cosmetic `claude` echo above the shell prompt
from v0.2.0 is gone.

**5. GitHub Releases DMG distribution.** v0.2.0 backfilled; README
points at `releases/latest/download/Duo-<v>-arm64.dmg`. cut-version
skill grew Step 6.5 to attach DMGs on every cut.

**Filed but deferred to v0.3.1:** BUG-015 (canvas comment rail
renders with no comments), BUG-016 (dark-mode pasted bold contrast),
BUG-017 (theme system mode not following macOS), MISSING-001
(markdown editor lacks comments — Stage 14a), ENH-001 (default
stable IDs for new HTML canvases — sidecar `idChoice: 'always'`),
ENH-002 (paste-and-match-style + ⌘⇧V cross-editor), ENH-003
(default-pin "What Duo Does" alongside the FAQ).

**Owed for v0.4.0+:** Stage 14a (markdown CommentRail binding),
Stage 18b (distro skill packs), Stage 25 (post-redirect chrome
banner), Stage 19d (mid-tab launch-claude banner), Stage 21
(sign + notarize).

---

## 2026-04-26 evening (later) — v0.2.0 cut: FTUX foundation

The chapter that started after v0.1.0 closed. Eleven commits since
the inaugural cut, including two whole stages (24 + 18) and two
full-class bug squashes (008 + 009). Cut as v0.2.0 with the bar
recalibrated halfway through ("not every three commits — wait for
a chapter to end").

**What landed:**

- **Stage 18 — First-launch self-install (whole stage).** Phase 1
  shipped early in this run: welcome banner copies skill + subagent
  + help-files into `~/.claude/`, bootstraps external-domains.json,
  writes provenance. Phase 2 then closed the loop: `cli/duo` →
  `~/.local/bin/duo`, with PATH check + shell-rc snippet when the
  dir isn't on $PATH. Decision was `~/.local/bin` over
  `/usr/local/bin` — no sudo needed; sandbox-friendly; the
  one-liner-to-add-to-zshrc trade-off felt acceptable for v1.
- **Stage 24 — Pin WorkingPane tabs.** Right-click → Pin/Unpin · pin
  glyph · sort to leftmost · ⌘W gated by confirm modal. Storage at
  `~/.claude/duo/pins.json`. Pin survives Duo restarts (verified
  during the smoke pass — the FAQ tab pinned in one Duo session
  showed up pinned after a clean restart). Foundation for Stage 18b
  PACK.json pre-pins and Stage 21c session restore.
- **BUG-008 squash.** xterm allowlist swept the whole Duo-global
  meta-shortcut family in one pass (⌘T/⌘⇧T/⌘N/⌘W/⌘L/⌘B/⌘\`/⌘0–9/
  ⌘+/=/-). Same edit included a spec flip: ⌘T everywhere now opens
  a browser tab (Chrome parity); ⌘⇧T opens a Claude tab from
  anywhere; vanilla shell only via the `>` button on the strip.
  Stage 19c's pane-aware ⌘T was reverted in favor of a universal
  mental model.
- **BUG-009 fix.** `waitForPtyReady` helper replaces `queueMicrotask`
  for new-tab post-spawn writes. Resolves on the shell's first PTY
  data event + 30ms paint settle. Functional fix is real; cosmetic
  residual filed as BUG-010 (a literal `claude` still echoes above
  the prompt because the helper resolves on pre-PS1 bytes; suggested
  follow-up is a prompt-shape regex instead).
- **FAQ direction completion.** about:blank → faq.html as the
  default browser landing. Two new declarative metas:
  `<meta name="duo-open-in" content="browser">` routes HTML files
  to a browser tab via file:// URL; `<meta name="duo-editable"
  content="false">` mounts the canvas read-only when present. Both
  used by the bundled help/ HTMLs.
- **Cut-version machinery refinement.** Skill recalibrated mid-
  conversation when the first v0.2.0 proposal was rejected ("not a
  release yet — keep building"). Added a "calibration note" to the
  skill: "a meaningful chapter has ended" is the bar, not "three
  coherent commits." Memory feedback entry updated to match. Then
  later in the same run: added Step 4.5 (`npm run dist`) to the
  skill so future cuts produce a DMG; clarified that file edits
  target the repo's `help/` directory NOT the installed
  `~/.claude/duo/help/` copies; documented the dev-mode banner
  oddity.
- **README + skill tidy + docs/dev/smoke-checklist-v0.2.0.html.**
  README's "Install the duo CLI and skill" section was rewritten
  for the post-Stage-18 reality (one click in the welcome banner,
  not manual copy/symlink commands). Added a "Build a distributable
  .app/.dmg" section. Owner-side smoke checklist filed for the
  V2–V27 walk that's still owed (Bucket 2 in that doc).

**Smoke verification during the cut session** (from a live
`npm run dev` build): 8 PASS + 2 PARTIAL across ten items. Default
landing, Stage 18 banner, FAQ live-search, ⌘T spec flip + xterm
allowlist (multiple), pin context menu + glyph + sort, ⌘W confirm
modal, duo-open-in routing, ⌘N new-file from terminal focus, ⌘B
file-column toggle from terminal focus — all PASS. The two PARTIAL
were ⌘⇧T claude-tab launch and `+` button claude-tab launch (both
launch claude successfully but show the BUG-010 cosmetic echo).

**Process notes:**

- **Cut-version skill cycle.** First proposal rejected after 3
  commits with "this is not a release yet — keep building." Skill
  recalibrated mid-conversation (raised the bar to "chapter ends").
  Eight more commits later, including two whole stages, the cut
  was approved as proposed. The litmus test mechanic worked — the
  draft notes felt different at the substantive moment.
- **Stage 18 Phase 2 path decision** stated and proceeded
  (`~/.local/bin/duo` over `/usr/local/bin/duo`); the trade-off
  documented inline. Owner did not push back.
- **`npm run dist` gap discovery.** The cut-version skill's earlier
  draft didn't include DMG production. Surfaced and fixed during
  the cut itself (Step 4.5 added). Now every cut produces a
  shippable artifact, not just a tag.
- **Dev launch fragility** observed and noted: when `npm run dev`'s
  parent process exits, Electron stays alive in default-app mode. A
  stray `open Electron` brings up the splash, not Duo. Filed as a
  small dev-script improvement (~10 LOC; backlog).

**Owed for v0.3.0:**

🔖 **Owner-flagged priority post-v0.2.0:** Stage 19b at the top.

1. **Stage 19b — passive priming (PRIORITY).** SessionStart hook +
   PATH shim + `priming.md` in `~/.claude/`. Closes the Stage 19
   family — when Claude Code spawns inside a Duo PTY, hand it
   ambient Duo context so the agent doesn't need to be told "you're
   in Duo." Originally specced as folding into Stage 18; keeping
   it 19b keeps the visibility.
2. **BUG-010 fix** — replace `waitForPtyReady`'s "first data" with
   a prompt-shape regex.
3. **V2–V27 verification walk** — inherited from v0.1.0; the
   canvas/editor surface verification still owed in eyes-on form.
4. **Stage 18b** (distro skill packs / `extra-skills/` /
   `PACK.json`).
5. **Stage 23** (canvas actions Claude↔HTML).
6. **Stage 25** (post-redirect chrome banner — small).
7. **Stage 19d** (mid-tab launch-claude banner — small).
8. **Stage 21** (sign + notarize the DMG; cert pre-work done).

---

## 2026-04-26 evening — v0.1.0 cut + version-management machinery

**The inaugural Duo release was cut**, blessing
`package.json`'s pre-existing `0.1.0` version label. Pre-distribution
tag — runs from `npm run dev` or the unsigned DMG; first-launch
self-install (Stage 18) lands in v0.2.0.

**What this session built:**

- **Version-management machinery** (the core ask: "I will not
  remember to tell you to cut a new version, so you will need to
  remember to do all of the steps"):
  - `CHANGELOG.md` at repo root — Keep-a-Changelog format with
    v0.1.0 drafted from the roadmap and `tasks.md`.
  - `docs/RELEASES.md` — prose log + `Pending — not yet cut`
    stash mechanism (rejected drafts accumulate here; rolled
    forward into the next cut proposal).
  - `.claude/skills/cut-version/SKILL.md` — the procedure as a
    project-scoped skill so any Claude session in this directory
    auto-discovers it. Strong/weak triggers + the litmus test
    convention (Step 1 is *draft notes*; if they don't feel
    substantive, the cut waits).
  - `CLAUDE.md` § Working style item 10 — trigger rule pointing
    at the skill.
  - Memory feedback entry at
    `~/.claude/projects/-Users-geoffreydudgeon-Documents-GitHub-duo/memory/feedback_propose_version_cuts_proactively.md`
    — primes future Claudes to detect ship moments.

- **User-facing reference HTMLs** at `help/` (source of truth in
  repo; will be installed to `~/.claude/duo/help/` via the Stage 18
  installer):
  - `help/what-duo-does.html` — 37 numbered capabilities across 8
    categories, plain-English voice + CLI alongside, live keyword
    filter, Atelier-styled (mirrored tokens from
    `renderer/styles/globals.css`).
  - `help/faq.html` — What's New section + Getting started + Using
    Duo + For Claude/agent users + Troubleshooting; same Atelier
    styling + live filter.
  - Both files declare `<meta name="duo-open-in" content="browser">`
    (route as browser tab, not canvas) and
    `<meta name="duo-editable" content="false">` (read-only). The
    meta-honoring code path in `fileClassifier.ts` + canvas init is
    deferred to v0.2.0.

- **Bug findings filed in `tasks.md`:**
  - **BUG-009** (`+`-claude-tab newline race): clicking `+` on the
    terminal tab strip writes `claude\n` before the shell prompt is
    ready; first `claude` lands as raw text, the `\n` lands at an
    empty prompt (no-op), then a second `claude` lands at the
    prompt without a trailing newline. User has to manually press
    Enter. Fix candidates: prompt-detector regex, post-spawn sleep,
    or a readiness signal on the PTY.
  - **Spec-conflict note appended to BUG-008** (filed by a parallel
    Claude session during my V-walk): BUG-008 says ⌘T from terminal
    focus *should* open a new browser tab, but Stage 19c shipped
    that exact shortcut as opening a *claude* tab
    (`docs/roadmap.html:648`). Either the parallel filer didn't
    know about 19c or Geoff has reconsidered 19c's pane-scoping;
    surfaced separately for resolution before fixing. Underlying
    xterm-eats-keystroke issue is real either way.

- **Verification sweep partial:** V1 PASS (browser-pane `+` plain
  click → file-name interstitial). 19c.1 PASS (split-button `+`/`>`
  visible). 19c.2 → BUG-009 (above). The remaining V2–V27 + full
  19c walk is deferred to v0.2.0 because Geoff was actively using
  Duo in a parallel claude session and my UI-driving clicks would
  collide with his work.

**Process notes from the conversation:**

- The "litmus test" mechanic worked as designed first time out.
  Drafting full release notes BEFORE bumping anything turned the
  proposal into something concrete enough to evaluate; Geoff
  approved with a single "a." If the notes had felt anemic, the
  same artifact would have stashed under
  `docs/RELEASES.md § Pending — not yet cut` and accumulated until
  the next ship moment.
- The about:blank → faq.html replacement was added to v0.2.0 scope
  during the conversation when Geoff observed Duo loads with a
  "blank, and not useful" landing tab.
- The `<meta name="duo-editable" content="false">` convention also
  came up mid-conversation — extends the existing routing-meta
  pattern (`duo-open-in: browser`) for read-only system files. v1
  scope: FAQ + What Duo Does + future help docs.
- Skipped `npm run build:cli` for this cut because `cli/duo.ts` is
  unchanged. Ran `sync:claude` as cheap insurance per the skill's
  own guidance. Both rules baked into the cut-version skill.

**Owed next session (v0.2.0 candidate scope):**

1. Verification sweep completion (V2–V27 + 19c full UI walk) +
   fixes for whatever it surfaces.
2. FTUX-coordinated trio — Stages 18 (first-launch self-install) +
   18b (distro skill packs) + 23 (canvas actions Claude↔HTML loop)
   + 24 (pin WorkingPane tabs).
3. Meta honoring (`duo-editable` + `duo-open-in`) in
   `fileClassifier.ts` + canvas init + browser-tab path.
4. Wire `faq.html` as default new-tab landing (replace about:blank).
5. BUG-008 spec-conflict resolution + xterm-allowlist fix; BUG-009
   PTY-ready race fix.
6. Pinned-tab todos for FAQ + What Duo Does (ship as
   distro-default pre-pins via Stage 18b's `PACK.json § pins`).

---

## 2026-04-26 night — Intent conversation → roadmap depth pass

After Stage 17d-A shipped (shared `<CommentRail>` primitive + canvas
binding + new-comment flow), Geoff paused dev to talk through six
ideas before pulling in the next ship. Each was expanded via
`AskUserQuestion` drilldowns until the design space was understood,
then feathered into the roadmap as a new stage card or sub-stage.

**The six resolutions:**

1. **Stage 22 — Navigator dual-pane overhaul (context pedagogy).**
   The navigator's primary job becomes teaching non-technical PMs
   that the agent reads from BOTH user-level (`~/.claude/`) and
   project-level (`./CLAUDE.md`) context. Two panes: top "Your Claude
   settings" (curated CLAUDE.md + skills/ + agents/, toggle-to-show-
   all), bottom "This project" (CWD-pinned, with project Claude
   context surfaced at top). Drops Stage 10 D11 three-column-deeper
   for inline collapsing folders. Plain-English labels.
2. **Stage 19d — Mid-tab launch-claude banner.** Closes the gap that
   19c (split-`+` button) leaves for non-technical PMs sitting in
   shell tabs. Detect `TabSession.kind === 'shell'` → render small
   banner: "Looking for Claude? Click here to start an AI session in
   this tab." Click handler: `pty.write(activeTabId, 'claude\n')`.
   Per-tab dismiss + global settings toggle.
3. **Stage 18b — Distro skill-pack support.** Convention folder
   `extra-skills/` (gitignored; build picks up if present); required
   `PACK.json` manifest; per-conflict UI in the consent sheet (skip
   all / overwrite all / decide each); provenance manifest at
   `~/.claude/duo/installed-packs.json`. v1 scope: skills + agents.
   Cap One distro workflow: clone duo + drop `extra-skills/` + `npm
   run dist`.
4. **Stage 23 — Canvas actions (Claude ↔ HTML loop).** Convention-
   based `data-duo-action` attribute on canvas HTML buttons; canvas
   runtime delegates clicks to a dispatcher; **no page scripts
   needed**. v1 vocabulary: `claude:spawn`, `terminal:send` (with
   optional `\n` via new `duo send --enter` flag), `browser:open`.
   Trust model: path-restricted to `~/.claude/duo/`. Demo lives in
   the AIP distro's quick-docs as the FTUX welcome page. Bidirectional
   loop achievable today — no Claude Code hooks needed.
5. **Stage 24 — Pin WorkingPane tabs.** Reframed from "quick-docs
   menu" to "pin tabs" — far simpler, same use cases (FTUX welcome,
   personal task list pinned, team wiki always-on). Right-click →
   Pin/Unpin; pinned tabs leftmost with pin icon; ⌘W triggers
   confirm modal. Storage: `~/.claude/duo/pins.json`. Distro pre-pins
   via Stage 18b's `PACK.json § pins` (merged on first install only;
   respects user removal). Pinned tabs anchor Stage 21c session
   restore.
6. **Stage 25 — Post-redirect chrome banner.** After `shell.openExternal`
   fires from `duo external`, Duo flashes auto-dismissing banner above
   WorkingPane with optional per-domain `reason` text. Schema for
   `external-domains.json` gets backward-compatible extension:
   strings still work; objects `{host, reason?}` opt-in. Contact-link
   mechanism deferred per Geoff. Small ship (~80 LOC).

**Cross-stage architecture insight:** the FTUX-coordinated trio
(Stage 23 + 24 + 18 + 18b) ships as a tight set so first-launch
users see a pinned, action-driven welcome page. This is the
highest-leverage Trailblazer surface and the recommended next ship
sequence.

**Process notes from the conversation:**
- Plan mode used effectively — captured all six idea seeds verbatim
  before drilling, then resolved each in order with consistent
  ask-to-expand → AUQ-drilldown → resolution-summary pattern.
- The "common componentry" theme from Stage 17d-A's `<CommentRail>`
  primitive recurred throughout — Stage 14 (MD binding) shorter
  because the rail is shipped; Stage 19d's `<LaunchClaudeBanner>`
  follows the `<WriteWarningBanner>` pattern; Stage 25's banner
  reuses the same primitive shape with auto-dismiss.
- The pedagogy theme (visibility for non-technical PMs) drove
  Idea 1 (navigator dual-pane), Idea 2 (mid-tab banner), and
  Idea 6 (post-redirect banner) toward consistent solution shapes:
  small visual surfaces with plain-English labels.

**Deliverables this turn:** roadmap.html + ROADMAP.md updated with
the six new/modified stage cards; layered build order ASCII diagram
extended; sidebar status counts updated; `docs/dev/intent-pause.md`
deleted (one-shot file; conversation has resolved). PRDs deferred to
implementation time per project convention.

---

## Current state (as of 2026-04-26)

**Foundation shipped. Flagship half #1 (cozy-mode terminal) shipped
2026-04-22, graduated 2026-04-25 (`(preview)` label dropped).
Flagship half #2 — sub-stage 11a of the markdown editor — shipped
2026-04-24; 11a tail (3 items) and 11b–e next.**

**Latest session (2026-04-26) — Stage 17d-A shipped (shared
`<CommentRail>` primitive + canvas binding + new-comment flow + `duo
html comment` / `comments` CLI verbs). The same primitive will serve
the markdown editor's Stage 11d binding when CriticMarkup ships —
visual layer is editor-agnostic, only the data binding differs. 17a +
17a polish + 17a.5 D + 17b + 17c + 17d-A + 19c merge + Stage 21 cert
pre-work all done in this session.** New canvas-side primitives:
`renderer/components/HtmlCanvas/{justAddedCanvas,blurredSelection,canvasSelection}.ts`;
serializer scrubs `duo-just-added` from saved class lists; new IPC
channel `CANVAS_SELECTION_PUSH` + `getCanvasSelection` on NavBridge;
`socket-server.ts` selection switch extended (`--pane canvas` plus
auto fallthrough chain browser → canvas → editor); CLI accepts
`--pane canvas`; `formatCanvasSendPayload` for all three formats;
`SendToDuoPill` translates iframe-content rect → viewport via
`iframe.getBoundingClientRect()`. Earlier same day: 17a + 17a polish
1-7 + 17a.5 D + 17b A-D + 19c merge + Stage 21 cert pre-work.
**Stage 21 cert pre-work ✅ complete** — all five artifacts verified
on disk + in keychain (`security find-identity` returns one valid
identity; `.p8` at `~/Documents/duo-private/`; Team ID `R39EF29X3Y`,
Key ID `T8VVN9GF4M`). Earlier same day: Stages 5 v2 + 13 + 15.1 +
15.2 + owner-walk fixes + skill refactor. Originally added
`html-canvas` tab type;
`renderer/components/HtmlCanvas/{CanvasTab,RenderedCanvas,CanvasToolbar,inlineMarks,htmlBoilerplate}.tsx`;
`shared/html-boilerplate.ts` shared between renderer + main; new
`duo html new <path.html>` CLI verb (writes H17 boilerplate
atomically + dispatches NAV_EDIT); `.html`/`.htm` route through
`fileClassifier`; `⌘N` extension-based dispatch dissolves PRD
H6.1; selection-aware mark applicator without `execCommand` (PRD
§8 non-negotiable). Skill stub at `skill/examples/html-canvas-authoring.md`.
Live walk pending — owner deferred to "after this batch." Detail
in the **Pick up here** section below.

**Earlier same-day session (2026-04-26 late-evening) — Stages 5 v2 + 13 +
15.1 + 15.2 shipped & committed; owner-walk follow-ups (focus on
Send → Duo, ⌘N D33f regression, editor click-target) committed in
`258ff6f`; SKILL.md slimmed by extracting verbose deep-dives into
`skill/references/` (`google-docs.md`, `sandbox-troubleshooting.md`)
so the top-level skill stays scannable while details stay one
fetch away.** Stage 5 v2: new global
`agents/duo.md` (Haiku 4.5) subsuming `duo-browser`; new `duo
external <url>` CLI verb; bootstrap of
`~/.claude/duo/external-domains.json`. F1/F2/F4/F5/F8/F9 + C5/C6/C7
all PASS live; Class B perf inverted PRD hypothesis (FOLLOWUP-003).
Stage 15.1: `duo selection-format [a|b|c]` (G19) + `duo send` (G17)
CLI verbs + editor pill UI (`<SendToDuoPill>` primitive,
`formatSendPayload` helper, `useSelectionFormat` hook, full wiring
in MarkdownEditor → WorkingPane → App.tsx → `pty.write`). Stage
15.2: page-side selection observer IIFE injected via CDP
`Runtime.evaluate` on every attach + frame-nav, posts via
`Runtime.addBinding('duoSelectionPush')`; main caches latest
push and forwards to renderer over `IPC.BROWSER_SELECTION`;
`useBrowserSelection` hook drives the pill in `BrowserRenderer` with
page→screen rect translation. **Verified live:** binding installed,
observer injected (`__duoSelectionObserver: true`), `selectionchange`
on example.com fires payload through to the cache (`count=1`,
serialized payload includes both snapshot and page-relative rect).
Visual pill rendering still gated on FOLLOWUP-004 (computer-use
deferred). All three commits landed: `f250b65`, `a870d37`,
`1076298`.

**Previous session (2026-04-26 evening) — Stage 13 ship + Stage 5 v2
PRD locked + canonical flip:** see "Pick up here" breadcrumb below
for the full write-up. Major items: **Stage 13 shipped end-to-end**
(Phase 0 editor-agnostic refactor + Phase 13a just-added highlight
+ Phase 13b warn-before-overwrite banner; verified in live app);
**Stage 5 v2 (Duo subagent) PRD locked** at
[docs/prd/stage-5-v2-duo-subagent.md](docs/prd/stage-5-v2-duo-subagent.md)
and line-jumped before Stage 15 — full PRD with 26 decisions
covering identity, contract, session guard, web routing, install,
validation; **canonical flip** of the roadmap (`docs/roadmap.html`
is now canonical, `ROADMAP.md` is the synced markdown view); editor-
agnostic primitive contract locked in
[DECISIONS.md](docs/DECISIONS.md); BUG-003 v1→v2 history captured
(inset-shadow ring → chrome-strip tint).

**Earlier session (2026-04-26 late-day) — Stage 12 Phase 3 + bug
sweep:** Five items shipped: PROCESS-001 Phase 1 (keyboard matrix
in smoke-checklist § 5), BUG-002 (⌘T address-bar focus), BUG-003
v2 (pane focus indicator on chrome strip), BUG-004 (⌘` OS-focus
move), and Stage 12 Phase 3 (tab-strip rhyme + cozy-mode visual).

**Earlier session (2026-04-26) — P0 CLI gaps shipped:**
- `duo doc read [path]` — live editor buffer (frontmatter + body,
  including unsaved edits). Body to stdout, `# <path> (unsaved
  changes)` header to stderr so it pipes cleanly.
- `duo selection [--pane auto|editor|browser]` — extended to a unified
  `DuoSelection` shape. `auto` (default) prefers a non-empty browser
  highlight, falls back to the editor cache. Browser shape carries
  `{kind, url, text, surrounding, selector_path}`.
- `duo errors [--since] [--limit]` — separate ring (200 entries) fed
  by `Runtime.exceptionThrown`. Catches the uncaught exceptions that
  `duo console` silently misses.
- `duo network [--since] [--filter <regex>] [--limit]` — request
  lifecycle stitched from `Network.requestWillBeSent` →
  `responseReceived` → `loadingFinished`/`loadingFailed`. Ring size
  300; in-flight entries surfaced too. CDP `Network.enable` added to
  the attach sequence; `networkInFlight` is cleared on tab switch so
  prior-tab requests don't sit forever as pending.

**Same-day follow-ups (2026-04-26) — all stage refs use NEW numbers per the same-day renumber, see ROADMAP § Number history for old↔new map:**
- Old Stage 14 split into **Stage 18** (first-launch self-install
  — no cert needed) + **Stage 21** (cert-gated distribution polish)
  so the user-facing first-launch UX isn't blocked on cert
  procurement.
- Atelier visual-redesign bundle imported to
  [docs/design/atelier/](docs/design/atelier/); **Stage 12**
  (Atelier) created and pulled to the front as the L0 visual
  foundation that every L1+ stage inherits. Per-feature visuals
  fold into hosts: **Stage 9 follow-up** (cozy completion),
  **Stage 13** (just-added highlight — yellow + 6s fade overrides
  "blue fade" placeholder), **Stage 14** (Suggesting / Accepted
  track changes), **Stage 15** (Send → Duo pill).
- BUG-001 fixed (commit `3976039`) — pane-aware ⌃Tab cycling.
  Three-part fix: pane-aware routing in the keyboard hook, xterm
  `attachCustomKeyEventHandler` so the keystroke isn't eaten as
  PTY input, and a `paneOverride` for the browser-forwarded-key
  path because WebContentsView clicks don't bubble to the
  working-column wrapper. See `tasks.md` for the full trace.
- **Layered build-order renumber** — stage numbers now reflect
  actual build order, not chronology of planning. See
  [ROADMAP.md § Number history](ROADMAP.md). Commit messages from
  before the renumber use old numbers; the map translates them.
- **Stage 12 Phase 1 shipped** (commit `585d4ee`) — Atelier token
  swap, light-as-default, serif voice. Atelier rendering live
  (cream paper + ochre cursor verified in screenshot).
- **Stage 12 Phase 2 shipped** (commit `5cbaa36`) — files-pane
  width 240→208, explicit chevron-collapse button, layout depth
  (terminal column on paper-deep, working pane on paper).
- **⌘T tried pane-aware then reverted** (commits `c239375` →
  `2b68d40`) — owner preferred Chrome-parity (⌘T = browser).
- **⌘N configurability decision recorded** — Stage 17 H6.1 + Stage
  11 D33a cross-ref. Future setting `duo.newFileShortcut: 'md' |
  'html'` so PMs whose primary artifact is HTML reports don't have
  to learn ⌘⇧N.

## ⚠️ Pick up here next session (2026-04-26 — pre-compaction breadcrumb)

> **🛑 OWNER PAUSED DEV TO TALK INTENT (2026-04-26 night).** Geoff
> shipped Stage 17d-A and immediately said: "I want to take a pause
> from dev for a bit and talk through a few more intent items." So
> the next post-compaction message will likely NOT be "build the next
> thing" — it'll be a conversation about what to work on, how, or
> why. Read the [Open intent items for the conversation](#open-intent-items-for-the-conversation)
> section near the bottom of this file before responding to the next
> turn so you can engage the conversation with full context. Don't
> jump back into the editor without confirmation.

**Where we are.** Massive 2026-04-26 — Stage 17 deep stack landed +
Stage 19c merged in from a parallel worktree + Stage 21 cert
pre-work confirmed complete. Commit chain on `main`:

- **17a** (canvas primitive) — `631d2b7`
- **17a polish & parity 1-7** (shared `EditorActions` toolbar +
  markdown shortcuts on typing + canvas blockOps + tableOps +
  placeholder foundation) — same commit
- **17a.5 design exploration** (5 directions, F committed inline,
  D shipped) — `257f9a2` (docs), `e10e6af` (D code; visual smoke owed)
- **17b A-D** (ID injection + first-open prompt + sidecar + 7
  agent CLI verbs + pretty-printer with runtime-chrome strip) —
  `717ea99` (A), `e73d4bd` (B), `9d41eed` (C), `6f8ed0d` (D)
- **Doc consolidation** — `557d689` (V1-V15 verification list)
- **Stage 19c merge** — pulled in from worktree
  `worktree-stage-19c-default-claude-tabs` (branch commits
  `79a1753`/`a5054a0`/`efc6462`) → merge commit `cbadc5f`. 6
  conflict files resolved by composing both 17b's canvas additions
  and 19c's new-tab additions in `shared/types.ts`, `main.ts`,
  `socket-server.ts`, `cli/duo.ts`, `cli/duo`, `App.tsx`. UI walk
  on the merged build owed.
- **Cert tracker update** — `7413a54` flips Step 3 + Step 4 to ✅
  in `docs/dev/cert-procurement.md`.
- **17d-A** (comments rail + canvas binding — code-side complete;
  visual smoke V23–V27 owed) — `8c62e70` (code) + `f781586` (docs).
  Pushed to origin/main. Shared `<CommentRail>` primitive + canvas
  binding + new-comment flow + `duo html comment` / `comments`
  CLI verbs. The same primitive serves the markdown editor's Stage
  14 binding when CriticMarkup ships — visual layer is editor-
  agnostic, only the data binding differs.
- **17c** (agent overlay + selection — code-side complete; visual
  smoke owed) — see § 17c below for the full inventory. Touches:
  `renderer/components/HtmlCanvas/{justAddedCanvas,blurredSelection,canvasSelection}.ts`
  (new), `serialize.ts` (scrub `duo-just-added` from `class=""`),
  `CanvasTab.tsx` (banner gating + repaint at open + pill +
  selection observer + new helpers wired into handleReady),
  `RenderedCanvas.tsx` (expose `getIframeElement()` for rect
  translation), `WorkingPane.tsx` (thread `onSendToDuo`),
  `editor/sendFormat.ts` (canvas variant), `shared/types.ts`
  (`CANVAS_SELECTION_PUSH` IPC + `pushSelection` on
  `ElectronCanvasAPI`), `electron/main.ts` (canvas selection cache
  + `getCanvasSelection`), `electron/preload.ts`
  (`canvas.pushSelection`), `electron/socket-server.ts` (selection
  switch extended to `--pane canvas` + auto fallthrough chain
  browser → canvas → editor), `cli/duo.ts` (`--pane canvas`),
  `agents/duo.md` + `skill/SKILL.md` + `docs/CLI-COVERAGE.md`
  (cheat-sheet entries). Typecheck clean; CLI rebuilt; sync:claude
  applied.

Earlier same-day work (already committed): Stage 5 v2 + 13 + 15.1
+ 15.2 + owner-walk fixes + skill refactor.

**Stage 21 cert pre-work complete.** All five required artifacts
verified on disk + in macOS login keychain:
- Apple Developer Program (individual, dudgeon@gmail.com)
- Bundle ID `com.geoffdudgeon.duo`
- Developer ID Application cert paired with private key —
  `security find-identity -p codesigning -v` returns one valid
  identity: `Developer ID Application: Geoffrey Dudgeon (R39EF29X3Y)`
- App Store Connect API key `~/Documents/duo-private/AuthKey_T8VVN9GF4M.p8`
  (perms 600)
- Team ID `R39EF29X3Y` (visible in cert CN)

Handoff packet (`CSC_NAME`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`,
`APPLE_API_ISSUER`, `APPLE_TEAM_ID`) is in
`~/Documents/duo-private/.env` (gitignored, perms 600). Three
optional follow-ups (.cer/.csr cleanup, .p12 1Password export,
.p8 1Password backup confirmation) still ☐ in tracker but none
blocking.

**Recommended next.** Three strong candidates:

1. **Stage 14** (markdown editor's `<CommentRail>` binding via
   CriticMarkup). The 17d-A shipment landed the editor-agnostic
   `<CommentRail>` primitive specifically shaped to also serve the
   markdown editor — see `primitives/CommentRail.tsx` headers + the
   primitives README. Stage 14 work is the parsing layer
   (`{>>[author · ts] body<<}` round-trip), TipTap mark for the
   in-document anchor decoration, and a `useMemo` adapter from
   parsed comment marks → `CommentThread[]` records. The visual
   layer + the rail UX are already done. ~2–3 PRDs.

2. **Stage 17d-B** (lock convention) and/or **17d-C** (skill snippet
   bundle). Both small. 17d-B: `data-duo-lock="structure"` rendering
   (subtle dashed outline on hover; tooltip "Structural element —
   text editable; layout locked") + ⌥-click override (PRD H19).
   17d-C: ship the H17 boilerplate + H18 ten-snippet bundle in
   `skill/examples/html-canvas-authoring.md` so Claude recognizes
   Duo-shape components when authoring.

3. **Stage 21** (signed + notarized DMG). Cert pre-work is done;
   remaining work is mechanical: uncomment `mac.identity` +
   `mac.notarize` in `electron-builder.yml` (referencing the env
   vars from `~/Documents/duo-private/.env`); flip
   `dmg.sign: false` → `true`; run `npm run dist`; validate with
   `spctl -a -t open --context context:primary-signature` +
   `stapler validate`. Could be a quick win — half-day if nothing
   misbehaves on the notarytool round-trip.

**Alternatives if a different bottleneck is felt:**
- **Run the V1–V22 verification list** filed in
  `docs/roadmap.html#s17a-polish` § In-depth verification owed.
  V2 (MD toolbar regression after the EditorActions refactor),
  V14 (full agent CLI sweep), V20 (CSS Custom Highlight Registry),
  V22 (warn-before-overwrite banner) are the highest-risk;
  V11/V12 verify the smart-blank overlay visually; V16-V19/V21
  cover the Stage 17c canvas-side wash + selection observer +
  Send → Duo pill.
- **UI walk for 19c** on the merged build (split-button, ⌘T from
  terminal focus → claude, install banner when claude missing,
  `duo new-tab` round-trip).
- **Stage 19b** (passive priming — SessionStart hook + PATH shim;
  folds into Stage 18 installer).
- **Stage 18** (first-launch installer — independent of L0–L2).
- **Stage 14** (track changes — defers cleanly).
- **Stage 15.3** (Send → Duo polish — defers cleanly).
- **17a.5 directions A/E** (templates) — still open design
  questions; owner needs to pick before code work starts.

## Open intent items for the conversation

Owner paused dev after 17d-A landed to talk intent. These are the
threads I noticed while shipping recent stages — surfacing them
explicitly so the next conversation has them at hand, not so I
push agendas. Triage as the user wants. Anything starred (★) is
something the user explicitly flagged earlier that I haven't yet
closed out.

**Sequencing / what to ship next**
- **Stage 14 vs. Stage 17d-B/C vs. Stage 21 vs. defer-and-talk.** All
  three are reasonable next ships per the breadcrumb. Stage 14 has
  the most leverage now that the rail primitive is in place; 17d-B
  + 17d-C are small but their value lights up only when the snippet
  bundle (17d-C) lands first; Stage 21 is mechanical but ships
  distribution. The intent question: which of these maps to a
  Trailblazer milestone the user is aiming at? If 17d-A was "the
  collab loop closes for canvas," then Stage 14 is "same loop for
  markdown" — does that shape the user's calendar?
- **★ Stage 11 tail items.** Frontmatter properties panel, drag-drop
  images, slash menu, floating selection bubble — all defer cleanly,
  none have been pulled in. The original Stage 11 PRD assumed they'd
  ship with 11a; they didn't. Are any worth pulling forward, or is
  this a "ship 14 + 17 first, polish 11 once the editor sees real
  use" call?
- **★ Stage 17a.5 directions A and E** (curated starter templates +
  user-defined template registry). Owner committed direction F
  (markdown shortcuts on typing) and direction D (smart-blank
  overlay). A and E are still open design questions blocking code
  work on a template gallery / registry. The Backlog template-
  loader card is already filed at
  `docs/roadmap.html#backlog-templates` with v1 location +
  agent-CLI shape proposed.

**Ergonomic / process loose ends**
- **Visual verification owed on V1–V27.** That's a lot of unwalked
  smoke. Most of it requires the Duo app running, which it usually
  isn't during my sessions. Worth scheduling a dedicated
  "verification afternoon" against the V1–V27 list before the next
  major ship?
- **★ The 19c UI walk on the merged build.** Split-button, ⌘T from
  terminal focus → claude, install banner when claude missing,
  `duo new-tab` round-trip — never been eyes-on-verified post-merge.
  Folds into the verification afternoon.
- **★ FOLLOWUP-002** (`tasks.md`): the C5 outside-Duo guard for the
  duo subagent has a corner case where a narrow Bash allowlist
  permission-denies the guard check, which causes the agent to
  proceed instead of refusing. Hardening idea: refuse-on-check-denied
  in the agent prompt.
- **★ FOLLOWUP-003** (`tasks.md`): the Stage 5 v2 PRD's "~85% token
  reduction" hypothesis didn't survive synthetic measurement. The
  agent's value is real but different (bounded context per task,
  specialized prompt, clear contract) — worth re-framing in the PRD
  so future readers don't expect cold-cache cost wins.
- **★ FOLLOWUP-004**: visual pill rendering verification (Stage
  15.2 + 17c) is gated on computer-use access which has been
  deferred all session.

**Architecture / direction**
- **The "common componentry" insight from 17d-A.** Having the
  `<CommentRail>` primitive shipped with both the canvas binding
  AND a documented MD reuse story makes Stage 14 meaningfully
  shorter. Are there other places this pattern ("ship the visual
  primitive with one binding; future bindings cost much less")
  deserves an explicit pass? Stage 14's track-changes primitives
  (`<TrackedRangeMark>`, `<AcceptAllBanner>`) are the obvious next
  ones; the comment-anchor logic in markdown will be very similar
  to canvas's `commentAnchors.ts` — consider refactoring the
  doc-order anchor sort + reconciliation pattern into a tiny
  shared util when 14a lands.
- **Sidecar schema versioning.** 17d-A added the additive
  `resolvedThreads` field; the schema is `version: 1` and we're
  silently extending. The current `isValidSidecar` only checks
  `version === 1`, not field shape. Worth a v2 bump + migration
  pass when the next breaking change arrives — the open question
  is which change crosses that line. Track changes in the sidecar
  (Stage 17 v2)? Comment threading semantics? Per-comment resolved
  state vs. per-thread? Worth a brief design pass.
- **The `data-duo-component` recognition layer is unimplemented.**
  17b shipped the attribute injection but no UI / agent flow
  reads it back. PRD H18 + 17d-C rely on this to teach Claude its
  own snippets; until the recognition flow exists, snippets are
  one-way. Is this the right time to design the read path, or
  defer to when the agent-snippet pattern is in real use?

**Distribution shape**
- **Trailblazers cohort timing.** Owner pre-work for Stage 21 is
  done. The mechanical sign + notarize is a half-day. The
  consent-sheet + installer (Stage 18) is independent. Which lands
  first for the cohort?
- **Auth on the Unix socket.** Stage 21 has the launch-time-token
  bullet; the Trailblazer ergonomics shift in interesting ways
  once the socket is auth'd (the agent has to learn about the
  token; today's "just send to the path" simplicity goes away).
  Worth thinking about before 21d ships.

### Stage 17d-A (just shipped — code-side, visual smoke owed)

PRD: [docs/prd/stage-17-html-canvas.md § 7 — 17d](docs/prd/stage-17-html-canvas.md).
Verification list: V23–V27 in
[docs/roadmap.html#s17a-polish](docs/roadmap.html).

**What landed:**

- `renderer/components/editor/primitives/CommentRail.tsx` — pure
  visual primitive (no editor imports, no IPC, no surface
  assumptions). Props: `threads: CommentThread[] | null`,
  `activeThreadId`, `onJumpTo`, `onReply`, `onResolve`, `onReopen`.
  The same primitive will serve the markdown editor's Stage 14
  binding when CriticMarkup ships — only the data binding differs.
- `renderer/components/HtmlCanvas/commentAnchors.ts` — paints
  numbered `<span class="duo-comment-anchor">` badges into the
  iframe body next to anchored elements. Reconciles on every
  render (idempotent). Badges carry `data-duo-canvas-runtime`
  sentinel so serializer scrubs them; never persist to disk.
  `buildThreads(doc, sidecar)` groups comments by anchorId and
  sorts in document order. `scrollToAnchor(doc, threadId)` is the
  rail's onJumpTo target.
- `renderer/components/HtmlCanvas/sidecar.ts` — `SidecarV1`
  extended with additive `resolvedThreads?: Record<anchorId, {ts,
  by}>`. New mutators: `withComment`, `withResolvedThread`,
  `withReopenedThread` (pure; caller persists).
- `CanvasTab.tsx` — mounts `<CommentRail>` to the right of the
  iframe (~280px panel); "💬 Comment" button pairs with the Send
  → Duo pill on selections that have a live `data-duo-id` ancestor;
  `<NewCommentComposer>` popover for new threads (⌘+Enter submits,
  Escape cancels); active thread state syncs both ways (anchor
  badge ↔ rail card).
- CLI: `duo html comment --id|--selector|--text --body "…"`
  (anchor resolves to nearest `data-duo-id` ancestor; body via
  flag or stdin); `duo html comments [--filter all|open|resolved]`.
- Plumbing: new IPC channels `CANVAS_HTML_COMMENT[_RESULT]` +
  `CANVAS_HTML_COMMENTS_LIST[_RESULT]`; `HtmlCommentRequest /
  Result / HtmlCommentsListRequest / Result / HtmlCommentThread /
  HtmlCommentEntry` types in `shared/types.ts`; `onHtmlComment` /
  `onHtmlCommentsList` on `ElectronCanvasAPI`; `dispatchHtmlComment`
  + `dispatchHtmlCommentsList` in main.ts (30s timeout, mirrors
  dispatchHtmlOp); NavBridge entries; socket-server cases
  `'html-comment'` + `'html-comments'`.
- Atelier styling in `globals.css` — paper-deep panel, accent
  number chips, dashed-resolved variants for the rail; runtime-
  badge styling for the in-body anchor chips.
- Skill / agent / coverage docs all updated.

**Visual smoke owed.** V23–V27 cover new-comment flow, rail
interactions, agent CLI ops, comments listing, and (most
importantly) V27 — confirming comment chrome doesn't leak to
disk. V27 is load-bearing for the canvas's "saved file is just
HTML" guarantee.

### Stage 17c (just shipped — code-side, visual smoke owed)

PRD: [docs/prd/stage-17-html-canvas.md § 7 — 17c](docs/prd/stage-17-html-canvas.md).
Verification list: V16–V22 in
[docs/roadmap.html#s17a-polish](docs/roadmap.html).

**What landed:**
- `justAddedCanvas.ts` — canvas-side binding for the
  `duo-just-added` keyframe. `installJustAddedStyles(doc)` injects
  the keyframe + class into the iframe stylesheet (parent's
  `globals.css` doesn't reach iframe documents). `markJustAdded(el)`
  paints the class for `HIGHLIGHT_MS = 6000` then strips. Marked
  with `data-duo-canvas-runtime` sentinel so the existing
  serializer-strip pass keeps the runtime style out of saved HTML.
- `serialize.ts § scrubClassValue` — strips `duo-just-added` from
  every element's `class=""` during serialization. Defends against
  the wash class racing the autosave: even if the 6s fade hasn't
  completed by the time autosave fires, the serializer drops the
  runtime class so the on-disk file stays canonical.
- `blurredSelection.ts` — installs body-focus/blur listeners and
  mirrors selection state into a CSS Custom Highlight named
  `duo-blurred-selection`. Highlight Registry API (Chromium 105+)
  paints presentation-only — no DOM mutation, so the dirty path
  doesn't fire on focus toggles. Stylesheet for
  `::highlight(duo-blurred-selection)` injected with the runtime
  sentinel. Window-level focus/blur listeners catch the case where
  the iframe loses focus to the parent renderer (clicking the
  terminal) without firing a body blur.
- `canvasSelection.ts` — `installCanvasSelection({doc, path,
  onPush, onRect})`. Computes the H25 union shape:
  `{kind:'html-canvas', path, text, html, anchorId, anchorPath,
  range, surrounding}`. Anchor = nearest `data-duo-id` ancestor;
  anchorPath = trail of ancestor duo-ids outermost-first; range =
  `{startOffset, endOffset, textPath}` only for selections inside
  a single text node within an anchored element; surrounding =
  enclosing block's textContent up to 1000 chars; html =
  `cloneContents()` outerHTML for non-collapsed selections.
  `onRect` fires the bounding rect in iframe-content viewport
  coordinates only when body has DOM focus (mirrors editor's
  `editor.isFocused` gate); pill is hidden otherwise.
- `RenderedCanvas.tsx` — added `getIframeElement()` to the
  imperative handle so CanvasTab can translate iframe-content rect
  → parent-renderer viewport rect by adding the iframe's own
  `getBoundingClientRect()` top/left.
- `CanvasTab.tsx` — `handleReady` now also installs
  `installJustAddedStyles`, `installBlurredSelection`,
  `installCanvasSelection`, and runs `repaintRecentClaudeEdits`
  (reads sidecar's `recentEdits[]`, paints anchored elements
  authored by 'claude' within the freshness window, idempotent
  per anchorId per pass). New state: `pillRect`,
  `lastCanvasSelectionRef`, `selectionFormat` (via existing
  `useSelectionFormat`), `pendingHtmlOp` (for the warn-before-
  overwrite gate). The html-op handler now (a) for read ops:
  applies immediately; (b) for write ops + dirty buffer: queues
  the request + surfaces `<WriteWarningBanner>`; (c) for write
  ops + clean buffer: applies immediately. On successful write
  ops the affected element (`result.id`) gets `markJustAdded`
  (skipped for `remove` since the element is gone). Pending
  banner concurrency: second write while a banner is up returns
  `"Another write is awaiting the user's decision."`.
- `editor/sendFormat.ts` — `formatCanvasSendPayload(snap, format)`
  for all three formats. Format A's provenance line uses
  `~/path · <anchorPath joined ' > '>` instead of the markdown
  editor's heading trail (anchor IDs are the canonical addressing
  primitive on canvas). Reuses `formatC()` (opaque token) verbatim.
- `WorkingPane.tsx` — threads `onSendToDuo` to CanvasTab (was
  accepted-but-unused before).
- `shared/types.ts` — new `CANVAS_SELECTION_PUSH` IPC channel;
  `pushSelection` added to `ElectronCanvasAPI`.
- `electron/main.ts` — `canvasSelection` cache + ipcMain handler;
  `getCanvasSelection()` exported and passed to NavBridge.
- `electron/preload.ts` — `canvas.pushSelection(snapshot)` exposed.
- `electron/socket-server.ts` — `NavBridge.getCanvasSelection`
  added; selection switch accepts `--pane canvas` and the auto
  branch falls through browser → canvas → editor (canvas inserts
  between browser and editor).
- `cli/duo.ts` — `--pane canvas` validation + help text update.
  Binary rebuilt via `npm run build:cli` (29.4KB).
- `skill/SKILL.md`, `agents/duo.md`, `docs/CLI-COVERAGE.md` —
  cheat-sheet entries updated for the canvas branch + auto
  fallthrough order. `npm run sync:claude` applied so Claude Code
  picks up the new info on next skill / agent lookup.

**Visual smoke owed.** The Duo app wasn't running during this
session, so the V16–V22 walk is owed for a future session with the
app open. Per CLAUDE.md `npm run dev` rules, we couldn't actually
see the canvas paint or click the pill — the typecheck pass + CLI
rebuild + sync:claude prove the wiring compiles + the CLI surface
declares correctly, but the visual layer (just-added wash, pill
position, banner copy) needs eyes-on confirmation.

### Stage 17b (just shipped — code-side, smoke-verified)

PRD: [docs/prd/stage-17-html-canvas.md](docs/prd/stage-17-html-canvas.md).
Polish/parity card: [docs/roadmap.html#s17a-polish](docs/roadmap.html).

**Phase A — ULID + ID injection (PRD H12–H14):**
- `renderer/components/HtmlCanvas/ulid.ts` — 30-LOC Crockford
  base32 generator. 26 chars: 10-char timestamp + 16-char random.
- `idInjector.ts` — TreeWalker body walk; skips text nodes / `<br>`
  / `<hr>` / `data-duo-id="opt-out"`; existing duo-ids preserved;
  `id="…"` never touched. Per-directory choice persistence in
  localStorage (`duo.html.autoInjectIds.byDir`).
- `IdInjectionBanner.tsx` — first-open prompt with candidate count
  + "don't ask again for this folder" checkbox.

**Phase B — sidecar (PRD H22):**
- `sidecar.ts` — typed schema (`SidecarV1`, `SidecarComment`,
  `SidecarRecentEdit`); `version: 1`; `withRecentEdit` caps at 50.
  Read returns `null` on missing/malformed; write atomic via
  files-service.
- CanvasTab reads sidecar on mount; persists alongside `.html` on
  save when sidecar is dirty. Accept-injection appends an
  `inject-ids` recentEdit entry.

**Phase C — agent CLI ops (PRD H37, H38):**
- New `'html-op'` DuoCommandName. Single discriminated request shape
  (`HtmlOpRequest`) routes through one socket command; renderer's
  CanvasTab subscribes via `IPC.CANVAS_HTML_OP`, executes via
  `htmlOps.executeHtmlOp`, replies via `IPC.CANVAS_HTML_OP_RESULT`.
  30s timeout (DOM ops are sub-ms; timeout window only matters when
  no canvas is active).
- All seven verbs: `query / get / set / replace / append / remove /
  attr`. Targeting via `--id <duo-id>` or `--selector <css>`.
  Doc-rooted resolution (so `body` is addressable for append).
- Successful WRITE ops append a `recentEdits` entry with
  `author: 'claude'`, kind matching the op, and the affected
  element's `data-duo-id` when present.
- Smoke verified all seven verbs end-to-end against a fresh canvas.

**Phase D — pretty-printer (PRD H34):**
- `serialize.ts` — 2-space indent, stable attr order
  (id, class, data-duo-id, then alphabetical); inline-only block
  elements → single line; void elements self-close; raw-text
  elements (pre/code/style/textarea/script) preserved verbatim;
  HTML5 doctype emitted lowercase to match authoring convention.
- Runtime-chrome strip via `data-duo-canvas-runtime` sentinel.
  Tagged on body's runtime attrs (contenteditable, spellcheck),
  the body-outline runtime `<style>`, and the placeholder overlay.
  Saved files contain none of this — verified via `cat` after save.
- New `RenderedCanvas.onReady(doc)` callback fires after iframe
  srcdoc parsing completes. CanvasTab uses it to wire iframe-side
  hooks instead of an `[initialHtml]` effect — wiring against an
  empty pre-parse body would have the parser wipe injections.
  `wired` flag in RenderedCanvas makes wire() idempotent so the
  synchronous fallback + the load-event listener can both call it
  without double-firing onReady.
- CanvasTab re-baselines `lastSavedRef` against the pretty-printed
  live DOM after iframe load so canvases don't open dirty against
  the canonical serialized form.

### 17a polish & parity items 1-7 (shipped earlier same day)

Recap (full detail in card `docs/roadmap.html#s17a-polish`):
- **Item 2:** `+` tab-strip → file interstitial; ⌥-click → browser
  tab with address-bar focus.
- **Item 3:** literal `EditorToolbar` reuse via `EditorActions`
  interface (presentational toolbar + `tiptapEditorActions.ts` for
  MD + `canvasEditorActions.ts` for canvas). PRD H28's divergent
  slash-menu approach kept as additive (17e), not a replacement.
- **Item 4:** canvas `blockOps.ts` (execCommand-backed where it
  makes sense; task lists / blockquote / code blocks hand-rolled).
- **Item 5:** native execCommand undo/redo (no custom snapshot
  stack — PRD §8 was scoped to marks, not blocks).
- **Item 6:** canvas `tableOps.ts` (hand-rolled add/del row+col,
  toggle header, delete table, can-X queries).
- **Item 1:** `markdownShortcuts.ts` — typing-time `# / ## / - /
  1. / > / **bold** / _italic_ / --- / \`\`\`` conversions; skips
  inside `<code>/<pre>/<a>` literal contexts.
- **Item 7:** `placeholder.ts` smart-blank overlay foundation
  (upgraded by 17a.5 D below).
- `CanvasToolbar.tsx` deleted (no longer needed).

### 17a.5 Direction D (just shipped — visual smoke owed)

`placeholder.ts` upgraded to a four-door card overlay:
- **[type]** Markdown shortcuts work as you type (active door)
- **[soon]** Component blocks via `/` (slash menu ships in 17e)
- **[soon]** Start from a template (gallery ships in 17a.5
  follow-up; owner needs to commit to direction A/E first)
- **[soon]** Ask the agent to draft this (UI ships in 17f; today
  via `duo html new` + `duo html replace` from a Duo terminal)

Dismisses on first user keystroke OR programmatic real-content
mutation. Marked `data-duo-canvas-runtime` so it never leaks to
disk (verified via `cat` post-save). Visual probe at ship-time
was inconclusive (`duo html query '#duo-canvas-placeholder'`
returned 0 hits) but predates the wire-idempotency fix in
RenderedCanvas — V11/V12 in the verification list capture this.

### Important known limitations / follow-ups

- **V1–V15 verification owed.** A future session should walk
  `docs/roadmap.html#s17a-polish § In-depth verification owed`.
- **17a.5 directions A/E (templates) still open.** Owner needs to
  decide before any code work on a template gallery / registry.
- **BUG-006 (canvas Send → Duo pill occlusion)** doesn't apply on
  the canvas surface (canvas is renderer DOM, not WebContentsView)
  — Stage 17c will reuse the existing primitive cleanly.
- **Pretty-printer "preserve untouched markup" caveat (PRD H34).**
  We re-format the whole tree on every save. First-save diffs
  against a hand-authored .html include whitespace + attr-order
  changes; second save and onward produce stable diffs. Documented
  in `serialize.ts` header.
- **A separate agent is working Stage 19** per the user's note.
  Stage 19's consent sheet folds into Stage 18, so don't pull
  Stage 18 without checking with the other agent's status.

### Stage 17a (just shipped — code-side)

PRD: [docs/prd/stage-17-html-canvas.md § 7 — 17a](docs/prd/stage-17-html-canvas.md).

What landed:
- New `html-canvas` tab type registered in `WorkingPane.tsx`
  (dispatch case mounts `<CanvasTab>`). `shared/types.ts` adds
  `'html-canvas'` to `WorkingTabType` and `'html-new'` to
  `DuoCommandName`.
- New `renderer/components/HtmlCanvas/` package:
  - `RenderedCanvas.tsx` — iframe-srcdoc host. `contentEditable`
    on body + `MutationObserver` on the document. Sandbox attrs
    `allow-same-origin allow-popups allow-forms` only — never
    `allow-scripts` in 17a (PRD H4/H8). Exposes
    `getDocument()` + `serialize()` via `useImperativeHandle`.
    Re-injects on iframe `load` so HMR / re-mounts wire cleanly.
  - `CanvasToolbar.tsx` — Stage 11 visual (top-anchored,
    surface-1 strip, Save button on the right). Buttons:
    bold/italic/underline/strike/inline-code + link picker.
    `onMouseDown` (not click) on the buttons so the iframe
    selection isn't blurred before the action runs.
  - `CanvasTab.tsx` — owns load/save/dirty/autosave state.
    Mirrors `MarkdownEditor.tsx` shape: read on path change,
    diff against `lastSavedRef` for dirty, 800ms autosave
    debounce, ⌘S window listener with host-contains check,
    flush-on-unmount.
  - `inlineMarks.ts` — own selection-aware mark applicator
    (PRD §8 non-negotiable: no `document.execCommand`). Wraps
    via `range.surroundContents`; falls back to
    `extractContents → wrap → insertNode` when the range
    crosses elements; ancestor-toggle to unwrap when the full
    selection sits inside an existing tag.
  - `htmlBoilerplate.ts` — re-exports `shared/html-boilerplate.ts`
    so renderer call sites keep their existing import.
- `shared/html-boilerplate.ts` — H17 minimal v1: `<!doctype>` +
  `<html lang="en">` + `<head>` (charset, title) + `<body>` (h1
  + empty p). Used by both the ⌘N+`.html` commit path
  (renderer) and `duo html new` (main). Tailwind / semantic
  scaffold / locked regions deferred to 17b/d/e per PRD.
- `renderer/components/fileClassifier.ts` — `.html`/`.htm` →
  `{ type: 'html-canvas', mime: 'text/html' }`. Routes
  FileTree clicks + `duo edit/view <path.html>` automatically.
- **⌘N audible (PRD H6.1 dissolved):** `App.tsx §
  onCommitNewFile` now classifies the resolved path's
  extension and updates the tab's `type`/`mime` along with
  `path`/`title`/`isNew`. `.html` paths get a boilerplate
  seed via `htmlBoilerplate` + `encodeUtf8`. The
  `MarkdownEditor`'s `NewFileBar` shows a live suffix label
  (typed extension or `.md` default) so the user sees which
  surface their typed name will mount. `MarkdownEditor`'s
  `handleCommitName` keeps the existing "default `.md` if no
  ext typed" behavior — muscle memory unchanged.
- New CLI verb: `duo html new <path.html> [--title "…"]`. CLI
  side at `cli/duo.ts` validates the `.html`/`.htm` suffix and
  sends `'html-new'` over the socket. `electron/socket-server.ts`
  routes to `nav.htmlNew(path, title)`. `electron/main.ts §
  htmlNew` writes the boilerplate atomically via
  `filesService.write` and dispatches `IPC.NAV_EDIT` so the
  classifier + canvas mount land naturally. `--title` defaults
  to the basename without extension.
- Skill stub at `skill/examples/html-canvas-authoring.md` (H16:
  README only, no snippets yet — the snippet bundle is 17d
  scope). `skill/SKILL.md` verb table updated to mention the
  canvas + `duo html new`. `agents/duo.md` cheat-sheet entry
  added.
- ROADMAP / roadmap.html / Stage 17 PRD all updated. Roadmap
  HTML stage card flipped to `inprog` with 17a struck through;
  next-up tagline now points at 17b.

**17a deferrals — explicit in PRD § 7 + ROADMAP § 17a:**
- Pretty-printed save (H34) → 17b/e. Today: writes
  `<!doctype html>\n` + `documentElement.outerHTML\n` as-is.
  First-save diffs may show whitespace / attribute reordering
  vs the source file.
- Scripts (H8) → 17e. Inline `<script>` and event handlers
  preserved on disk but inert in the canvas.
- `data-duo-id` injection (H12–H15) → 17b. No agent write
  surface yet — `duo html query/get/set/replace/append/attr`
  ship in 17b.
- Send → Duo pill on the canvas (H27) → 17c. The primitive
  already supports the kind: 'html-canvas' branch via the
  `DuoSelection` union (Stage 13 Phase 0); 17c just adds the
  iframe-side selection observer.
- External-write reconciliation (H35) → 17e. No chokidar hook
  yet; external writes during an open buffer get overwritten
  by next save.

**Verification:** typecheck clean, CLI rebuilt, sync:claude
applied. Live walk pending — owner deferred to "after this
batch" (this turn's instruction). Smoke checklist § 7a (Duo
subagent) + Stage 13 + Stage 15 walks all owe a same-machine
end-to-end pass.

### Recommended next: Stage 17b (stable IDs + sidecar + agent write surface)

PRD: [docs/prd/stage-17-html-canvas.md § 7 — 17b](docs/prd/stage-17-html-canvas.md).

Why now: 17a unblocks 17b — the canvas exists, so an agent
can address elements once IDs are in place. 17b is the bigger
unlock per the Stage 17 thesis ("the bottleneck is the
human-edit story" — once Claude can edit specific elements by
ID, the whole agent/human collab loop on HTML lights up).
~2 PRs of work:

- ULID minting + auto-injection of `data-duo-id` on every
  editable body element on first open (H12, H13).
- First-open prompt for ID injection (H14).
- `<file>.duo.json` sidecar reader/writer; `version: 1`
  schema (H22).
- `duo html query / get / set / replace / append / remove /
  attr` end-to-end (H37). Each operates by `data-duo-id` (or
  CSS selector resolved server-side to the nearest
  `data-duo-id` ancestor).
- Pretty-printed serializer (H34) — pull this in here so
  `duo html set` doesn't blow up the diff every time.
- `data-duo-component` recognition (no UI yet — that's 17d).

Risk: `data-duo-id` collisions with existing `id` attributes on
legacy / generated HTML. PRD H12 calls `id` immutable +
additive-only; the H14 prompt is the v1 escape valve.

**Stage 17b is the right next ship**, but Stage 14 / 15.3 / 18
are all reasonable alternatives if something else is the
binding constraint when picking up.

### Stage 5 v2 (just shipped — code-side)

PRD: [docs/prd/stage-5-v2-duo-subagent.md](docs/prd/stage-5-v2-duo-subagent.md).

What landed:
- New `duo external <url>` CLI verb (A24). Wraps `shell.openExternal`;
  validates `http`/`https`/`mailto` schemes only — refuses `file://`
  and other dangerous schemes. Wired through `shared/types.ts`,
  `electron/socket-server.ts`, `electron/main.ts` (`openExternalUrl`),
  `cli/duo.ts`. Binary rebuilt.
- New global agent `agents/duo.md` (Haiku 4.5, ~254 LOC). **A20
  session guard is literally the first instruction** — agent runs
  `[ -n "$DUO_SESSION" ]` and refuses cleanly if unset. Full verb
  cheat-sheet, 5 patterns (read-rewrite-write, browser extract,
  multi-tab, file-tree, Send → Duo), failure protocol, A23–A25 web
  routing rules.
- `agents/duo-browser.md` deleted. `npm run sync:claude` actively
  removes the old `~/.claude/agents/duo-browser.md` so dev installs
  flip cleanly.
- `~/.claude/duo/external-domains.json` bootstrapped to
  `{"domains":[]}` by `sync:claude` (never overwrites populated).
- `skill/SKILL.md` rewrote the "Prefer delegating" section (now
  points at `duo`, with the `$DUO_SESSION` orchestrator-side check
  per A21) and added a "Web routing" section documenting the
  external-domains.json file.
- `docs/dev/smoke-checklist.md` § 7a (new) — Pre-flight + functional
  walks (F1, F2, F5, F8, F9) + recovery walks (C5/C6/C7 the
  load-bearing guards) + post-walk cleanup.
- README, FIRST-RUN, BUILD-PROCEDURES, CLAUDE.md plumbing checklist
  all updated to point at `agents/duo.md` (the "*pending*" qualifier
  on item 7 of the plumbing checklist is gone — agent file is now
  load-bearing).

**Live walks done in this session — Class A + Class C all PASS:**

CLI smoke (orchestrator-driven, direct calls):
- ✅ `duo external` end-to-end: success path opens macOS default
  browser; scheme guard rejects `file://` / `javascript:` / malformed
  URLs.
- ✅ **F1 read-rewrite-write** (`/tmp/agent-fixture.md`): editor
  mounted, `doc read` returned live buffer, `doc write --replace-all`
  landed on disk inside the autosave window.
- ✅ **F8 web routing (Duo path)**: empty `external-domains.json` →
  `duo open https://example.com` opened tab in Duo's browser pane
  (verified via `duo url` + `duo title` + `duo text --selector h1`).
- ✅ **F9 web routing (listed external)**: seeded
  `external-domains.json` with `example.com` → `duo external` opened
  in Safari; `duo tabs` showed Duo's tab list unchanged.

Agent walks (fresh `claude -p --agent duo` subprocesses, Haiku 4.5,
total cost ~$0.40):
- ✅ **C5 outside-Duo guard.** `env -u DUO_SESSION -u DUO_SOCKET claude
  -p --agent duo "..."` → agent ran `[ -n "$DUO_SESSION" ] && echo
  in_duo || echo not_in_duo`, saw `not_in_duo`, refused with the
  EXACT one-line message from the prompt. **2 turns, zero `duo` verb
  invocations, $0.006.** Permission-denial caveat noted below.
- ✅ **C6 malformed list.** Truncated JSON (`{"domains":[`) in the
  list file. Agent navigated via `duo open` (correct fallback); no
  crash. 4 turns, $0.027.
- ✅ **C7 listed-domain bypass.** Seeded list with `example.com`,
  asked agent to navigate. Stream-json call log:
  `duo external https://example.com/test-page` — NO `duo open`/`duo
  navigate` for the listed host. Duo's tab list unchanged
  before/after.
- ✅ **F2 browser extract.** Agent navigated example.com, returned
  H1 + correctly noted no list items present.
- ✅ **F4 file-tree.** Agent scanned `/tmp/test-dir/{a,b,c}.md`,
  correctly identified a + c as containing "risk" and b as not.
- ✅ **F5 send→duo round-trip.** Agent inserted text at the editor's
  caret position via `duo doc write --replace-selection`; file on
  disk reflected the change.

**C5 caveat — narrow Bash allowlist can mask the guard.** When the
agent was given `--allowedTools "Bash(duo *) Bash(echo *)"` (narrow
patterns that don't match the compound `[ … ] && echo … || echo …`
guard command), the guard check was permission-denied, the agent
proceeded to call `duo doc read`, and the refusal didn't fire. With
permissive `--allowedTools "Bash"` the guard works correctly. This
is a corner case for users who hand-write tight Bash allowlists; the
agent's prompt could be hardened to refuse-on-check-denied. Filed in
`tasks.md` as FOLLOWUP-002.

**Class B perf — finding inverts the PRD hypothesis.** Synthetic F1
on a fresh `claude -p --model sonnet`, comparing inline (Sonnet calls
`duo` directly) vs subagent (Sonnet delegates via Task to the duo
subagent):

|  | inline (A) | subagent (B) |
|---|---|---|
| Total cost | $0.08 | $0.17 |
| Wall-clock | 36s | 65s |
| Sonnet tokens | 6 in / 398 out | 6 in / 348 out |
| Haiku tokens | 1593 out | 2285 out |

Both paths show tiny Sonnet usage because **Claude Code already
routes mechanical tool work to Haiku regardless of `--model`**. The
subagent path stacks a SECOND Haiku context (the agent's own) on top
of Claude Code's fast-tier Haiku, doubling the Haiku-side cost.

The PRD's "~85% orchestrator-token reduction" was framed against a
mental model where the top-level Sonnet processes CLI dumps directly.
That isn't how Claude Code actually distributes tokens across model
tiers, so the synthetic measurement doesn't show the predicted win.

**The agent's value is real but different from the PRD framing:**
1. **Bounded context per task** — the subagent's window is
   independent, so a long session with many duo tasks doesn't bloat
   the main conversation's prefix cache.
2. **Specialized prompt** — the agent knows the verbs, the routing
   rule, the failure modes. The orchestrator doesn't need to be
   primed with `~/.claude/skills/duo/SKILL.md` content for every
   task.
3. **Clear contract** — orchestrator drafts content, agent applies.
   Failure modes are predictable.

These are ergonomic / scale-with-session-length wins, not per-task
dollar wins on a cold-cache synthetic. **A proper measurement would
track cumulative orchestrator-context tokens across a multi-task
session**, not single-task fresh-cache costs. Filed as FOLLOWUP-003.

The smoke checklist (`docs/dev/smoke-checklist.md § 7a`) carries the
agent walks for ongoing regression coverage.

**Critical contracts** (see PRD A20–A26 for detail):
- **Session guard (A20):** agent is global-installed, so every Claude
  Code session on the user's machine sees it — including non-Duo
  terminals. Without the `$DUO_SESSION` check, an outside-Duo
  orchestrator would route Duo-flavored work to the agent and waste
  turns hitting `Cannot connect: Duo app is not running`. Guard IS
  the first action in the prompt. Stage 19a Phase 19a exports
  `DUO_SESSION=1` per Duo PTY (`electron/pty-manager.ts:33`).
- **Web routing (A23–A26):** every URL goes through Duo by default;
  hostnames in `~/.claude/duo/external-domains.json` route to system
  default browser via `duo external <url>`. List ships empty;
  user-curated for sites that don't render well in `WebContentsView`
  (claude.ai, chatgpt.com, banking sites, etc.).
- **Content authority (A8):** orchestrator drafts content; agent
  applies. Keeps Haiku in its lane; makes failures predictable.
- **Failure mode (A10):** hard-fail-and-surface. Agent never
  improvises on unexpected output shapes; orchestrator decides
  recovery.

### Stage 15.2 (just shipped — code-side, data-plane verified live)

PRD: [docs/prd/stage-15-send-to-duo.md § 6.2](docs/prd/stage-15-send-to-duo.md).

What landed:
- **CDP page-side selection observer.** `SELECTION_OBSERVER_IIFE` in
  `electron/cdp-bridge.ts` — ~80 LOC, debounced, listens for
  `selectionchange`/`scroll`/`resize`, serializes to
  `BrowserSelectionSnapshot` + page-relative rect, posts via
  `window.duoSelectionPush(json)`. Re-injection guarded by
  `__duoSelectionObserver`. Re-injected on `Page.frameNavigated`
  for top-frame navigation.
- **`Runtime.addBinding('duoSelectionPush')`** registered in CDP
  attach. `Runtime.bindingCalled` events parsed in `handleCdpEvent`
  → cached as `latestBrowserSelection` → emitted to a single
  `browserSelectionListener` callback.
- **Cache reset on tab switch.** `attach()` emits a `null` push so
  the renderer's pill goes away while the new tab's observer
  reports.
- **`BrowserManager.constructor` wires the listener** to forward
  pushes via `mainWindow.webContents.send(IPC.BROWSER_SELECTION,
  push)`. New IPC channel `BROWSER_SELECTION` (main → renderer).
  New types: `BrowserSelectionRect`, `BrowserSelectionPush`.
- **`renderer/hooks/useBrowserSelection.ts`** — small hook
  subscribing to the IPC.
- **`BrowserRenderer` pill mount.** Reads `useBrowserSelection`,
  reads page title from `BrowserState`, reads format from
  `useSelectionFormat`, translates page rect → screen rect using
  `contentRef.getBoundingClientRect()`. Click handler calls
  `formatBrowserSendPayload` (new variant in `sendFormat.ts`).
- **`<SendToDuoPill>` rect type loosened** from `DOMRect` to a
  minimal `PillAnchorRect = { top, bottom, right }` so the browser
  surface can synthesize a translated rect rather than fabricating
  a DOMRect (DOMRect isn't constructable in renderer code).
- **`onSendToDuo` threaded** through `WorkingPane` to
  `BrowserRenderer` so the same `pty.write(activeTabId, payload)`
  callback serves both surfaces.

**Live verification (data plane):**
- `duo eval "({ hasBinding: typeof window.duoSelectionPush === 'function', hasObserverGuard: !!window.__duoSelectionObserver })"`
  → `{hasBinding: true, hasObserverGuard: true}` on a fresh
  example.com tab.
- Programmatically selecting the H1 fires the observer; the wrapped
  binding sees the call and the captured payload contains both
  `snapshot` and `rect: {x, y, width, height}`.
- On-demand `duo selection --pane browser` keeps working
  (independent path through `getBrowserSelection()` — the CLI does
  not depend on the binding cache).

**Visual pill rendering** (the actual purple chip floating over the
selected H1) is the only piece not yet eyes-on-verified — gated on
FOLLOWUP-004's computer-use access. The data plane proves the
pipeline is correct; rendering is a CSS / portal-positioning
question that the editor variant already validates.

### Stage 17a → 17b transition (full detail in the breadcrumb above)

Stage 17a shipped 2026-04-26 night. The "what landed" + "deferrals"
+ "recommended next" detail lives in the breadcrumb section at the
top of this file ("Pick up here next session"). Keeping it in one
place avoids drift.

### Stage 15.1 (just shipped)

PRD: [docs/prd/stage-15-send-to-duo.md § 6.1](docs/prd/stage-15-send-to-duo.md).

CLI half (smoke-tested live):
- `duo selection-format [a|b|c]` (G19) — agent-tunable runtime knob,
  persisted in renderer localStorage. Default `a` (quote + provenance);
  `b` = literal; `c` = opaque token. Mirrors `duo theme` plumbing
  (renderer source of truth, main caches for CLI reads). New IPC:
  `SELECTION_FORMAT_STATE_PUSH` / `SELECTION_FORMAT_SET`.
- `duo send [--text "…"]` (G17) — writes payload into active terminal's
  PTY. No Enter (G11). Renderer pushes active tab id via
  `TERMINAL_ACTIVE_PUSH` so main knows where to write. Returns
  `{ok, written, terminalId}`.

UI half (HMR-applied, typecheck clean, visual walk deferred):
- `renderer/components/editor/sendFormat.ts` — pure formatter for
  modes a/b/c. Per-line `> ` prefix on multi-line selections; `~/`
  shortening on paths inside `$HOME`.
- `renderer/components/editor/primitives/SendToDuoPill.tsx` — visual
  primitive (no editor imports per the Stage 13 contract). Portals to
  `document.body`, anchors 6px above selection (falls back below when
  no room), right-aligns and clamps to viewport. `onMouseDown` (not
  click) so the editor doesn't blur first.
- `renderer/hooks/useSelectionFormat.ts` — localStorage round-trip
  + main pushState + CLI-driven `onSet` listener.
- `MarkdownEditor.tsx`: tracks `pillRect` in the same effect that
  pushes `EDITOR_SELECTION_PUSH`; hides on blur or collapsed
  selection; repositions on scroll/resize. Click handler reads
  `lastSelectionRef`, formats via `useSelectionFormat`, calls
  `onSendToDuo` prop.
- `WorkingPane.tsx` + `App.tsx`: `onSendToDuo` callback in App.tsx
  calls `pty.write(activeTabId, payload)` then sets `focusedColumn =
  'terminal'`. `null` propagates when no terminal exists, hiding the
  pill entirely.
- `globals.css` — `.duo-send-pill` style: small purple chip on
  `--duo-accent`, 11px text, layered drop-shadow, hover lift, 120ms
  fade-in keyframe.

### Stage 13 (just shipped)

Phase 0 + 13a + 13b end-to-end. The two visual primitives
(`duo-just-added` keyframe, `<WriteWarningBanner>`) live under
`renderer/components/editor/primitives/` with zero TipTap imports —
contract enforced via the `primitives/README.md`. MD bindings live
in `extensions/`. Stage 14 (track changes) and Stage 17 (HTML canvas)
will reuse the same primitives directory; Stage 17 v2 just writes a
canvas-side binding.

Notable runtime fix: `--duo-mark` token bumped `#F8E59C` → `#F0CB6A`
because the prototype's value was visually imperceptible against
cream paper. DOM inspection confirmed the wash was painting; it was
contrast, not wiring. Doc-write timeouts also bumped 5s → 5min on
both renderer (`dispatchDocWrite`) and CLI (`PER_CMD_TIMEOUT_MS`)
sides for the human-in-the-loop banner-decision window.

### Owner pre-work (cert procurement)

Can run in parallel — see ROADMAP § Owner pre-work. 1–2 business
days enrollment lead time, longer for cert provisioning. Kick off now
to shave weeks off Stage 21.

### Open process work
