# Resume after compaction — Sprint 21 / v0.7.9 (ENH-183 walk-3 in-flight)

**Read this first.** Then in order:
1. [`docs/research/bug-156-terminal-stability-postmortem.md`](../research/bug-156-terminal-stability-postmortem.md) — the most recent investigation chain; lessons + the open follow-ups.
2. [`docs/dev/enh-183-build-plan.md`](enh-183-build-plan.md) — ENH-183 C1–C13 status + § Lessons learned (now includes § 14, the walk-1/2/3 fix chain).
3. [`tasks.md`](../../tasks.md) — current open work at the top of Sprint 21 section. BUG-156 closed; FOLLOWUP-028 + BUG-157 open.

## Where we are

**ENH-183 implementation complete** (C1–C13 all landed). Smoke walk **rev3 in progress**, partial paste-back captured:

| Walk-3 item | Status |
|---|---|
| ENH-183-S1-VISIBLE | ✅ PASS |
| ENH-183-S1-MORE-THAN-3 | ✅ PASS |
| ENH-183-S1-FRESH-TAB-NOT-OVERCAPTURED | ✅ PASS |
| ENH-183-T3-AUTO-HYDRATION | ❌ FAIL → BUG-156 root-caused + fixed; T3 defensively OFF |
| ENH-183-S2-EXPANDED | ⏸ SKIP (cascade) |
| ENH-183-S2-COLLAPSED-DOT through ENH-183-CLI-HYDRATE | ⏸ NOT REACHED (owner stopped walk after T3 crash) |

