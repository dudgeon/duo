# Resume after compaction — Sprint 22 / v0.8.0 (next-agent handoff)

**Read this first.** Then in order:

1. [`docs/dev/active-sprint.md`](active-sprint.md) — Sprint 22 starting scope + carry-forward queue.
2. [`CLAUDE.md`](../../CLAUDE.md) § Active sprint — same content, shorter form.
3. [`tasks.md`](../../tasks.md) — the running ledger. Top of the file is most-current.

## Where we are

**v0.7.9 just shipped** (2026-05-25) — see [GitHub Release](https://github.com/dudgeon/duo/releases/tag/v0.7.9). Cut + tag + signed DMG + GitHub Release all live. Dev session bumped to v0.8.0. Two commits on `main` since the cut: `6a8525e` (release) + `835f373` (bump) + `acf2bff` (merge with parallel ENH-182 docs that landed during the cut).

**ENH-183 mid-cycle pare-back was the main event.** Started as a four-state polymorphic session header (S0/S1/S2/S3) with auto-hydration + inline rename + educational tip + four CLI verbs. Owner directed Option A pare after walking rev3-rev5: dropped S2 named banner + C11 educational tip + T3 auto-hydration + S2 inline rename + force-rename CLI (~600 LOC). Kept S1 resume pills + S3 restore offer + D5 read ladder + `duo session list/resume`. Full rationale at [`tasks.md § ENH-183 PARED 2026-05-25 (Option A)`](../../tasks.md#enh-183-pared-2026-05-25-option-a--s2--c11--t3--force-rename-dropped).

## Sprint 22 starts here

### Top of the queue: ENH-184 (finish the in-flight work first)

**Owner intent.** Render the title-bar workspace pill as a **passive label** — no dropdown, no caret, no click. All workspace operations route through File menu.

**Working tree state (uncommitted, intentionally left for Sprint 22):**

```
M renderer/App.tsx                                  (flag declared, not consumed)
M renderer/components/WorkspaceSwitcherDropdown.tsx (+ handler fix complete)
?? renderer/hooks/useWorkspacePillMenuFlag.ts       (new flag hook, default OFF)
```

**Next steps:**
1. Read [`docs/dev/active-sprint.md`](active-sprint.md) § ENH-184 for full detail.
2. Wire `workspacePillMenuEnabled` in `App.tsx` to gate the pill's `onClick` + caret render. ~5 lines.
3. CLI parity verb `duo workspace-pill-menu [on|off]` (optional but matches CLAUDE.md § 4).
4. Update [`packs/duo-default/canvases/what-duo-does.html`](../../packs/duo-default/canvases/what-duo-does.html) §37c which still describes the click-to-open behavior.
5. Smoke-walk it via the `/smoke-walk` skill (CLAUDE.md § 7b — MUST invoke via Skill tool).

### Second in queue: ENH-182 (PRD locked, ready to build)

[`docs/prd/enh-182-project-centric-ux.md`](../prd/enh-182-project-centric-ux.md) — locked 2026-05-25, design assets + file:line code map included. Spec-complete; pick up when ENH-184 closes.

## Critical guardrails for the next agent

These are the failure modes I (or the agent before me) hit during the cycle. Read before touching the codebase.

### 1. Verify the artifact BEFORE filing fixes from verbal symptom reports

BUG-159 lesson: owner reported `/rename CLI rename test successful` sitting in claude's input buffer "un-submitted." I jumped to a "LF doesn't commit" hypothesis + shipped a defensive CR-terminator fix. JSONL inspection AFTER the fix showed two `custom-title` entries proving the rename WAS committing — the owner-visible artifact was Claude TUI render timing, not a Duo bug. The fix became moot in the pare anyway, but the process gap stays: **before filing a fix based on a verbal "looks broken" report, check the artifact (file on disk, JSONL entry, network response — whatever the supposed-broken code writes) and confirm the broken behavior is real.** Existing memory rule `feedback_verify_current_behavior_before_proposing_fix.md` applies — extend it from "what's the impact?" framing to "is this even a bug?" framing.

### 2. Symlink-encoding gotcha (BUG-158 root cause, now fixed)

macOS `/tmp/X` is a symlink to `/private/tmp/X`. The shell resolves before passing cwd to Claude, so any session started at a `/tmp/...` path writes to `~/.claude/projects/-private-tmp-X/`. Duo's `encodeProjectDir` now calls `realpathSync()` before encoding (with ENOENT fallback to literal). Don't bypass it for new FS-touching call sites. If you add a new function that reads from `~/.claude/projects/<encoded-cwd>/`, use `encodeProjectDir` not a hand-rolled string transform.

### 3. Capture-on-evidence rule (CLAUDE.md § 12)

The `tabsThatHostedClaude` Set in `electron/main.ts` is the gate for `lastClaudeSession.id` capture. Tabs only get the pointer captured when `claudePresence` actually transitions to `'claude'` for them during THIS Duo run (OR they carry a prior pointer from disk on restore). Don't add new code paths that capture pointers based on cwd-attribute heuristics — that's the BUG that walk-1 surfaced.

### 4. Always invoke `/smoke-walk` via the Skill tool (CLAUDE.md § 7b)

Hard rule. Don't run `.claude/skills/smoke-walk/generate.mjs` directly. The skill's procedural steps (renderer reload, surface re-probe, pref reset, agent-walks-CLI-items) are not in the generator script.

### 5. Renderer reload after dev restarts

After any `npm run dev` kill+spawn cycle, run:
```bash
duo dom --js 'window.location.reload()'
sleep 3
until duo dom --js 'typeof window.electron?.session' 2>&1 | grep -q object; do sleep 1; done
```
HMR through multiple restarts can leave the renderer pinned to an older module graph. ENH-183 walk-1 was burned ~30 min by this.

### 6. Computer-use access at session start for UI work (CLAUDE.md § 7e)

If the session has any meaningful UI work on the table (renderer/, TipTap, CSS, keyboard, modals, etc.), call `request_access` with `applications: ["Electron"]` BEFORE writing code. Don't wait for a smoke walk to fail. The app name is **"Electron"** (the dev target), NOT "Duo" (which resolves to the packaged `.app` in /Applications).

### 7. Owner walks the smoke walk; agent walks the CLI

For any smoke-walk item that's runnable via `duo <verb>` without a mouse click or visual judgment, the agent walks it before handoff (CLAUDE.md § 7b → smoke-walk skill § "Walk every CLI-testable step yourself before handoff"). Mark agent-walked items as known-PASS in the manifest intro so the owner can skip them.

## State at-a-glance

- **Branch:** `main` at `acf2bff` (merge commit). v0.7.9 tag at `6a8525e`. Bump commit at `835f373`. ENH-182 docs commits at `d10bdd2` + `a353f2f`.
- **Git status:** working tree has the 3 ENH-184 files uncommitted. That's intentional — Sprint 22 picks them up.
- **Dev session:** if running, it's on pre-cut code. Next agent should kill + respawn to get the pared SessionHeader.
- **Package version:** 0.8.0 (dev).
- **Pack version:** `packs/duo-default/PACK.json` is 1.0.13 (bumped during the cut to re-fire the in-app "what's new" surface).
- **Smoke walks:** rev3-rev6 manifests in `docs/dev/smoke-walks/` are gitignored; safe to ignore.

## What NOT to do

- Don't re-build the S2 banner / inline rename / C11 tip / T3 auto-hydration. They were intentionally dropped. Adding them back would require a fresh owner conversation.
- Don't reach for `duo session rename` or `duo session hydrate` — those verbs are gone. Type `/rename <title>` in Claude's TUI directly.
- Don't bypass `encodeProjectDir` for direct `~/.claude/projects/<dir>/` lookups — use the helper so the BUG-158 fix applies.
- Don't push commits to `main` without checking for parallel work (Geoff may commit ENH-182-style docs on the web while you're working).

## Quick orientation commands

```bash
# Confirm everything is current
git log --oneline -5
duo doctor
cat package.json | grep version
ls -lh dist/Duo-0.7.9-arm64.dmg

# Read ENH-184's full state
sed -n '/^### ENH-184/,/^---$/p' tasks.md | head -50

# See what's queued
sed -n '/^## Sprint 22/,/^## /p' docs/dev/active-sprint.md
```

Welcome aboard.
