# ENH-221 handoff — scheduled (cron) Claude sessions

> **For:** the local (Mac) session picking this up. **From:** the cloud session
> that locked the spec + built Tier 1. **Branch:** `claude/chron-job-management-yfy4ae`
> · **PR:** #103 (draft).

## State in one paragraph

Spec is **locked** (decision playground + PRD, all 10 decisions + 2 owner
notes). **Tier 1 (engine + CLI) is built, committed, and pushed** — typecheck
clean, 55 cron unit tests + full suite (1626) green, `check:skill-currency`
passes. The ONE thing the cloud session could **not** do is exercise the live
socket round-trip + actual tab spawn against a running Electron app (the cloud
container has no Electron binary). **That live verification is the first job
locally**, before building Tier 2.

## Get the environment

```bash
git fetch origin claude/chron-job-management-yfy4ae
git checkout claude/chron-job-management-yfy4ae
npm install            # runs electron-rebuild (node-pty) — needs the real install, not --ignore-scripts
npm run typecheck      # expect clean
npm run test:run       # expect green (incl. core/cron-*.test.ts)
npm run dev            # launch Duo
```

## FIRST: verify the live run path (the unverified seam)

The run-decision/scheduling logic is unit-tested behind a mock runner; the
untested part is the thin `main.ts` runner wiring (`dispatchNewTabToWindow` +
`resolveCronLandingWindow` + `sessionExists`). Walk it:

1. **Fresh run spawns + seeds the prompt.**
   ```bash
   ./cli/duo cron add --name "Smoke" --cwd "$PWD" --say "say hello and stop" --every daily --at 09:00
   ./cli/duo cron run <id>      # id from the add output / `duo cron list`
   ```
   Expect: a new terminal tab opens (no focus steal) running
   `claude --session-id <uuid> 'say hello and stop'` and Claude starts with that
   as its first message. Confirm `~/.claude/duo/cron-jobs.json` exists and the
   job's `lastSessionId` / `lastRunAt` / `lastRunState: "ran"` were recorded.
2. **Same-session resume (D3).** Set a job to `--session same`, run it twice.
   First run = `--session-id` (fresh); second = `claude --resume <sameuuid> …`.
   Delete the session JSONL between runs and confirm it falls back to fresh
   (`lastRunState: "fresh-fallback"`).
3. **Scheduled fire.** Add a job `--every hourly` or a near-future `--cron`
   (e.g. set `--at` to a minute ~2 min out via `--cron "M H * * *"`), leave Duo
   open, confirm it fires at the minute (tick is 30s).
4. **Catch-up (D5).** Add a job `--catch-up` with a past daily time, quit Duo,
   relaunch — confirm it fires once on launch. Without `--catch-up`, confirm it
   does NOT.
5. **D10 landing window** (multi-window on). Focus window 2 on the job's project
   → run → confirm it lands in window 2; with no/ambiguous match it lands in the
   primary (lowest-id) window.
6. **Headless gate (D4).** It's not reachable from the CLI (instruction is
   quoted), but confirm `FEATURE_HEADLESS_CRON=false` and that the gate exists
   (`core/cron-command.ts` `assertInteractiveCommand`).
7. `./cli/duo cron list | show <id> | pause <id> | resume <id> | rm <id>` all
   behave.

If the live walk reveals wiring bugs, they'll be in `electron/main.ts` (the
`runner.spawn` closure + `resolveCronLandingWindow`) — the pure modules are
solid.

## Decisions worth re-confirming with the owner

- **D8 deviation.** Locked decision was "add a small cron-parser dependency";
  Tier 1 ships a **dependency-free engine** (`core/cron-schedule.ts`) because the
  cloud build env was network-gated. It covers presets + standard 5-field cron
  (lists/ranges/steps, dom/dow either-match, DST-correct local next-fire). Now
  that you're local with network, the owner may prefer swapping in `cron-parser`
  (+ a describer like `cronstrue`) — it's isolated behind
  `nextFireAfterSchedule` / `describeSchedule` / `parseScheduleArgs`, a one-file
  change. Ask before changing.
- **No-window fire records `lastRunState: "error"`** (not "missed") when a
  scheduled tick fires with all windows closed (process alive on darwin). Minor;
  decide if it's worth distinguishing.

## Module map (Tier 1)

| File | Role |
|---|---|
| `core/cron-schedule.ts` (+ test) | preset/cron → next-fire + describe + arg parsing (the self-contained engine) |
| `core/cron-command.ts` (+ test) | `claude` command building + shell-quote + the `-p` gate |
| `core/cron-store.ts` (+ test) | `~/.claude/duo/cron-jobs.json` persistence |
| `core/cron-service.ts` (+ test) | Electron-free orchestrator: tick scheduler, catch-up, fresh/same, CLI dispatch |
| `electron/main.ts` | CronService lifecycle + runner + D10 `resolveCronLandingWindow` + `sessionExists` + `NavBridge.cron` |
| `core/socket-server.ts` | `case 'cron'` |
| `cli/duo.ts` (+ `cli/duo` binary) | `duo cron …` cluster + `Scheduling` help group |
| `shared/types.ts` | `CronJob`/`CronJobsFile`/`CronSchedule`/`CronJobView` + `'cron'` |
| `shared/feature-flags.ts` | `FEATURE_HEADLESS_CRON = false` (D4) |

Docs/4-surface sync: `skill/references/cli-reference.md`, `agents/duo.md`,
`docs/CLI-COVERAGE.md`, `scripts/check-skill-currency.mjs`.

## Housekeeping the cloud session could NOT do

- **`npm run sync:claude`** — copies `skill/` + `agents/` into `~/.claude/`
  (the cloud container's home is ephemeral, so it was skipped). Run it locally
  so the installed skill/subagent reflect the new `duo cron` verbs.
- After any `cli/duo.ts` edit: **`npm run build:cli && git add cli/duo`** (the
  binary is committed).

## What's next (after live verification)

- **Tier 2 — Home surface** (PRD §6): jobs nested under their project's Home
  card + an aggregated "Scheduled" block; status chips; create dialog +
  **File ▸ New Scheduled Job…** + project-rail entry; row actions
  (run-now / pause / edit / delete). Touches `renderer/` → run **`/smoke-walk`**
  before any cut (CLAUDE.md §7b).
- **ENH-223** — the "waiting on you" tab badge (D9): a Duo-managed Stop /
  permission hook posting to Duo's Unix socket; benefits all sessions.
- Logged future: **ENH-222** (`launchd` launches Duo at a job's time),
  headless `-p` mode (the reason `FEATURE_HEADLESS_CRON` exists), full
  run-history view.

## References

- PRD: `docs/prd/enh-221-scheduled-sessions.md` (§3 locked decisions, §9 Tier 1
  impl notes + the D8 deviation).
- Decision playground: `docs/research/enh-221-scheduled-sessions.html`.
- Ledger: `tasks.md` → ENH-221.
- PR #103.
