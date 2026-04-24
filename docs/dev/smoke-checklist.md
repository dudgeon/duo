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

## 5. Keyboard shortcuts (catches: browser-focus forwarding, chord typos)

Exercise each with focus on **both** the terminal AND the browser
WebContentsView. Browser-focus forwarding was the Cmd+T / Cmd+L
regression — if Chromium eats the key, these all break silently.

- [ ] `⌘T` → new browser tab, from either focus.
- [ ] `⌘⇧T` → new terminal tab, from either focus.
- [ ] `⌘L` → focuses address bar (text selected), from either focus.
- [ ] `⌘W` → closes the active tab in the focused column.
- [ ] `⌘\`` → cycles focus between terminal column and working pane.
      After the keypress, typing goes into the newly-focused side
      (don't just trust the state — press a character and confirm).
- [ ] `⌘1` / `⌘2` → jumps to terminal tab N.
- [ ] `⌘⇧1` / `⌘⇧2` → jumps to working-pane tab N.

## 6. Cozy mode (catches: xterm option plumbing, TUI-safety)

- [ ] View → "Cozy mode (preview) — current tab" toggles on. Typography
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
- [ ] `duo nav state` returns JSON with `cwd`, `selected`, `pinned`.
- [ ] `duo reveal <path>` jumps the files pane and surfaces the
      "Claude moved to …" chip at the top of the navigator.

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
- Files pane: pass (breadcrumb click navigated)
- Working pane: pass (browser loaded)
- Shortcuts: pass (⌘T / ⌘L from browser focus)
- Cozy mode: not exercised (no terminal changes in this PR)
- Agent bridge: not exercised (no CLI changes)
```

Skip unambiguous sections only when the changeset obviously can't touch
them. If in doubt, run it — this takes five minutes and catches the
expensive mistakes.
