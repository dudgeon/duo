# ENH-223 (cron) — RESUME (2026-06-21)

> **For:** the next session picking this up (likely post-compaction).
> **Branch:** `claude/chron-job-management-yfy4ae` · **PR:** #103 (draft).
> **Renumbered:** this feature was ENH-221 (now file-history's); the attention
> badge sibling moved ENH-223 → **ENH-225**. Older commits say ENH-221.

## State in one paragraph

**Scheduled ("cron") Claude sessions** — Tier 1 (engine + CLI) and **Tier 2
increments 1 + 2** are **built, live-verified, audited, committed, and pushed**.
Users can create / view / edit / run / pause / resume / delete scheduled jobs
from the **Home "Scheduled" block** + a **create/edit dialog** (with an F3 live
preview) + the **full `duo cron` CLI** (`list|add|edit|run|pause|resume|rm|show`).
A multi-agent adversarial audit found 8 real issues; 7 are fixed (1 deferred —
the advanced-cron describer, an owner dep decision). typecheck clean · full suite
**1654 green** · `check:skill-currency` (74 verbs) passes. The work is at a
**clean, shippable milestone**.

## Resume plan (do in order)

0. **Merge ORDER (owner, 2026-06-21):** this branch merges **after**
   `claude/duo-file-open-flow-g3rpdx` (which was rebasing concurrently). So
   **wait for that branch to land on `main`, then rebase onto the updated
   `main`** (it touches overlapping plumbing too — rebasing onto a main that
   already includes it avoids a double conflict resolution). Coordinate the
   shared Electron dev: **ask the owner before launching `npm run dev` / using
   Electron** (other agents share the app-global socket — I released it to the
   duo-file-open-flow agent at handoff time).
1. **Rebase onto the updated `origin/main`** (best with fresh context).
   As of 2026-06-21 `origin/main` was **6 commits ahead** of the `df26ddf` fork
   point (will be more once duo-file-open-flow lands); we're 11 ahead. **~13
   overlapping files**, all shared plumbing: `shared/types.ts`, `host-api.ts`,
   `electron/main.ts`, `electron/preload.ts`, `renderer/App.tsx`,
   `core/socket-server.ts`, `cli/duo.ts`, `agents/duo.md`, `docs/CLI-COVERAGE.md`,
   `skill/references/cli-reference.md`, `docs/dev/session-log.md`, `tasks.md`,
   `cli/duo` (binary). Conflicts are mostly **additive** — cron ADDS to enums
   (`DuoCommandName`, the `IPC` object), switch statements (socket-server `case`,
   the cli `case 'cron'`), the preload `cron:` namespace, `ElectronAPI`, and doc
   tables. Resolve by **keeping both sides**. After: `npm install` (electron-
   rebuild), `npm run typecheck`, `npm run test:run` (expect 1654+), rebuild the
   cli binary if `cli/duo.ts` changed (`npm run build:cli && git add cli/duo`),
   then a quick live re-check of `duo cron add/run` against a fresh `npm run dev`.
2. **`/smoke-walk`** via the Skill tool (touches `renderer/` → required before a
   cut). It must exercise the **native File ▸ New Scheduled Job… menu** and the
   **project-rail right-click "New Scheduled Job…"** — those use the verified
   open path but the *native menus* were never driven headlessly. Also walk:
   create → fire (a tab spawns in the background, no focus steal) → Edit → the
   status chips → delete-confirm.
3. **Cut a version** with Tier 1 + Tier 2 inc 1+2 as the cron **v1** (use the
   `cut-version` skill). This is a coherent, complete capability — ship it.
4. **Then** (post-v1, optional polish): **Tier 2 increment 3** — D6 per-project
   nesting (jobs nested under their hero/spine card via `deepestEnclosingRoot`
   from `shared/projects.ts`; the aggregated "Scheduled" block keeps only
   unmatched jobs). Extract a reusable `CronJobRow` from `CronSection`. Add a
   per-card "+ Schedule" affordance.
5. **ENH-225** — the "waiting on you" attention badge (D9/F2): a Duo-managed
   `Stop` (+ permission) hook posts `{session_id, state}` to Duo's Unix socket;
   main flips a per-tab needs-attention flag. **Must surface on cron's
   `kind:'shell'` claude tabs** — key the badge on `session_id` (presence is
   process-based, the badge keys on the session, so neither needs `kind:'claude'`).

## Invariants / gotchas — don't regress these

- **Cron job cwd MUST be absolute** (audit HIGH fix). The CLI absolutizes via
  `resolveFilePath`; the modal requires absolute + a server `assertCwdAbsolute`
  guard. A relative/typo'd cwd would silently run the job in `$HOME`.
- **F1 — runs open a BACKGROUND tab** (`NewTabRequest.background` flag); never
  re-introduce focus-steal.
- **Catch-up (D5) waits for `SESSION_STATE_RESTORE_SETTLED`** (primary window),
  not `did-finish-load` — restore's wholesale `setTabs` clobbers a tab appended
  during boot. See memory `feedback_cron_catchup_waits_for_restore_settled`.
- **One invoke channel reuses `handleCli`** — keep CLI + UI on the one code path.
- **Killing the dev: kill the zsh-wrapper ROOT** (electron-vite respawns its
  child). `pkill -f "<worktree>/node_modules"` + kill the npm/zsh root.
- **Audit #8 — RESOLVED (2026-06-21, commit `6dd555c`).** Hand-rolled
  `describeCron` (no dep, per owner D8) renders cron in natural English for the
  F3 preview + Home rows + CLI `list`/`show`; honesty-biased (echoes anything it
  can't render faithfully). An adversarial multi-agent pass caught + fixed two
  lie-classes (non-dividing `*/N` steps; impossible calendar dates). The
  describer lives entirely in `core/cron-schedule.ts` — NOT a rebase-overlap
  file, so it won't conflict.
- **Electron access** — request it from the owner (don't assume); a prior
  `request_access` timed out unactioned.

## Pointers

- PRD: `docs/prd/enh-223-scheduled-sessions.md` (§3 locked decisions, §9 Tier 1
  impl + live-walk, **§10 = current status**).
- Session log: `docs/dev/session-log.md` (2026-06-20 + 2026-06-21 entries).
- Ledger: `tasks.md` → ENH-223 (+ ENH-225 for the badge).
- Module map: PRD §9. Renderer: `renderer/components/Home/{CronSection,
  NewCronJobModal}.tsx`, `App.tsx` cron wiring, `ProjectRail.tsx`.
