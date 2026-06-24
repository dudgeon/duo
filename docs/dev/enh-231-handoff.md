# ENH-231 — Async Catch-Up Home: build handoff (cloud → local)

> Paste the **"Handoff prompt"** block at the bottom into a fresh local Claude
> Code session to continue. Everything below is the durable context.

## Where we are
- Branch: **`claude/async-catchup-home-view-657v0x`** · PR **#108** (draft).
- Design is **locked**; the **implementation plan is the authoritative playbook**:
  [`docs/prd/enh-231-implementation-plan.md`](../prd/enh-231-implementation-plan.md)
  (phased P0–P7, file:line anchors, the 16 adversarial-review fixes in §11).
  Decisions: [`docs/prd/enh-231-async-catchup-home.md`](../prd/enh-231-async-catchup-home.md) (D1–D8).
  Visual: `docs/research/async-catchup-board.html` (the planned UI — two-tier
  columns, mode toggle, scheduled badge, attention-only).

## ✅ Done & verified headlessly (commit `edfdb53`)
**P0 — contracts** (`shared/types.ts`): `HomeMode`, `AttentionReason`,
`DigestState`, `DigestTodo/File/Artifacts`, `SessionDigest`
(transcript-derived ONLY), `SessionAnnotation` (Duo-owned), `CatchupCard/
Column/Snapshot`; IPC channels `HOME_CATCHUP`, `HOME_MODE_GET/SET/PUSH`,
`SESSION_DIGEST`; `core/settings-service.ts` `homeMode` (default `'projects'`,
coerced on load).

**P1 — the spine:**
- `electron/session-digest.ts` — the pure, deterministic extractor (goal,
  youAsked, todos via `TodoWrite`, files w/ created-vs-edited from
  `toolUseResult`, PR/test artifacts, attention reason, gitBranch, fallback
  snippet). Reuses the now-**exported** tracker helpers in
  `electron/claude-session-tracker.ts` (`readJsonlLines`, `safeParse`,
  `extractAssistantText`, `extractUserMessageText`).
- `core/session-digest-store.ts` — the **rebuildable cache**
  (`~/.claude/duo/session-digests.json`, transcript-only).
- `core/home-state-store.ts` — **Duo-owned** narrative/reviewedAt/watermark
  (`~/.claude/duo/home-state.json`), keyed by uuid (survives tab close).
- Tests: `electron/session-digest.test.ts` (14), `core/session-digest-store.test.ts`
  (6), `core/home-state-store.test.ts` (4) — **all pass**, incl. the §D9
  delete-cache→byte-identical-rebuild gate and a `Date.now()`-never-called
  assertion. Tracker's 47 existing tests still pass. `npm run typecheck` clean.

## 🔑 FIRST thing to do locally (gating)
1. `npm install` (full — this build ran `--ignore-scripts`, so node-pty was
   NOT natively rebuilt; you need the real install for the app).
2. **Confirm the JSONL shapes against real transcripts** — they were ABSENT
   from the cloud container, so the scanners are modeled on the documented
   Claude Code shapes + fixture-tested. Grep a real session:
   ```
   F=$(ls -S ~/.claude/projects/*/*.jsonl | head -1)
   grep -m1 '"name":"TodoWrite"'   "$F"   # todos[].{content,status}
   grep -m1 '"name":"ExitPlanMode"' ~/.claude/projects/*/*.jsonl
   grep -m1 '"toolUseResult":{'    "$F"   # created-vs-edited signal (type:'create')
   ```
   If a field name differs, fix it in `electron/session-digest.ts` (localized)
   and update the fixtures. Then `npm test -- session-digest`.

## ⏳ Remaining phases (from the plan)
- **P2** — Stop-hook digest trigger: add a `digest` arm to
  `skill/scripts/duo-attention.sh` (`duo session digest $DUO_TAB || true`),
  fire it on Stop alongside `set` and on UserPromptSubmit (`--you-asked-only`);
  `electron/install-service.ts` piggybacks the existing Stop arm (no second
  hook entry → no version-bump merge dup). Tests: merge fixture + script test.
- **P3** — `electron/home-snapshot.ts` `buildCatchupSnapshot(...)`: enumerate
  (`enumerateProjectDirs`→`rollupProjects`) within a 7-day window;
  `readOrExtractDigest` per session (cache hit / miss-rebuild / mtime-prefer-
  transcript); `isLive` from `buildHomeOpenJoin` (`electron/main.ts ~:4400`);
  **the tab→uuid resolver `sessionIdForTab` (new primitive — does not exist
  yet)**; column = attention/live; **two-tier: full if (open || attention),
  else compact** (a closed-but-needs-you session MUST stay full); merge
  `home-state.json` annotation; `scheduled` from cron `lastSessionId` set;
  `watermarkAt`. `electron/main.ts`: `HOME_CATCHUP` handler (coalesced) +
  NavBridge methods (`getCatchupBoard`, `getHomeMode`, `setHomeMode` →
  **broadcast `HOME_MODE_PUSH` to ALL windows via WindowRegistry**,
  `getSessionDigest/Note/NextSteps`, `setSessionNote/Next`). Tests in
  `electron/home-snapshot.test.ts`.
