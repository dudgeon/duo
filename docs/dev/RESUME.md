# Resume after compaction — current state (2026-06-21)

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
