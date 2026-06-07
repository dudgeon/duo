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

## Where things stand (2026-06-07)

- Branch `claude/enh-191-multiwindow`, origin HEAD **`8266924`**. 1075 tests
  green, typecheck clean, `check:routing` baseline 0.
- **P0–P3 SHIPPED** (the registry-of-one read-model — see `enh-191-p3-seam-plan.md`
  + PRD §8.1; adversarial-verify SHIP, 0 blockers). **P0–P3 spine handed off for
  merge** at the boundary commit `997f8e4` via branch `claude/enh-191-p0-p3`
  (the separate merge session opens that PR; this session keeps building +
  rebases when it lands).
- **P4 COMPLETE** (all 6 seams, this session) — the persistence layer for
  per-window state (closes the C8 + C13 data-corruption hard gate). Renderer +
  `SessionStateService`, byte-identical at one window. **Code-complete; the Cut-3
  smoke-walk + cut are the SEPARATE session's job, NOT this one.**
- **NOW: P5** — the FIRST user-visible release (flag-gated). See "Then P5" below
  + PRD §4 P5. Execute continuously; pause ONLY for a genuine NEW owner-decision
  the PRD doesn't lock (P5 has a few — flag default, entry-point UX, the
  `duo events` per-window decision).

## Gate (run INSIDE the worktree; vitest excludes `.claude/worktrees/**` from the primary root)
`cd /Users/geoffreydudgeon/Documents/GitHub/duo/.claude/worktrees/enh-191 && npm run typecheck && npm run check:routing && npm run test:run`

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
- **[ ] S3c — `duo window new` verb (4-surface)** — NEXT: menu/CLI parity (CLAUDE.md §4).
  socket-server `window` case → bridge → `openNewWindow`; `DuoCommandName` += `window`;
  `cli/duo.ts` verb + help + `npm run build:cli`; skill/SKILL.md + agents/duo.md +
  docs/CLI-COVERAGE.md + `check:skill-currency` (absorbs old S7). `--cwd` optional.
- **[ ] S4 — windowId on the wire**: `windowId?` on `DuoRequest` + `cli/duo.ts`
  threading; consume the dormant `DUO_WINDOW` PTY stamp (resolution order:
  `--window` > `DUO_WINDOW` > focused fallback); `SocketServer.handle` resolves
  windowId→context (clean `no such window: N` error).
- **[ ] S5 — N-window restore + geometry**: restore all persisted windows
  (flag-gated); **flag-off must NOT prune the dormant `WindowState`s** (PRD §7.2 /
  line-970 gap — preserve unloaded slots); per-window bounds.
- **[ ] S6 — `duo doctor` window count + macOS Window menu** (NFR-4.4 / NFR-5.1).
- **[ ] S7 — four-surface CLI doc-sync** for `duo window new` (CLAUDE.md §3:
  cli/duo.ts + skill/SKILL.md + agents/duo.md + docs/CLI-COVERAGE.md) +
  `check:skill-currency`.

Then **P5b** = explicit `--window` across the full ~36-verb surface + `duo windows`
enumeration + tab/aux/split addressing + the `duo events` per-window decision
(PRD §4 P5b — STATE it). P5 consumes the P3 `only()` fail-loud placeholders.

## Key locked constraints (do NOT re-decide — PRD §4 P4)
- `{windows: WindowState[]}` envelope (locked). Single serialized writer (compose,
  don't per-key the flag). Per-window keys = new names, old keys left unread.
  SCHEMA_VERSION bump gates the new shape; downgrade returns empty.
- P4→P3 is RELEASE-isolation, not a hard code dependency — P4 builds on the branch
  fine without P3 merged.
