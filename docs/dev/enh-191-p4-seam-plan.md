# ENH-191 P4 — Seam Plan + Resume (the multi-window persistence gate)

> ## ⛔ RESUME DIRECTIVE — READ FIRST (post-compaction)
> **EXECUTE CONTINUOUSLY. The owner greenlit "keep pushing multi-window forward
> (P4/P5) on the branch as before." Build seam-by-seam, gate, commit + push EACH
> seam, and KEEP GOING to the next without stopping.**
>
> **DO NOT** stop to report milestones, ask "shall I continue?", offer
> sequencing options, or otherwise checkpoint mid-plan. The owner has twice
> called this out as ignoring a clear direction — mid-plan checkpoints read as
> stalling, not diligence. Just build P4 → P5.
>
> The ONLY reasons to pause: (1) a genuine NEW owner-decision the PRD does NOT
> already lock (rare — P4 is PRD-locked), or (2) a gate fails and you can't
> resolve it. Otherwise: build, gate, commit, push, next seam. No narration
> beyond terse per-push status.
>
> **Do NOT** re-spin smoke-walks, version cuts, or merge proposals — those are a
> SEPARATE session's job. Stay on building. (A separate session manages merges;
> the owner drives cuts.)
>
> **▶ CURRENT STATE (2026-06-07): P5a Tier 2-4 + S4 COMPLETE on the branch
> (origin `claude/enh-191-multiwindow` @ `36c171f`, 0 behind / 16 ahead of main
> v0.9.3).** All of Tier 2 (interaction crashers + app-menu focus + workspace
> threading), Tier 3 (DUO_WINDOW addressing + N-window restore + id-reconciliation),
> and Tier 4 (cache teardown, enrich hook, doctor count, exit-code, menu gate) +
> NFR-6.2 (blank-window pin-clone) landed across 9 commits this session. 1093
> tests, typecheck clean, routing baseline 0 (getFocusedWindow=0), check:skill-
> currency 67 verbs. **LIVE-VERIFIED via `duo` probes** on the worktree dev:
> N-window restore (2 windows restored with distinct per-window slices),
> no-2N-growth (envelope stays 2 windows — id-reconciliation works), `duo doctor`
> "Windows: 2", `duo windows` enumeration, and DUO_WINDOW addressing
> (`duo --window 2 dom --js windowId` → 2; was 1 before the fix). No crash/wedge
> at N=2 after extensive probing.
>
> **REMAINING (the owner's call): a 2-window `/smoke-walk`** for the eyes-on /
> keystroke / relaunch items computer-use can't reach on the worktree dev:
> right-click context menu at N=2, app-menu clicks targeting the focused window,
> blank-window pin visual (NFR-6.2), and a real quit+relaunch to confirm
> N-window restore + bounds across launches. Then merge + cut (a SEPARATE
> session's job). See "P5a remaining" below (now annotated DONE per phase).
>
> NOTE: an `ultracode` adversarial-verify workflow was launched but HUNG
> (agents stalled mid-tool-call, never finalized) — its highest-value lens (the
> residual-crasher census) was done MANUALLY instead and found 4 real
> wrong-window fixes (commits `b529771` + `36c171f`).

## Where things stand (2026-06-07, post-checkpoint)

**Merged to main:** P0–P3 (PR #76) + P4 + P5a foundation S1/S2 (PR #78 — the
`claude/enh-191-p4-p5a-dark` boundary). main is now **v0.9.3**. The working
branch `claude/enh-191-multiwindow` is **rebased onto main** (0 behind, 6 ahead):
the P5a entry points (S3a–c) + Tier-1. 1081 tests, typecheck clean, routing
baseline 0, `check:skill-currency` PASS.

**P5a status (the FIRST user-visible release — open a SECOND window):**
- **Entry points DONE** (S3a–c): `createWindow({restore})` + `openNewWindow` +
  File→New Window (⌥⌘N) + Settings "Allow Multiple Windows" toggle + the
  `duo window new` verb. Window 2 opens.
- **Tier-1 DONE + LIVE-VERIFIED** (window 2 *survivable*): the automatic-on-mount
  crashers (browser IPC → `browserForSender(event)`; git-watch → arming-window id)
  + the persistence data-loss (`seedWindowsFromDisk` + `dropWindow`) + the
  blank-race. Proven live on the worktree dev: `duo window new`→{ok:true} (was a
  timeout+crash); `doctor` works after window 2 (no bridge-wedge); windowIds
  [1,2] persist; a tracked-file touch at N=2 doesn't crash.
- **Tier 2-4 + S4 DONE + LIVE-VERIFIED** (2026-06-07, this session — 9 commits
  `ebf8d68`..`36c171f`). Window 2 is fully *functional*: no crash on any CLI/
  interaction path at N>1, each window resolves its own state, and a `duo
  --window N` (or a terminal's `DUO_WINDOW`) addresses any window. The detailed
  per-phase map is in "P5a remaining" below (each annotated ✅).

**Verification reality:** the CLI-testable surface is LIVE-VERIFIED via `duo`
probes (addressing, restore, no-2N-growth, doctor count, no-wedge). The eyes-on
items — right-click context menu, app-menu-click focus-targeting, blank-window
pin visual, and a real quit+relaunch (N-window restore + geometry across
launches) — can't be driven by computer-use on the worktree dev, so they are the
**2-window `/smoke-walk`'s job** (the owner's verification).

## P5a Tier 2-4 + S4 — ✅ DONE (2026-06-07; survey-mapped, then hand-implemented)

> **All items below shipped this session** (commits `ebf8d68`..`36c171f`). The
> map was a 6-agent survey (`/tmp/enh191-survey-digest.txt`, transient). Phase →
> commit: Tier-2 crashers `de108a5`; app-menu focus `b50829d`; workspace
> threading `4ef1def`; S4 addressing `e722d2b` (+ read/query addressing
> `b529771`, browser-pane/cue addressing `36c171f`); N-window restore +
> reconciliation `6294476`; NFR-6.2 + Tier-4 `ff5e7ac`. The S4 resolver core
> (`registry.primary()`, non-throwing) is `ebf8d68`. Kept below for the
> implementation trail; **nothing here is outstanding** except the 2-window
> `/smoke-walk` (eyes-on items).

Tasks #28–30 track these. The full review (6 agents) is the source; KEY items
captured here durably (the workflow result file is transient).

### Tier 2 — interaction crashers + NFR-6.2 (mostly "high"; crash on USER action)
- **Right-click context-menu** builder (electron-context-menu `prepend`, main.ts
  ~1238/1266/1269) calls `liveMainWindow()/liveBrowser()` → crash on ANY
  right-click at N=2 → resolve via `BrowserWindow.fromWebContents(wc)`.
- **App-menu** click handlers (`safeSend`) + menu-rebuild `*.getDefault(registry)`
  reads → throw at N>1 → resolve via `getFocusedWindow()/getFocusedWebContents()`.
- **CDP path-link callbacks** in createWindow (`onBrowserOpenPath/Split` →
  `sendEdit`/`splitViewOpen`, main.ts ~791/810) → `ctxSend` (the S2 pattern, missed).
- **NFR-6.2 pin-clone:** a blank window auto-opens pinned FILE tabs (renderer-side
  pin-auto-open in App.tsx ~719, no blank gate) → plumb a blank flag to the
  renderer (preload `env.blank` via additionalArguments, or a blank-set keyed by
  `env.windowId`) + skip the file-pin auto-open when blank.
- ~25 `liveMainWindow()` sites total (workspace Save/Open/New, `MENU_POPUP`,
  `DIALOG_CONFIRM`, `focusPane`) — categorize EACH: per-window/focused →
  focused-window id; genuinely app-global CLI (NavBridge reveal/view/edit,
  visibility cluster) → stay `resolveDefault` (the S4 fallback).

### Tier 3 / S4 — addressing + restore (the FUNCTIONALITY blocker + verification-enabler)
- **DUO_WINDOW terminal-origin:** the CLI forwards the connecting PTY's
  `DUO_WINDOW` in the handshake; `SocketServer.handle` resolves `get(windowId)` as
  the per-command default, `resolveDefault` fallback when unstamped. (Unblocks
  `duo --window N` probing window 2 → lets a future session live-verify Tier 2/4.)
- Make `resolveDefault` NOT throw at N>1 for app-global ops (pick a window / route
  via DUO_WINDOW) so the visibility cluster + `duo open/reveal` clean-resolve
  instead of clean-erroring.
- **N-window boot restore:** loop `createWindow({restore, restoreIndex:i})` over
  `loadWindows()` + apply per-window geometry (today hardcodes windows[0]).

### Tier 4 — polish
- `cli/duo.ts` case `window`: check `result.ok` + `die()` when disabled (exit
  non-zero; mirrors `duo clone`).
- closed handler: `.delete(winId)` on the ~16 `WindowKeyedCache` + `PendingRegistry`
  instances (no teardown today → slot leak).
- `duo doctor`: thread `registry.count()` → a "Windows: N" line (NFR-4.4).
- enrich-before-persist hook (main.ts ~515): thread `w.windowId` instead of
  `registry.only()?.id` (caught today, but stops lastClaudeSession capture at N>1
  — the only N=2 log noise after Tier-1).
- Menu New Window: `enabled` gate on `settings.multiWindow` + `rebuildAppMenu` on
  the toggle.

## Gate (run INSIDE the worktree; vitest excludes `.claude/worktrees/**` from the primary root)
`cd /Users/geoffreydudgeon/Documents/GitHub/duo/.claude/worktrees/enh-191 && npm run typecheck && npm run check:routing && npm run test:run`

> ⚠️ **ALWAYS prefix every gate/git command with the `cd <worktree>` above — do
> NOT trust the persistent Bash cwd.** It silently drifted to the MAIN repo once
> this session (2026-06-07), so build:cli + typecheck + routing + skill-currency
> + test:run all ran against `main` and reported a FALSE-GREEN (1045 tests / 64
> files — main's count, missing the P4/P5a test files). Tell-tale: test count
> drops to 1045/64 or `check:skill-currency` shows 64 verbs (worktree = 1081/68,
> 65 verbs incl. `window`). If in doubt, `pwd` first. No damage occurred (gates
> are read-only; build:cli is deterministic) but the green was meaningless.

## P4 seams

### [x] Seam 1 — `core/session-envelope.ts` (pure, dead code) — DONE (`483031b`)
v1-flat → v2-envelope migration. Added `WindowState` / `SessionEnvelope` /
`WindowBounds` (shared/types.ts) + `migrateFlatToEnvelope` / `readEnvelopeWindows`
/ `composeEnvelope` / `SESSION_ENVELOPE_VERSION=2`. 7 tests (field-drop negative control).

### [x] Seam 2 — `renderer/state/perTabPrune.ts` (pure, dead code) — DONE (`189d663`)
`pruneByTab(map, liveIds)` — the C13 fix (each window owns its own byTab map; the
prune can't touch another window's entries). 5 tests (prune-isolation + shared-map-deletes-other-window control).

### [x] Seam 3 — localStorage triage (move per-window keys OFF the shared bus) — DONE (`6e6b8e7` windowId plumbing + `3b9b7e0` triage)
RE-GREP these (drifted): `renderer/App.tsx` — `COZY_BY_TAB_KEY` (~:60),
`FONT_BUMP_BY_TAB_KEY` (~:66), load (~:152/:165), cozy toggle + the prune
(~:2736-2779 — wire it to `pruneByTab` from seam 2), fontBump setItem (~:3207);
`renderer/hooks/useNavigator.ts` — `LS_KEY_CWD='duo.nav.cwd'` (~:20),
`LS_KEY_EXPANDED='duo.nav.expanded'` (~:21).
- **Move OFF the storage-event bus into per-window/per-tab state:** `cozy.byTab`,
  `fontBump.byTab`, `nav.cwd`, `nav.expanded`. **Per-window keys are NEW names**
  (leave the OLD shared keys in place but UNREAD so a Cut-3 revert reads them
  untouched — PRD §7.5). **Keep on the bus:** theme/author/autosave/send-pill/
  line-numbers/update-banner.
- Any key that becomes per-window MUST NOT subscribe to the storage broadcast.
- The prune (`:2685-2710`-era) must operate on per-window state so window A's
  prune can't delete window B's entries.

### [x] Seam 4 — `SessionStateService` adopts the v2 envelope — DONE (`339e140`)
`core/session-state-service.ts` — `SCHEMA_VERSION` (~:46) → **2**; `load` (~:83)
reads BOTH shapes via `readEnvelopeWindows` (migrate v1→v2) + field-validates each
`WindowState` (mirror the current field-by-field defensive copy); `flush` (~:175)
composes ALL windows via `composeEnvelope` behind the SINGLE serialized writer.
- **MANDATE (PRD item 4): keep the single `writing` flag + single timer. DO NOT
  key the `writing` flag per window** — that removes serialization → concurrent
  flushes race the shared tmp and lost-update. The debounce composes the latest
  snapshot of EVERY window before each flush.
- Re-type `enrichBeforePersistHook`/`mirrorHook` (~:64/:71) to run per-`WindowState`
  INSIDE the single flush (the enrich hook scans `~/.claude/projects` — an await),
  never concurrently.
- The boot peek (~`main.ts`) must read both shapes. Write a `session-state.json.v1.bak`
  (write-once) for downgrade recovery.
- Downgrade (NFR-8.2): an old v1 reader against a v2 doc hits the version-mismatch
  guard (~:89-90) → returns empty, no destructive overwrite (already the behavior;
  add the test).

### [x] Seam 5 — migration / prune-isolation / downgrade / concurrent-flush tests — DONE (`024ecec`; +injectable path)
Pure node-env. Migration round-trip + a persisted-field-drop negative control
(seam 1 covers the envelope; add the service-load round-trip). Prune-isolation
(seam 2 covers the fn; add the App.tsx wiring test if feasible). Downgrade
(old-reader-on-v2 → graceful). **Concurrent-flush:** two windows' overlapping
saves both survive the single composed writer; negative control — per-window
`writing` flags FAIL it.

### [x] Seam 6 — persist the per-window active-workspace pointer in each `WindowState` — DONE (`8266924`)
P3-S10's persistence home (PRD item 8). At compose, fold `ctx.activeWorkspace`
into that window's `WindowState.activeWorkspace`; at restore, seed
`ctx.activeWorkspace` from it. Extend the migration round-trip test to assert it
survives flat→envelope. Confirm `auxTabId` round-trips per window.

## NOW: P5a — the FIRST user-visible release (open window 2)

> **⛔ Same EXECUTE-CONTINUOUSLY directive as P4 (see top). Build seam-by-seam,
> gate (`typecheck && check:routing && test:run` in the worktree), commit + push
> EACH, keep going. The Cut-4a two-window `/smoke-walk` + the cut + merges are a
> SEPARATE session's job — NOT this one.**

### Owner decisions (locked 2026-06-07 — do NOT re-decide)
- **`multiWindow` defaults ON** (overrides PRD §7.2's original default-false).
  User can disable via a **Settings menu** toggle. Storage = main-side
  `SettingsService` over `~/.claude/duo/settings.json` (`{ multiWindow: boolean }`,
  default true). Recorded in PRD §7.2.
- **New Window shortcut = `⌥⌘N`** (`⌘N`/`⌘⇧N` taken by New File / New Folder).
- New window opens **blank to a default cwd** (NFR-6.2, pinned) — not cloning w1.

### P5a seams (PRD §4 P5a work items 1,2,3,6,8,10 + Window-menu/geometry)
- **[x] S1 — `SettingsService`** — DONE (`249d623`): `~/.claude/duo/settings.json`,
  `{ multiWindow: boolean }` default TRUE, atomic write, injectable path + 6 tests.
- **[x] S2 — ctx-scoped per-window sends in `createWindow`** — DONE (`54623d8`):
  browser state/tabs + presence + NAV_EDIT route via `ctxSend = makeSafeSend(() =>
  ctx.window)` (not the default `only()` send that throws at N>1) + the
  activeTerminalId read → `getOrDefault(winId)`. Byte-identical at N=1.
- **[x] S3a — window-opening mechanism** — DONE (`80222f7`): `createWindow({restore?})`
  (true=boot; false=blank New-Window, NFR-6.2) + `openNewWindow()` (flag-gated) +
  `blankWindowIds` (their `SESSION_STATE_LOAD` → empty) + SettingsService wired into
  main. Byte-identical at N=1 (nothing opens a 2nd window yet).
- **[x] S3b — menu entry points** — DONE (`c61ecb2`): File → "New Window" (`⌥⌘N`) +
  Settings → "Allow Multiple Windows" toggle. **Behavior-changing** (clicking opens
  window 2) → needs the two-window smoke-walk; NOT autonomously verifiable.
- **[x] S3c — `duo window new` verb (4-surface)** — DONE (`9229b15`): menu/CLI parity
  (CLAUDE.md §4). socket-server `window` case → `NavBridge.openWindow` → `openNewWindow`;
  `DuoCommandName` += `window`; `cli/duo.ts` verb + `VERBS[]` + rebuilt binary;
  cli-reference.md + agents/duo.md + docs/CLI-COVERAGE.md rows + checker SUBCOMMANDS.
  `check:skill-currency --strict` PASS (65 verbs). `--cwd <path>` NOT yet wired
  (optional; deferred — a new window opens at the default cwd). **sync:claude NOT
  run** (would push branch-ahead verb docs into the shared ~/.claude the other
  agent's app reads — owed at merge).
- **[ ] S4 — windowId on the wire** (NEXT): `windowId?` on `DuoRequest` + `cli/duo.ts`
  `--window` threading; consume the dormant `DUO_WINDOW` PTY stamp (order:
  `--window` > `DUO_WINDOW` > focused); `SocketServer.handle` resolves windowId→context
  (clean `no such window: N`). Byte-identical at N=1 (resolves the sole window).
- **[ ] S5 — N-window restore + geometry**: restore all persisted windows
  (flag-gated); **flag-off must NOT prune the dormant `WindowState`s** (PRD §7.2 /
  line-970 gap — preserve unloaded slots); per-window bounds.
- **[ ] S6 — `duo doctor` window count + macOS Window menu** (NFR-4.4 / NFR-5.1).
  (Old S7 four-surface doc-sync folded into S3c — done there.)

Then **P5b** = explicit `--window` across the full ~36-verb surface + `duo windows`
enumeration + tab/aux/split addressing + the `duo events` per-window decision
(PRD §4 P5b — STATE it). P5 consumes the P3 `only()` fail-loud placeholders.

## Key locked constraints (do NOT re-decide — PRD §4 P4)
- `{windows: WindowState[]}` envelope (locked). Single serialized writer (compose,
  don't per-key the flag). Per-window keys = new names, old keys left unread.
  SCHEMA_VERSION bump gates the new shape; downgrade returns empty.
- P4→P3 is RELEASE-isolation, not a hard code dependency — P4 builds on the branch
  fine without P3 merged.
