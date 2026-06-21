# ENH-223 PRD — Scheduled ("cron") Claude Code sessions

> **Renumbered 2026-06-21 (collision avoidance):** this feature was **ENH-221**
> (now reassigned to file-history); the "waiting on you" attention badge sibling
> moved **ENH-223 → ENH-225**. Older commits / handoffs may say ENH-221.
> **Status:** spec locked 2026-06-20. Ready to build.
> **Owner decisions:** intent refined via AskUserQuestion (4 framing answers),
> then 10 design decisions locked via the decision playground (this doc § 3).
> **References:**
> - [docs/research/enh-223-scheduled-sessions.html](../research/enh-223-scheduled-sessions.html)
>   — the decision playground (10 cards; all answered, recommendations accepted).
> - Claude Code CLI primitives confirmed via `claude-code-guide` (this doc § 5).

---

## 1. What we're building

A **scheduler for interactive Claude Code sessions**. A *job* is a saved recipe
— a working directory, an initial instruction, a periodicity, and a
same-session-vs-fresh choice — that Duo fires on schedule by opening a real
interactive Claude Code terminal tab seeded with the instruction, then **handing
control to the user**. Duo only ever performs *session start + initial
instruction*; all actual execution stays interactive.

- **Create** a job from a small dialog (working dir · initial instruction ·
  fresh/same session · periodicity · missed-run behavior).
- **View / manage** jobs on the **Home** view — nested under their parent
  project's card, aggregated into a "Scheduled" block when the project isn't a
  surfaced hero/spine card. Each job shows last-run status + next-fire time.
- **Run** = a background terminal tab in the resolved window (no focus steal),
  launched via Claude Code's own primitives.
- **CLI parity:** the full lifecycle is reachable from `duo cron …`.

**The one hard constraint that shapes everything.** Interactive runs require a
real Claude TUI inside a Duo tab, so a job can **only fire while Duo is open**.
The scheduler is an **in-app next-fire timer**, not a system daemon. There is no
headless execution in v1 — that is deliberately gated off (§ D4).

**Out of scope for v1 (logged as future work, § 6):**

- Headless (`-p`/`--print`) autonomous runs — the whole reason the feature flag
  exists; off until designed (permissions, safety, output capture).
- System-scheduler (`launchd`) launch of Duo at a job's time → **ENH-222**.
- A full run-history / run-log surface — v1 is last-run + status only.
- Auto-approval of tool-permission prompts during a run (runs are interactive;
  prompts are expected, and the attention badge is how you find them).

---

## 2. Why now / problem

Duo's premise is human+agent pair-work. Today every Claude session is started by
hand. Recurring intent — "every morning, review my open PRs"; "nightly, audit
deps"; "weekly, clean the branch list" — has no home. A system `crontab` can't
serve it without going headless, which discards the interactive, in-the-loop
model Duo is built around. Duo already owns the pieces (PTY spawn + env stamps,
the socket CLI, session detection/`buildResumeCommand`, the Home re-entry
surface, the project model) — nothing joins them into "run this Claude command
on a schedule, interactively."

---

## 3. Locked decisions

