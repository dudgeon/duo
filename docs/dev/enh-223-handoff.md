# ENH-223 (cron) — REVIEWER BRIEF (2026-06-21)

> **For:** the agent reviewing + merging PR #103.
> **Branch:** `claude/chron-job-management-yfy4ae` · **PR:** #103.
> **Status:** feature COMPLETE — Tier 1 + 2 + 3 + ENH-225, integrated with
> `main`, reviewed, tested, smoke-walked. `MERGEABLE`/`CLEAN`.
> **Numbering note:** this feature was ENH-221 (now file-history's); the badge
> sibling is **ENH-225**. Commits before 2026-06-21 say ENH-221.

## What the PR delivers

**Scheduled ("cron") Claude Code sessions** + the **"waiting on you" tab badge**.

- **Tier 1 — engine + CLI.** `cron-jobs.json` store, tick scheduler, next-fire
  math, D5 missed-run catch-up, spawn-into-background-tab, D3 fresh/resume, D4
  headless `-p` gate (default off), D10 window landing. Full `duo cron
  list|add|edit|run|pause|resume|rm|show`.
- **Tier 2 — Home surface.** Create/edit dialog (`NewCronJobModal`) with a
  debounced F3 live preview, status chips, row actions; **D6 per-project
  nesting** (jobs nest under their hero/spine card; the aggregated "Scheduled"
  block holds only unmatched jobs); **D7 entry points** (Home "+ Schedule",
  project-rail right-click, File ▸ New Scheduled Job…, CLI).
- **Audit #8 — describer.** Hand-rolled `describeCron` (no dependency) renders
  cron as natural English for the F3 preview + Home rows + CLI.
- **Tier 3 — ENH-225 attention badge.** A Duo-managed Claude Code hook
  (Stop/Notification → set, UserPromptSubmit → clear) posts `{tabId, event}` to
  the socket via `duo attention`; main flips a transient per-tab flag; the tab
  strip shows an amber pulse dot (never on the active tab; clears on activity OR
  focus). Tab identity = a new `DUO_TAB` env stamp on every PTY.

## Commit map (review in this order)

| Commits | What |
|---|---|
| `04fecb9`→`d891a6a` | plan + Tier 1 (engine + CLI) |
| `52d4641` `f60a376` `5e251cf` `e8d039d` `66770cb` | Tier 1 live-walk fixes · Tier 2 inc 1+2 · 7 audit fixes |
| `6dd555c` | audit #8 — `describeCron` (+ adversarial-verify fixes) |
| `58953e9` | **merge of `origin/main`** (the only conflict resolution) |
| `c2571ba` | Tier 2 inc 3 — D6 per-project nesting |
| `7af4fcd` | **ENH-225** attention badge |
| `5528636` `2029240` | ENH-225 unit tests + adversarial-review fixes |
| `95c845e` | create-dialog polish (Browse / relabel / interactive note) |

## How it was verified

- **Automated:** typecheck clean · full suite **1714** · `check:skill-currency`
  76 verbs. Logic is unit-tested: `core/cron-{schedule,command,store,service}`,
  `homeModel.assignCronJobs`, `attentionForEvent`, `planManagedHooksMerge`.
- **Live (`duo dom` against a real dev build):** the cron run path (session-JSONL
  inspection), D3/D5/D10, the Home nesting placements, the badge round-trip, and
  — finally — a **real Claude `Stop` lighting the badge** (fired a cron job in a
  trusted dir so no folder-trust prompt blocked it).
- **Adversarial multi-agent reviews:** the describer (caught + fixed two
  lie-classes — non-dividing `*/N` steps + impossible calendar dates) and
  ENH-225/inc-3 (caught + fixed the active-tab false-badge + prune-on-close).
- **Owner smoke-walk v0.11.2:** 3 PASS; the 1 FAIL was an install precondition
  (not code), resolved + re-verified end-to-end. Manifest:
  `docs/dev/smoke-walks/v0.11.2.json`.

## Invariants — don't regress these

- **Cron cwd MUST be absolute** (`assertCwdAbsolute` server guard + modal).
- **Runs open a BACKGROUND tab** (`NewTabRequest.background`) — never focus-steal.
- **Catch-up (D5) waits for `SESSION_STATE_RESTORE_SETTLED`**, not
  `did-finish-load` (restore's `setTabs` clobbers a boot-appended tab).
- **One invoke channel reuses `handleCli`** — CLI + UI on one code path.
- **The badge never shows on the ACTIVE tab** (the Stop hook fires there every
  turn; an `activeTabIdRef` drops that SET — see commit `2029240`).
- **`DUO_TAB` = the renderer's TabSession.id** — the badge keys on it.

## Merge plan + the one cut-time check

- #103 is `MERGEABLE` and may merge **before or after** #102
  (`duo-file-open-flow`) — the integration is already done (commit `58953e9`;
  conflicts were additive, kept-both). The repo **squash-merges**.
- **The attention badge requires the Duo install to have run** — it rides the
  SAME managed-hook install path (`installService.run()`) as the priming/guard
  hooks. At cut time, confirm the install banner re-surfaces on the version bump
  so existing users pick up the new `Stop`/`Notification`/`UserPromptSubmit`
  hooks (this governs ALL managed hooks, not just ENH-225).

## Out of scope (logged future)

Headless `-p` autonomous runs (feature-flagged off), ENH-222 (`launchd` launch
of Duo at a job's time), full run-history view. The "overlapping fires" edge
(PRD §7) is a tracked open question, not a blocker.

## Pointers

- PRD: `docs/prd/enh-223-scheduled-sessions.md` (§3 locked decisions, §9 Tier 1
  impl, §10 = full current status).
- Ledger: `tasks.md` → ENH-223. Session log: `docs/dev/session-log.md`
  (2026-06-20 + 2026-06-21).
- Module map (PRD §9). Renderer: `renderer/components/Home/{CronSection,
  CronJobRow,NewCronJobModal,HeroPanel,SpineRow,HomeView}.tsx`,
  `renderer/components/TabBar.tsx` (badge), `App.tsx` cron + attention wiring.
