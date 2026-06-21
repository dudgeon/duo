# Resume after compaction — current state (2026-06-21)
# ⚠ THIS WORKTREE (serene-lumiere-3cccdd) = ENH-224 FILE-OPEN FLOW — full state in `docs/prd/enh-224-file-open-flow.md`

> **Post-compaction orientation (2026-06-21).** This worktree builds **ENH-224**
> (renumbered from ENH-221 — collision with main's file-history ENH-221 #104) on
> branch **`claude/duo-file-open-flow-g3rpdx`** = **PR
> [#102](https://github.com/dudgeon/duo/pull/102)** (rebased on `main`, **MERGEABLE**).
> The vision: one ⌘O surface to *open a doc or clone a repo*, and "open a remote
> GitHub doc like it's local → edit → Propose changes (PR)". **Read the PRD first**
> — `docs/prd/enh-224-file-open-flow.md`: § 3 locked decisions D1–D19, § 6 phases,
> § 6a build status, § 6b change-log (DR1–DR6 resolutions), § 6c Phase-0 follow-ups.
>
> **✅ DONE + live-verified (committed + pushed):**
> - **Phase 0 — the merged ⌘O Open bar** (`renderer/components/OpenBar.tsx`,
>   subsumes VaultQuickSwitcher): fuzzy-find + paste path/URL + Browse… (D17) +
>   Open Recent (D14, `core/open-recents-service.ts` + `OpenRecentsService`
>   singleton in main, shared with `duo recent` + `duo open` record-on-open) +
>   github-repo→prefilled CloneModal + github-file→file-vs-repo choice. Resolver
>   = `core/open-resolve.ts` (`resolveOpenTarget` + `deriveRecentEntry`).
> - **3 Phase-0 follow-ups** (§ 6c): FU1 CloneModal "Choose…" folder picker
>   (`OPEN_PICK_DIR`) · FU2 CloneModal geometry matches the bar (640px + top-anchor)
>   · FU3 ⌘O works from terminal focus (File ▸ Open… menu **registers** the ⌘O
>   accelerator; see memory `feedback_global_shortcut_terminal_focus_menu_accel`).
> - **Phase 1 — "open just this doc"** (`core/open-checkout.ts` `runManagedCheckout`
>   + `OPEN_GITHUB_FILE` IPC + the live OpenBar tile w/ progress panel): a
>   github-file URL → depth-1 clone at the ref into the opaque
>   `~/.claude/duo/checkouts/<owner>-<repo>@<ref>/` → opens like a local file +
>   focuses the folder + records the recent. **DR6 = depth-1 whole-repo** (sparse
>   deferred); **DR2 = always-ask**. Walked live: `octocat/Spoon-Knife/blob/main/README.md`.
>
> - **Phase 1 CLI twin ✅ DONE + tested (2026-06-21):** the `duo open` socket
>   handler (`core/socket-server.ts` case `open`) classifies its target → on a
>   github-file URL runs the SAME managed checkout via a new optional
>   `NavBridge.runManagedCheckout` (wired in `electron/main.ts` to
>   `runManagedCheckout` — one engine, shared with the `OPEN_GITHUB_FILE` IPC) →
>   `nav.edit` + `nav.reveal` + records the recent; auth-missing bounces to
>   `gh auth login`; bare-repo URL still → browser pane. `cli/duo.ts
>   resolveOpenTarget` https-prefixes a scheme-less github host. +4 socket tests ·
>   5-surface doc sync. ✅ **live-verified** (`duo open` Spoon-Knife/README).
> - **Phase 2 — share-back CORE PLUMBING ✅ BUILT + LIVE-VERIFIED (2026-06-21):**
>   net-new git-WRITE core under `core/git/`:
>   `divergence.ts` (P5), `proposal-meta.ts` (D7 prefill), `branch/commit/push.ts`,
>   `fork.ts` (D3 auto-fork), `pr.ts`, `failure-sniff.ts`, `share-back.ts`
>   (`runShareBack` orchestrator). Plus `duo pr create|status|view` (socket
>   `case 'pr'` → dynamic-imports share-back, like `clone`) + 5-surface sync. All
>   state read LIVE from the checkout's git/gh (§12); D4-guarded to
>   `~/.claude/duo/checkouts/`. 42 pure unit tests (spawning `run*` = live-owed).
> - **Phase 2 — UI footer affordance 🚧 BUILT (blind, no Electron):**
>   `renderer/components/ProposeBar.tsx` (footer bar + confirm sheet + morph,
>   D10–D13) mounts under the markdown editor (MarkdownEditor.tsx, gated `!isNew`
>   + `isActive`; a `shareBackTick` bumps on save → re-poll). INERT for ordinary
>   files. New IPC SHARE_BACK_STATUS/DIFF/CREATE (preload `window.electron.pr` +
>   main handlers) → the same `core/git/share-back` engine. probeDiff returns the
>   D7 proposalMeta for the sheet prefill. typecheck clean · prod bundle compiles
>   · 1744 tests. ✅ **LIVE-VERIFIED (2026-06-21):** footer appears on
>   divergence → confirm sheet (heading title + `duo/…-d0dd1f6` branch + real
>   diff) → `duo pr create` → **auto-fork + cross-fork PR #40238** (D3) → footer
>   morphs to "Proposed · View PR" (D13). Bug found+fixed live: `16a23b7`
>   (status-gate — a fresh checkout no longer shows a stranger's head:main PR).
>
> **OWED / NEXT:**
> - **ALL 5 PHASES (0–4) BUILT.** Phases 0–2 LIVE-VERIFIED (PR #40238). **Phase 3
>   (already-local detection D6)** + **Phase 4 (format breadth D8 + escape hatch
>   D4)** built + tested (`976bd64`, `9ac158d`) — **owe a live walk** (re-request
>   Electron): P3 = open a github-file whose repo IS a navigator project → the
>   Open bar's 3rd "Open from your local clone" choice / `duo open` prefers-local;
>   P4 = the "Propose changes" footer in a JSON/YAML + HTML-canvas checkout doc +
>   `duo pr export <path> <dest>`. UI "Save a copy…" affordance deferred (owner UX
>   choice). Test PR #40238 + the fork `dudgeon/Spoon-Knife` are leftover
>   verification artifacts (close/delete if unwanted).
> - **Deferred:** sparse-folder checkout (DR6 optimization) · full-inline modal
>   merge (D15/DM1) · NewVaultModal geometry audit · **UI/CLI symmetry follow-up**:
>   `duo open <github-url>` now opens just-this-doc via the checkout, but the UI
>   *recents-list* reopen of a github-file still routes to the clone modal
>   (`App.tsx openResolvedTarget` — deliberate "clone the whole repo" default).
>   Could route github-file recents through `onOpenGithubDoc` for full symmetry
>   (UI change → needs Electron). Documented as a rule-#4 asymmetry in PRD § 6.
>
> **VERIFICATION + ENV NOTES:**
> - **Electron: owner-granted (2026-06-21); a dev IS running from THIS worktree**
>   (launched `npm run dev` after confirming no other instance — socket up,
>   version matches). Verified the features via `duo dom`/`duo eval` DOM probes +
>   the worktree `./cli/duo` (the on-PATH `duo` symlinks here). If access is
>   later revoked, ASK before re-launching; other agents share the app-global socket.
> - **Dev restart = CLEAN-QUIT first:** `osascript -e 'tell application "Electron" to quit'`
>   (runs `before-quit` → disposes chokidar watchers → no fsevents SIGABRT), THEN
>   `pkill -f 'electron-vite dev'` + relaunch. SIGTERM-ing the app direct causes a
>   benign `fse_instance_destroy` crash report (memory
>   `feedback_pkill_dev_triggers_benign_fsevents_sigabrt`).
> - Latest: `9ac158d` (Phase 4) · `976bd64` (Phase 3) · `59dc65b` (P1–2
>   live-verified docs) · `16a23b7` (status-gate fix) · `e1e33b0` (P2 UI footer) ·
>   `65cc392` (P2 core) · `4419c5e` (P1 CLI twin). typecheck clean · **1750 tests**
>   · currency 76/76 · prod bundle compiles.
> - Leftover state: a real test checkout at `~/.claude/duo/checkouts/octocat-Spoon-Knife@main/`;
>   iCloud `* 2.*` sync-conflict dupes moved to `/tmp/icloud-dupes-backup-d76de1e/`
>   (await owner OK to delete — `rm` of untracked files is auto-denied).
> - Per owner: **"won't ship until the full plan is built"** → no version cut yet.
>
> The ENH-216 / ENH-212 banners below are OTHER worktrees' (shipped) initiatives —
> historical, not this worktree's.
>
> ---

# ⚠ THIS WORKTREE (quizzical-jepsen) = ENH-216 OKF VAULT MODE — full state in `docs/dev/active-sprint.md` § ENH-216 (top section)

> **Read this first.** This file is the cold-start orientation: where the project
> is *right now*, not its history. For per-version shipped detail read the top of
> [`session-log.md`](session-log.md); for the running queue + open owner
> questions, [`active-sprint.md`](active-sprint.md); for the full backlog,
> [`tasks.md`](../../tasks.md). The always-on working rules live in
> [`CLAUDE.md`](../../CLAUDE.md) § "Working style" (1–13) + the path-scoped rules
> under `.claude/rules/`.

## Version state
- **Latest released:** **v0.11.1**.
- **`package.json`:** bumped to **v0.11.2** but **NOT yet cut** — four features are
  merged to `main` and queued for the next cut.
- **The next cut is GATED on PR #102** (`duo-file-open-flow-g3rpdx` — the ENH-224
  unified Open + Clone flow, still a DRAFT). **Do not cut until #102 lands.**

## Merged since v0.11.1 (on `main`, awaiting the v0.11.2 cut)
- **ENH-221 — durable file version history + a real ⌘Z undo fix** (#104). History
  modal: timeline · inline diff · restore-with-confirm. `duo history list|show|restore`.
  Store at `~/.claude/duo/file-history/` (§D9-clean). ADR in `docs/DECISIONS.md`.
- **ENH-222 — worktree lifecycle UX** (#105). Create a worktree from the navigator
  dropdown (slug-validated, no git typing) + graceful removal-recovery (revert to
  main, dismissible banner, never a crash). `duo worktree new|remove`. PRD:
  `docs/prd/enh-222-worktree-lifecycle.md`.
- **ENH-223 — scheduled (cron) Claude sessions** (#103). Create/manage from Home
  (presets + custom cron, live preview, per-project nesting).
  `duo cron list|add|edit|run|pause|resume|rm|show`. PRD:
  `docs/prd/enh-223-scheduled-sessions.md`.
- **ENH-225 — "waiting on you" tab attention badge** (#103). Amber dot when a
  background Claude session stops; clears on focus/activity. `duo attention`.
- **#101 — iCloud sync-conflict duplicate detection** in the materialization check
  (dev tooling only; documented in `CLAUDE.md` § iCloud Drive trap).

## In flight / next move
- **PR #102 (ENH-224 open + clone flow)** is the next to land; the cut waits on it.
- **When #102 merges:** do the doc cleanup held back to avoid colliding with its
  plumbing edits — flip the `tasks.md` Status lines for ENH-221/222/223 to ✅ and
  add a first-class **ENH-225** entry; touch up the CLI docs (`CLI-COVERAGE.md`
  "last updated" + the `duo history` follow-up note, `agents/duo.md` attention-hook
  wording, `skill/SKILL.md` verb map). Then run `/smoke-walk` (via the Skill tool)
  and propose the **v0.11.2 cut** via the `cut-version` skill.

## Locked designs — don't re-derive these (full ADRs in `docs/DECISIONS.md`)
- **File history** is an append-only, content-addressed store captured
  fire-and-forget OFF the save path (§D9-clean — never a sidecar).
- **Cron is interactive-only** — a real Claude TUI in a Duo tab, an in-app
  next-fire timer (NOT a system daemon; fires only while Duo is open). Headless
  `-p` is behind a default-off flag; the scheduler starts only after
  `SESSION_STATE_RESTORE_SETTLED` (the boot catch-up gate).
- **Attention badge** keys off a `DUO_TAB` env stamp + a Duo-managed Claude Stop
  hook posting to the Unix socket.

## Known / flagged (non-blocking)
- **DST spring-forward:** a cron wall-time in the skipped hour (e.g. daily 02:30 on
  the spring-forward day) is silently not fired, and catch-up won't recover it.
  Pinned by a test; accept-or-special-case decision owed (ENH-223 PRD §11d).
- **BUG-211:** browser-pane clipboard first-click focus race — open, P3.

---

> Older initiative writeups (ENH-208 Vault, ENH-212 Home, ENH-216 OKF vault, etc.)
> were removed from this file when they shipped — their detail lives in
> [`session-log.md`](session-log.md) and git history. Keep this file slim: it is
> *current state only*, refreshed whenever a feature merges or the version moves
> (CLAUDE.md rule 13).
