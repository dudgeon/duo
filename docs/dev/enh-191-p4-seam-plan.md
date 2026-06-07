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

- Branch `claude/enh-191-multiwindow`, origin HEAD **`189d663`** — rebased onto
  `main` (incl. #74 ENH-203), **0 behind / 58 ahead**. 1057 tests green,
  typecheck clean, lint 0-errors, `check:routing` baseline 0, `check:skill-currency` PASS.
- **P0–P3 SHIPPED** (the registry-of-one read-model — see `enh-191-p3-seam-plan.md`
  + PRD §8.1; adversarial-verify SHIP, 0 blockers).
- **P4 IN PROGRESS** — the persistence layer for per-window state (closes the C8 +
  C13 data-corruption hard gate). Renderer + `SessionStateService`, pure-function
  testable, byte-identical at one window.

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

### [ ] Seam 3 — localStorage triage (move per-window keys OFF the shared bus)
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

### [ ] Seam 4 — `SessionStateService` adopts the v2 envelope
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

### [ ] Seam 5 — migration / prune-isolation / downgrade / concurrent-flush tests
Pure node-env. Migration round-trip + a persisted-field-drop negative control
(seam 1 covers the envelope; add the service-load round-trip). Prune-isolation
(seam 2 covers the fn; add the App.tsx wiring test if feasible). Downgrade
(old-reader-on-v2 → graceful). **Concurrent-flush:** two windows' overlapping
saves both survive the single composed writer; negative control — per-window
`writing` flags FAIL it.

### [ ] Seam 6 — persist the per-window active-workspace pointer in each `WindowState`
P3-S10's persistence home (PRD item 8). At compose, fold `ctx.activeWorkspace`
into that window's `WindowState.activeWorkspace`; at restore, seed
`ctx.activeWorkspace` from it. Extend the migration round-trip test to assert it
survives flat→envelope. Confirm `auxTabId` round-trips per window.

## Then P5 (after P4) — the FIRST user-visible release (flag-gated)
P5a = open window 2 (reentrant `createWindow`) + terminal-origin CLI addressing
(`DUO_WINDOW` consumer) behind `multiWindow.enabled`; P5b = explicit `--window`
surface. See PRD §4 P5. P5 is where the P3 `only()` fail-loud placeholders +
the dormant `DUO_WINDOW` stamp get consumed. KEEP EXECUTING through it too.

## Key locked constraints (do NOT re-decide — PRD §4 P4)
- `{windows: WindowState[]}` envelope (locked). Single serialized writer (compose,
  don't per-key the flag). Per-window keys = new names, old keys left unread.
  SCHEMA_VERSION bump gates the new shape; downgrade returns empty.
- P4→P3 is RELEASE-isolation, not a hard code dependency — P4 builds on the branch
  fine without P3 merged.