| # | Decision | Lock |
|---|---|---|
| **Framing — locked in the intent round (AskUserQuestion, 2026-06-20)** | | |
| F1 | Run landing | **New tab, no focus steal.** A run opens a background terminal tab; it never interrupts current work. Paired with the F2 attention badge so it's still discoverable. |
| F2 | "Waiting on you" signal | A new **tab attention indicator** (cron *and* normal sessions) marks a tab whose Claude session is idle awaiting input/permission. |
| F3 | Schedule UX | **Presets + advanced cron** — friendly presets (hourly · daily at HH:MM · weekdays · weekly on day) plus an advanced raw cron field with a live human-readable preview. |
| F4 | Observability | **Last run + status only** for v1 (ran / never / missed / waiting). No run-log view. |
| F5 | Missed-while-closed | A **preference** (global default + per-job override): default skip, opt-in "run once on next launch." Multiple missed occurrences collapse into a single catch-up run. |
| **Design — locked in the playground (2026-06-20)** | | |
| D1 | Storage shape & scope | **App-global `~/.claude/duo/cron-jobs.json`** (sibling to `projects.json`/`settings.json`). Jobs are app-wide; the file holds the recipe + per-job run pointers. Not in the session envelope, not in `settings.json`. |
| D2 | Initial-instruction delivery | **Claude's positional prompt.** Fresh: `claude "<instruction>"`. Same: `claude --resume <uuid> "<instruction>"`. One primitive, no keystroke-timing race; the assembled command string is what § D4 validates. |
| D3 | Same-vs-fresh semantics | **Pre-allocate the uuid; resume it; fall back to fresh if missing.** Each run Duo mints the session id and starts with `claude --session-id <uuid> "…"`, storing it on the job (a Duo-minted pointer — no filesystem sniffing). Next "same" run does `claude --resume <uuid> "…"` **from the same cwd** (Claude scopes id lookup to the project dir); if the JSONL is gone, start fresh and note it. Honors no-sidecar (ENH-183 D9). |
| D4 | Headless (`-p`) enforcement | **Validate & reject** at spawn time. If the assembled command contains `-p`/`--print`/`--output-format`/`--bare`/piped-stdin **and** `features.headlessCron` is false (default), refuse with a clear message. Belt-and-suspenders: the UI never offers headless *and* the runtime blocks it. The flag is **not exposed in the UI**. |
| D5 | Missed-run default | **Default skip; opt-in "run once on next launch."** No surprise tab storm after a cold launch; power users flip the per-job (or global) toggle. (Implements F5's default position.) |
| D6 | Home surfacing layout | **Nested under surfaced projects + one aggregated "Scheduled" block for the rest.** A job's home is its project card; jobs whose project isn't a hero/spine card collect in a single "Scheduled" section so nothing is hidden. |
| D7 | Create / manage entry points | **Home "+ Schedule" on a project card · project-rail right-click · `File ▸ New Scheduled Job…` menu item · full `duo cron` verbs.** *(Owner note: File-menu entry added.)* Manage actions (run-now / pause / edit / delete) via Home row actions + CLI. |
| D8 | Scheduler engine | **Add a small, well-tested cron-parser dependency** (e.g. `cron-parser` + a human-readable describer). Schedule off "next occurrence" timers, not a tick loop. Handles the DST/timezone edges presets+advanced cron require. |
| D9 | Attention badge (F2 build) | **Sibling ENH-225, landing alongside cron.** A Duo-managed `Stop` (+ permission) hook posts `{session_id, state}` to Duo's **existing Unix socket**; main flips a per-tab "needs attention" flag. Decoupled so cron isn't blocked if it slips; benefits all sessions. |
| D10 | Run-landing window | **Project-affinity, then primary.** Resolution order: **(1)** if **exactly one** open window has the job's target project as its active/focused project, land there *(owner note)*; **(2)** else the lowest-id primary window (Duo's default identity resolution, never focus); **(3)** if no window is open, the run is a "missed" run governed by § D5. |

---

## 4. Data model

`~/.claude/duo/cron-jobs.json` (app-global, atomic write like the other Duo
stores):

```jsonc
{
  "version": 1,
  "jobs": [
    {
      "id": "job_<uuid>",
      "name": "Morning triage",
      "cwd": "/Users/.../GitHub/duo",
      "instruction": "review open PRs and summarize what needs my attention",
      "session": "fresh",            // "fresh" | "same"
      "schedule": { "kind": "preset", "preset": "daily", "at": "09:00" },
                                     // or { kind: "cron", expr: "0 9 * * 1-5" }
      "catchUpOnLaunch": false,      // per-job override of the global default (D5/F5)
      "enabled": true,               // pause/resume (D7)
      "lastSessionId": null,         // Duo-minted pointer for "same" (D3); null until first run
      "lastRunAt": null,             // ISO; for the status chip (F4)
      "lastRunState": null           // "ran" | "missed" | "fresh-fallback" | null (F4)
    }
  ],
  "settings": {
    "defaultCatchUpOnLaunch": false  // global default behind the per-job override (D5/F5)
  }
}
```

- **`features.headlessCron`** (D4) lives wherever the app's other internal flags
  read from (not in this file, not in the UI); defaults `false`.
