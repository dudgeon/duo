# BUG-156 postmortem — terminal stability during ENH-183 walks

> **Why this doc exists.** A multi-hour debugging chain crossed three
> wrong hypotheses before landing on the actual root cause. The
> chain produced a defense-in-depth pattern that should apply across
> the codebase (not just the one bug). Writing it up because
> compaction is imminent and the lessons are bigger than the bug.

## TL;DR

- **Trigger:** ENH-183 walk-2 fix at [07d7a08](https://github.com/dudgeon/duo/commit/07d7a08) introduced
  `<div className="relative flex-1 min-h-0">` as the xterm host's
  flex parent (needed for the in-flow SessionHeader slot).
- **Latent bug exposed:** `TerminalInstance`'s ResizeObserver +
  visibility-change + typography-change effects all called
  `fit.fit()` then `window.electron.pty.resize(tab.id, cols, rows)`
  **without a zero-size guard**. Pre-walk-2, the host was inside
  `h-full` and could never reach 0 — the missing guard had never
  mattered.
- **Cascade:** `min-h-0` allowed the flex child to transiently shrink
  to 0 during layout reflow (any SessionHeader state machine
  transition). The ResizeObserver fired → `fit.fit()` against a
  0×0 host → cols/rows computed as 0 → `pty.resize(0, 0)` → node-pty's
  `ioctl(TIOCSWINSZ)` wrote a degenerate winsize → child Claude
  TUI saw 0×0 cells → exited cleanly → SIGHUP propagated through
  the process group → zsh printed "1 jobs SIGHUPed" → `[process
  exited]` from xterm.
- **`/resume` re-crashed** because first-paint reflow hits the
  same 0×0 window before layout settles.
- **Fix:** defense-in-depth at three layers (PtyManager.resize +
  ResizeObserver + the other two resize call sites). Wrapper stays
  as designed.
- **Walk-3 outcome:** 3 PASS (S1-VISIBLE, S1-MORE-THAN-3,
  S1-FRESH-TAB-NOT-OVERCAPTURED), 1 FAIL (T3, the BUG-156
  incident), 1 SKIP (cascade). The fix landed at [afb590c](https://github.com/dudgeon/duo/commit/afb590c).

## Investigation timeline

The chain crossed three wrong hypotheses before landing the real
cause. Each one looked plausible at the time + each pruning
narrowed the search. Recording in order so the *thinking* survives,
not just the conclusion.

### Hypothesis 1 (REJECTED) — undefined CSS vars

Walk-2 owner report: "text renders invisible in light mode; in
dark mode I can see the text but there is no context."
Diagnosis: the cherry-picked f351719 banner CSS used `var(--duo-text)`,
`var(--duo-text-mute)`, `var(--duo-surface)` — **none of which
exist** in Duo's actual CSS-var set. The vars resolved to undefined,
fell back to transparent bg + dark-on-dark text. The cherry-picked
banner had been visually broken since 2026-05-23; the S3 single-row
use case mostly hid it because that surface was rarely exercised.
Fix [07d7a08](https://github.com/dudgeon/duo/commit/07d7a08): hardcoded the locked Variant B mockup
palette (`#1a1814` bg, `#fbf8f1` titles, `#9a9080` mute, `#c46a1c`
accent).

### Hypothesis 2 (REJECTED) — absolute-overlay layout

Same walk-2 report: "you did not follow the agreed upon layout
(variant B)." The cherry-picked banner used `position: absolute;
top: 8px; left: 8px; right: 8px` — a floating card over xterm.
Mockup wanted an in-flow slot between tab strip and xterm. With
the transparent bg from Hypothesis 1, the shell prompt bled
through. Fix [07d7a08](https://github.com/dudgeon/duo/commit/07d7a08): restructured TerminalPane to
flex-column with SessionHeader above + `<div className="relative
flex-1 min-h-0">` wrapping `TerminalInstance` children. Banner is
now `position: static`.

**This fix is what later enabled BUG-156.** `min-h-0` allows
flex children to shrink to 0; the latent fit-then-resize bug
was previously unreachable.

### Hypothesis 3 (REJECTED) — over-capture in workspace metadata

Walk-2 follow-up: "when I opened a new raw terminal tab in the
same CWD, I did not get the resume UI." Diagnosis: C2's enrichment
hook captured `lastClaudeSession.id` for every tab whose cwd had
a recent JSONL — even tabs that never ran Claude. Fresh shell tab
in `/docs` inherited the cwd's most-recent session UUID just by
existing in that CWD when an autosave fired. SessionHeader's
discriminator routed it to S3 ("This tab had: …") instead of S1
(pills). Fix [cbaeb9c](https://github.com/dudgeon/duo/commit/cbaeb9c): added `tabsThatHostedClaude:
Set<tabId>` updated by `claudePresence.onChange`; hook gates
capture on set membership OR a prior pointer from disk
(workspace-restore preserves). Positional-matching fix at
[60f5957](https://github.com/dudgeon/duo/commit/60f5957) (multiple tabs in same cwd needed
ordered tabId consumption — without it, all entries mapped to
the first tab).

PRD § D9 + CLAUDE.md § 12 updated with "capture-on-evidence-not-
speculation" sub-rule. Smoke-walk SKILL.md § 4c/4d extended with
computed-style + state-precondition probes. These docs land the
broader pattern.

### Hypothesis 4 (REJECTED, defensively acted on) — T3 hydrator /rename injection

Walk-3 owner report: "during enh-183-t3 walk, I sent two prompts
to claude; while claude was working on the second prompt, I
started typing the third to be ready to send it; then claude
spontaneously quit with no warning: I re-initiated claude, used
/resume to resume prior sessions, and it quit again."

Owner's hypothesis: my T3 trigger's `\r/rename <derived>\n` PTY
injection arriving mid-turn caused Claude to bail. Plausible
because:
1. The `\r` is interpreted by terminals as Enter, force-submitting
   any partial input the user had typed.
2. `/rename` arriving mid-Claude-turn could land in a queue state
   that doesn't accept slash commands.

**Forensic findings (the key evidence that ruled this out):**
- Inspected every JSONL in `~/.claude/projects/` modified during
  the walk window. Most-recent user session in the duo cwd
  (`6226b1f8-…`) has 34 user prompts + 9 ai-title entries + **ZERO
  `{"type":"custom-title", ...}` entries**.
- My gate (`already-has-aiTitle`) should have blocked any
  injection — the session had a Haiku-generated ai-title from the
  jump.
- The only custom-title writes today are in the agent's own
  session (`896d1042-…` = "Main live sprint"), generated by
  Claude Code's own internal mechanism, not by Duo's hydrator.

Hydrator never fired against the user's session. Hypothesis 4
rejected by absence-of-evidence.

**Defensive action [076e221](https://github.com/dudgeon/duo/commit/076e221) — still in place.** Even
though Hypothesis 4 turned out to be wrong, the T3 auto-hydrator
got disabled via a feature flag (`T3_AUTO_HYDRATION_ENABLED =
false`). Reasoning: the `\r` force-submit problem is real (it
WOULD commit user partial input as a Claude prompt if the gate
ever opened). The disable stays until we have an idle-gate for
the injection. See **FOLLOWUP-028** below.

### Hypothesis 5 (the actual cause) — pty.resize(0, 0)

SIGHUP is a process-group signal, not stdin content. That
fingerprint pointed at PTY destruction, not bad input. Audited
every `pty.kill` / `ptyManager.kill` / `pty.dispose` call site:

```
renderer/components/TerminalPane.tsx:493  // cleanup useEffect
renderer/hooks/useTerminal.ts:34          // cleanup useEffect (dead code)
core/pty-manager.ts:100                   // kill(id)
core/pty-manager.ts:114                   // dispose() loop
electron/main.ts:1186                     // ipcMain IPC.PTY_KILL handler
```

Walked each path → none could have fired during the user's walk
window. Renderer cleanup useEffect deps `[tab.id, tab.cwd,
onTitleChange]` are all stable; tab wasn't being unmounted.

Then audited every `pty.resize` site. Found the gap:

```
renderer/components/TerminalPane.tsx:585  // ResizeObserver - NO size guard
renderer/components/TerminalPane.tsx:536  // typography effect - NO guard
renderer/components/TerminalPane.tsx:547  // visibility effect - NO guard
core/pty-manager.ts:94 (pre-fix)          // unconditional pty.resize call
```

A `safeFit()` helper existed at line 424 with the right guard:
```ts
const { width, height } = host.getBoundingClientRect()
if (width <= 0 || height <= 0) return false
```

…but only the initial mount used it. The three resize sites that
fire during the component's lifetime did `fit.fit()` directly +
fed the result to `pty.resize(tab.id, cols, rows)`.

When the SessionHeader's height transitions (S0↔S1↔S2↔S3 changes,
claudePresence flicker, listPrior fetch resolving), the wrapper's
flex layout reflows. **`min-h-0` allows the wrapper to shrink to 0
during reflow.** The xterm host's ResizeObserver fires. `fit.fit()`
runs against a 0×0 host. xterm computes 0 cols / 0 rows. The
unguarded `pty.resize(0, 0)` lands in `PtyManager.resize`. node-pty's
`ioctl(TIOCSWINSZ)` writes a degenerate winsize. Claude's TUI sees
0×0 cells, exits cleanly. SIGHUP propagates.

`/resume` re-crashed because first-paint reflow hits the same
0×0 transient window before layout settles.

**Pre-walk-2, the xterm host was inside `w-full h-full` — never
zero.** The resize-without-guard bug had been latent in the
ResizeObserver path forever. The flex-column wrapper was the
first time the host could reach 0×0.

## The fix

[afb590c](https://github.com/dudgeon/duo/commit/afb590c) — defense-in-depth across three layers:

| Layer | File | Guard |
|---|---|---|
| Main-process API boundary | `core/pty-manager.ts::resize()` | Early-return if `cols < 1 \|\| rows < 1`. **Authoritative.** Even if a renderer path forgets the check in the future, main rejects the bad dimensions before they reach node-pty's ioctl. |
| ResizeObserver | `renderer/components/TerminalPane.tsx:577-595` | `host.getBoundingClientRect()` width/height check before `fit.fit()` + skip `pty.resize` if `cols < 1 \|\| rows < 1`. |
| Typography effect | `renderer/components/TerminalPane.tsx:534-538` | Skip `pty.resize` if `cols < 1 \|\| rows < 1`. |
| Visibility-change effect | `renderer/components/TerminalPane.tsx:544-549` | Same. |

The wrapper itself stays as designed — `min-h-0` is required for
flex-column to give SessionHeader its natural height + cede the
remainder to xterm. The fix is at the layer where the bad value
is generated, not where it's exposed.

## Walk-3 results (partial)

| Item | Status | Notes |
|---|---|---|
| ENH-183-S1-VISIBLE | ✅ PASS | Walk-2 CSS-palette fix verified |
| ENH-183-S1-MORE-THAN-3 | ✅ PASS | Show-all expansion path works |
| ENH-183-S1-FRESH-TAB-NOT-OVERCAPTURED | ✅ PASS | Capture-on-evidence gate fix verified |
| ENH-183-T3-AUTO-HYDRATION | ❌ FAIL | Claude crash → BUG-156 (root-caused + fixed; T3 still defensively off) |
| ENH-183-S2-EXPANDED | ⏸ SKIP | Cascade after T3 fail; can be re-walked manually via the CLI-HYDRATE path |
| ENH-183-S2-COLLAPSED-DOT, S2-INLINE-RENAME, S2-RENAME-GATE, S3-RESTORE, S3-DISMISS, C11-EDUCATIONAL-TIP, CLI-RENAME, CLI-HYDRATE | ⏸ NOT REACHED | Owner stopped the walk to investigate the crash |

3 PASS / 1 FAIL / 1 SKIP / 8 not reached. The 3 PASS items
exhausted the S1 surface (the major fix-cluster from walks 1+2);
the 8 not-reached items still need owner verification post-fix.

## Lessons

### 1. SIGHUP fingerprint matters

`zsh: warning: 1 jobs SIGHUPed` is a process-group teardown signal,
not stdin content. The investigation lost ~30 minutes to
Hypothesis 4 (T3 /rename injection) because the crash *correlated*
with the T3 walk + injection was the most recently-touched code.
The right pivot — pause and ask "what would cause SIGHUP
mechanically?" — bypasses the content-level theories entirely.
For future PTY crashes, **first check the signal type. SIGHUP =
PTY/process-group destruction. SIGTERM/SIGKILL = explicit kill.
SIGSEGV = process bug. SIGBUS = file mapping. Each one's
root-cause set is disjoint from the others.**

### 2. Latent bugs reachable through layout changes

`fit.fit()` + `pty.resize(cols, rows)` without checking
`host.getBoundingClientRect()` is a latent bug pattern. It only
matters when the host can transiently reach 0×0. Layout-change
PRs (flex restructure, splitter resize, sidebar collapse) can
expose latent input-validation bugs in completely-unrelated
subsystems. **Anytime a layout change exposes a parent to
0-dimension states, audit downstream consumers of size for
0-input handling.**

This isn't xterm-specific. Any sibling that does "measure DOM →
write to backing system via IPC" should defensively check the
measured value before sending. Browser pane WebContentsView
bounds, image-viewer aspect-ratio calcs, canvas-iframe sizing —
all have the same shape.

### 3. Defense-in-depth at API boundaries

The fix put the authoritative guard in `PtyManager.resize` — the
main-process API boundary. Even if a future renderer path forgets
the check, main rejects the bad input. Renderer-side guards are
belt-and-suspenders. **The right place for "this value must be
sane" checks is the lowest-level API that crosses a process
boundary, because forgetting one renderer path is too easy.**

### 4. The wrong-hypothesis trail is its own data

Three rejected hypotheses isn't a bug-investigation failure; it's
how narrowing works. Each rejection eliminated a class of causes.
The recording-the-rejection part matters more than I thought —
two of the wrong hypotheses (Hyp 1 undefined CSS vars, Hyp 3
over-capture) found *other real bugs* that needed fixing in their
own right. Without writing them up, those fixes would have
shipped as undifferentiated "BUG-156 work" without their own
lessons captured.

### 5. Renderer state transitions trigger main-process side effects

When SessionHeader changes height, the wrapper reflows, ResizeObserver
fires, `pty.resize` IPC fires, main-process state mutates. **A
renderer state-machine change had a main-process side effect with
no explicit IPC contract documenting that link.** Future
state-machine work touching TerminalInstance's parent should
include "what does this do to xterm sizing?" in its review
checklist.

## Follow-up work

Filed as separate tasks (see tasks.md):

- **FOLLOWUP-028 — T3 auto-hydrator: input-buffer race redesign.** The
  defensive disable [076e221](https://github.com/dudgeon/duo/commit/076e221) stays. Need an idle-gate
  before re-enable (e.g. tail JSONL for the most recent assistant
  turn completion; only inject when the queue is empty + the
  user-input buffer is empty). Probably also need to use `\n`
  instead of `\r` so we don't force-submit partial user input.
  Owner decision before re-enable.
- **BUG-157 — Audit sibling fit-then-resize patterns.** The same
  latent shape exists in any "measure DOM → write to backing
  system" loop. Check ImageView, BrowserRenderer, AuxBrowserSlot
  ResizeObservers; check the `useTerminalIPC` hook (dead code per
  grep but worth removing).
- **Smoke-walk re-walk.** 8 items not reached during walk-3. The
  fix unblocks them; owner can re-walk when ready. ENH-183-T3-
  AUTO-HYDRATION will remain a SKIP-with-note until FOLLOWUP-028
  ships.

## Cross-references

- BUG-156 in tasks.md — closed; root cause documented above.
- ENH-183 build plan § Lessons learned § 14 — walk-1/2/3 fix
  chain entries.
- PRD § D9 — capture-on-evidence-not-speculation sub-rule (from
  Hypothesis 3 fix).
- CLAUDE.md § 12 — no-sidecar anti-pattern rule updated with the
  capture-on-evidence sub-rule.
- Smoke-walk SKILL.md § 4c (computed-style probe) + § 4d
  (state-precondition probe) — additions from walks 1 + 2 fixes.

## Commit chain

```
07d7a08  Hypothesis 1+2 fixes (CSS palette + flex-column wrapper)
2584c20  S1 auto-dismiss race fix (defensive correctness)
cbaeb9c  Hypothesis 3 fix (capture-on-evidence enrichment gate)
60f5957  Positional matching follow-up (gate's tabId resolution bug)
076e221  Hypothesis 4 defensive disable (T3 auto-hydrator off)
e4e826f  Hypothesis 3 docs (PRD + CLAUDE.md + skill)
afb590c  HYPOTHESIS 5 fix (pty.resize zero guard) — ROOT CAUSE
```
