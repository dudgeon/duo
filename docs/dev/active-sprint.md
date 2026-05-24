# Active sprint state — Sprint 21 / v0.7.9 (post-v0.7.8-cut)

**Status (2026-05-24):** v0.7.8 cut + tagged + pushed; [GitHub Release](https://github.com/dudgeon/duo/releases/tag/v0.7.8) live with signed+notarized DMG. FOLLOWUP-027 (about:blank ghost-tab fix) shipped uncommitted on `main` this session — awaiting owner call on whether to commit standalone or bundle with ENH-177+181. Sprint 21 remaining scope is the **ENH-177 + ENH-181 bundle** plus carry-forward picks.

## Sprint 21 implementation TODO (post-compaction handoff)

### Marquee — ENH-177 + ENH-181 bundle (Claude session resume banner + inline rename + collapse toggle)

> **Notion mirror:** [ENH-177 + ENH-181 — Claude session resume banner + inline rename + collapse toggle (Sprint 21 queued)](https://www.notion.so/36945f48854f810ca7f9dfa275c4389d) — embeds the 7-state mockup PNG + ENH-181 design + build order. Phone-readable.
>
> **Mockup HTML:** [`docs/prd/enh-183-claude-session-lifecycle.html`](../prd/enh-183-claude-session-lifecycle.html) — `duo open` it for the interactive view. All 7 states (3 ENH-177 banner shapes + 4 ENH-181 rename/collapse states).

**Step 1 — Cherry-pick ENH-177 from [f351719](https://github.com/dudgeon/duo/commit/f351719).** This was the original build, reverted at [49f4644](https://github.com/dudgeon/duo/commit/49f4644) before the v0.7.7 cut. File inventory:

| File | Type | Shape |
|---|---|---|
| `electron/claude-session-tracker.ts` | new (~81 LOC) | Pure helpers: `encodeProjectDir(absPath)` mirrors Claude's `/` and `.` → `-` naming; `detectLatestClaudeSession(cwd, maxAgeMs)` scans `~/.claude/projects/<encoded-cwd>/` for newest `.jsonl`, returns session UUID. |
| `electron/claude-session-tracker.test.ts` | new (~36 LOC) | 6 vitest cases against real on-disk directory names. |
| `core/session-state-service.ts` | edit (~57 LOC) | Adds `setEnrichBeforePersistHook` — async pre-write decoration hook. Runs inside `flush()` so enrichment rides both autosave file AND mirror-hook payload. Best-effort: hook failures logged + original state persisted. |
| `electron/main.ts` | edit (~30 LOC) | Wires the hook to call `detectLatestClaudeSession` for every terminal entry. Stale captures (>24h) dropped. Defensive: if scan fails but prior session stored, preserve (no flicker on transient errors). |
| `renderer/components/ClaudeResumeBanner.tsx` | new (~55 LOC) | Banner component — title, Resume button, × dismiss. Click Resume → writes `claude --resume <id>\n` to PTY via existing `PtyManager.write`. |
| `renderer/components/TerminalPane.tsx` | edit (~43 LOC) | Mounts the banner per-terminal-tab when `lastClaudeSession` exists AND not yet dismissed in this session. |
| `renderer/App.tsx` | edit (~16 LOC) | Plumbing. |
| `renderer/styles/globals.css` | edit (~77 LOC) | Banner styling. |
| `shared/types.ts` | edit (~17 LOC) | Adds `lastClaudeSession?: { id: string; capturedAt: number } | null` field to terminal-tab persisted state. |

Cherry-pick procedure: `git cherry-pick -n f351719`. Resolve any conflicts (the surrounding files have moved since — App.tsx and TerminalPane.tsx especially), then move to Step 2 BEFORE committing.

**Step 2 — Layer in ENH-181 (the 4 new states from the mockup).**

| Behavior | What it does | Implementation |
|---|---|---|
| **Banner title reads `sessions-index.json`** (ENH-180 absorbed) | Title priority: `customName > summary > short(UUID)`. Live re-reads on file change so claude's own auto-summary refresh and our own `/rename` write both propagate to the banner. | In `claude-session-tracker.ts`: add `readSessionTitle(cwd, sessionId): Promise<{ customName?: string; summary?: string }>` reading from `~/.claude/projects/<encoded-cwd>/sessions-index.json` (filter to the session id). Banner subscribes via `fs.watchFile` on the sessions-index path (debounced) and re-reads on change. UUID fallback uses first 8 chars. |
| **Collapsed marker on tab (default state)** | On workspace switch, the affected terminal tab in the tab strip gets a small `⏪` chip. Banner stays HIDDEN inside the terminal pane. Tap the tab to expand → banner appears; tap the tab again to collapse → banner hides. State persists per-tab across the session (lost on Duo quit). | Lift collapse state to workspace level: `useState<Record<tabId, boolean>>` in `TerminalPane`'s parent, default `true` (collapsed) when `lastClaudeSession` first appears. Tab-strip render uses this to show the marker. Banner mount condition: `!collapsed[tabId]`. |
| **Inline rename via PTY `/rename` inject** | Banner expanded + `claudePresence === 'claude'` for this tab → title shows dashed underline + pencil glyph. Click title → contentEditable, accent border, Resume/× dim. Type → Keyboard hint `↵ save · esc cancel`. Return / click-outside → write `\r/rename <new-title>\n` to PTY → 2s `✓ saved` flash. Esc → revert. When `claudePresence !== 'claude'`, title is non-editable (`cursor: not-allowed` + tooltip). | Banner JSX: title becomes `<span contentEditable={isEditing}>` with `onBlur` + `onKeyDown` handlers. New IPC `duo.session.rename(tabId, title)` → routes to existing `PtyManager.write(tabId, '\r/rename ' + title + '\n')`. Banner reads `claudePresence` (already in renderer state for ENH-176 / ENH-142 toggle gating). The `'\r' prefix' is critical — verified empirically; just `/rename\n` doesn't always commit if there's pending input on the PTY line. |
| **CLI parity** (per CLAUDE.md § 4) | `duo session rename <tabId> "<title>"` · `duo session collapse <tabId>` · `duo session expand <tabId>` | Standard plumbing: `shared/types.ts § DuoCommandName` + `electron/preload.ts` + `electron/main.ts` + `core/socket-server.ts` + `cli/duo.ts` + `skill/SKILL.md` + `agents/duo.md` + `docs/CLI-COVERAGE.md`. Rebuild + commit `cli/duo`. |

**Step 3 — Verify live.** Owner walks: workspace-switch → marker on tab → tap to expand → click title → type new name → Return → confirm `/rename` lands in claude transcript → wait for `sessions-index.json § customName` to update → confirm banner re-renders with new title → re-tap tab to collapse. Computer-use access for Electron should already be granted; the [locked-Mac signature](../../.claude/projects/-Users-geoffreydudgeon-Documents-GitHub-duo/memory/feedback_locked_mac_screenshot_pattern.md) memory rule applies if the Mac is locked.

**Mechanism empirics (don't re-research):**
- `claude -p '/rename X'` returns *"isn't available in this environment"*. Slash commands are TUI-only.
- `--name` on `--resume` doesn't visibly persist + is expensive ($0.73 per resume call due to Opus default + 117K cache-token reload).
- Writing `\r/rename <title>\n` to a live claude PTY: **$0 cost, ~0s latency**, persists to `sessions-index.json § customName`, visible in `/resume` picker + terminal title + the banner.

### Shipped this sprint (2026-05-23)

| ID | What | Commit |
|---|---|---|
| **ENH-178** | Browser blocklist three modes (`local-only` default) | [d851296](https://github.com/dudgeon/duo/commit/d851296) (cherry-pick of [b03a8da](https://github.com/dudgeon/duo/commit/b03a8da)) |
| **FOLLOWUP-027** | Short-circuit tab creation when `local-only` would filter a remote URL (no more about:blank ghost-tab) | uncommitted on `main` — `openTab` + `navigateOrFocus` pre-check `routeOffHostIfMatched` before `addTab`; new return shape `{ok, url, routedTo: 'system-browser'}`. Verified live via DOM probes (`browserTabsCount` stays at 1 + EXTERNAL_REDIRECTED banner renders + `routedTo` in CLI response). Owner call needed: commit standalone or bundle with ENH-177+181. |

### Shipped this sprint (2026-05-23)

| ID | What | Commit |
|---|---|---|
| **ENH-178** | Browser blocklist three modes (`local-only` default) | [d851296](https://github.com/dudgeon/duo/commit/d851296) (cherry-pick of [b03a8da](https://github.com/dudgeon/duo/commit/b03a8da)) |
| **FOLLOWUP-027** | Short-circuit tab creation when `local-only` would filter a remote URL (no more about:blank ghost-tab) | this session — `openTab` + `navigateOrFocus` pre-check `routeOffHostIfMatched` before `addTab`; new return shape `{ok, url, routedTo: 'system-browser'}` |

### Closed during planning (2026-05-23)

| ID | Outcome |
|---|---|
| **ENH-180** | Closed same-day. Owner observation: Claude Code already writes a Haiku summary to `sessions-index.json` automatically — Duo doesn't need to generate its own title. The ~20-line "banner reads `sessions-index.json` and falls back to UUID" detail folds into ENH-177's re-ship. PRD at [`docs/prd/_archive/enh-180-session-rename.html`](../prd/_archive/enh-180-session-rename.html) preserved with closure banner + historical empirics under `<details>` (for the `/rename` mechanics + cost research, in case a v2 ever revisits). |

### Carry-forward backlog (not yet picked for Sprint 21)

- **BUG-079** tab-cycle latency — needs prod repro
- **BUG-093** split crash — needs clean repro
- **BUG-122 hypothesis 2/3** — Notion-race / OneDrive xattr — next-repro log gated
- **ENH-084 v4** aux glow — owner 60s walk owed
- **ENH-127** composer-window direction — if pain re-surfaces
- **ENH-128 walk-4** HEIC drag-drop — owner verification owed
- **ENH-137** Beginner's Guide
- **ENH-141** enterprise smoke
- **ENH-148 v2** cross-boundary selection — wait for owner ping
- **ENH-157** browser-pane comments
- **ENH-162** Clone modal destination collision UX
- **FOLLOWUP-021** `duo install --clean`
- **BUG-024 follow-up** combined Send + Comment pill
- **17a.5** template gallery
- **Backlinks / graph view** (Obsidian cluster)

(FOLLOWUP-027 shipped this session — moved out of carry-forward into "Shipped this sprint" above.)

## Memory rules locked Sprint 21

- [feedback_locked_mac_screenshot_pattern](../../.claude/projects/-Users-geoffreydudgeon-Documents-GitHub-duo/memory/feedback_locked_mac_screenshot_pattern.md) — when every screenshot returns wallpaper + `(name withheld)` + `com.apple.loginwindow` in the hidden-apps diagnostic + `left_click` errors with `"loginwindow" is not in the allowed applications` → the Mac is LOCKED. Don't debug the app. Fall back to DOM probes. Locked from FOLLOWUP-027 verification 2026-05-24 (burned ~30 min mis-diagnosing as an Electron blind-spot).

## What shipped in v0.7.7 (closed)

| Item | Commit | Smoke-walked |
|---|---|---|
| **ENH-169** Navigator new-file / new-folder UX | [ce50e78](https://github.com/dudgeon/duo/commit/ce50e78) | ✅ owner walk-1 PASS |
| **ENH-170 v2** Top-level Settings menu | [342020a](https://github.com/dudgeon/duo/commit/342020a) | ✅ owner walk-2 PASS (post-BUG-154 fix) |
| **ENH-171** Workspace switcher dropdown | [2bde2f6](https://github.com/dudgeon/duo/commit/2bde2f6) | ✅ owner walk-2 PASS |
| **ENH-172** Show / hide hidden files | [600d16e](https://github.com/dudgeon/duo/commit/600d16e) | ✅ owner walk-1 PASS |
| **ENH-173** `duo view <folder>` Navigate-here button | [3daf480](https://github.com/dudgeon/duo/commit/3daf480) | ✅ owner walk-2 PASS |
| **ENH-174** Disable TipTap autolink | [ffd798b](https://github.com/dudgeon/duo/commit/ffd798b) | ✅ agent walked (insert + diff on /tmp fixture) |
| **ENH-175** `duo navigate <url>` opens new tab or focuses existing | [ffd798b](https://github.com/dudgeon/duo/commit/ffd798b) | ✅ agent walked both branches via CLI |
| **ENH-176** Send-pill agent + terminal variants (localStorage flags) | [3d331f0](https://github.com/dudgeon/duo/commit/3d331f0) | ✅ agent walked data path (flag round-trip) |
| **ENH-179** ⌘Z reopens last-closed tab | [21fa66a](https://github.com/dudgeon/duo/commit/21fa66a) | ✅ agent walked via computer-use ⌘Z |
| **BUG-149/150/151/152/154/155** | various | various walks ✅ |
| **ENH-180** PRD only | [c090064](https://github.com/dudgeon/duo/commit/c090064) | n/a |

## Deferred / reverted out of v0.7.7 (status)

| ID | Status |
|---|---|
| **ENH-177** Claude session resume banner | Still queued — re-shipping Sprint 21 bundled with ENH-181 (banner inline rename + collapse toggle). |
| **ENH-178** Browser blocklist three modes | ✅ Shipped v0.7.8 ([d851296](https://github.com/dudgeon/duo/commit/d851296)). |

## Process memory locked Sprint 20

- [feedback_open_every_modal_before_smoke_handoff](../../.claude/projects/-Users-geoffreydudgeon-Documents-GitHub-duo/memory/feedback_open_every_modal_before_smoke_handoff.md) — every modal/dropdown in a smoke-walk manifest gets opened via computer-use BEFORE handoff. Locked from BUG-153 (ENH-170 v1 modal occlusion under browser-pane WCV).

## Build / repo state

- Test count: 698 green (35 files; ENH-178 restored 11 browser-manager `isLocalUrlForBrowserMode` cases).
- Typecheck clean.
- `dist/Duo-0.7.8-arm64.dmg` (104 MB) signed + notarized + validated + uploaded to [GitHub Release v0.7.8](https://github.com/dudgeon/duo/releases/tag/v0.7.8).
- Dev session running under v0.7.9 identity (post-cut bump).

## CLI driving etiquette (still in effect)

- Avoid `duo edit --reveal` and computer-use clicks unless owner is actively expecting eyes-on.
- Prefer `duo doc read <path>` over `duo edit <path>` for inspection.
- For modal/menu verification, ASK owner before invoking computer-use.

## When you next have context

1. Re-ship ENH-177 + ENH-181 (banner + inline rename + collapse toggle).
2. Pick Sprint 21 carry-forward items from the backlog above.