- All other state (which sessions exist, live processes, project membership) is
  read **live** — no mirroring (ENH-183 D9 / CLAUDE.md #12). The only persisted
  pointer is `lastSessionId`, minted by Duo on an actual run.

---

## 5. Confirmed Claude Code primitives (`claude-code-guide`)

| Need | Primitive |
|---|---|
| Fresh interactive run w/ seeded prompt | `claude "<instruction>"` (stays interactive) |
| Pre-allocate a tracked session id (D3) | `claude --session-id <uuid> "<instruction>"` |
| Same-session continue (D3) | `claude --resume <uuid> "<instruction>"` — **same cwd only** |
| Branch without mutating the thread | `--fork-session` (available; not the default for "same") |
| Headless triggers to **gate** (D4) | `-p` / `--print`, `--output-format`, `--bare`, piped stdin |
| Attention signal (D9) | `Stop` (+ permission) hook → write `{session_id, state}` to Duo's Unix socket |

---

## 6. Build sequencing

| Tier | Ships |
|---|---|
| **1 · Engine + CLI** | `cron-jobs.json` store · `CronScheduler` (next-fire timers, missed-run catch-up per D5) · spawn-into-tab via the D2 primitive · fresh/same (D3) · D4 `-p` gate · window resolution (D10) · full `duo cron list\|add\|run\|pause\|resume\|rm\|show`. Headless even with a minimal Home read. |
| **2 · Home surface** | Inline-under-project cards + aggregated "Scheduled" block (D6) · status chips (F4) · the create dialog + `File ▸ New Scheduled Job…` + project-rail entry (D7) · row actions (run-now / pause / edit / delete). |
| **3 · Attention (ENH-225)** | The "waiting on you" tab badge (D9/F2) — sibling ENH benefiting all sessions; cron is its best demo. |

**Logged future ENHs (not in this scope):**

- **ENH-222** — system-scheduler (`launchd`) agent that *launches Duo* at a
  job's time, so runs fire even when the app was closed. The honest path to
  "unattended-ish" without going headless.
- **ENH-225** — the F2/D9 attention indicator (tracked above; built alongside).
- **Headless (`-p`) runs** — gated by the default-off `features.headlessCron`
  flag; a future, deliberately-enabled autonomous mode.
- **Full run history / log view** — beyond v1's last-run + status.

---

## 7. Open questions (tracked, not blocking)

- **Overlapping fires** — if a job's previous run tab is still active when the
  next fire arrives: proposal **skip with a "still running" note** (revisit).
- **Sleep/wake** — a fire whose time passed during system sleep is treated like
  a while-closed miss (D5) once the app wakes.
- **Permission prompts mid-run** — expected (interactive); no auto-approve in
  v1; the D9 badge surfaces them.
- **Timezone / DST** — presets are local-time; the D8 parser owns advanced-cron
  DST behavior.
- **Env / shell** — runs inherit the standard Duo PTY env stamps
  (`DUO_SESSION`, `DUO_WINDOW`, `DUO_SOCKET`, …) like any Duo terminal.

---

## 8. CLI surface (the spec — sync across the 4 surfaces)

| Verb | Does |
|---|---|
| `duo cron list` | List jobs with next-fire + last-run status. |
| `duo cron add` | Create: `--cwd --say "<instruction>" --every <preset\|cron> --session fresh\|same [--catch-up]`. |
| `duo cron run <id>` | Fire now (manual), same path as a scheduled fire. |
| `duo cron pause / resume <id>` | Disable/enable without deleting. |
| `duo cron rm <id>` | Delete a job. |
| `duo cron show <id>` | Inspect one job's recipe + last-run pointer. |

Final verbs sync across `cli/duo.ts`, `skill/SKILL.md`, `agents/duo.md`,
`docs/CLI-COVERAGE.md` (CLAUDE.md #3).

---

## 9. Implementation notes — Tier 1 (engine + CLI), 2026-06-20

Tier 1 shipped: the store, scheduler, run path, `-p` gate, window resolution,
and the full `duo cron` cluster. Module map:

- `core/cron-schedule.ts` — pure schedule math (preset/cron → next-fire +
  describe + arg parsing).
- `core/cron-command.ts` — pure `claude` command building + shell-quoting +
  the D4 headless gate (`assertInteractiveCommand`).
- `core/cron-store.ts` — `cron-jobs.json` persistence (injectable `baseDir`,
  atomic write, write-queue serialized).
- `core/cron-service.ts` — Electron-free orchestrator (tick scheduler,
  catch-up, fresh/same decision, CLI dispatch). Deps (runner, `sessionExists`)
  injected so it unit-tests with fake timers + a mock runner.
- `electron/main.ts` — constructs `CronService` in `whenReady` (runner =
  `dispatchNewTabToWindow({ kind:'shell', cwd, cmd })` + `resolveCronLandingWindow`
  for D10; `sessionExists` via `encodeProjectDir`), starts/stops it across the
  app lifecycle, and exposes `NavBridge.cron`.
- `core/socket-server.ts` — `case 'cron'` → `nav.cron(op, args)`.
- `cli/duo.ts` — `case 'cron'` cluster + a `Scheduling` help group.
- `shared/types.ts` (`CronJob`/`CronJobsFile`/`CronSchedule`/`CronJobView`) +
  `shared/feature-flags.ts` (`FEATURE_HEADLESS_CRON = false`).

**Deviation from D8 (tracked, not hidden).** D8 locked "add a small cron-parser
dependency." Tier 1 ships a **self-contained, dependency-free engine** in
`core/cron-schedule.ts` instead — it builds and tests offline (the cloud
build environment is network-gated and has no cron lib) with a clean
esbuild/electron-vite bundle, and supports the full preset set + standard
5-field cron (lists/ranges/steps, dom/dow either-match, DST-correct local-time
next-fire by minute-stepping). The whole surface is isolated behind
`nextFireAfterSchedule` / `describeSchedule` / `parseScheduleArgs`, so swapping
in `cron-parser` (+ a describer) later — if richer expressions or a fancier
human-readable preview are wanted — is a one-file change. Satisfies D8's intent
(don't re-derive next-fire ad hoc per call) without the dependency risk.

**Deviation status — owner-sanctioned (2026-06-20, local session).** Re-raised
with the owner now that we're local with network. Owner delegated the call
("make a pragmatic choice"); decision is to **keep the dependency-free engine**
for Tier 1 rather than destabilize a tested, working foundation immediately
before live verification. **Revisit trigger:** Tier 2's advanced-cron field
(F3) needs a *live human-readable preview* — `describeSchedule` currently only
echoes the raw expression for `kind: 'cron'`. When that surface is built, either
hand-roll a describer for the common grammar or swap in `cron-parser` +
`cronstrue` (the locked-D8 path). The isolation behind the three functions keeps
that a one-file change.

**No-window fire → `"missed"` (2026-06-20, local session).** D10(3) says a fire
with all windows closed is a "missed" run governed by D5; Tier 1 originally
recorded it as `"error"`. Owner confirmed `"missed"`. Implemented: the `main.ts`
runner returns `{ ok: false, reason: 'no-window' }` when `resolveCronLandingWindow`
finds no open window, and `CronService.fireJob` maps that reason to
`lastRunState: 'missed'` **without advancing `lastRunAt`** (so D5 catch-up still
anchors on the last *real* run and the missed occurrence stays recoverable on
relaunch). Locked by a cron-service unit test.

**Verified (unit):** 56 cron unit tests + the full suite (1647) green; typecheck
clean (node + web); CLI builds, `--help` renders the `Scheduling` group,
arg-validation correct; `check:skill-currency` passes (4-surface sync).

**Live walk — DONE (2026-06-20, local session).** Exercised against a running
dev build; verified by inspecting `cron-jobs.json` + the spawned `claude`
session JSONLs (proof the command actually ran) + per-window `term tabs`:

- **Fresh run** — `cron run` spawns a tab running `claude --session-id <uuid>
  '<instruction>'`; the JSONL's session id matches the minted `lastSessionId`
  and contains the seeded prompt. ✓
- **D3 same-session** — run 1 fresh (mints uuid), run 2 **resumes** the same
  uuid (`lastSessionId` unchanged, state `ran`), run 3 after deleting the JSONL
  **falls back to fresh** (new uuid, state `fresh-fallback`). ✓
- **Scheduled fire** — a near-future `--cron` fired at the minute boundary
  (within one 30 s tick), state `ran`. ✓
- **D5 catch-up** — a backdated catch-up job fires once on launch (spawns
  claude); a non-catch-up job with the same missed occurrence does **not**. ✓
- **D10 landing** — a job whose project is focused in exactly one window lands
  there (single-match branch); every unmatched (`/private/tmp`) job lands in the
  primary window (fallback). ✓
- **Verb cluster** — `list / show / pause / resume / rm` all behave. ✓
- **D4 headless gate** — not CLI-reachable (the instruction is a quoted
  positional prompt, never a flag); `FEATURE_HEADLESS_CRON=false` and
  `assertInteractiveCommand` confirmed in code + unit tests. ✓

**Two bugs found in the live walk and FIXED (the unit-tested mock runner could
not surface either):**

1. **F1 focus steal.** Cron used the generic new-tab path
   (`renderer/App.tsx onNewTabRequest`), which unconditionally
   `setActiveTabId`s the new tab → a run *stole focus*, contradicting F1's
   "background tab." Fix: a `background?: boolean` on `NewTabRequest`
   (`shared/host-api.ts`); the renderer skips activation when set; the cron
   runner passes `background: true`. Verified: a run no longer changes the
   active tab.
2. **Catch-up clobbered at launch.** `CronService.start()` ran catch-up the
   instant `whenReady` fired — first racing renderer mount (new-tab IPC timed
   out → state `error`, no tab), then (after a `did-finish-load` gate) racing
   *session restore*, whose wholesale `setTabs(restored)` wiped the catch-up's
   background tab (tab created → state `ran` → wiped → claude never ran). Fix: a
   `SESSION_STATE_RESTORE_SETTLED` signal — the renderer fires it once its
   restore chain settles (`sessionHydrated`), and main gates the scheduler start
   on the **primary** window's signal (timeout fallback so it always starts).
   Verified: catch-up now spawns claude into a surviving background tab.

**Note for ENH-225 (attention badge):** cron tabs are `kind: 'shell'` (claude
runs *inside* the shell via `--cmd` — `kind: 'claude'` would double-launch).
Presence is process-based and the D9 badge keys on `session_id`, so neither
needs `kind: 'claude'` — but ENH-225 must surface the badge on these
shell-hosted claude tabs.

---

## 10. Status (2026-06-21) — Tier 2 COMPLETE (inc 1+2+3) + audited + integrated

**Tier 2 increment 1 — Home "Scheduled" block (DONE, live-verified).** Engine→
renderer plumbing: a `CronService.onJobsChanged` change-emitter → a
`CRON_JOBS_CHANGED` broadcast, and a single `CRON_INVOKE` invoke channel that
reuses the **same `handleCli` the socket CLI uses** (one code path for CLI + UI).
`CronSection` renders one row per job — status chip (ran/never/missed/error/
paused), schedule label, next-fire, project, + row actions (Run now / Pause /
Resume / Delete with a 2-click confirm). Invisible when there are no jobs.

**Tier 2 increment 2 — create/edit dialog + entry points (DONE, live-verified).**
`NewCronJobModal` (create + edit): preset segmented control (Hourly/Daily/
Weekdays/Weekly/Custom-cron) + conditional time/weekday/cron fields + a
**debounced F3 live preview** (the `preview` op validates in main → label +
next-fire), session radio, catch-up checkbox. Entry points (D7): a
`duo-open-cron-modal` CustomEvent (Home "+ New job" + per-row Edit + project-rail
right-click) and a `CRON_OPEN_NEW_MODAL` push for **File ▸ New Scheduled Job…**.
**CLI parity verb `duo cron edit`** (+ `edit`/`preview` `handleCli` ops, 4-surface
docs). The modal parks the browser WCV (BUG-209 lineage) so it isn't occluded.

**Adversarial audit (multi-agent, 8 confirmed / 6 refuted) — 7 fixed.** HIGH:
modal persisted a non-absolute cwd → silent `$HOME` run (now absolute-required +
a server `assertCwdAbsolute` guard). MED: `fireJob` catch didn't reschedule →
tight retry loop on a persist throw (now reschedules). LOWs: fire-time cwd stat,
reject unschedulable cron (Feb 30) on add/edit/preview, `fromSchedule` default,
`canSave` preview-pending gate, bare-`duo cron` usage string, IPC-error prefix
strip.

**Audit #8 — RESOLVED (2026-06-21, hand-rolled, per owner D8).** The Custom-cron
preview no longer echoes the raw expression: `describeCron` renders a 5-field
cron in natural English ("every weekday at 09:00", "every 15 minutes", "at
09:00 on the 1st and 15th of each month"), feeding the F3 preview + Home rows +
CLI `list`/`show` via `describeSchedule`. Dependency-free (no `cronstrue`),
honesty-biased — echoes the raw expression for anything it can't render
faithfully. A second adversarial multi-agent pass (47 agents grounding every
claim against the engine's real next-fire times) caught two lie-classes my
happy-path tests missed, both fixed: (a) non-dividing `*/N` steps that reset at
the hour/day wrap ("every 7 minutes" isn't uniform — `detectStep` now requires
the step to divide 60/24), and (b) impossible calendar dates ("31st of April"
never fires — the day-of-month branch now echoes when a (day, month) pair is
calendar-impossible). Commit `6dd555c`.

**Tier 2 increment 3 — D6 per-project nesting (DONE, live-verified, commit
`c2571ba`).** Cron jobs now nest under their project's hero/spine card on Home;
the aggregated "Scheduled" block holds only the remainder (jobs whose project
isn't a surfaced card) so nothing is hidden. Adds the D7 per-card "+ Schedule"
affordance (seeds the dialog with the project cwd). Extracted a reusable
`CronJobRow` (+ `useCronJobs`, `NewScheduleButton`); a pure
`assignCronJobs(jobs, allRoots, surfacedRoots)` splits jobs by deepest-enclosing
root (`shared/projects` `deepestEnclosingRoot`); surfaced = 2 heroes + visible
spine. Heroes nest jobs + "+ Schedule" always; spine rows show a "⏱ N" count
collapsed and the nested block when expanded. **Live-verified** (`duo dom`): a
subdir job nests under its deepest-enclosing hero card, a `/tmp` job falls to the
aggregated block, "+ Schedule" opens the dialog seeded with the project cwd, the
spine badge + expand-nesting render, and a row Pause round-trips. The native
File-menu + rail entry points dispatch the SAME verified modal-open path; their
native-menu click-leg is for the owner-walked `/smoke-walk`. **Tier 2 is now
complete (D6 + D7 fully implemented).**

**Integration (commit `58953e9`).** Merged `origin/main` (#100/#99/#101/#105/#104)
into the branch — all 13 plumbing files auto-merged; only `tasks.md` +
`session-log.md` hand-resolved (keep-both). **PR #103 is `MERGEABLE`/`CLEAN`.**
Per owner (2026-06-21), **#103 may merge BEFORE #102** (`duo-file-open-flow`) if
it wraps first — so it integrates onto the *current* main (no #102), and #102
rebases onto a main that already includes cron.

**Verified:** 19 cron-service + 31 cron-schedule + (homeModel) 6 assignCronJobs
unit tests + full suite (**1702**) green; typecheck clean; `check:skill-currency`
(75 verbs) passes. PR #103 `MERGEABLE`.

**Still owed:**
1. **`/smoke-walk`** — the only unexercised leg is the **native** File ▸ New
   Scheduled Job… menu + the project-rail right-click (both native Electron
   menus DOM can't drive; both dispatch the already-verified modal-open path).
   Fold into the pre-cut walk.
2. **Cut** Tier 1 + Tier 2 (inc 1+2+3) as the cron **v1** (after #102 also lands,
   per the cut-after-both plan).
3. **ENH-225** — the "waiting on you" attention badge (must surface on cron's
   `kind:'shell'` claude tabs). *(Separate sibling.)*
5. Logged future: ENH-222 (`launchd` launch), headless `-p` mode, full
   run-history view.

