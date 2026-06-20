# Duo smoke checklist

> **Who runs this:** the Claude instance working on Duo, **before** calling
> any renderer / main / preload / CSS / menu change "done".
>
> **Why:** Stage 9 and the breadcrumb regression both typechecked and built
> cleanly, but broke the app on mount. A two-minute preview pass catches
> those. See the "verify UI before declaring done" rule in
> [CLAUDE.md](../../CLAUDE.md).
>
> **How:** launch / confirm `npm run dev` is running, bring Electron forward
> (`mcp__computer-use__request_access` → `mcp__computer-use__open_application`
> → `mcp__computer-use__switch_display` if needed), and walk the sections
> below in order. Capture a screenshot after each *section* (not each step).
>
> **What to report:** in the end-of-task summary, state "saw in the live
> app: …" with one-line per section (pass / fail / didn't exercise). If
> anything fails, fix or surface before declaring done.

---

## 0. Prep

- [ ] `tail -1 /private/tmp/claude-501/**/tasks/<hash>.output` to confirm
      a fresh `npm run dev` started. After main or preload changes, kill
      any running Electron + restart — HMR covers the renderer only.
- [ ] `npm run typecheck` is clean.

## 1. App boot (catches: mount crashes, preload mismatches, build hang)

- [ ] Electron window appears.
- [ ] Window chrome: traffic lights visible in top-left, the ~40px
      titlebar row accepts drag-to-move (click-and-drag in that row
      should move the window — issue #17 regression check).
- [ ] React tree renders: you see three columns (files / terminal /
      working pane). A blank window means something threw during mount.

## 2. Terminal pane (catches: PTY wiring, xterm fit, tab scoping)

- [ ] Focus the terminal (click into it). A shell prompt appears.
- [ ] Type a short command (`echo hello`). It echoes.
- [ ] `⌘⇧T` opens a new terminal tab.
- [ ] Tab bar shows both tabs; clicking each switches scrollback.
- [ ] Close via `⌘W` while focused on the terminal column — the other
      tab remains.

## 3. Files pane (catches: breadcrumb follow-mode, nav regressions)

- [ ] Left column shows a tree rooted at home (or the last persisted cwd).
- [ ] **Breadcrumb click navigates.** Click a parent segment
      (e.g. `~ / Documents / Claude` → click `Documents`). The tree
      re-roots at the clicked path. This failed silently in the
      follow-mode regression — tree must actually update, not just
      highlight the button.
- [ ] Click a folder row: it expands; its children appear.
- [ ] Click a `.md` or `.png` file: the working pane gets a new file
      tab and renders content.
- [ ] `⌘B` toggles the files column between expanded and collapsed rail.

## 3a. Worktree lifecycle (ENH-221 — create + removal recovery, v0.11.2)

- [ ] **Worktree pill opens on ANY repo.** In a git repo (even a lone
      single-checkout one), click the worktree pill under the breadcrumb:
      the dropdown opens and shows the current checkout row + a
      **"+ New worktree"** row. (Regression: a lone repo used to show an
      empty "Switch worktree · 0".)
- [ ] **Create a worktree.** Click "+ New worktree", type a name with
      spaces/punctuation (e.g. `Q3 Pricing: Copy & v2!`) → the
      `creates claude/…` preview sanitizes live to a safe slug
      (`q3-pricing-copy-v2`). Press Enter (or Create): the navigator
      re-roots into the new worktree, and — Claude toggle on (default) — a
      `claude` terminal opens at it. The ⚄ "Name it for me" fills an auto
      codename; leaving the field blank also auto-names.
- [ ] **Removal under-foot recovers.** With the nav rooted in a worktree,
      remove it from outside (`git worktree remove --force <path>` in a
      terminal, or have the agent merge+remove). Within ~1–2s the nav
      reverts to the **main** checkout (NOT the `.claude/worktrees/`
      parent), a dismissible **"Worktree X was removed — you're back on
      main"** banner shows, and the app does NOT blank / show a red error
      screen. The ✕ dismisses; any navigate also clears it.
- [ ] **CLI parity.** `duo worktree new "<desc>"` creates + prints
      `{ path, branch, slug }`; `duo worktree remove <path>` removes — both
      run git directly with no running app (sandbox-tolerant).

## 4. Working pane (catches: browser bounds, tab strip, type routing)

- [ ] About:blank browser tab is visible with working address bar.
- [ ] Navigate somewhere real: `⌘L` → type `https://example.com` →
      Return. Page loads and the white content fills the pane horizontally
      (no black vertical strip on the left — known issue, flag if seen).
- [ ] `⌘T` (while browser has focus) opens a second browser tab.
- [ ] Opening a file from the files pane into a file tab, then clicking
      the browser tab, round-trips cleanly — no stale canvas, no stuck
      browser view hiding the file tab.

## 5. Keyboard shortcuts (catches: browser-focus forwarding, chord typos, focus-routing regressions)

**Hard rule:** every Duo shortcut MUST be exercised from **all five
focus surfaces** the user can be on:

1. **Terminal** (xterm.js textarea — eats some keys via xterm's
   default key handler unless `attachCustomKeyEventHandler` consults
   `matchGlobalShortcut` and returns false; see BUG-001 for the
   ⌃Tab gotcha)
2. **Browser** (WebContentsView — Chromium eats keys unless
   `BrowserManager.wireKeyForwarding` allowlists them; clicks into
   the page don't bubble to the column wrapper, so renderer's
   `focusedColumn` can stay stuck on the previous value — see
   BUG-001 fix part 3)
3. **Editor** (TipTap contenteditable — TipTap's
   `editorProps.handleKeyDown` consults the matcher and returns
   `true` for global hits so ProseMirror skips its local keymap;
   editor-local marks like `⌘B`/`⌘I`/`⌘U`/`⌘K` still fire because
   the matcher yields when `inEditableSurface=true`)
4. **Canvas** (iframe + contentEditable — the iframe doc has its
   own listeners; `installGlobalShortcutForwarder` resyntehsizes
   matched keystrokes on the parent doc so the capture listener
   sees them; canvas-local ⌘B/⌘I/⌘U/⌘K/⌘S still fire because the
   matcher yields when `inEditableSurface=true`. Added 2026-04-26
   after BUG-012/013/014 — the chronic regression family that
   forced the preventative architecture.)
5. **Files** (tree pane, no editable element but still focusable)

**Why we walk this every time:** since 2026-04-19, Duo has shipped
five keyboard regressions because changes touched one surface and
the matrix wasn't walked across the others (BUG-001 ⌃Tab cross-pane,
BUG-002 ⌘T address-bar focus, BUG-004 ⌘` doesn't move OS focus,
⌘T-pane-aware churn, plus BUG-012/013/014 — canvas iframe + TipTap
swallowing global shortcuts). The 2026-04-26 architectural fix
inverts the default: every surface now consults a single matcher
(`renderer/keyboard/globalShortcuts.ts`) so adding a shortcut gives
all surfaces coverage automatically. This matrix is the SECOND line
of defense — the architecture is the first. Walk it anyway.

**Three classes of failure to look for, not just "did the shortcut
fire":**

a. **Did it fire at all?** (allowlist gaps, `inEditable` guards,
   xterm/Chromium key-eating). Tick the surface column.
b. **Did focus land on the right element?** (BUG-002 / BUG-004
   class). Most shortcuts that change pane state should also move
   keyboard focus to the destination — type a single character
   immediately after to confirm.
c. **Did the visual focus indicator update?** (BUG-003 class).
   The accent border on the focused column must be perceptible in
   both light and dark themes.

### 5.1 Pre-flight

- [ ] Identify which file(s) changed. If any of these touched, walk
      the FULL matrix (every shortcut × every surface):
      - `renderer/keyboard/globalShortcuts.ts` (the registry — touch
        here automatically affects every surface)
      - `renderer/keyboard/iframeForwarder.ts` (canvas escape path)
      - `renderer/hooks/useKeyboardShortcuts.ts`
      - `renderer/components/TerminalPane.tsx` (xterm key handler —
        consults `matchGlobalShortcut`)
      - `renderer/components/Page/RenderedPage.tsx`
        (installs the iframe forwarder)
      - `renderer/components/editor/MarkdownEditor.tsx`
        (`editorProps.handleKeyDown` consults the matcher)
      - `electron/browser-manager.ts` (`wireKeyForwarding` allowlist)
      - `electron/main.ts` (menu accelerator registration)
      - `renderer/App.tsx` (`togglePaneFocus`, `newBrowserTab`,
        `newMarkdownFile`, focus-related callbacks)
      - `electron/preload.ts` (`keyboard` surface)
      Otherwise, walk only the rows touched + the rows for any
      surface whose focus path changed.

### 5.2 Shortcut × focus-surface matrix

Fire each shortcut from every surface in order (T = terminal,
B = browser, E = editor, **C = canvas (HTML)**, F = files). For
each cell, verify ALL of:

- The **action fires** (new tab, focus moves, etc.)
- **Focus lands on the right element** (test by typing one
  character — does it go where expected? URL bar? Filename input?
  PTY? Editor prose? Canvas body?)
- **No collateral damage** to the other panes (focused column
  border updates correctly; previously-focused element loses focus)

| # | Shortcut | T | B | E | C | F | Expected outcome |
|---|---|---|---|---|---|---|---|
| 1a | `⌘T` from B/E/C/F | n/a | ☐ | ☐ | ☐ | ☐ | New foreground browser tab AND address-bar input has DOM focus + URL is selected. **Type one letter immediately** — it should land in the address bar, not in the new tab's page or in the previously focused surface (BUG-002, BUG-013 regression check). |
| 1b | `⌘T` from T (Stage 19c D18) | ☐ | n/a | n/a | n/a | n/a | New **claude tab** in the terminal column (NOT a browser tab). Title prefix `claude · <basename>`; PTY shows `claude` typed and the TUI taking over. If `claude` is not on PATH, a one-line install banner prints instead (D23). The split-button `+` does the same thing. |
| 2 | `⌘⇧T` | ☐ | ☐ | ☐ | ☐ | ☐ | New **vanilla shell** terminal tab regardless of focus (Stage 19c D19); PTY accepts typing immediately (xterm focused). The split-button `>` half does the same thing. |
| 3 | `⌘N` | ☐ | ☐ | ☐ | ☐ | ☐ | New `editor` tab; filename input focused. Type a name → `Enter` → focus moves to prose, next keystroke lands in prose (D33f). **Canvas check (BUG-012):** in canvas focus, ⌘N must NOT type 'n' into the canvas body. |
| 4 | `⌘L` | ☐ | ☐ | ☐ | ☐ | ☐ | Address-bar input focused + URL selected; type replaces URL. |
| 5 | `⌘W` | ☐ | ☐ | ☐ | ☐ | ☐ | Closes active tab in the **focused column** (terminal column → terminal tab; working column → browser tab, editor tab, or canvas tab depending on active slot). Last terminal tab + last browser tab can't close. Pinned tabs gate behind a confirm modal (Stage 24). |
| 6 | `⌘B` | ☐ | ☐ | n/a | n/a | ☐ | Toggles Files column. **Skipped in editor + canvas on purpose** (both claim `⌘B` for bold via the matcher's `inEditableSurface` check). When collapsed, rail-icon click still expands. |
| 7 | `` ⌘` `` | ☐ | ☐ | ☐ | ☐ | ☐ | Cycles focus between terminal and working pane. **OS-level focus must move too**: after the cycle, type a single character — it goes to xterm OR the browser/editor/canvas depending on direction (BUG-004 regression check). The focused-column accent border updates. macOS: registered as a menu accelerator so the system shortcut doesn't intercept it. |
| 8 | `⌘1` / `⌘2` | ☐ | ☐ | ☐ | ☐ | ☐ | Jumps to terminal tab N. |
| 9 | `⌘⇧1` / `⌘⇧2` | ☐ | ☐ | ☐ | ☐ | ☐ | Jumps to working-pane tab N (browser, editor, or canvas — all share the strip). |
| 10 | `⌘+` / `⌘-` / `⌘0` | ☐ | n/a | n/a | n/a | ☐ | Adjust terminal font bump (browser/editor/canvas own native zoom). |
| 11 | `⌃Tab` / `⌃⇧Tab` | ☐ | ☐ | ☐ | ☐ | ☐ | **Pane-aware**: from terminal focus → cycles terminal tabs; from working-column surfaces (B/E/C) → cycles working-pane tabs across all types (BUG-001, BUG-014 regression check). xterm's `attachCustomKeyEventHandler` and the canvas iframe forwarder must yield to the matcher; browser-key-forward path must pass `paneOverride='working'`. |
| 11b | **Full-cycle coverage (BUG-038)** | ☐ | ☐ | n/a | n/a | n/a | Open ≥4 terminal tabs (mix shell+claude). Click last tab. Press `⌃Tab` 4 times — cursor must visit EVERY tab in display order, no skips. Repeat after a session restore (Quit → relaunch). Repeat with browser tabs (open ≥4, press `⌃Tab` 4 times, all visited). Pinned WorkingPane tabs included in cycle. |
| 11c | **Cross-pane focus tracking (BUG-038)** | ☐ | ☐ | ☐ | ☐ | ☐ | Click into terminal → ⌃Tab cycles terminals. Click into HTML canvas → ⌃Tab cycles working-pane tabs. Click back into terminal → ⌃Tab cycles terminals again. The xterm-focus listener (BUG-038) and canvas-mousedown forwarder (BUG-037) must keep `focusedColumn` in sync with where the user actually is. |
| 13 | `⌘⇧G` (Go to folder) | ☐ | ☐ | ☐ | ☐ | ☐ | Stage 26 PR 3 item 8 — flips the navigator breadcrumb into an editable input + focuses the files column. Type `~/Documents` → ↵ navigates. Type a file path → navigates to parent + opens file. Type a non-existent path → inline error, input stays. ⎋ cancels. Click the breadcrumb's empty area also flips into edit mode. |
| 14 | `⌘F` find-in-document (ENH-023) | n/a | n/a | ☐ | n/a | n/a | Open a long markdown file (e.g. `tasks.md`), press ⌘F → find bar drops below toolbar with focused input. Type a query → matches highlight inline (yellow), current match accent-orange + bold; counter shows `N/M`. ⌘G / ↵ next, ⌘⇧F / ⇧↵ prev. Aa toggle flips case sensitivity. ⎋ closes the bar. Bar stays inert when no markdown editor is open. |
| 15 | `⌘⇧G` find-prev does NOT fire when find bar is OPEN (ENH-023) | n/a | n/a | ☐ | n/a | n/a | With the find bar open + a query typed, press ⌘⇧G → should still trigger "Go to folder" (focus jumps to the breadcrumb). The find-bar uses ⌘⇧F for previous-match, NOT ⌘⇧G — confirms the chord disambiguation lands as designed. |
| 12 | `⌘⇧[` / `⌘⇧]` | ☐ | ☐ | ☐ | ☐ | ☐ | Previous / next terminal tab (always terminal-scope). |

**If any cell fails, do NOT call the change done.** Trace through:
1. Does `matchGlobalShortcut` in `renderer/keyboard/globalShortcuts.ts`
   recognize the key combo? Add a temporary `console.log` after the
   `match` lookup in the surface that's failing — if `match` is null,
   the registry needs the row.
2. Does the surface's escape mechanism consult the matcher?
   - **Terminal:** `term.attachCustomKeyEventHandler` in `TerminalPane.tsx`
     should return `false` when the matcher claims the key.
   - **Browser:** `BrowserManager.wireKeyForwarding` in
     `electron/browser-manager.ts` must include the key in its allowlist
     so it can be forwarded via IPC; the renderer's
     `keyboard.onBrowserKey` callback then routes through the matcher.
   - **Editor:** `editorProps.handleKeyDown` in `MarkdownEditor.tsx`
     must call the matcher and return `true` when it matches.
   - **Page:** `installGlobalShortcutForwarder` in
     `RenderedPage.tsx` must be installed unconditionally on the
     iframe doc; check the `cleanForwarder` ref isn't null.
3. Does `useKeyboardShortcuts.ts` see the keydown? (Add a `console.log`
   in the document capture handler to confirm.)
4. If editor or canvas eats a *local* shortcut (⌘B for bold) that
   should NOT escape: confirm `inEditableSurface=true` is being passed
   to the matcher when called from that surface — if false, the
   matcher will claim ⌘B globally and the local handler never fires.

### 5.3 Theme dimension

Run this sub-section in **both Light and Dark** themes (toggle via
the theme button in the top-right). Most shortcut behavior is
theme-agnostic, but visual feedback can regress unnoticed:

- [ ] **Focused-column accent border** is clearly visible (BUG-003
      regression check). Click into Files, then Terminal, then
      Working — each transition should be unambiguous at a glance.
      "Subtle" is not enough; if you have to squint, file a bug.
- [ ] **xterm cursor color** matches the theme (Atelier ochre on
      dark, ochre on light's inky terminal background).
- [ ] **Address-bar focus ring** visible (`focus:border-accent/50`).
- [ ] **Files column collapsed-rail icon** visible at rest and on
      hover.

### 5.4 Pane-toggle focus contract (BUG-004 specifically)

Walk this sequence verbatim — it's the regression that was missed
during Stage 12:

1. Click into the browser pane. Type a letter into the URL bar to
   confirm browser has keyboard focus.
2. Press `` ⌘` `` to cycle to terminal. Without clicking, type
   `echo hi` + Enter. **The PTY must receive the keystrokes.**
3. Press `` ⌘` `` to cycle back to working. Without clicking, press
   `↓` (or whatever scrolls the active page). **The browser must
   scroll.**
4. Open an editor tab (e.g., `⌘N` from any surface, commit a name).
   With the editor tab visible: click into terminal, then `` ⌘` `` to
   cycle into working. Type a letter — it should land in the editor
   prose, not be lost.

If any step fails to type/scroll without an intermediate click,
`togglePaneFocus` in `renderer/App.tsx` is not moving DOM/Chromium
focus correctly. The fix lives in the `queueMicrotask` block — it
must call `xterm.focus()`, `window.electron.browser.focusActive()`,
or the editor's `focus()` API depending on the destination.

## 6. Cozy mode (catches: xterm option plumbing, TUI-safety)

- [ ] View → "Cozy mode — current tab" toggles on. Typography
      shifts: font size grows (13→15), line height loosens, outer-pane
      padding appears. Reader-width cap centers text on wide windows.
- [ ] Claude Code TUI (if running in the terminal) re-layouts without
      dropping content mid-stream. Box-drawing characters in tables
      align cleanly.
- [ ] Toggle back off. Layout returns to default cleanly — no stale
      padding, no canvas artifacts.
- [ ] Menu checkmark tracks the *active* tab — switching tabs updates
      the checkmark to match that tab's cozy state.

## 7. Agent bridge (catches: CLI socket regressions)

Run from a terminal **inside** Duo:

- [ ] `duo url` returns the current browser URL.
- [ ] `duo open https://example.com` navigates the active browser tab.
- [ ] `duo view <some .md path>` opens it as a file tab in the
      working pane.
- [ ] `duo edit <some .md path>` opens it in the rich editor (Stage 11).
- [ ] `duo selection` with cursor in the editor returns
      `{path, text, paragraph, heading_trail, start, end}`.
- [ ] `echo "x" | duo doc write --replace-selection` inserts at caret.
- [ ] `duo doc write --replace-all --text "..."` swaps body, frontmatter
      preserved.
- [ ] `duo nav state` returns JSON with `cwd`, `selected`, `pinned`.
- [ ] `duo reveal <path>` jumps the files pane and surfaces the
      "Claude moved to …" chip at the top of the navigator.
- [ ] `duo external https://example.com` opens example.com in the macOS
      default browser (Safari/Chrome) — NOT Duo's embedded view. The
      verb is for sites listed in `~/.claude/duo/external-domains.json`;
      the agent owns routing decisions, but the verb itself should
      always work.
- [ ] `duo external file:///etc/passwd` is refused with a "Refusing to
      open scheme" error — only http/https/mailto are allowed.

## 7a. `duo` subagent (Stage 5 v2 — catches: agent install, session guard, web routing)

Run only when the change touches `agents/duo.md`, `skill/SKILL.md`,
`npm run sync:claude`, the `external-domains.json` install bootstrap,
or anything in the orchestrator-side delegation contract. Requires a
fresh Claude Code session inside a Duo terminal (so `DUO_SESSION` is
set and the orchestrator picks up the latest `~/.claude/agents/duo.md`).

**Pre-flight**

- [ ] `npm run sync:claude` succeeded; `~/.claude/agents/duo.md` exists
      and `~/.claude/agents/duo-browser.md` is gone.
- [ ] `~/.claude/duo/external-domains.json` exists with `{"domains":[]}`
      (or your curated list — whichever is current).

**Functional walks** (Class A from PRD § 6 — pick at least F1 and F5
each release; walk all 10 on changes to the agent prompt or web routing)

- [ ] **F1 read-rewrite-write.** From a fresh CC session in a Duo terminal:
      *"Open `/tmp/agent-fixture.md` (create if missing), read it, then
      replace the second paragraph with: `Updated paragraph.`"* — agent
      should return a one-paragraph summary; the file on disk reflects
      the change; just-added highlight (yellow + 6s fade) visible in
      the editor.
- [ ] **F2 browser extract.** *"Navigate to https://example.com and
      return the H1 plus the first three list items."* — agent returns
      structured content; only one tab opened.
- [ ] **F5 send→duo round-trip.** Select a paragraph in the editor.
      *"Apply this rewrite to the user's editor selection: <text>.
      Verify it landed."* — write applied, just-added highlight
      visible, verify excerpt returned.
- [ ] **F8 web routing — Duo path.** With empty external-domains list:
      *"Navigate to https://example.com and read the H1."* — verify
      tab opened in Duo (not Safari). Inspect the agent's call log:
      `duo open` or `duo navigate`, NOT `duo external`.
- [ ] **F9 web routing — listed external.** Seed
      `~/.claude/duo/external-domains.json` with `{"domains":["example.com"]}`,
      then *"Open https://example.com/any-page."* — agent uses
      `duo external`; example.com loads in Safari/Chrome; Duo's tab
      list unchanged.

**Recovery walks** (Class C5/C6/C7 — load-bearing guards)

- [ ] **C5 outside-Duo guard.** Open a non-Duo terminal (regular iTerm,
      VS Code integrated terminal, or anywhere `echo $DUO_SESSION`
      returns empty). Run a fresh `claude` session and ask it to do a
      Duo-flavored task ("read /tmp/foo.md via duo"). Agent should
      refuse cleanly with the one-line message naming `$DUO_SESSION`
      as the cause. **Verify zero `Cannot connect: Duo app is not
      running` errors in the agent's output** — those would mean the
      guard didn't fire.
- [ ] **C6 malformed list.** Drop a truncated/invalid JSON in
      `~/.claude/duo/external-domains.json` (e.g. `{`). Repeat F8 — agent
      should surface a one-line warning and fall back to "no exceptions"
      (everything via Duo). Restore the empty list when done.
- [ ] **C7 listed-domain bypass.** Seed the list with `example.com`.
      Inspect the agent's call log on the next browser task on that
      hostname: there must be NO `duo open https://example.com` or
      `duo navigate https://example.com` — the routing decision belongs
      to the agent's pattern, not the CLI.

**Post-walk**

- [ ] Restore `external-domains.json` to its prior state (empty by
      default; or the user's curated list).

## 8. Markdown editor (Stage 11 — catches: TipTap wiring, save loop, focus handoff)

Run only when the change touches `renderer/components/editor/`,
`electron/files-service.ts`, or any wiring through preload / shared types
related to editor flows.

- [ ] Open a `.md` (click in files pane or `duo edit <path>`). Editor
      mounts, prose typography renders (headings + lists + tables look
      Google-Docs-ish, not raw markdown).
- [ ] Type into the prose. Toolbar status flips "Saved" → "Unsaved",
      then back to "Saved" after the autosave debounce (~800ms).
- [ ] `⌘S` flushes immediately (status flips to "Saved" without waiting).
- [ ] `cat <path>` outside Duo confirms the edit landed on disk.
- [ ] `⌘N` from each focus surface (T/B/E/F) creates a new editor tab
      with the "New document" filename bar focused.
- [ ] **D33f regression — known recurring bug; walk literally.**
      `⌘N` → type `regression-d33f-{ts}` → press Enter → IMMEDIATELY
      type `hello world` (no mouse, no other keys). Expected: the
      string `hello world` appears in the prose body verbatim. Failure
      shape this catches: the focus call from the post-commit effect
      races the load effect's `setContent('', false)` and the
      keystrokes either land in `<body>` (no-op) or get swallowed.
      First seen during Stage 11 (D33f); regressed during Stage
      13/15.1; fixed again post-Stage-15.2 by deferring the focus
      call to the load effect's success path via `pendingProseFocusRef`.
      Don't trust the smoke alone — when PROCESS-001 Phase 2 lands,
      this gets a Playwright assertion.
- [ ] **Editor click-target — click anywhere in the pane should focus
      prose.** Open an existing `.md`. Click into the gray margin (the
      area around the centered prose column, but below the toolbar) —
      click should land on the editor area but NOT on the prose
      itself. Expected: the prose receives focus and the next
      keystroke types into it. Failure shape: clicks on the gray
      margin are no-ops; user has to aim at the prose itself, which
      makes the click-target feel small.
- [ ] Cursor in a table cell shows the contextual table toolbar (insert
      row above/below, etc.). `⌥⇧↑/↓/←/→` insert rows/cols by keyboard.
- [ ] Select text in the editor; click into the terminal. Selection
      remains painted as a tinted overlay (`.duo-blurred-selection`).
- [ ] **Send → Duo from editor (Stage 15.1).** Select a sentence in
      the editor. A small purple "Send → Duo ↗" pill appears anchored
      ~6px above the selection. Click it. Expected: payload appears at
      the active terminal's prompt (default format A: `> "selection"\n>
      (~/path · heading_trail)`); **focus moves to the terminal**
      (next keystroke types in the terminal, not the editor); pill
      disappears. No Enter is pressed — the user controls the prompt.
- [ ] **`duo selection-format` round-trip.** From a terminal: `duo
      selection-format` → `{format: 'a'}`. `duo selection-format b` →
      switches; re-select-and-click the pill → terminal gets literal
      text only (no quotes, no provenance). `duo selection-format a`
      → restores. `duo selection-format c` → opaque token like
      `<<duo-sel-abc123>>`.
- [ ] **`duo send` from the terminal.** Run `echo "marker" | duo
      send`. Expected: `marker` appears at the active terminal's
      prompt input line; no Enter pressed.
- [ ] **Send → Duo from browser pane (Stage 15.2 — KNOWN
      VISUAL GAP).** Select text on a browser-pane page. The data
      plane is correct (`duo selection --pane browser` returns the
      selection) but the pill is **not visibly rendered** because the
      WebContentsView is OS-level above the renderer DOM. Tracked as
      BUG-006; do not flag this as a regression of Stage 15.2 unless
      the data plane is also broken.
- [ ] Theme toggle (icon in top-right of chrome row) cycles
      System → Light → Dark; light palette applies.
- [ ] Files column collapsed: clicking the rail icon expands it.

## 8. SSO persistence (catches: partition wiring)

Only needs a periodic sanity check — not every change. Skip unless you
touched BrowserManager session config or partitions.

- [ ] A Google Docs URL you've signed into before still shows your
      logged-in session after an app relaunch.

---

## 9. Multi-window (ENH-191 — window 2 functional, v0.10.0)

> ENH-191 P5a/P5b shipped a **real second window** (PRs #73 + #78): File → New
> Window (⌥⌘N) and `duo window new` open a blank window 2; each window owns its
> workspace / browser / navigator / terminals / geometry, all restored across
> relaunches. Legs A–C remain the runtime catch for the two silent foot-guns the
> node-env harness can't see — an accidental `getFocusedWindow()` substitution
> (drops backgrounded sends) and the BUG-190 teardown-timing quit-loop — plus the
> P1 windowless-lifetime path. Legs D–F exercise the window-2 surface itself.
> Walk A–C on every cut; walk D–F whenever a cut touches multi-window plumbing
> (`createWindow`, the session-file v2 schema, `duo window*`/`duo windows`/
> `--window`, or the "Allow Multiple Windows" setting). Detail:
> `docs/prd/enh-191-multi-window.md` §5.2.

### A — BACKGROUNDED-CLI (catches: focus-substitution send-drop, R2)

With Duo **not frontmost** (focus another app first), run each and confirm the
output is identical to foreground and lands on the (single) window:

- [ ] `duo url` returns the active browser-pane URL.
- [ ] `duo nav-state` returns the file-tree state.
- [ ] `duo send "echo hi"` reaches the active terminal.
- [ ] `duo open <some.html>` opens in the window's browser pane.
- [ ] **Visibility cluster** (highest-consequence — CLAUDE.md tells agents to
      reach for these first when debugging blind): `duo dom <sel>`,
      `duo eval <js>`, `duo layout`, `duo devtools` each return the SAME
      answer as when Duo is frontmost. A wrong/empty answer = a focus-resolved
      send (the R2 foot-gun the harness cannot catch).

### B — QUIT-NO-CRASH (catches: BUG-190 teardown-timing crash, R1)

- [ ] `Cmd+Q` with one window open → app quits with **no looping crash dialog**
      ("Object has been destroyed").
- [ ] After quit, `duo doctor` shows the socket **DOWN**.
- [ ] Relaunch → boots clean, socket back UP, no stale-socket "address in use".

### C — CLOSE-NO-QUIT-REOPEN (catches: dead CLI bridge across dock-reopen, ENH-191 P1 lifecycle)

> The ONE deliberate behavior change in P1: on macOS the `duo` socket stays **UP**
> after the last window closes (the app stays alive), and a dock-reopen rebinds
> cdp/browser cleanly. The node-env harness can't exercise the darwin
> `window-all-closed`-no-op path — only this live leg can. (Was the empirically-
> confirmed dock-reopen crash before the app-lifetime-singleton fix.)

- [ ] Close the **only** window via the red traffic-light / `⌘W` (NOT `⌘Q`) →
      app stays alive (dock icon present), **no crash dialog**.
- [ ] While windowless: `duo doctor` shows the socket **UP**; `duo ping` answers.
- [ ] While windowless: a browser/cdp verb (e.g. `duo url`) returns a **clean
      error** (`{ok:false}`, bridge-not-ready) — NOT a hang or a crash.
- [ ] Dock-click (or `⌘N`) to reopen → a fresh window appears, **no throw**.
- [ ] After reopen: `duo url` / `duo dom` / `duo nav-state` work against the new
      window (the getter-thunks resolved the new window's cdp/browser).

### D — OPEN-WINDOW-2 (catches: blank-not-clone, NFR-6.2)

- [ ] **File → New Window** (or `⌥⌘N`) opens a SECOND window.
- [ ] `duo window new` from any terminal also opens a second window.
- [ ] Window 2 boots **blank** — it does NOT clone window 1's pins / open tabs
      (NFR-6.2: own empty workspace, browser, navigator, terminals).
- [ ] Window 2's geometry is independent (move/resize it; window 1 unaffected).

### E — CROSS-WINDOW-CLI (catches: identity-not-focus routing, R2)

With BOTH windows open:

- [ ] `duo windows` lists both, e.g. `[{id, primary, focused, activeWorkspace}]`
      — exactly one `primary:true` (lowest id) and one `focused:true`.
- [ ] `duo doctor` reports the live count (`Windows: 2`).
- [ ] In a window-2 terminal, `echo $DUO_WINDOW` prints window 2's id (each Duo
      terminal carries its own `DUO_WINDOW`).
- [ ] A bare `duo url` (no `--window`) resolves to the **PRIMARY** (lowest-id)
      window, NOT whichever is focused — focus the window-2 browser, run it from a
      window-1 terminal, confirm you get window 1's URL.
- [ ] `duo --window <2-id> url` (also `--window=<id>`) targets window 2
      specifically; `duo --window <bogus-id> url` falls back to the primary window
      (clean answer, no error).

### F — N-WINDOW RESTORE + SETTING-OFF (catches: v2 session schema, gate)

- [ ] With 2 windows open (distinct geometry/workspaces), `⌘Q` then relaunch →
      **both** windows restore in ascending-id order with their own state.
- [ ] Toggle **Settings → Allow Multiple Windows OFF**: the **New Window** menu
      item greys out, and `duo window new` exits **non-zero** with a clean error.
- [ ] With the setting OFF, relaunch with 2 windows in the session → only window 1
      restores (window 2 stays dormant); re-enabling + relaunch brings it back.

---

## 10. OKF vault mode (ENH-216 — renderer seam + New Vault dialog)

> Run only when the change touches the New Vault modal, the editor's
> vault-mode detection / link-serializer seam, the FrontmatterPanel
> commit path, or anything in `core/markdown/vaultLinks.ts`'s consumers.
> **Do NOT add rows for the pure link math** (`slugStem` / `relLink` /
> `serializeOkfLink` / `linkSerializerFor` / `resolveMarkdownLinkHref`) —
> those are CI-covered by the 334 unit tests; this section is the
> NON-CI UI/integration surface only.
>
> One graph model, two at-rest serializers. The `[[ ]]` gesture is
> identical in OKF and Obsidian mode; only the on-disk syntax + vault
> marker differ (D3). Mode is per-vault, detected via
> `window.electron.vault.detect` (fallback `obsidian`, D4).

- [ ] **New Vault dialog defaults to OKF.** File ▸ New Vault opens a
      modal with a location field, name field, and a two-option format
      picker (OKF / Obsidian) with **OKF pre-selected** (D2). Escape
      dismisses (no vault created); Enter / Create commits.
- [ ] **`duo vault init --format=okf` makes an OKF vault.** No
      `.obsidian/` directory; a root `index.md` carries the
      `okf_version` marker; `window.electron.vault.detect({vaultRoot})`
      returns `okf` (the editor's mode probe — there is no CLI `detect`
      verb). The `--format` flag is REQUIRED on the CLI (only the dialog
      defaults it).
- [ ] **OKF gesture expands on resolve (D3).** In an OKF-vault note,
      `[[Name]]`⇥ → type-picker → stub. On disk the persisted text is a
      standard markdown rel link `[Name](./slug-path.md)` — NEVER a
      `[[wikilink]]`. A fresh stub uses the human name you typed as link
      text; picking an existing note uses the on-disk slug (D6). The
      stub file lands at a slug path with `title:` + `id:` frontmatter.
- [ ] **Cmd+click follows a relative markdown link.** Over an
      `[Name](./rel.md)` link in an OKF note, Cmd+click opens the
      resolved target (not a 404 / new-blank note).
- [ ] **Frontmatter gesture expands on COMMIT (D7).** In a typed
      frontmatter field, `owner: [[Alice]]` rewrites to a quoted
      rel-path string (`owner: "people/alice.md"`) on commit — NOT
      per-keystroke (FrontmatterPanel is a raw textarea). Mode-gated;
      Obsidian-mode frontmatter wikilinks are left unchanged.
- [ ] **Active-vault switch flips the dialect (D4).** Editing a note in
      an OKF vault writes rel links; switching the active vault to an
      Obsidian vault and editing there writes `[[wikilinks]]` — the
      serializer follows the active vault's detected mode, no stale
      dialect carried over.
- [ ] **REGRESSION — Obsidian mode unchanged.** The `[[ ]]` gesture in
      an Obsidian vault still persists wikilinks verbatim (no slug
      rewrite); `duo graph backlinks` still resolves by basename.
- [ ] **Auto-relink on vault open (D5).** Move an OKF note out-of-band
      (Finder / git), then open the vault — the main process repairs
      dangling rel links automatically (by `id:` then slug fallback).
      `duo vault relink --dry-run` reports any remaining ambiguous /
      broken links rather than rewriting them blindly.
- [ ] **Obsidian-compat.** An OKF vault opened as a folder in Obsidian
      proper renders + navigates its markdown rel links natively (the
      ENH-208 "opens in Obsidian always" guarantee still holds).

---

## Reporting template

Paste this into the end-of-task summary, filling in each line:

```
Saw in the live app:
- Boot: pass
- Terminal: pass
- Files pane: pass (breadcrumb click navigated, rail click expands)
- Working pane: pass (browser loaded)
- Shortcuts: pass (⌘T / ⌘N / ⌘L from all four focus surfaces: T/B/E/F)
- Cozy mode: not exercised (no terminal changes in this PR)
- Agent bridge: pass (duo selection + doc write round-trip)
- Markdown editor: pass (autosave, ⌘N filename commit hands focus to prose)
```

Skip unambiguous sections only when the changeset obviously can't touch
them. If in doubt, run it — this takes five minutes and catches the
expensive mistakes.

---

## Verifying transient UI states (computer-use limitations)

A note for Claude instances driving Duo via the `computer-use` MCP.
Discovered during the v0.2.0 BUG-011 verification: `screenshot` has
substantial latency between the trigger and the captured frame —
**typically 5–15 seconds end-to-end** when chained off other tool
calls. Anything that auto-dismisses faster than ~5s won't reliably
appear in a screenshot taken via `click → screenshot`, even if the
state is visible to a human watching the screen in real time.

**Examples of transient UI you might miss:** the install banner's 3s
"Installed." success state, toast notifications, the Send → Duo pill
on selection (which can dismiss when focus moves), the just-added
wash on canvas edits (6s fade).

**Pattern: temporarily extend timers in the source.** When you need
to capture a transient state for a smoke test, edit the relevant
`setTimeout(...)` in the source up to 60s, exercise the path, then
revert the change before commit. Add a `// TEMP for <test name> —
REVERT to <original>` comment so the rollback is obvious. HMR picks
up the change immediately for renderer code.

**Pattern: use indirect proof when direct visual capture fails.**
File mtimes (`installed.json` written = install ran), dev server log
lines (HMR fired = renderer reloaded), `tasks.md` edits that confirm
the test artifact landed. The visual capture is only one of several
signals.

## Restarting Duo cleanly when the renderer state is stale

`⌘R` from `mcp__computer-use__key` doesn't always reach the right
window when focus has moved (clicks earlier in the session ended on
a non-Duo surface, etc.). When the visible state has diverged from
what you expect:

1. Kill Electron: `pkill -f "node_modules/electron/dist/Electron.app"`.
2. Verify the `npm run dev` parent is still alive: `pgrep -fl "electron-vite"`. If not, restart it: `npm run dev` in a background bash. Wait ~14s for boot.
3. Bring Electron forward: `mcp__computer-use__open_application("Electron")`.
4. Verify the renderer mounted: `screenshot`, look for the three-pane layout.

Heavier than `⌘R` but resets all renderer state (including
component-local `useState`) reliably. Note: `npm run dev`'s parent
process exits when Electron exits, so killing Electron sometimes
also kills the dev server — check + restart explicitly.