- **P5** — CLI: extend the existing `session`/`home` cases in `cli/duo.ts`
  (`duo session digest|note|next`, `duo home mode [v]`, **`duo home catchup
  [--json]`** — a `home` sub-op, NOT a flat verb) + inline `args:`/`summary:`
  help strings; `core/socket-server.ts` extend the `session`/`home` cases.
  **MANDATORY: edit `scripts/check-skill-currency.mjs` SUBCOMMANDS (~:163-191)**
  — add `digest,note,next` to `session` and `mode,catchup` to `home`, else
  `check:skill-currency` hard-fails. Doc 4-surface sync:
  `skill/references/cli-reference.md` (authoritative) + `skill/SKILL.md` +
  `agents/duo.md` (cheat-sheet) + `docs/CLI-COVERAGE.md`. Then
  `npm run build:cli && git add cli/duo`, `npm run sync:claude`,
  `npm run check:skill-currency`.
- **P4 (needs the running app — `/smoke-walk`)** — `renderer/components/Home/`:
  `ModeToggle`, `CatchupBoard` (3 columns, full cards + compact rows beneath),
  `SessionDigestCard` (goal · "You asked" · todo chips · files · artifact
  chips · state badge · narrative-or-fallback; primary **Open session →**,
  md/html → **Open <artifact> →**, PR/diff secondary), `CompactSessionRow`,
  `AttentionChip`, `ScheduledBadge`. Wire `HOME_CATCHUP` into the SAME
  `isActive`-gated effect (BUG-046; toggling mode must NOT fetch). Theme via
  `var(--duo-*)` + `duo-banner-*`/`duo-text-*` (no `dark:`, no Tailwind color
  utils, no bare hex). **P5a preload bridge must land before P4's data path.**
  Match the prototype `docs/research/async-catchup-board.html`.
- **P6** — cron `scheduled` badge (pass cron `lastSessionId` set into assembly).
- **P7** — `tasks.md` status flip, ADR in `docs/DECISIONS.md` (digest cache =
  rebuildable index; home-state.json = Duo-owned), refresh `RESUME.md` +
  `active-sprint.md` + roadmap, run `/smoke-walk` (wait for pasted results),
  then `cut-version`.

## Watch-outs (from the adversarial review — full list in plan §11)
- Narrative/reviewedAt/watermark live in `home-state.json`, **never** the
  rebuildable digest cache (keeps the §D9 test honest). Already structured this
  way in P1 — keep it so in P3/P5.
- `duo home catchup`, not `duo catchup` (no flat-verb / DuoCommandName churn).
- `blocked` heuristic reads `toolUseResult` (string `"Error…"` or `is_error`),
  not just `is_error` (it's near-absent live). Already implemented; verify live.
- `sessionIdForTab` is the load-bearing missing primitive for P3.

---

## Handoff prompt (paste into a fresh LOCAL Claude Code session)

> Continue building **ENH-231 (Async Catch-Up Home)** on branch
> `claude/async-catchup-home-view-657v0x` (PR #108). **Read
> `docs/dev/enh-231-handoff.md` first**, then the authoritative playbook
> `docs/prd/enh-231-implementation-plan.md`.
>
> P0 (types) + P1 (the deterministic digest extractor `electron/session-digest.ts`
> + the two stores `core/session-digest-store.ts` / `core/home-state-store.ts`)
> are **built and verified** (typecheck clean; 24 tests pass incl. the §D9
> rebuild gate). Pick up at **P2**.
>
> **Do these first:** (1) `npm install` (full — the cloud build skipped native
> scripts); (2) confirm the real Claude Code JSONL shapes for
> `TodoWrite`/`ExitPlanMode`/`toolUseResult`/PR-creation against
> `~/.claude/projects/*/*.jsonl` and reconcile `electron/session-digest.ts` +
> its fixtures if any field differs (`npm test -- session-digest`); (3)
> `npm run typecheck` to confirm a clean baseline.
>
> Then build **P2 → P3 → P5 → P4 → P6 → P7** per the plan, honoring the §11
> review fixes (esp. the two-store §D9 boundary, the `check-skill-currency.mjs`
> SUBCOMMANDS edit, `duo home catchup` as a sub-op, the `sessionIdForTab`
> primitive, and `HOME_MODE_PUSH` multi-window fan-out). Commit per phase. The
> renderer (P4) needs the running app — request Electron access at session
> start and finish with `/smoke-walk` before proposing `cut-version`. Match the
> visual prototype `docs/research/async-catchup-board.html`.
