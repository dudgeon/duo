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

**Hard rule:** every Duo shortcut MUST be exercised from **all four
focus surfaces** the user can be on:

1. **Terminal** (xterm.js textarea — eats some keys via xterm's
   default key handler unless `attachCustomKeyEventHandler` returns
   false; see BUG-001 for the ⌃Tab gotcha)
2. **Browser** (WebContentsView — Chromium eats keys unless
   `BrowserManager.wireKeyForwarding` allowlists them; clicks into
   the page don't bubble to the column wrapper, so renderer's
   `focusedColumn` can stay stuck on the previous value — see
   BUG-001 fix part 3)
3. **Editor** (TipTap contenteditable — TipTap binds some keys
   itself: `⌘B`/`⌘I`/`⌘U`/`⌘E`/`⌘K`/`⌘Z` are claimed)
4. **Files** (tree pane, no editable element but still focusable)

**Why we walk this every time:** since 2026-04-19, Duo has shipped
four keyboard regressions because changes touched one surface and
the matrix wasn't walked across the others (BUG-001 ⌃Tab cross-pane,
BUG-002 ⌘T address-bar focus, BUG-004 ⌘` doesn't move OS focus,
plus ⌘T-pane-aware churn). Each was caught days later by manual
daily-driving. Walking this section on every keyboard-touching
change (even "trivial" ones) catches them at PR time. See
`tasks.md` PROCESS-001 for the full root-cause discussion.

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
      - `renderer/hooks/useKeyboardShortcuts.ts`
      - `renderer/components/TerminalPane.tsx` (xterm key handler)
      - `electron/browser-manager.ts` (`wireKeyForwarding` allowlist)
      - `electron/main.ts` (menu accelerator registration)
      - `renderer/App.tsx` (`togglePaneFocus`, `newBrowserTab`,
        `newMarkdownFile`, focus-related callbacks)
      - `electron/preload.ts` (`keyboard` surface)
      Otherwise, walk only the rows touched + the rows for any
      surface whose focus path changed.

### 5.2 Shortcut × focus-surface matrix

Fire each shortcut from every surface in order (T = terminal,
B = browser, E = editor, F = files). For each cell, verify ALL of:

- The **action fires** (new tab, focus moves, etc.)
- **Focus lands on the right element** (test by typing one
  character — does it go where expected? URL bar? Filename input?
  PTY? Editor prose?)
- **No collateral damage** to the other panes (focused column
  border updates correctly; previously-focused element loses focus)

| # | Shortcut | T | B | E | F | Expected outcome |
|---|---|---|---|---|---|---|
| 1 | `⌘T` | ☐ | ☐ | ☐ | ☐ | New foreground browser tab AND address-bar input has DOM focus + URL is selected. **Type one letter immediately** — it should land in the address bar, not in the new tab's page or in the previously focused surface (BUG-002 regression check). |
| 2 | `⌘⇧T` | ☐ | ☐ | ☐ | ☐ | New terminal tab; PTY accepts typing immediately (xterm focused). |
| 3 | `⌘N` | ☐ | ☐ | ☐ | ☐ | New `editor` tab; filename input focused. Type a name → `Enter` → focus moves to prose, next keystroke lands in prose (D33f). |
| 4 | `⌘L` | ☐ | ☐ | ☐ | ☐ | Address-bar input focused + URL selected; type replaces URL. |
| 5 | `⌘W` | ☐ | ☐ | ☐ | ☐ | Closes active tab in the **focused column** (terminal column → terminal tab; working column → browser tab or editor tab depending on active slot). Last terminal tab + last browser tab can't close. |
| 6 | `⌘B` | ☐ | ☐ | n/a | ☐ | Toggles Files column. **Skipped in editor on purpose** (TipTap claims `⌘B` for bold). When collapsed, rail-icon click still expands. |
| 7 | `` ⌘` `` | ☐ | ☐ | ☐ | ☐ | Cycles focus between terminal and working pane. **OS-level focus must move too**: after the cycle, type a single character — it goes to xterm OR the browser/editor depending on direction (BUG-004 regression check). The focused-column accent border updates. macOS: registered as a menu accelerator so the system shortcut doesn't intercept it. |
| 8 | `⌘1` / `⌘2` | ☐ | ☐ | ☐ | ☐ | Jumps to terminal tab N. |
| 9 | `⌘⇧1` / `⌘⇧2` | ☐ | ☐ | ☐ | ☐ | Jumps to working-pane tab N (browser or file). |
| 10 | `⌘+` / `⌘-` / `⌘0` | ☐ | n/a | n/a | ☐ | Adjust terminal font bump (browser/editor own native zoom). |
| 11 | `⌃Tab` / `⌃⇧Tab` | ☐ | ☐ | ☐ | ☐ | **Pane-aware**: from terminal focus → cycles terminal tabs; from browser/editor/files focus → cycles browser tabs (BUG-001). xterm's `attachCustomKeyEventHandler` must let the event bubble; browser-key-forward path must pass `paneOverride='working'`. |
| 12 | `⌘⇧[` / `⌘⇧]` | ☐ | ☐ | ☐ | ☐ | Previous / next terminal tab (always terminal-scope). |

**If any cell fails, do NOT call the change done.** Trace through:
1. Does `useKeyboardShortcuts.ts` see the keydown? (Add a `console.log`
   at the top of `process()` to confirm.)
2. If from browser: is the key in `wireKeyForwarding`'s allowlist in
   `electron/browser-manager.ts`?
3. If terminal eats it: does `term.attachCustomKeyEventHandler` in
   `TerminalPane.tsx` return `false` for it?
4. If editor eats it: is there a TipTap binding to override? Check
   `renderer/components/editor/extensions/`.

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