8 items still need owner verification. The fix that unblocks them is [afb590c](https://github.com/dudgeon/duo/commit/afb590c) (`PtyManager.resize` zero guard + defense-in-depth at three renderer sites).

## Recent commit chain (last 10)

```
65e3a01  docs(BUG-156): terminal-stability postmortem + FOLLOWUP-028 + BUG-157
afb590c  fix(BUG-156): pty.resize(0,0) crashed Claude — root-cause + defense-in-depth guard
076e221  hotfix(ENH-183 BUG-156): disable T3 auto-hydrator after Claude crash during rev3 walk
60f5957  fix(ENH-183): positional matching in enrichment hook tab-id lookup
e4e826f  docs(ENH-183): capture-on-evidence sub-rule across PRD + CLAUDE.md + skill
cbaeb9c  fix(ENH-183 post-walk-1): only capture lastClaudeSession.id for tabs that hosted Claude
2584c20  fix(ENH-183): only auto-dismiss S1 pills on actual same-tab claude transition
07d7a08  fix(ENH-183 walk-1): S1 banner visual + layout — terminal palette + in-flow
6c1ceeb  docs(smoke-walk): require Skill-tool invocation + fix HMR-staleness gap
182969c  chore(ENH-183 C13): smoke-walk manifest for v0.7.9 ready (gitignored)
```

## Likely next moves (pick by owner direction)

### A. Continue the rev3 walk

The 8 unreached items are unblocked by [afb590c](https://github.com/dudgeon/duo/commit/afb590c). To resume:
1. The walk page is at `docs/dev/smoke-walks/v0.7.9-rev3.html` (gitignored). Regenerate via `node .claude/skills/smoke-walk/generate.mjs docs/dev/smoke-walks/v0.7.9-rev3.json docs/dev/smoke-walks/v0.7.9-rev3.html` if needed — though prefer the Skill-tool path (see below).
2. **MUST invoke `/smoke-walk` skill via the Skill tool** (not the generator directly) — see [CLAUDE.md § 7b](../../CLAUDE.md). Audit-trail requirement; the skill's preflight (§ 4b reload, § 4c surface probe, § 4d state-precondition probe, § 5b items 7+8) catches the failure modes from walks 1–3.
3. ENH-183-T3-AUTO-HYDRATION stays a known SKIP — pre-mark in the intro. Owner can exercise the same flow manually via `duo session hydrate <tabId>` (ENH-183-CLI-HYDRATE item).
4. After paste-back: parse → flip tasks.md → propose `cut-version` for v0.7.9 if all green.

### B. Address FOLLOWUP-028 (T3 re-enable design)

T3 auto-hydrator is OFF. To re-enable, the design needs:
- Replace `\r` with `\n` in the hydrator's PTY-write (don't force-submit user's partial input).
- Add JSONL idle-gate: only inject when last assistant entry is terminated.
- Add tracer log (per BUG-156 convention) — every PTY synthesis without explicit user gesture must record `(timestamp, tabId, sessionUuid, payload)`.

Flag toggle at `T3_AUTO_HYDRATION_ENABLED = false` in [`electron/main.ts`](../../electron/main.ts) § `setEnrichBeforePersistHook`.

### C. Address BUG-157 (sibling fit-then-resize audit)

Pre-emptive — the BUG-156 pattern (measure DOM → write to backing system via IPC, no zero-dim guard) likely exists in other components:
- `renderer/components/ImageView.tsx:95` — ResizeObserver
- `renderer/components/BrowserRenderer.tsx:57` — bounds → WCV
- `renderer/components/AuxBrowserSlot.tsx:111` — bounds → WCV
- `renderer/hooks/useTerminal.ts:42` — likely dead code; verify + remove

For each: identify the IPC boundary, defensively reject zero/negative dimensions in main (mirrors `PtyManager.resize` guard).

## Critical guardrails for the next agent

Read these BEFORE touching the codebase — they're failure modes I hit this session that will re-bite a fresh agent.

### 1. Use `/smoke-walk` skill via the Skill tool

CLAUDE.md § 7b hard rule (strengthened 2026-05-24). Do NOT run `.claude/skills/smoke-walk/generate.mjs` directly. The skill's procedural rules (§ 4b renderer reload, § 4c computed-style probes, § 4d state-precondition probes, § 5b 8-item checklist) are what catches the regressions that bit walks 1–3. Bypassing them is auditable as a process failure even if output looks right.

### 2. SIGHUP = process-group teardown, not stdin content

If Claude crashes with `zsh: warning: 1 jobs SIGHUPed`, **don't chase stdin/PTY-content theories first.** SIGHUP comes from PTY destruction or process-group signal — audit `pty.kill` / `pty.dispose` / `pty.resize` paths before assuming bad input. BUG-156 burned ~30 min on a stdin-content hypothesis before pivoting; the signal type was the right first clue.

### 3. `duo eval` vs `duo dom --js`

`duo eval` targets the **browser pane** (WebContentsView). `duo dom --js` targets the **main renderer** (the React shell). When probing renderer state, use `duo dom --js`. Burning 15 minutes rediscovering this is a session-1 trap.

### 4. Force a renderer reload after dev restarts

Multiple dev restarts during a sprint can leave HMR in a stale state where the source on disk doesn't match what the renderer is running. After ANY dev kill+spawn cycle, run:

```bash
duo dom --js 'window.location.reload()'
sleep 3
until duo dom --js 'typeof window.electron?.session' 2>&1 | grep -q object; do sleep 1; done
```

Skill § 4b enforces this; it was added 2026-05-24 because walks 1–2 hit HMR-staleness and gave false PASS on agent probes.

### 5. Don't sidecar speculative pointers

CLAUDE.md § 12 (capture-on-evidence sub-rule, added 2026-05-24). If you're tempted to "guess" a Duo-owned pointer for a tab/object based on its attributes (cwd, kind), don't. Only capture on actual evidence the association exists (e.g. `claudePresence` transitioned to 'claude' for THIS tab during THIS Duo run). Walk-1's over-capture bug was exactly this pattern.

### 6. Verify computed styles, not just element existence

Skill § 4c. A surface can be `mounted: true` with the right `textContent` and still be invisible (transparent background, dark-on-dark text). Probe `getComputedStyle(...).backgroundColor` + `.color` on the surface root + key children, not just `querySelector`. ENH-183 walk-1 had this exact failure mode (undefined CSS vars → transparent + dark-on-dark).

### 7. TerminalPane wrapper is now `flex-col` with `min-h-0` on the child

ENH-183 walk-2 fix [07d7a08](https://github.com/dudgeon/duo/commit/07d7a08). The SessionHeader is in-flow above TerminalInstance children. `min-h-0` is required for `flex-1` to take remaining space (CSS gotcha) — **don't** remove it. The latent zero-dim resize bug it exposed is now guarded at the API boundary in `PtyManager.resize` (BUG-156). If you re-touch TerminalPane, the resize guards must stay.

## State at-a-glance

- **Branch:** `main` (no feature branch in flight)
- **Git status:** all ENH-183 work pushed through [65e3a01](https://github.com/dudgeon/duo/commit/65e3a01)
- **Dev:** restarted at [afb590c](https://github.com/dudgeon/duo/commit/afb590c); renderer reloaded; `duo doctor` clean
- **Active workspace:** `/Users/geoffreydudgeon/Desktop/session.duo-workspace` (test workspace; 5+ shell tabs in `/docs` cwd)
- **Smoke walk page open:** `docs/dev/smoke-walks/v0.7.9-rev3.html` as the active browser tab
- **T3 hydrator:** `T3_AUTO_HYDRATION_ENABLED = false` (flag in main.ts; OFF pending FOLLOWUP-028)
- **45 ENH-183 unit tests passing.** typecheck clean.

## What NOT to do

- Don't re-enable T3 without FOLLOWUP-028 design landing (input-buffer race + idle-gate + tracer).
- Don't run the smoke-walk generator script directly — use the Skill tool.
- Don't assume HMR caught up — always force a renderer reload after dev restarts.
- Don't propose a v0.7.9 cut until the 8 unreached walk items have owner verification (cut-version skill's Step 0 will block on this anyway).
- Don't remove the `min-h-0` from TerminalPane's wrapper — it's required for the mockup-locked SessionHeader slot.

## Reading order if you're picking up the smoke walk specifically

1. [`docs/dev/smoke-walks/v0.7.9-rev3.json`](smoke-walks/v0.7.9-rev3.json) — current manifest (13 items)
2. [`docs/research/bug-156-terminal-stability-postmortem.md`](../research/bug-156-terminal-stability-postmortem.md) — § Walk-3 results table for what's PASS/FAIL/SKIP/NOT-REACHED
3. [`.claude/skills/smoke-walk/SKILL.md`](../../.claude/skills/smoke-walk/SKILL.md) — § 4b/4c/4d/5b — pre-handoff checks (latest additions catch BUG-156-style failures)
4. The walk page is open in Duo's browser pane; `duo url` to confirm.
